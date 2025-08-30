// api/index.js
const express = require('express');
const playwright = require('playwright-core');
// PERBAIKAN: Menggunakan library yang benar sesuai package.json
const chromium = require('@sparticuz/chromium');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cheerio = require('cheerio');

// --- Konfigurasi Logging dan Model ---
// ... sisa kode sama persis ...
// ... tidak ada perubahan lain di bawah ini ...
console.log('Menginisialisasi server...');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const AI_MODEL_NAME = process.env.AI_MODEL_NAME || "gemini-1.5-flash";

if (!GEMINI_API_KEY) {
    console.error("KRITIS: API Key Gemini tidak ditemukan di environment variables.");
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const app = express();
app.use(express.json({ limit: '50mb' })); // Menaikkan limit body parser untuk HTML content

// --- Logika Inti ---

async function getPageElements(url) {
    let browser = null;
    console.log(`Memulai navigasi ke: ${url}`);
    try {
        // Menggunakan @sparticuz/chromium yang dioptimalkan untuk serverless
        browser = await playwright.chromium.launch({
            args: chromium.args,
            executablePath: await chromium.executablePath(), // Perhatikan ada () di sini
            headless: chromium.headless,
        });

        const page = await browser.newPage();
        console.log(`Mencoba membuka halaman: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        
        // Scroll untuk memuat konten lazy-load
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight / 2);');
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Injeksi atribut data-ai-id dan ambil HTML
        const htmlWithIds = await page.evaluate(() => {
            const elements = document.querySelectorAll('a, button, input[type="submit"], input[type="text"], input[type="search"]');
            elements.forEach((el, index) => {
                el.setAttribute('data-ai-id', `ai-id-${index}`);
            });
            return document.documentElement.outerHTML;
        });

        const currentUrl = page.url();
        
        // Parsing menggunakan Cheerio, lebih ringan dari JSDOM
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

        console.log(`Berhasil memproses ${url}, ditemukan ${elements.length} elemen.`);
        return { current_url: currentUrl, title, elements, html: htmlWithIds };

    } catch (error) {
        console.error(`Gagal memproses ${url}:`, error);
        throw new Error(`Gagal membuka URL: ${error.message}`);
    } finally {
        if (browser) {
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
    Pilihannya adalah:
    1.  "navigate": Jika Anda harus mengklik sebuah link.
    2.  "scrape": Jika halaman ini sudah merupakan halaman detail yang dicari dan siap untuk diekstrak datanya.
    3.  "fail": Jika Anda tidak bisa menentukan langkah selanjutnya atau merasa buntu.

    Berikan jawaban dalam format JSON yang VALID dengan struktur berikut:
    {
      "action": "navigate" | "scrape" | "fail",
      "details": {
        "ai_id": "ai-id-of-element-to-click",
        "url": "url-to-navigate-to",
        "reason": "Alasan singkat mengapa Anda memilih aksi ini."
      }
    }

    - Jika action adalah "navigate", \`details\` harus berisi \`ai_id\`, \`url\`, dan \`reason\`.
    - Jika action adalah "scrape", \`details\` hanya perlu berisi \`reason\`.
    - Jika action adalah "fail", \`details\` hanya perlu berisi \`reason\`.
    - Pilih elemen yang paling relevan untuk mencapai tujuan.
    `;

    console.log(`Meminta saran AI untuk tujuan: ${goal}`);
    return model.generateContent(prompt)
        .then(result => {
            const jsonText = result.response.text().replace(/```json/g, "").replace(/```/g, "").trim();
            return JSON.parse(jsonText);
        })
        .catch(error => {
            console.error(`AI gagal memberikan saran:`, error);
            return { action: "fail", details: { reason: `Error pada AI: ${error.message}` } };
        });
}


function scrapeDetailsWithAi(goal, html_content) {
    const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
    
    // Menggunakan cheerio untuk membersihkan HTML sebelum dikirim ke AI
    const $ = cheerio.load(html_content);
    // Hapus script dan style tag untuk mengurangi token
    $('script, style').remove();
    const cleanText = $('body').text().replace(/\s\s+/g, ' ').trim();
    
    const prompt = `
    Anda adalah ahli scraper yang sangat teliti. Tujuan scraping adalah: "${goal}".
    Dari teks konten berikut, ekstrak semua informasi relevan ke dalam format JSON yang VALID dan KONSISTEN.
    Teks konten:
    ---
    ${cleanText.substring(0, 50000)}
    ---
    Pastikan JSON 100% valid dan ekstrak semua informasi yang mungkin relevan. Jika tidak ada, gunakan null.
    `;
    
    console.log(`Memulai scraping dengan AI untuk tujuan: ${goal}`);
    return model.generateContent(prompt)
        .then(result => {
            const jsonText = result.response.text().replace(/```json/g, "").replace(/```/g, "").trim();
            return JSON.parse(jsonText);
        })
        .catch(error => {
            console.error(`AI gagal mengekstrak detail:`, error);
            throw new Error(`AI gagal mengekstrak detail: ${error.message}`);
        });
}


// --- Endpoint API ---

app.post("/api/navigate", async (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ status: "error", message: "URL diperlukan" });
    }
    console.log(`Menerima request navigasi ke: ${url}`);
    try {
        const result = await getPageElements(url);
        res.json({ status: "success", data: result });
    } catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

app.post("/api/suggest_action", async (req, res) => {
    const { goal, current_url, elements } = req.body;
    if (!goal || !current_url || !elements) {
        return res.status(400).json({ status: "error", message: "Parameter goal, current_url, dan elements diperlukan" });
    }
    console.log(`Menerima request saran AI untuk tujuan: ${goal}`);
    try {
        const suggestion = await getAiSuggestion(goal, current_url, elements);
        res.json({ status: "success", data: suggestion });
    } catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

app.post("/api/scrape", async (req, res) => {
    const { goal, html_content } = req.body;
    if (!goal || !html_content) {
        return res.status(400).json({ status: "error", message: "Parameter goal dan html_content diperlukan" });
    }
    console.log(`Menerima request scrape untuk tujuan: ${goal}`);
    try {
        const result = await scrapeDetailsWithAi(goal, html_content);
        res.json({ status: "success", data: result });
    } catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
});

// Vercel akan menangani routing, kita hanya perlu export app
module.exports = app;

