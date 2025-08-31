// api/index.js (v3.7 - Detailed Prompts)
const express = require('express');
const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cheerio = require('cheerio');

// --- Konfigurasi ---
console.log('Menginisialisasi server (v3.7)...');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const AI_MODEL_NAME = "gemini-1.5-flash";

if (!GEMINI_API_KEY) {
    console.error("KRITIS: API Key Gemini tidak ditemukan.");
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const app = express();
app.use(express.json({ limit: '50mb' }));

// --- Fungsi Analisa Halaman ---
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
        let cleanText = '';
        const boldText = element.find('b, strong').first().text().trim();
        if (boldText) {
            cleanText = boldText;
        } else {
            cleanText = element.text().replace(/\s+/g, ' ').trim();
        }
        if (cleanText.includes(' - ')) {
            cleanText = cleanText.split(' - ')[0].trim();
        }
        pageData.other_elements.push({
            ai_id: element.attr('data-ai-id'), 
            tag: el.tagName.toLowerCase(),
            text: cleanText,
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

// --- FUNGSI AI (DENGAN DUA MODE OTAK & PROMPT DETAIL) ---

// Mode 1: "Co-pilot Penjelajah"
function getExplorationSuggestion(pageTitle, htmlContent) {
    const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
    const $ = cheerio.load(htmlContent);
    $('script, style, head').remove();
    const cleanText = $('body').text().replace(/\s+/g, ' ').trim();

    const prompt = `
    Anda adalah asisten scraper cerdas dan proaktif. Pengguna sedang menjelajah dan baru saja tiba di sebuah halaman dengan judul "${pageTitle}".
    Tugas Anda adalah menganalisa ringkasan teks dari halaman ini dan memberikan saran yang paling berguna.
    
    Ringkasan Teks Halaman:
    ---
    ${cleanText.substring(0, 10000)}
    ---

    Berdasarkan judul dan ringkasan teks di atas, jawab pertanyaan-pertanyaan berikut:
    1.  Apa tujuan utama dari halaman ini? (Contoh: Menampilkan daftar komik populer, daftar genre, dll.)
    2.  Apakah ada daftar data yang jelas dan menarik untuk di-scrape? (Fokus pada: daftar judul komik, menu genre, tipe komik, daftar update terbaru).

    Jika Anda menemukan sesuatu yang menarik, berikan saran untuk men-scrape area tersebut.
    Jika halaman ini tampaknya hanya halaman navigasi biasa atau tidak ada daftar data yang jelas, katakan saja begitu.

    Berikan jawaban Anda dalam format JSON yang VALID dan tidak mengandung markdown:
    {
      "is_interesting": boolean,
      "suggestion_text": "Saran singkat dan jelas untuk ditampilkan di menu. Contoh: Scrape Daftar Komik Populer",
      "reason": "Alasan singkat dan logis mengapa halaman ini menarik atau tidak menarik untuk di-scrape."
    }
    `;

    return model.generateContent(prompt)
        .then(r => JSON.parse(r.response.text().replace(/```json|```/g, '').trim()))
        .catch(e => ({ is_interesting: false, suggestion_text: "Analisa gagal", reason: e.message }));
}


// Mode 2: "GPS Pemburu"
function getNavigationSuggestion(goal, current_url, elements) {
    const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
    const elementMapStr = JSON.stringify(elements, null, 2);
    const prompt = `
    Anda adalah otak dari agen web scraper otonom yang sangat fokus dan efisien.
    Tujuan akhir Anda (buruan Anda): "${goal}"
    Posisi Anda saat ini: "${current_url}"

    Tugas Anda adalah memilih SATU langkah berikutnya yang paling efisien untuk mencapai tujuan, berdasarkan "peta elemen" di bawah ini.
    Pilih salah satu dari aksi berikut dan kembalikan dalam format JSON yang VALID:
    1.  {"action": "navigate", "details": {"url": "URL_TUJUAN", "reason": "Alasan singkat kenapa link ini adalah pilihan terbaik."}}: Jika Anda perlu mengklik sebuah link atau tombol untuk lebih dekat ke tujuan.
    2.  {"action": "scrape", "details": {"reason": "Alasan singkat kenapa halaman ini adalah tujuan akhir."}}: HANYA jika Anda YAKIN 100% sudah berada di halaman detail final yang berisi informasi yang dicari.
    3.  {"action": "fail", "details": {"reason": "ALASAN_GAGAL"}}: Jika Anda buntu atau tidak ada elemen relevan yang bisa membawa Anda lebih dekat ke tujuan.

    --- ATURAN KRITIS ---
    - Jika Anda berada di halaman hasil pencarian (URL mengandung "?s="), tugas utama Anda adalah **MENGKLIK** link yang judulnya paling mirip dengan "${goal}".
    - **JANGAN** pernah memilih 'scrape' di halaman daftar, halaman utama, atau halaman hasil pencarian. Aksi 'scrape' HANYA untuk halaman detail.
    - Alasan Anda harus logis dan fokus pada tujuan.
    --------------------

    Peta Elemen Interaktif di Halaman Saat Ini (Maksimal 30KB):
    ---
    ${elementMapStr.substring(0, 30000)}
    ---
    Tentukan langkah berikutnya.
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
        }
      ]
    }
    -----------------------------------------

    ATURAN PENTING:
    1.  Ikuti format contoh di atas dengan SANGAT TELITI. Nama key harus persis sama.
    2.  Pastikan JSON yang Anda hasilkan 100% valid. Perhatikan penggunaan koma (,) dan kurung siku [].
    3.  Ekstrak SEMUA chapter yang tersedia dalam HTML.
    4.  Jika suatu informasi (seperti author atau rating) tidak dapat ditemukan, gunakan \`null\` sebagai nilainya, BUKAN string kosong "".
    5.  Untuk 'genre', hasilnya harus berupa array of strings.

    HTML untuk di-scrape (sudah dibersihkan dari script dan style):
    ---
    ${cleanHtml.substring(0, 40000)}
    ---
    Silakan mulai ekstraksi.
    `;

    return model.generateContent(prompt).then(r => JSON.parse(r.response.text().replace(/```json|```/g, '').trim())).catch(e => { throw new Error(e.message) });
}


// --- Logika Navigasi Inti ---
async function navigateAndAnalyze(url, context) {
    let browser = null;
    try {
        const executablePath = await chromium.executablePath();
        if (!executablePath) throw new Error("Path executable Chromium tidak ditemukan.");
        
        browser = await playwright.chromium.launch({
            args: chromium.args, executablePath, headless: true, ignoreHTTPSErrors: true
        });
        
        const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'});
        page.setDefaultNavigationTimeout(60000);
        await page.goto(url, { waitUntil: 'networkidle' });

        if (context.isChapter) {
            const imageSelectors = ['#readerarea img', '.reading-content img', '.main-reading-area img', 'div.chapter-images img'];
            await page.waitForSelector(imageSelectors.join(', '), { timeout: 30000 });
            const contentHtml = await page.content();
            return scrapeChapterImages(contentHtml, page.url());
        }

        const htmlWithIds = await page.evaluate(() => {
            document.querySelectorAll('a, button, input').forEach((el, index) => el.setAttribute('data-ai-id', `ai-id-${index}`));
            return document.documentElement.outerHTML;
        });

        let analyzedData = analyzePageContent(htmlWithIds, page.url());

        if (context.mode === 'exploration') {
            console.log("[AI-EXPLORE] Mode Penjelajahan Aktif. Menganalisa halaman...");
            const explorationSuggestion = await getExplorationSuggestion(analyzedData.title, analyzedData.html);
            if (explorationSuggestion && explorationSuggestion.is_interesting) {
                analyzedData.contextual_suggestion = explorationSuggestion;
            }
        }
        
        return analyzedData;
    } catch (error) {
        console.error(`[NAVIGATE] Gagal total saat memproses ${url}:`, error);
        throw new Error(`Gagal membuka URL: ${error.message}`);
    } finally {
        if (browser) await browser.close();
    }
}


// --- Endpoint API ---
app.post("/api/navigate", async (req, res) => {
    try {
        const { url, context = {} } = req.body;
        const result = await navigateAndAnalyze(url, context);
        res.json({ status: "success", data: result });
    } catch (error) { res.status(500).json({ status: "error", message: error.message }); }
});

app.post("/api/scrape_chapter", async (req, res) => {
    try {
        const result = await navigateAndAnalyze(req.body.url, { isChapter: true });
        res.json({ status: "success", data: result });
    } catch (error) { res.status(500).json({ status: "error", message: error.message }); }
});

app.post("/api/suggest_action", async (req, res) => {
    const { goal, current_url, elements } = req.body; 
    try {
        const suggestion = await getNavigationSuggestion(goal, current_url, elements);
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

