// api/index.js (v3.3 - Flexible Vision)
const express = require('express');
const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cheerio = require('cheerio');

// --- Konfigurasi ---
console.log('Menginisialisasi server (v3.3)...');
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
        pagination: {},
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

    const nextLink = $('a.next.page-numbers, a:contains("Next"), a[rel="next"]').first();
    if (nextLink.length > 0) {
        pageData.pagination.next_page_url = new URL(nextLink.attr('href'), currentUrl).href;
    }

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
    return pageData;
}

// --- Fungsi Scraping Chapter ---
function scrapeChapterImages(html, currentUrl) {
    const $ = cheerio.load(html);
    const chapterData = { images: [], next_chapter_url: null, prev_chapter_url: null };
    // --- PERUBAHAN: Selector gambar diperbanyak ---
    $('#readerarea img, .reading-content img, .main-reading-area img, div.chapter-images img').each((i, el) => {
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
        
        if (isChapterPage) {
            // --- PERUBAHAN: Menggunakan daftar selector dan timeout lebih lama ---
            console.log("[CHAPTER-SCRAPE] Menunggu salah satu selector gambar muncul...");
            const imageSelectors = [
                '#readerarea img',
                '.reading-content img',
                '.main-reading-area img',
                'div.chapter-images img'
            ];
            
            await page.waitForSelector(imageSelectors.join(', '), { timeout: 30000 });

            console.log("[CHAPTER-SCRAPE] Selector gambar ditemukan. Mengambil konten...");
            const contentHtml = await page.content();
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

// --- Fungsi AI (Lengkap dengan Prompt Baru) ---
function getAiSuggestion(goal, current_url, elements) {
    const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
    const elementMapStr = JSON.stringify(elements, null, 2);
    const prompt = `
    Anda adalah otak dari agen web scraper otonom yang sangat cerdas.
    Tujuan akhir Anda: "${goal}"
    Posisi Anda saat ini: "${current_url}"

    Tugas Anda adalah memilih SATU langkah berikutnya yang paling efisien berdasarkan "peta elemen" di bawah ini.
    Pilih salah satu dari aksi berikut dan kembalikan dalam format JSON yang VALID:
    1.  {"action": "navigate", "details": {"url": "URL_TUJUAN", "reason": "Alasan singkat mengapa Anda memilih link ini."}}: Jika Anda perlu mengklik sebuah link atau tombol untuk lebih dekat ke tujuan.
    2.  {"action": "scrape", "details": {"reason": "Alasan singkat mengapa halaman ini siap di-scrape."}}: HANYA jika Anda YAKIN 100% sudah berada di halaman detail final yang berisi informasi yang dicari (seperti sinopsis, daftar chapter, dll).
    3.  {"action": "fail", "details": {"reason": "ALASAN_GAGAL"}}: Jika Anda buntu, tidak bisa menemukan elemen yang relevan, atau merasa halaman ini tidak akan membawa lebih dekat ke tujuan.

    --- ATURAN KRITIS ---
    - Jika URL saat ini mengandung parameter pencarian (contoh: "?s=") atau halaman ini jelas merupakan DAFTAR HASIL PENCARIAN, tugas utama Anda adalah **MENGKLIK** link yang judulnya paling relevan dengan tujuan "${goal}".
    - **JANGAN** memilih 'scrape' di halaman daftar, halaman utama, atau halaman hasil pencarian. Aksi 'scrape' hanya untuk halaman detail.
    - Selalu berikan alasan yang jelas dan singkat untuk setiap pilihan Anda.
    --------------------

    Peta Elemen Interaktif di Halaman Saat Ini (Maksimal 30KB):
    ---
    ${elementMapStr.substring(0, 30000)}
    ---
    Berdasarkan tujuan, posisi, dan ATURAN KRITIS di atas, tentukan langkah berikutnya.
    `;
    
    return model.generateContent(prompt)
        .then(r => JSON.parse(r.response.text().replace(/```json|```/g, '').trim()))
        .catch(e => ({ action: "fail", details: { reason: e.message } }));
}

function scrapeDetailsWithAi(goal, html_content) {
    const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
    const $ = cheerio.load(html_content);
    $('script, style').remove();
    const cleanHtml = $('body').html();
    const prompt = `
    Anda adalah ahli ekstraksi data yang sangat teliti. Tugas Anda adalah mengubah konten HTML menjadi data JSON yang bersih dan terstruktur.
    Tujuan Scraping: "Mendapatkan detail lengkap untuk komik berjudul '${goal}'".

    --- CONTOH FORMAT JSON YANG DIINGINKAN ---
    {
      "title": "Judul Komik yang Lengkap",
      "author": "Nama Author atau Pengarang",
      "genre": ["Genre 1", "Genre 2", "Genre 3"],
      "type": "Tipe Komik (e.g., Manhwa, Manga, Manhua)",
      "status": "Status (e.g., Ongoing, Completed)",
      "release_date": "Tanggal Rilis atau Tahun Terbit",
      "rating": "Skor Rating (jika ada)",
      "synopsis": "Paragraf sinopsis yang lengkap...",
      "chapters": [
        {
          "chapter_title": "Chapter 1 - Judul Chapter",
          "release_date": "Tanggal Rilis Chapter (jika ada)",
          "url": "https://url-lengkap-ke-chapter-1.com"
        },
        {
          "chapter_title": "Chapter 2 - Judul Chapter Lain",
          "release_date": "Tanggal Rilis Chapter (jika ada)",
          "url": "https://url-lengkap-ke-chapter-2.com"
        }
      ]
    }
    -----------------------------------------

    ATURAN PENTING:
    1.  Ikuti format contoh di atas dengan SANGAT TELITI. Nama key harus persis sama.
    2.  Pastikan JSON yang Anda hasilkan 100% valid. Perhatikan penggunaan koma (,) dan kurung siku [].
    3.  Ekstrak SEMUA chapter yang tersedia dalam HTML. Jangan hanya mengambil beberapa.
    4.  Jika suatu informasi (seperti author atau rating) tidak dapat ditemukan, gunakan \`null\` sebagai nilainya, JANGAN string kosong "".
    5.  Untuk 'genre', hasilnya harus berupa array of strings.

    HTML untuk di-scrape (sudah dibersihkan dari script dan style):
    ---
    ${cleanHtml.substring(0, 40000)}
    ---
    Silakan mulai ekstraksi.
    `;
    
    return model.generateContent(prompt)
        .then(r => JSON.parse(r.response.text().replace(/```json|```/g, '').trim()))
        .catch(e => { throw new Error(e.message) });
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
    try {
        const suggestion = await getAiSuggestion(goal, current_url, elements);
        res.json({ status: "success", data: suggestion });
    } catch (error) { res.status(500).json({ status: "error", message: error.message }); }
});
app.post("/api/scrape", async (req, res) => {
    const { goal, html_content } = req.body;
    try {
        const result = await scrapeDetailsWithAi(goal, html_content);
        res.json({ status: "success", data: result });
    } catch (error) { res.status(500).json({ status: "error", message: error.message }); }
});
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

module.exports = app;

