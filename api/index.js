// api/index.js (Versi V.1 - AI Navigator)
// Mengimplementasikan arsitektur "Scraping Dua Langkah" untuk waitForSelector yang dinamis dan universal.
require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

const puppeteer = require('puppeteer-extra');
const sparticuz_chromium = require('@sparticuz/chromium');

// --- Solusi Dependensi Vercel ---
require('puppeteer-extra-plugin-user-preferences');
require('puppeteer-extra-plugin-user-data-dir');
puppeteer.use(require('puppeteer-extra-plugin-stealth/evasions/chrome.app')());
puppeteer.use(require('puppeteer-extra-plugin-stealth/evasions/chrome.csi')());
puppeteer.use(require('puppeteer-extra-plugin-stealth/evasions/chrome.loadTimes')());
puppeteer.use(require('puppeteer-extra-plugin-stealth/evasions/chrome.runtime')());
puppeteer.use(require('puppeteer-extra-plugin-stealth/evasions/iframe.contentWindow')());
puppeteer.use(require('puppeteer-extra-plugin-stealth/evasions/media.codecs')());
puppeteer.use(require('puppeteer-extra-plugin-stealth/evasions/navigator.hardwareConcurrency')());
puppeteer.use(require('puppeteer-extra-plugin-stealth/evasions/navigator.languages')());
puppeteer.use(require('puppeteer-extra-plugin-stealth/evasions/navigator.permissions')());
puppeteer.use(require('puppeteer-extra-plugin-stealth/evasions/navigator.plugins')());
puppeteer.use(require('puppeteer-extra-plugin-stealth/evasions/navigator.vendor')());
puppeteer.use(require('puppeteer-extra-plugin-stealth/evasions/navigator.webdriver')());
puppeteer.use(require('puppeteer-extra-plugin-stealth/evasions/sourceurl')());
puppeteer.use(require('puppeteer-extra-plugin-stealth/evasions/user-agent-override')());
puppeteer.use(require('puppeteer-extra-plugin-stealth/evasions/webgl.vendor')());


const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// --- Konfigurasi ---
console.log('Menginisialisasi server (Versi V.1 - AI Navigator)...');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const AI_MODEL_NAME = "gemini-1.5-flash";

if (!GEMINI_API_KEY) {
    console.error("KRITIS: API Key Gemini tidak ditemukan.");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const app = express();
app.use(express.json({ limit: '50mb' }));


// Fungsi untuk menangani panggilan AI dengan mekanisme coba lagi (Tidak diubah)
async function generateContentWithRetry(model, prompt, retries = 3) {
    // ... (kode tidak diubah)
    for (let i = 0; i < retries; i++) {
        try {
            return await model.generateContent(prompt);
        } catch (error) {
            const errorMessage = error.toString();
            if (errorMessage.includes("503") || errorMessage.toLowerCase().includes("overloaded")) {
                if (i < retries - 1) {
                    const delay = Math.pow(2, i) * 1000;
                    console.warn(`Panggilan AI gagal (percobaan ${i + 1}/${retries}): Server sibuk. Mencoba lagi dalam ${delay / 1000} detik...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error(`Panggilan AI gagal setelah ${retries} percobaan. Menyerah.`);
                    throw error;
                }
            } else {
                console.error("Panggilan AI gagal karena error yang tidak bisa dicoba lagi:", error);
                throw error;
            }
        }
    }
}

// ==============================================================================
// === BAGIAN BARU: FUNGSI DAN PROMPT UNTUK MISI PENGINTAIAN (RECONNAISSANCE) ===
// ==============================================================================

function createReconPrompt(skeletalHtml) {
    return `
    ### PROFIL DAN MISI UTAMA ###
    Anda adalah "ReconAI", seorang ahli arsitektur front-end yang sangat berpengalaman. Misi Anda HANYA SATU: menganalisis kerangka HTML dari sebuah halaman web dan mengidentifikasi **satu selector CSS** yang paling mungkin menjadi **kontainer utama untuk konten dinamis** yang akan dimuat oleh JavaScript.

    ### PROSES BERPIKIR WAJIB (STEP-BY-STEP) ###
    1.  **ANALISIS STRUKTUR:** Pindai keseluruhan HTML yang diberikan. Abaikan header, footer, sidebar, dan menu navigasi. Fokus pada area konten utama di tengah halaman.
    2.  **IDENTIFIKASI PETUNJUK:** Cari petunjuk dalam nama class atau ID yang mengindikasikan sebuah daftar atau area konten utama. Petunjuk umum meliputi kata-kata seperti: "list", "posts", "items", "main", "content", "grid", "latest", "results".
    3.  **PEMILIHAN KANDIDAT TERBAIK:** Dari beberapa kemungkinan, pilih SATU selector yang paling spesifik namun tetap cukup umum untuk menjadi kontainer utama. Hindari selector yang terlalu spesifik yang mungkin hanya menargetkan satu item.
        -   Contoh BAIK: \`.latest-updates .post-list\`, \`#main-content .product-grid\`, \`.bixbox.list-update\`
        -   Contoh KURANG BAIK: \`.post-item:nth-child(1)\` (terlalu spesifik), \`div\` (terlalu umum).
    4.  **GENERASI JSON FINAL:** Bangun objek JSON dengan sangat hati-hati.

    ### ATURAN KETAT ###
    -   **ATURAN #0 (OUTPUT FINAL):** Respons Anda HARUS berisi SATU blok kode JSON yang valid dan HANYA berisi satu kunci: \`"dynamic_container_selector"\`. Jangan sertakan penalaran atau komentar di dalam JSON.
    -   **ATURAN #1 (KEJUJURAN):** Jika Anda sama sekali tidak bisa menemukan kandidat yang kuat, kembalikan \`null\` sebagai nilai selector.
    
    ### STRUKTUR JSON YANG WAJIB ANDA HASILKAN ###
    \`\`\`json
    {
      "dynamic_container_selector": ".selector-css-terbaik-yang-anda-temukan"
    }
    \`\`\`

    ### DATA UNTUK DIPROSES ###
    -   **HTML Kerangka Halaman untuk Dianalisis:**
        ${skeletalHtml}

    Sekarang, laksanakan misi intelijen Anda dan hasilkan satu blok JSON yang valid.
    `;
}

async function getDynamicContentSelector(skeletalHtml) {
    try {
        const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
        const prompt = createReconPrompt(skeletalHtml);
        const result = await generateContentWithRetry(model, prompt);
        let text = (await result.response).text();
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
        if (!jsonMatch || !jsonMatch[1]) {
            console.warn("ReconAI tidak mengembalikan JSON yang valid. Menggunakan fallback 'body'.");
            return 'body';
        }
        const jsonString = jsonMatch[1];
        const jsonResponse = JSON.parse(jsonString);
        return jsonResponse.dynamic_container_selector || 'body'; // Fallback jika selector null
    } catch (error) {
        console.error("Gagal menjalankan Misi Pengintaian AI:", error);
        return 'body'; // Fallback jika terjadi error
    }
}


// Prompt AI Ekstraksi (v8.0 - Mode Fotografer dengan Limiter) - Tidak diubah
function createEnhancedPrompt(instruction, currentURL, bodyHTML, recoveryAttempt = false, memory = null, conversationHistory = []) {
    // ... (kode tidak diubah, tetap lengkap dan detail)
    if (recoveryAttempt && memory) {
        return `
        PERHATIAN: ANDA DALAM MODE PEMULIHAN DARURAT.
        Misi Anda adalah menemukan selector CSS baru.
        **KONTEKS:**
        - Instruksi: "${instruction}"
        - Selector GAGAL: "${memory.selector}"
        **PETUNJUK ELEMEN:**
        - Tag: '<${memory.tagName}>'
        - Teks: "${memory.textSample}"
        - Atribut: ${memory.attributes.join(', ')}
        **ATURAN:**
        1.  Fokus HANYA menemukan selector baru.
        2.  Analisis HTML di bawah.
        3.  Temukan elemen yang paling cocok dengan petunjuk.
        4.  Respons HANYA berupa JSON: {"new_selector": "selector_css_baru_yang_stabil"}
        **HTML UNTUK DIANALISIS:**
        ${bodyHTML}
        `;
    }

    const historyText = conversationHistory.map(turn => {
        if (turn.human) return `Human: ${turn.human}`;
        if (turn.ai) return `You: ${turn.ai}`;
        return '';
    }).join('\n');

    return `
    ### PROFIL DAN MISI UTAMA ###
    Anda adalah "CognitoScraper v8.0 - Mode Fotografer", agen AI yang mengekstrak data dengan kejujuran absolut dan presisi. Misi Anda adalah mengubah instruksi bahasa manusia menjadi "resep" JSON yang fleksibel, termasuk memahami batasan jumlah (limit) yang diminta.

    ### FILOSOFI UTAMA: "KEJUJURAN DATA" ###
    1.  **NAMA FIELD YANG JUJUR:** Kunci (key) dalam JSON output Anda HARUS merefleksikan nama class atau atribut yang paling relevan dari elemen target. JANGAN menerjemahkan atau membuat nama sendiri (misal: gunakan "title" bukan "judul_komik").
    2.  **DATA MENTAH SEBAGAI DEFAULT:** Selalu gunakan \`type: 'html'\` sebagai DEFAULT. HANYA gunakan \`type: 'text'\`, \`'href'\`, atau \`'src'\` jika pengguna secara EKSPLISIT memintanya.

    ### PROSES BERPIKIR WAJIB (STEP-BY-STEP) ###
    1.  **ANALISIS TUJUAN:** Pahami instruksi pengguna ("${instruction}").
    2.  **ANALISIS BATASAN (LIMIT):** Periksa instruksi pengguna untuk angka spesifik (misal: "**5** komik", "**1** item", "**10** judul teratas"). Jika ada, catat angka ini sebagai batasan.
    3.  **IDENTIFIKASI KONTAINER:** Jika pengguna meminta daftar, temukan selector CSS untuk "kartu" yang berulang.
    4.  **BUAT SKEMA JUJUR (\`schema\`):** Pindai HTML dan buat "peta" data. Untuk setiap data yang diminta:
        a.  Temukan elemennya dan gunakan class/atributnya sebagai **nama kunci (key)**.
        b.  Tentukan selector CSS yang akurat.
        c.  Tentukan tipenya (default \`'html'\`).
    5.  **KONSTRUKSI PENALARAN (\`reasoning\`):** Jelaskan mengapa Anda memilih selector, skema, dan limit tersebut.
    6.  **GENERASI JSON FINAL:** Bangun objek JSON dengan hati-hati.

    ### ATURAN KETAT ###
    -   **ATURAN #0 (OUTPUT FINAL):** Respons Anda HARUS berisi SATU blok kode JSON yang valid.
    -   **ATURAN #1 (KUNCI/KEY JUJUR):** NAMA KUNCI DI DALAM \`schema\` HARUS DIAMBIL DARI CLASS/ATRIBUT HTML ASLI. DILARANG MENERJEMAHKAN.
    -   **ATURAN #2 (DEFAULT HTML):** SELALU prioritaskan \`type: 'html'\`.
    -   **ATURAN #3 (BATASAN/LIMIT):** Jika instruksi pengguna mengandung angka yang jelas (misal: "scrape **1** komik", "ambil **5** item"), Anda WAJIB menyertakan field \`"limit": angka\` dalam JSON Anda. Jika tidak ada angka yang disebutkan, JANGAN sertakan field \`limit\`.
    -   **ATURAN #4 (GUNAKAN \`extract_structured\`):** Untuk SEMUA permintaan ekstraksi data, gunakan \`action: "extract_structured"\`.

    ### STRUKTUR JSON YANG WAJIB ANDA HASILKAN ###
    \`\`\`json
    {
      "reasoning": "Penjelasan detail tentang pemilihan selector, skema jujur, dan limit jika ada.",
      "commentary": "Komentar ramah untuk pengguna.",
      "action": "extract_structured",
      "limit": 5, // (Opsional) HANYA jika pengguna menyebutkan angka
      "container_selector": ".list-update_item",
      "schema": {
        "title": { "selector": "h3.title", "type": "html" },
        "image": { "selector": ".thumb img", "type": "html" }
      }
    }
    \`\`\`

    ### DATA UNTUK DIPROSES ###
    -   **Instruksi Pengguna Terakhir:** "${instruction}"
    -   **URL Saat Ini:** "${currentURL}"
    -   **HTML Halaman untuk Dianalisis:**
        ${bodyHTML}

    Sekarang, bertindaklah sebagai "CognitoScraper v8.0" dan hasilkan satu blok kode JSON yang valid, jujur, dan presisi.
    `;
}
    
async function navigateAndAnalyze(url, instruction, conversationHistory = []) {
    let browser = null;
    let page = null;

    try {
        let finalHtml = ''; // Variabel untuk menyimpan HTML yang sudah lengkap

        // Fase Fetcher Bertingkat (Tier 1)
        try {
            console.log("Tier 1: Mencoba fetch standar...");
            const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36' }});
            if (!response.ok) throw new Error(`Fetch gagal: ${response.status}`);
            const tempHtml = await response.text();
            // Jika halaman tidak bergantung pada JS, kita bisa langsung anggap ini final
            if (tempHtml.length > 500 && !tempHtml.toLowerCase().includes("enable javascript")) {
                finalHtml = tempHtml;
                console.log("Tier 1: Sukses! Situs tampaknya statis.");
            } else {
                throw new Error("Konten dari fetch standar tidak lengkap atau butuh JS.");
            }
        } catch (e) {
            console.log(`Tier 1 Gagal: ${e.message}. Menggunakan Tier 2 (Puppeteer)...`);
            
            const executablePath = await sparticuz_chromium.executablePath();
            browser = await puppeteer.launch({
                args: sparticuz_chromium.args,
                executablePath,
                headless: sparticuz_chromium.headless
            });

            page = await browser.newPage();
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
            
            // --- LANGKAH 1: MISI PENGINTAIAN ---
            const initialHtml = await page.content();
            console.log("Menjalankan Misi Pengintaian untuk menemukan kontainer konten dinamis...");
            const dynamicSelector = await getDynamicContentSelector(initialHtml);
            
            if (dynamicSelector && dynamicSelector !== 'body') {
                 console.log(`AI Navigator merekomendasikan untuk menunggu selector: '${dynamicSelector}'`);
                 await page.waitForSelector(dynamicSelector, { timeout: 30000 });
                 console.log("Konten dinamis terdeteksi dan telah dimuat.");
            } else {
                console.log("AI Navigator tidak menemukan selector spesifik, akan melanjutkan dengan konten yang ada.");
            }

            // --- LANGKAH 2: EKSEKUSI ---
            finalHtml = await page.content(); // Ambil HTML final setelah menunggu
            console.log("Tier 2: Sukses! Konten final telah didapat.");
        }
    
        // Panggil AI Ekstraksi dengan HTML yang sudah lengkap
        const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
        const finalPrompt = createEnhancedPrompt(instruction, url, finalHtml, false, null, conversationHistory); 
        
        const result = await generateContentWithRetry(model, finalPrompt);
        let text = (await result.response).text();
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
        if (!jsonMatch || !jsonMatch[1]) {
            throw new Error("Gagal mengekstrak JSON dari respons AI Ekstraksi.");
        }
        const jsonString = jsonMatch[1];
        const jsonResponse = JSON.parse(jsonString);

        const baseResponse = {
            status: 'success',
            reasoning: jsonResponse.reasoning,
            commentary: jsonResponse.commentary,
            action: jsonResponse.action
        };

        // Logika Ekstraksi (tidak diubah, kini menggunakan finalHtml)
        if (jsonResponse.action === 'extract_structured') {
            const { container_selector, schema, limit } = jsonResponse;
            if (!schema) throw new Error("AI tidak memberikan 'schema' untuk ekstraksi.");
            
            const $ = cheerio.load(finalHtml);
            const data = [];
            const extractValue = (element, schemaItem) => {
                if (!schemaItem || !schemaItem.selector) return null;
                const target = element.find(schemaItem.selector).first();
                if (target.length === 0) return null;
                switch (schemaItem.type) {
                    case 'text': return target.text().trim();
                    case 'href': return target.attr('href');
                    case 'src': return target.attr('src');
                    case 'html': return target.html();
                    default: return null;
                }
            };
            const scope = container_selector ? $(container_selector) : $(finalHtml);
            const limitedScope = (typeof limit === 'number' && limit > 0) ? scope.slice(0, limit) : scope;
            limitedScope.each((i, el) => {
                const element = $(el);
                const structuredItem = {};
                for (const key in schema) {
                    structuredItem[key] = extractValue(element, schema[key]);
                }
                data.push(structuredItem);
            });
            return { ...baseResponse, structured_data: data };
        } 
        else if (jsonResponse.action === 'navigate') {
            return { ...baseResponse, url: jsonResponse.url, instruction: jsonResponse.instruction };
        } 
        else {
             return { ...baseResponse, response: jsonResponse.response };
        }

    } catch (error) {
        // Mode pemulihan tidak diubah, namun mungkin kurang relevan sekarang
        console.warn("Terjadi kesalahan:", error.message);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// ================== ENDPOINTS EXPRESS (Tidak diubah) ==================

app.post('/api/scrape', async (req, res) => {
    // ... (kode tidak diubah)
    const { url, instruction, conversation_history } = req.body;
    if (!url || !instruction) {
        return res.status(400).json({ error: 'URL dan instruksi diperlukan' });
    }
    try {
        const result = await navigateAndAnalyze(url, instruction, conversation_history);
        res.json(result);
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/api/chain-scrape', async (req, res) => {
    // ... (kode tidak diubah)
    let { url, instruction } = req.body;
    if (!url || !instruction) { return res.status(400).json({ error: 'URL dan instruksi diperlukan' }); }
    
    const results = [];
    let currentUrl = url;
    let currentInstruction = instruction;
    const conversationHistory = []; 

    for (let i = 0; i < 10; i++) { 
        try {
            console.log(`Chain scrape langkah ke-${i+1}: URL=${currentUrl}`);
            const result = await navigateAndAnalyze(currentUrl, currentInstruction, conversationHistory);
            results.push(result);

            conversationHistory.push({ human: currentInstruction });
            conversationHistory.push({ ai: result.commentary || "Melanjutkan navigasi." });

            if (result.status === 'error' || result.action !== 'navigate' || !result.url) {
                console.log("Chain scrape berhenti: Aksi bukan navigasi atau error.");
                break;
            }
            
            currentUrl = new URL(result.url, currentUrl).href;
            currentInstruction = result.instruction || "Lanjutkan analisis di halaman baru ini.";
            
        } catch(error) {
            results.push({ status: 'error', message: `Langkah ke-${i+1} gagal: ${error.message}` });
            break;
        }
    }
    res.json({ status: 'completed', steps: results });
});

app.post('/api/analyze-html', async (req, res) => {
    // ... (kode tidak diubah)
    const { html, instruction } = req.body;
    if (!html || !instruction) {
        return res.status(400).json({ error: 'Konten HTML dan instruksi diperlukan' });
    }
    try {
        const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
        const prompt = createEnhancedPrompt(instruction, "http://local-file.com", html); 
        
        const result = await generateContentWithRetry(model, prompt);
        let text = (await result.response).text();
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
        if (!jsonMatch || !jsonMatch[1]) { throw new Error("Gagal mengekstrak JSON dari respons AI."); }
        
        const jsonString = jsonMatch[1];
        const jsonResponse = JSON.parse(jsonString);

        res.json({ status: 'success', ...jsonResponse });

    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message, stack: error.stack });
    }
});


app.get('/', (req, res) => {
    res.send('AI Scraper API vV.1 (AI Navigator) is running!');
});

module.exports = app;

