# api/index.py
import os
import asyncio
import logging
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from bs4 import BeautifulSoup
import google.generativeai as genai
from playwright.async_api import async_playwright
import json
from urllib.parse import urljoin
import sparticuz_chromium
from typing import List, Dict, Any, Optional

# --- Konfigurasi Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Konfigurasi Model & API Key ---
try:
    GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
    if not GEMINI_API_KEY:
        raise ValueError("API Key Gemini tidak ditemukan di environment variables.")
    genai.configure(api_key=GEMINI_API_KEY)
    AI_MODEL_NAME = os.environ.get("AI_MODEL_NAME", "gemini-1.5-flash")
except ValueError as e:
    logging.critical(f"Gagal mengonfigurasi Gemini: {e}")
    # Jika API key tidak ada, aplikasi tidak bisa berjalan.
    # Kita bisa raise exception di sini atau membiarkannya gagal saat dipanggil.
    # Untuk Vercel, lebih baik log error dan biarkan endpoint gagal dengan pesan jelas.
    AI_MODEL_NAME = "gemini-1.5-flash" # Fallback

app = FastAPI()

# --- Model Data (Pydantic) ---

class Element(BaseModel):
    ai_id: str
    tag: str
    text: Optional[str] = None
    href: Optional[str] = None
    placeholder: Optional[str] = None

class NavigateRequest(BaseModel):
    url: str

class ScrapeRequest(BaseModel):
    html_content: str
    goal: str

class SuggestActionRequest(BaseModel):
    goal: str
    current_url: str
    elements: List[Element]

# --- Logika Inti ---

async def get_page_elements(url: str):
    """Membuka URL dengan Playwright, mengekstrak elemen, dan mengembalikan HTML."""
    async with async_playwright() as p:
        browser = None
        for attempt in range(3): # Mekanisme Retry
            try:
                if not browser:
                    browser = await p.chromium.launch(
                        executable_path=await sparticuz_chromium.executable_path(),
                        headless=sparticuz_chromium.headless,
                        args=sparticuz_chromium.args
                    )
                page = await browser.new_page()
                logging.info(f"Mencoba navigasi ke {url} (Percobaan {attempt + 1})")
                await page.goto(url, wait_until='domcontentloaded', timeout=30000)
                
                # Scroll untuk memuat konten lazy-load
                await page.evaluate('window.scrollTo(0, document.body.scrollHeight / 2);')
                await asyncio.sleep(1)

                # Injeksi atribut data-ai-id
                js_script = """
                () => {
                    const elements = document.querySelectorAll('a, button, input[type="submit"], input[type="text"], input[type="search"]');
                    elements.forEach((el, index) => {
                        el.setAttribute('data-ai-id', `ai-id-${index}`);
                    });
                    return document.documentElement.outerHTML;
                }
                """
                html_with_ids = await page.evaluate(js_script)
                current_url = page.url
                
                soup = BeautifulSoup(html_with_ids, 'lxml')
                title = soup.title.string if soup.title else 'No Title'
                
                elements = []
                for el in soup.find_all(attrs={"data-ai-id": True}):
                    element_info = {
                        "ai_id": el['data-ai-id'],
                        "tag": el.name,
                        "text": el.get_text(strip=True),
                        "href": urljoin(current_url, el.get('href')) if el.name == 'a' and el.has_attr('href') else None,
                        "placeholder": el.get('placeholder') if el.name == 'input' and el.has_attr('placeholder') else None
                    }
                    elements.append(Element(**element_info))

                await browser.close()
                logging.info(f"Berhasil memproses {url}")
                return {"current_url": current_url, "title": title, "elements": elements, "html": html_with_ids}

            except Exception as e:
                logging.error(f"Gagal pada percobaan {attempt + 1} untuk {url}: {e}")
                if browser:
                    await browser.close()
                    browser = None # Paksa buat ulang browser
                if attempt == 2: # Percobaan terakhir gagal
                    raise HTTPException(status_code=500, detail=f"Gagal membuka URL setelah 3 kali percobaan: {e}")
                await asyncio.sleep(2) # Tunggu sebelum mencoba lagi

def get_ai_suggestion(goal: str, current_url: str, elements: List[Element]):
    """Meminta saran dari AI untuk aksi selanjutnya."""
    model = genai.GenerativeModel(AI_MODEL_NAME)
    element_map_str = json.dumps([el.dict() for el in elements], indent=2)
    prompt = f"""
    Anda adalah asisten navigasi web cerdas.
    Tujuan utama: "{goal}"
    URL saat ini: "{current_url}"

    Berikut adalah daftar elemen interaktif yang ada di halaman dalam format JSON:
    {element_map_str}

    Berdasarkan tujuan utama, URL saat ini, dan daftar elemen, tentukan SATU aksi terbaik berikutnya.
    Pilihannya adalah:
    1.  "navigate": Jika Anda harus mengklik sebuah link.
    2.  "scrape": Jika halaman ini sudah merupakan halaman detail yang dicari dan siap untuk diekstrak datanya.
    3.  "fail": Jika Anda tidak bisa menentukan langkah selanjutnya atau merasa buntu.

    Berikan jawaban dalam format JSON yang VALID dengan struktur berikut:
    {{
      "action": "navigate" | "scrape" | "fail",
      "details": {{
        "ai_id": "ai-id-of-element-to-click",
        "url": "url-to-navigate-to",
        "reason": "Alasan singkat mengapa Anda memilih aksi ini."
      }}
    }}

    - Jika action adalah "navigate", `details` harus berisi `ai_id`, `url`, dan `reason`.
    - Jika action adalah "scrape", `details` hanya perlu berisi `reason`.
    - Jika action adalah "fail", `details` hanya perlu berisi `reason`.
    - Pilih elemen yang paling relevan untuk mencapai tujuan.
    """
    try:
        logging.info(f"Meminta saran AI untuk tujuan: {goal}")
        response = model.generate_content(prompt)
        json_text = response.text.replace("```json", "").replace("```", "").strip()
        return json.loads(json_text)
    except Exception as e:
        logging.error(f"AI gagal memberikan saran: {e}")
        return {"action": "fail", "details": {"reason": f"Error pada AI: {e}"}}


def scrape_details_with_ai(goal: str, html_content: str):
    """AI mengekstrak semua data detail dari halaman final."""
    model = genai.GenerativeModel(AI_MODEL_NAME)
    prompt = f"""
    Anda adalah ahli scraper yang sangat teliti. Tujuan scraping adalah: "{goal}".
    Dari HTML berikut, ekstrak semua informasi relevan ke dalam format JSON yang VALID dan KONSISTEN.
    Potongan HTML:
    ---
    {html_content[:50000]}
    ---
    Pastikan JSON 100% valid dan ekstrak semua informasi yang mungkin relevan. Jika tidak ada, gunakan null.
    """
    try:
        logging.info(f"Memulai scraping dengan AI untuk tujuan: {goal}")
        response = model.generate_content(prompt)
        json_text = response.text.replace("```json", "").replace("```", "").strip()
        return json.loads(json_text)
    except Exception as e:
        logging.error(f"AI gagal mengekstrak detail: {e}")
        raise HTTPException(status_code=500, detail=f"AI gagal mengekstrak detail: {e}")

# --- Endpoint API ---

@app.post("/api/navigate")
async def http_navigate(request: NavigateRequest):
    logging.info(f"Menerima request navigasi ke: {request.url}")
    result = await get_page_elements(request.url)
    return {"status": "success", "data": result}

@app.post("/api/suggest_action")
async def http_suggest_action(request: SuggestActionRequest):
    logging.info(f"Menerima request saran AI untuk tujuan: {request.goal}")
    suggestion = get_ai_suggestion(request.goal, request.current_url, request.elements)
    return {"status": "success", "data": suggestion}

@app.post("/api/scrape")
async def http_scrape(request: ScrapeRequest):
    logging.info(f"Menerima request scrape untuk tujuan: {request.goal}")
    result = scrape_details_with_ai(request.goal, request.html_content)
    return {"status": "success", "data": result}

@app.get("/api/health")
async def health_check():
    return {"status": "ok"}