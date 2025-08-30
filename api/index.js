// api/index.js (v2.0 - Stabil & Anti-Bot)
const express = require('express');
const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cheerio = require('cheerio');

// --- Konfigurasi ---
console.log('Menginisialisasi server (v2.0)...');
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
    console.log(`Memulai navigasi ke: ${url}`);
    try {
        // SOLUSI: Konfigurasi browser yang lebih tangguh sesuai rekomendasi
        browser = await playwright.chromium.launch({
            args: chromium.args,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true, // Abaikan error sertifikat HTTPS
        });

        // SOLUSI: Menyamarkan scraper agar tidak terdeteksi Cloudflare
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        });
        const page = await context.newPage();

        console.log(`Mencoba membuka halaman: ${url}`);
        // SOLUSI: Menunggu hingga semua koneksi jaringan selesai (penting untuk Cloudflare)
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });

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

// ... Fungsi getAiSuggestion dan scrapeDetailsWithAi tetap sama ...

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
    const $ = cheerio.load(html_content);
    $('script, style').remove();
    const cleanText = $('body').text().replace(/\s\s+/g, ' ').trim();
    
    const prompt = `
    Anda adalah ahli scraper. Tujuan: "${goal}".
    Dari teks konten berikut, ekstrak semua informasi relevan ke dalam format JSON yang VALID.
    Teks konten: --- ${cleanText.substring(0, 50000)} ---
    Pastikan JSON 100% valid. Jika tidak ada, gunakan null.`;
    
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

