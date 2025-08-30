// api/index.js (v2.7 - Smart Search Detection)
const express = require('express');
const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cheerio = require('cheerio');

// --- Konfigurasi ---
console.log('Menginisialisasi server (v2.7)...');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const AI_MODEL_NAME = "gemini-1.5-flash";

if (!GEMINI_API_KEY) {
    console.error("KRITIS: API Key Gemini tidak ditemukan.");
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const app = express();
app.use(express.json({ limit: '50mb' }));

// --- Fungsi Analisa Halaman Cerdas ---
function analyzePageContent(html, currentUrl) {
    console.log("[ANALYSIS] Memulai analisa konten halaman...");
    const $ = cheerio.load(html);
    const pageData = {
        current_url: currentUrl,
        title: $('title').text() || 'No Title',
        html: html,
        search_results: [],
        pagination: {},
        other_elements: []
    };

    // --- PERUBAHAN: Logika deteksi halaman pencarian ---
    const isSearchPage = new URL(currentUrl).searchParams.has('s');
    console.log(`[ANALYSIS] Apakah ini halaman pencarian? ${isSearchPage}`);

    // Heuristik untuk mendeteksi hasil pencarian
    const searchResultItems = $('div.list-update_item, article.bs, div.utao'); 
    
    // Hanya proses sebagai hasil pencarian JIKA ini adalah halaman pencarian
    if (isSearchPage && searchResultItems.length > 0) {
        pageData.search_results = searchResultItems.map((i, el) => {
            const element = $(el);
            const titleElement = element.find('h3, .title, .tt');
            const linkElement = element.find('a').first();
            if (titleElement.length && linkElement.length) {
                return {
                    title: titleElement.text().trim(),
                    url: new URL(linkElement.attr('href'), currentUrl).href
                };
            }
            return null;
        }).get().filter(item => item !== null);
        console.log(`[ANALYSIS] Ditemukan ${pageData.search_results.length} item hasil pencarian.`);
    } else {
         console.log(`[ANALYSIS] Bukan halaman pencarian, tidak memproses hasil pencarian.`);
    }

    // Heuristik untuk mendeteksi tombol "Next"
    const nextLink = $('a.next.page-numbers, a:contains("Next"), a[rel="next"]').first();
    if (nextLink.length > 0) {
        pageData.pagination.next_page_url = new URL(nextLink.attr('href'), currentUrl).href;
        console.log("[ANALYSIS] Ditemukan link halaman berikutnya.");
    }
    
    // Ambil semua elemen interaktif lainnya
    $('[data-ai-id]').each((i, el) => {
        const element = $(el);
        pageData.other_elements.push({
            ai_id: element.attr('data-ai-id'),
            tag: el.tagName.toLowerCase(),
            text: element.text().trim(),
            href: element.is('a') ? new URL(element.attr('href'), currentUrl).href : null,
            placeholder: element.is('input') ? element.attr('placeholder') : null,
        });
    });
    console.log(`[ANALYSIS] Ditemukan ${pageData.other_elements.length} elemen interaktif lainnya.`);

    return pageData;
}


// --- Logika Inti ---
async function getPageElements(url) {
    let browser = null;
    console.log(`[NAVIGATE] Memulai proses untuk URL: ${url}`);
    try {
        const executablePath = await chromium.executablePath();
        if (!executablePath) throw new Error("Path executable Chromium tidak ditemukan.");
        
        browser = await playwright.chromium.launch({
            args: chromium.args,
            executablePath: executablePath,
            headless: true,
            ignoreHTTPSErrors: true,
        });
        
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        });
        const page = await context.newPage();
        page.setDefaultNavigationTimeout(60000);

        console.log(`[NAVIGATE] Membuka halaman: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle' });
        console.log(`[NAVIGATE] Halaman berhasil dimuat.`);

        const htmlWithIds = await page.evaluate(() => {
            document.querySelectorAll('a, button, input').forEach((el, index) => el.setAttribute('data-ai-id', `ai-id-${index}`));
            return document.documentElement.outerHTML;
        });
        
        const analyzedData = analyzePageContent(htmlWithIds, page.url());
        
        return analyzedData;

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
    console.log(`[AI-SUGGEST] Memulai proses untuk tujuan: "${goal}"`);
    const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
    const elementMapStr = JSON.stringify(elements, null, 2);
    const prompt = `Anda adalah asisten navigasi. Tujuan: "${goal}". URL saat ini: "${current_url}". Berdasarkan elemen ini: ${elementMapStr.substring(0, 30000)}, tentukan aksi terbaik berikutnya (navigate, scrape, atau fail) dalam format JSON: {"action": "...", "details": {"url": "...", "reason": "..."}}`;
    
    return model.generateContent(prompt)
        .then(r => {
            const jsonText = r.response.text().replace(/```json|```/g, '').trim();
            return JSON.parse(jsonText);
        })
        .catch(e => {
            console.error(`[AI-SUGGEST] Gagal mendapatkan saran dari AI:`, e);
            return { action: "fail", details: { reason: e.message } };
        });
}

function scrapeDetailsWithAi(goal, html_content) {
    console.log(`[AI-SCRAPE] Memulai proses scraping untuk tujuan: "${goal}"`);
    const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
    const $ = cheerio.load(html_content);
    $('script, style').remove();
    const cleanHtml = $('body').html();
    const prompt = `Anda ahli scraper. Tujuan: "${goal}". Ekstrak data dari HTML ini ke format JSON (title, author, genre, status, synopsis, chapters): --- ${cleanHtml.substring(0, 40000)} ---`;
    
    return model.generateContent(prompt)
        .then(r => {
            const jsonText = r.response.text().replace(/```json|```/g, '').trim();
            if (!jsonText.startsWith('{')) throw new Error(`Respons AI tidak valid (bukan JSON).`);
            return JSON.parse(jsonText);
        })
        .catch(e => {
            console.error(`[AI-SCRAPE] Gagal mengekstrak detail dari AI:`, e);
            throw new Error(`AI gagal mengekstrak detail: ${e.message}`);
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

