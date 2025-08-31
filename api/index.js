// api/index.js (v3.0 - The Definitive Version)
const express = require('express');
const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cheerio = require('cheerio');

// --- Konfigurasi ---
console.log('Menginisialisasi server (v3.0)...');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const AI_MODEL_NAME = "gemini-1.5-flash";

if (!GEMINI_API_KEY) {
    console.error("KRITIS: API Key Gemini tidak ditemukan.");
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const app = express();
app.use(express.json({ limit: '50mb' }));

// --- Fungsi Analisa Halaman (DIGABUNGKAN) ---
function analyzePageContent(html, currentUrl) {
    const $ = cheerio.load(html);
    const pageData = {
        current_url: currentUrl,
        title: $('title').text() || 'No Title',
        html: html,
        search_results: [],
        pagination: {}, // Pastikan objek pagination ada
        other_elements: []
    };
    const isSearchPage = new URL(currentUrl).searchParams.has('s');
    if (isSearchPage) {
        pageData.search_results = $('div.list-update_item, article.bs, div.utao').map((i, el) => {
            const element = $(el);
            const titleElement = element.find('h3, .title, .tt');
            const linkElement = element.find('a').first();
            if (titleElement.length && linkElement.length) {
                return { title: titleElement.text().trim(), url: new URL(linkElement.attr('href'), currentUrl).href };
            }
            return null;
        }).get();
    }

    // --- DIKEMBALIKAN DARI v2.7: Deteksi Tombol "Next Page" ---
    const nextLink = $('a.next.page-numbers, a:contains("Next"), a[rel="next"]').first();
    if (nextLink.length > 0) {
        pageData.pagination.next_page_url = new URL(nextLink.attr('href'), currentUrl).href;
    }

    // --- DIKEMBALIKAN DARI v2.7: Detail Elemen Lebih Lengkap untuk AI ---
    $('[data-ai-id]').each((i, el) => {
        const element = $(el);
        pageData.other_elements.push({
            ai_id: element.attr('data-ai-id'), 
            tag: el.tagName.toLowerCase(), // tag dikembalikan
            text: element.text().trim(),
            href: element.is('a') ? new URL(element.attr('href'), currentUrl).href : null,
            placeholder: element.is('input') ? element.attr('placeholder') : null, // placeholder dikembalikan
        });
    });
    return pageData;
}

// --- Fungsi Scraping Chapter ---
function scrapeChapterImages(html, currentUrl) {
    const $ = cheerio.load(html);
    const chapterData = { images: [], next_chapter_url: null, prev_chapter_url: null };
    $('#readerarea img, .reading-content img').each((i, el) => {
        const imageUrl = $(el).attr('src');
        if (imageUrl) chapterData.images.push(imageUrl.trim());
    });
    const nextLink = $('.nextprev a[rel="next"]').first();
    if (nextLink.length) chapterData.next_chapter_url = new URL(nextLink.attr('href'), currentUrl).href;
    const prevLink = $('.nextprev a[rel="prev"]').first();
    if (prevLink.length) chapterData.prev_chapter_url = new URL(prevLink.attr('href'), currentUrl).href;
    return chapterData;
}

// --- Logika Navigasi Inti ---
async function navigateAndAnalyze(url, isChapterPage = false) {
    let browser = null;
    try {
        const executablePath = await chromium.executablePath();
        if (!executablePath) throw new Error("Path executable Chromium tidak ditemukan.");
        
        browser = await playwright.chromium.launch({
            args: chromium.args, executablePath, headless: true, ignoreHTTPSErrors: true
        });
        
        const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'});
        const page = await context.newPage();
        page.setDefaultNavigationTimeout(60000);

        await page.goto(url, { waitUntil: 'networkidle' });
        
        const contentHtml = await page.content();
        if (isChapterPage) {
            return scrapeChapterImages(contentHtml, page.url());
        } else {
            const htmlWithIds = await page.evaluate(() => {
                document.querySelectorAll('a, button, input').forEach((el, index) => el.setAttribute('data-ai-id', `ai-id-${index}`));
                return document.documentElement.outerHTML;
            });
            return analyzePageContent(htmlWithIds, page.url());
        }
    } catch (error) {
        console.error(`[NAVIGATE] Gagal total saat memproses ${url}:`, error);
        throw new Error(`Gagal membuka URL: ${error.message}`);
    } finally {
        if (browser) await browser.close();
    }
}

// --- Fungsi AI (Lengkap) ---
function getAiSuggestion(goal, current_url, elements) {
    console.log(`[AI-SUGGEST] Memulai proses untuk tujuan: "${goal}"`);
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
    try {
        const result = await navigateAndAnalyze(req.body.url, false);
        res.json({ status: "success", data: result });
    } catch (error) { res.status(500).json({ status: "error", message: error.message }); }
});

app.post("/api/scrape_chapter", async (req, res) => {
    try {
        const result = await navigateAndAnalyze(req.body.url, true);
        res.json({ status: "success", data: result });
    } catch (error) { res.status(500).json({ status: "error", message: error.message }); }
});

app.post("/api/suggest_action", async (req, res) => {
    const { goal, current_url, elements } = req.body; 
    if (!goal || !current_url || !elements) return res.status(400).json({ status: "error", message: "Parameter tidak lengkap" });
    try {
        const suggestion = await getAiSuggestion(goal, current_url, elements);
        res.json({ status: "success", data: suggestion });
    } catch (error) { res.status(500).json({ status: "error", message: error.message }); }
});

app.post("/api/scrape", async (req, res) => {
    const { goal, html_content } = req.body;
    if (!goal || !html_content) return res.status(400).json({ status: "error", message: "Parameter tidak lengkap" });
    try {
        const result = await scrapeDetailsWithAi(goal, html_content);
        res.json({ status: "success", data: result });
    } catch (error) { res.status(500).json({ status: "error", message: error.message }); }
});

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

module.exports = app;

