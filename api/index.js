require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cheerio = require('cheerio');

// ================== BLOK PERUBAHAN UTAMA ==================
// Mengganti ekosistem Playwright dengan Puppeteer
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const sparticuz_chromium = require('@sparticuz/chromium');

// Terapkan plugin stealth ke Puppeteer
puppeteer.use(StealthPlugin());
// ==========================================================

const app = express();
const port = process.env.PORT || 3000;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(express.json());

// ================== PROMPT AI BARU YANG LEBIH CERDAS ==================
function createEnhancedPrompt(instruction, bodyHTML) {
    // Fungsi ini membangun prompt yang sangat detail untuk AI.
    // Ini memberikan peran, aturan ketat, skema JSON, dan contoh.
    // Tujuannya adalah untuk memaksa AI memberikan output yang konsisten dan akurat.
    return `
Anda adalah agen web scraping AI yang sangat cerdas dan teliti. Peran Anda adalah sebagai "navigator" dan "ekstraktor" data. Tugas Anda adalah menganalisis konten HTML mentah dan mengikuti instruksi pengguna untuk mengekstrak informasi, menavigasi ke halaman lain, atau memberikan jawaban berdasarkan konten halaman.

ATURAN PALING PENTING:
Anda HARUS SELALU memberikan respons HANYA dalam format JSON yang valid. Jangan pernah menyertakan teks, penjelasan, atau markdown seperti \`\`\`json di luar blok JSON utama. Respons Anda harus bisa langsung di-parse.

Berikut adalah tiga kemungkinan tindakan ('action') yang bisa Anda ambil. Pilih SATU yang paling sesuai dengan instruksi pengguna:

================================================
1. "action": "extract"
================================================
Gunakan tindakan ini KETIKA pengguna meminta untuk MENGAMBIL, MENDAPATKAN, atau MENGEKSTRAK data spesifik dari halaman.

Struktur JSON-nya HARUS seperti ini:
{
  "action": "extract",
  "items": [
    {
      "name": "nama_data_yang_diminta",
      "selector": "selector_css_yang_paling_akurat_dan_stabil",
      "type": "jenis_ekstraksi"
    }
  ]
}

DETAIL FIELD "extract":
- "name": Deskripsi singkat dan jelas tentang data yang diekstrak. (Contoh: "judul_komik", "daftar_chapter", "gambar_utama").
- "selector": Gunakan selector CSS yang paling spesifik dan stabil untuk menargetkan elemen. Hindari selector yang terlalu umum. (Contoh: "div.chapter-list > ul > li > a", bukan sekadar "a").
- "type": Pilih salah satu dari tiga opsi ini: 'text' (untuk mengambil teks yang terlihat), 'href' (untuk mendapatkan URL dari tag <a>), 'src' (untuk mendapatkan URL dari tag <img> atau <script>).

Contoh Penggunaan "extract":
- Instruksi Pengguna: "dapatkan semua judul chapter dan linknya"
- Contoh Respons JSON:
  {
    "action": "extract",
    "items": [
      {
        "name": "judul_chapter",
        "selector": "div.chapter-list > a > span.chapter-title",
        "type": "text"
      },
      {
        "name": "link_chapter",
        "selector": "div.chapter-list > a",
        "type": "href"
      }
    ]
  }

================================================
2. "action": "navigate"
================================================
Gunakan tindakan ini KETIKA pengguna meminta untuk PINDAH HALAMAN (misalnya, "klik link berikutnya", "pergi ke halaman detail", "lanjut ke chapter 2").

Struktur JSON-nya HARUS seperti ini:
{
  "action": "navigate",
  "url": "url_tujuan_lengkap_dan_absolut",
  "instruction": "instruksi_baru_yang_jelas_untuk_halaman_berikutnya"
}

DETAIL FIELD "navigate":
- "url": Pastikan ini adalah URL yang LENGKAP (absolut). Jika Anda menemukan link relatif (contoh: "/chapter/2"), Anda harus bisa menggabungkannya dengan URL halaman saat ini untuk membentuk URL absolut.
- "instruction": Buat instruksi baru yang relevan dan spesifik untuk halaman tujuan. Ini sangat penting untuk scraping multi-langkah.

Contoh Penggunaan "navigate":
- Instruksi Pengguna: "pergi ke chapter selanjutnya"
- Contoh Respons JSON:
  {
    "action": "navigate",
    "url": "https://contoh.com/komik/chapter-2",
    "instruction": "Setelah sampai, ekstrak semua gambar (src) dari elemen dengan selector 'div.reader-area > img' dan cari link 'Next Chapter' lagi."
  }

================================================
3. "action": "respond"
================================================
Gunakan tindakan ini untuk semua permintaan lainnya, seperti menjawab pertanyaan umum tentang konten halaman, atau JIKA INFORMASI YANG DIMINTA TIDAK DITEMUKAN.

Struktur JSON-nya HARUS seperti ini:
{
  "action": "respond",
  "response": "jawaban_lengkap_dan_informatif_dalam_bentuk_teks"
}

Contoh Penggunaan "respond":
- Instruksi Pengguna: "ada berapa gambar di halaman ini?"
- Contoh Respons JSON:
  {
    "action": "respond",
    "response": "Saya menemukan ada 15 gambar di halaman ini."
  }
- Instruksi Pengguna: "cari daftar pengarangnya"
- Contoh Respons JSON (jika tidak ditemukan):
  {
    "action": "respond",
    "response": "Maaf, saya sudah menganalisis seluruh halaman dan tidak dapat menemukan informasi mengenai pengarang."
  }

================================================

KONTEKS ANDA SAAT INI:
- Instruksi Pengguna: "${instruction}"
- HTML Halaman Lengkap (mentah):
\`\`\`html
${bodyHTML}
\`\`\`

TUGAS ANDA SEKARANG:
Berdasarkan instruksi pengguna dan konten HTML di atas, buatlah satu respons JSON yang valid sesuai dengan salah satu dari tiga struktur tindakan yang telah dijelaskan. Pilih tindakan yang paling sesuai.
`;
}

async function navigateAndAnalyze(url, instruction) {
    let browser;
    try {
        console.log("Meluncurkan browser dengan Puppeteer...");
        
        browser = await puppeteer.launch({
            args: sparticuz_chromium.args,
            executablePath: await sparticuz_chromium.executablePath(),
            headless: sparticuz_chromium.headless,
        });

        const page = await browser.newPage();
        console.log(`Menavigasi ke: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); // Timeout ditambah
        const bodyHTML = await page.content();
        
        console.log("Konten halaman berhasil diambil, menganalisis dengan AI...");

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
        // Menggunakan fungsi prompt baru yang lebih canggih
        const prompt = createEnhancedPrompt(instruction, bodyHTML);
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        console.log("Respons mentah dari AI diterima.");

        // Membersihkan string respons agar menjadi JSON yang valid
        if (text.startsWith("```json")) {
            text = text.substring(7, text.length - 3).trim();
        }

        const jsonResponse = JSON.parse(text);

        if (jsonResponse.action === 'extract') {
            console.log("AI memilih tindakan: Ekstrak Data");
            const $ = cheerio.load(bodyHTML);
            const extractedData = {};
            for (const item of jsonResponse.items) {
                const elements = $(item.selector);
                const data = [];
                elements.each((i, el) => {
                    let value;
                    switch (item.type) {
                        case 'text':
                            value = $(el).text();
                            break;
                        case 'href':
                            value = $(el).attr('href');
                            break;
                        case 'src':
                            value = $(el).attr('src');
                            break;
                        default:
                            value = $(el).html(); // Fallback
                    }
                    data.push(value);
                });
                extractedData[item.name] = data;
                console.log(` - Mengekstrak '${item.name}' dari '${item.selector}', ditemukan ${data.length} item.`);
            }
            return {
                status: 'success',
                action: 'extract',
                data: extractedData
            };
        } else if (jsonResponse.action === 'navigate') {
            console.log(`AI memilih tindakan: Navigasi ke ${jsonResponse.url}`);
            return {
                status: 'success',
                action: 'navigate',
                url: jsonResponse.url,
                instruction: jsonResponse.instruction
            };
        } else {
            console.log("AI memilih tindakan: Merespons");
            return {
                status: 'success',
                action: 'respond',
                response: jsonResponse.response
            };
        }

    } catch (error) {
        console.error("Terjadi kesalahan fatal di navigateAndAnalyze:", error);
        return {
            status: 'error',
            message: error.message,
            stack: error.stack // Menambahkan stack trace untuk debugging
        };
    } finally {
        if (browser) {
            console.log("Menutup browser...");
            await browser.close();
        }
    }
}

app.post('/api/scrape', async (req, res) => {
    const { url, instruction } = req.body;

    if (!url || !instruction) {
        return res.status(400).json({ error: 'URL dan instruksi diperlukan' });
    }

    console.log(`Menerima permintaan untuk URL: ${url}`);
    const result = await navigateAndAnalyze(url, instruction);
    res.json(result);
});

app.post('/api/chain-scrape', async (req, res) => {
    let { url, instruction } = req.body;

    if (!url || !instruction) {
        return res.status(400).json({ error: 'URL dan instruksi diperlukan' });
    }

    console.log(`Memulai chain scrape untuk URL: ${url}`);

    const results = [];
    let currentUrl = url;
    let currentInstruction = instruction;
    let maxSteps = 10; // Batas untuk mencegah infinite loop

    for (let i = 0; i < maxSteps; i++) {
        console.log(`Langkah ${i + 1}: URL = ${currentUrl}`);
        const result = await navigateAndAnalyze(currentUrl, currentInstruction);
        results.push(result);

        if (result.status === 'error' || result.action !== 'navigate') {
            console.log("Chain scrape berhenti: ada error atau bukan perintah navigasi.");
            break; 
        }
        
        try {
            const nextUrl = new URL(result.url, currentUrl).href;
            currentUrl = nextUrl;
            currentInstruction = result.instruction;
        } catch (e) {
            console.error(`URL tidak valid diterima dari AI: ${result.url}. Menghentikan chain scrape.`);
            results.push({ status: 'error', message: `Invalid URL provided by AI: ${result.url}` });
            break;
        }

        if (!currentInstruction) {
            console.log("Tidak ada instruksi lebih lanjut, mengakhiri chain scrape.");
            break;
        }
    }

    res.json({
        status: 'completed',
        steps: results
    });
});

const analyzeHtmlApi = async (req, res) => {
    const { html, instruction } = req.body;

    if (!html || !instruction) {
        return res.status(400).json({ error: 'Konten HTML dan instruksi diperlukan' });
    }

    try {
        console.log("Menganalisis konten HTML dengan AI...");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
        // Menggunakan fungsi prompt baru yang lebih canggih
        const prompt = createEnhancedPrompt(instruction, html);
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        console.log("Respons AI diterima.");

        if (text.startsWith("```json")) {
            text = text.substring(7, text.length - 3).trim();
        }

        const jsonResponse = JSON.parse(text);

        if (jsonResponse.action === 'extract') {
            const $ = cheerio.load(html);
            const extractedData = {};
            for (const item of jsonResponse.items) {
                const elements = $(item.selector);
                const data = [];
                elements.each((i, el) => {
                    let value;
                    switch (item.type) {
                        case 'text':
                            value = $(el).text();
                            break;
                        case 'href':
                            value = $(el).attr('href');
                            break;
                        case 'src':
                            value = $(el).attr('src');
                            break;
                        default:
                            value = $(el).html();
                    }
                    data.push(value);
                });
                extractedData[item.name] = data;
            }
            res.json({
                status: 'success',
                action: 'extract',
                data: extractedData
            });
        } else {
             res.json({
                status: 'success',
                action: 'respond',
                response: jsonResponse.response
            });
        }

    } catch (error) {
        console.error("Kesalahan saat menganalisis HTML:", error);
        res.status(500).json({
            status: 'error',
            message: error.message,
            stack: error.stack
        });
    }
};

app.post('/api/analyze-html', analyzeHtmlApi);


app.get('/', (req, res) => {
    res.send('AI Scraper API is running!');
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

module.exports = app;

