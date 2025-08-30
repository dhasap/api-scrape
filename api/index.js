// api/index.js (v2.4 - Peningkatan Stabilitas & Logging)
const express = require('express');
const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cheerio = require('cheerio');

// --- Konfigurasi ---
console.log('Menginisialisasi server (v2.4)...');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const AI_MODEL_NAME = "gemini-1.5-flash";

if (!GEMINI_API_KEY) {
    console.error("KRITIS: API Key Gemini tidak ditemukan.");
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const app = express();
app.use(express.json({ limit: '50mb' }));

// --- Logika Inti ---

async function getPageElements(url) {
    let browser = null;
    console.log(`[NAVIGATE] Memulai proses untuk URL: ${url}`);
    try {
        console.log(`[NAVIGATE] Mencari path executable Chromium...`);
        const executablePath = await chromium.executablePath();
        
        if (!executablePath) {
             throw new Error("Path executable Chromium tidak ditemukan.");
        }
        console.log(`[NAVIGATE] Path ditemukan. Meluncurkan browser...`);
        
        browser = await playwright.chromium.launch({
            args: chromium.args,
            executablePath: executablePath,
            headless: true, // Wajib true untuk lingkungan serverless
            ignoreHTTPSErrors: true,
        });
        
        console.log(`[NAVIGATE] Browser berhasil diluncurkan.`);
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        });
        const page = await context.newPage();
        
        // Menaikkan timeout default untuk navigasi
        page.setDefaultNavigationTimeout(60000); // 60 detik

        console.log(`[NAVIGATE] Membuka halaman: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle' });
        console.log(`[NAVIGATE] Halaman berhasil dimuat.`);

        const htmlWithIds = await page.evaluate(() => {
            const elements = document.querySelectorAll('a, button, input[type="submit"], input[type="text"], input[type="search"]');
            elements.forEach((el, index) => el.setAttribute('data-ai-id', `ai-id-${index}`));
            return document.documentElement.outerHTML;
        });

        const currentUrl = page.url();
        const $ = cheerio.load(htmlWithIds);
        const title = $('title').text() || 'No Title';
        
        const elements = [];
        $('[data-ai-id]').each((i, el) => {
            const element = $(el);
            const href = element.is('a') ? element.attr('href') : null;
            elements.push({
                ai_id: element.attr('data-ai-id'),
                tag: el.tagName.toLowerCase(),
                text: element.text().trim(),
                href: href ? new URL(href, currentUrl).href : null,
                placeholder: element.is('input') ? element.attr('placeholder') : null,
            });
        });

        console.log(`[NAVIGATE] Berhasil memproses ${url}, ditemukan ${elements.length} elemen.`);
        return { current_url: currentUrl, title, elements, html: htmlWithIds };

    } catch (error) {
        console.error(`[NAVIGATE] Gagal total saat memproses ${url}:`, error);
        throw new Error(`Gagal membuka URL: ${error.message}`);
    } finally {
        if (browser) {
            console.log(`[NAVIGATE] Menutup browser.`);
            await browser.close();
        }
    }
}

function getAiSuggestion(goal, current_url, elements) {
    const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
    const elementMapStr = JSON.stringify(elements, null, 2);
    
    const prompt = `
    Anda adalah asisten navigasi web cerdas.
    Tujuan utama: "${goal}"
    URL saat ini: "${current_url}"
    Berikut adalah daftar elemen interaktif yang ada di halaman dalam format JSON:
    ${elementMapStr.substring(0, 30000)}
    Berdasarkan tujuan utama, URL saat ini, dan daftar elemen, tentukan SATU aksi terbaik berikutnya.
    Pilihannya adalah: "navigate", "scrape", atau "fail".
    Berikan jawaban dalam format JSON yang VALID dengan struktur:
    {
      "action": "pilihan_aksi",
      "details": { "url": "url_tujuan", "reason": "Alasan singkat." }
    }`;

    console.log(`[AI-SUGGEST] Meminta saran AI untuk tujuan: ${goal}`);
    return model.generateContent(prompt)
        .then(result => {
            const jsonText = result.response.text().replace(/```json/g, "").replace(/```/g, "").trim();
            return JSON.parse(jsonText);
        })
        .catch(error => {
            console.error(`[AI-SUGGEST] Gagal memberikan saran:`, error);
            return { action: "fail", details: { reason: `Error pada AI: ${error.message}` } };
        });
}

function scrapeDetailsWithAi(goal, html_content) {
    const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
    const $ = cheerio.load(html_content);
    $('script, style').remove();
    const cleanHtml = $('body').html();
    
    const prompt = `
    Anda adalah ahli scraper. Tujuan: "${goal}".
    Dari HTML berikut, ekstrak semua informasi relevan ke dalam format JSON yang VALID, sesuai contoh ini:
    {
      "title": "Judul Komik", "author": "Nama Author", "genre": ["Genre 1"], "status": "Ongoing", "synopsis": "Paragraf sinopsis...",
      "chapters": [{ "chapter_title": "Chapter 1", "url": "https://url-chapter.com" }]
    }
    Ekstrak SEMUA chapter. Jika informasi tidak ada, gunakan null.
    HTML: --- ${cleanHtml.substring(0, 40000)} ---
    `;
    
    console.log(`[AI-SCRAPE] Memulai scraping dengan AI untuk tujuan: ${goal}`);
    return model.generateContent(prompt)
        .then(result => {
            const jsonText = result.response.text().replace(/```json/g, "").replace(/```/g, "").trim();
            if (!jsonText.startsWith('{')) {
                throw new Error(`Respons AI tidak valid (bukan JSON).`);
            }
            return JSON.parse(jsonText);
        })
        .catch(error => {
            console.error(`[AI-SCRAPE] Gagal mengekstrak detail:`, error);
            throw new Error(`AI gagal mengekstrak detail: ${error.message}`);
        });
}

// --- Endpoint API ---

app.post("/api/navigate", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ status: "error", message: "URL diperlukan" });
    try {
        const result = await getPageElements(url);
        res.json({ status: "success", data: result });
    } catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

app.post("/api/suggest_action", async (req, res) => {
    const { goal, current_url, elements } = req.body;
    if (!goal || !current_url || !elements) return res.status(400).json({ status: "error", message: "Parameter tidak lengkap" });
    try {
        const suggestion = await getAiSuggestion(goal, current_url, elements);
        res.json({ status: "success", data: suggestion });
    } catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

app.post("/api/scrape", async (req, res) => {
    const { goal, html_content } = req.body;
    if (!goal || !html_content) return res.status(400).json({ status: "error", message: "Parameter tidak lengkap" });
    try {
        const result = await scrapeDetailsWithAi(goal, html_content);
        res.json({ status: "success", data: result });
    } catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

module.exports = app;
