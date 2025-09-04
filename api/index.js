// api/index.js (Versi L.1 - Ekstraksi Dinamis)
// Logika dan prompt dirombak untuk ekstraksi dan skema yang sepenuhnya dinamis.
require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const sparticuz_chromium = require('@sparticuz/chromium');

puppeteer.use(StealthPlugin());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// --- Konfigurasi ---
console.log('Menginisialisasi server (Versi L.1 - Ekstraksi Dinamis)...');
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
// === FUNGSI PEMBUATAN PROMPT AI (DIROMBAK UNTUK SKEMA DINAMIS) ===
// ==============================================================================
function createEnhancedPrompt(instruction, currentURL, bodyHTML, recoveryAttempt = false, memory = null, conversationHistory = []) {
    // --- PROMPT UNTUK MODE PEMULIHAN DARURAT (TIDAK DIUBAH) ---
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
    Anda adalah "CognitoScraper v6.0", agen AI ekstraksi web yang sepenuhnya dinamis. Misi Anda adalah mengubah instruksi bahasa manusia menjadi "resep" JSON yang fleksibel. Anda harus bisa menangani permintaan apa pun, mulai dari mengekstrak beberapa field data terstruktur hingga mengambil blok HTML mentah.

    ### PROSES BERPIKIR WAJIB (STEP-BY-STEP) ###
    1.  **ANALISIS TUJUAN:** Apa inti dari permintaan pengguna ("${instruction}")? Apakah ia ingin daftar entitas terstruktur (seperti daftar komik dengan judul dan URL) atau hanya satu bagian data (seperti rating) atau bahkan blok HTML mentah?
    2.  **IDENTIFIKASI KONTAINER (JIKA PERLU):** Jika pengguna meminta daftar entitas, temukan **selector CSS untuk kontainer yang berulang**. Ini adalah "kartu" yang membungkus setiap entitas. Jika pengguna hanya meminta satu data tunggal (misal: "apa rating komik ini?"), kontainer tidak diperlukan.
    3.  **BUAT SKEMA DINAMIS (\`schema\`):** Ini adalah bagian paling penting. Buat "peta" atau skema berdasarkan PERMINTAAN PENGGUNA.
        * **Kunci (Key):** Nama kunci HARUS mencerminkan data yang diminta. Gunakan format snake_case (contoh: 'judul_komik', 'raw_html', 'rating_pengguna').
        * **Selector:** Tentukan sub-selector yang paling akurat untuk data tersebut, relatif terhadap kontainer jika ada.
        * **Tipe (\`type\`):** Pilih tipe yang paling sesuai:
            * \`'text'\`: Untuk mengambil teks bersih (membuang HTML).
            * \`'href'\`: Untuk mengambil URL dari atribut 'href'.
            * \`'src'\`: Untuk mengambil URL dari atribut 'src'.
            * \`'html'\`: Untuk mengambil **SELURUH BLOK HTML MENTAH** di dalam selector. Ini sangat penting jika pengguna meminta "html".
    4.  **KONSTRUKSI PENALARAN (\`reasoning\`):** Jelaskan mengapa Anda memilih selector dan skema tersebut.
    5.  **GENERASI JSON FINAL:** Bangun objek JSON dengan hati-hati.

    ### ATURAN KETAT ###
    -   **ATURAN #0 (OUTPUT FINAL):** Respons Anda HARUS berisi SATU blok kode JSON yang valid.
    -   **ATURAN #1 (FLEKSIBILITAS SKEMA):** Kunci di dalam \`schema\` TIDAK TETAP. Buatlah berdasarkan permintaan pengguna. Jika pengguna minta "judul dan rating", skema harus berisi "judul" dan "rating". Jika pengguna minta "html", skema harus berisi kunci seperti "html_blok".
    -   **ATURAN #2 (GUNAKAN \`extract_structured\`):** Untuk SEMUA permintaan ekstraksi data, gunakan \`action: "extract_structured"\`.
    -   **ATURAN #3 (TIPE 'html'):** Jika pengguna menggunakan kata seperti "html", "elemen", atau "blok", gunakan tipe \`'html'\` untuk memenuhi permintaan mengambil struktur mentah.

    ### STRUKTUR JSON YANG WAJIB ANDA HASILKAN ###
    \`\`\`json
    {
      "reasoning": "Penjelasan detail tentang pemilihan selector dan skema dinamis.",
      "commentary": "Komentar ramah untuk pengguna.",
      "action": "pilih_satu: 'extract_structured', 'navigate', 'respond'",

      // HANYA JIKA action = 'extract_structured'
      "container_selector": ".selector-css-untuk-setiap-kartu-jika-ada",
      "schema": {
        "kunci_dinamis_1_berdasarkan_permintaan": { "selector": ".sub-selector-1", "type": "text" },
        "kunci_dinamis_2_berdasarkan_permintaan": { "selector": "img.gambar", "type": "src" },
        "blok_html_jika_diminta": { "selector": ".elemen-div", "type": "html" }
      },
      
      // HANYA JIKA action = 'navigate' atau 'respond'
      "url": "...",
      "instruction": "...",
      "response": "..."
    }
    \`\`\`

    ### DATA UNTUK DIPROSES ###
    -   **Instruksi Pengguna Terakhir:** "${instruction}"
    -   **URL Saat Ini:** "${currentURL}"
    -   **HTML Halaman untuk Dianalisis:**
        ${bodyHTML}

    Sekarang, hasilkan satu blok kode JSON yang valid.
    `;
}
    
async function navigateAndAnalyze(url, instruction, conversationHistory = [], isRecovery = false) {
    let browser = null;
    let page = null;
    let bodyHTML = '';

    try {
        // Fase Fetcher Bertingkat (Tidak diubah)
        try {
            console.log("Tier 1: Mencoba fetch standar...");
            const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36' }});
            if (!response.ok) throw new Error(`Fetch gagal: ${response.status}`);
            const tempHtml = await response.text();
            if (tempHtml.length < 500 || tempHtml.toLowerCase().includes("enable javascript")) {
                throw new Error("Konten dari fetch standar tidak lengkap.");
            }
            bodyHTML = tempHtml;
            console.log("Tier 1: Sukses!");
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
            
            console.log("Menunggu konten halaman asli muncul...");
            await page.waitForSelector('.list-update', { timeout: 30000 });
            console.log("Konten halaman asli terdeteksi.");

            bodyHTML = await page.content();
            console.log("Tier 2: Sukses!");
        }
    
        const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
        const finalPrompt = createEnhancedPrompt(instruction, url, bodyHTML, false, null, conversationHistory); 
        
        const result = await generateContentWithRetry(model, finalPrompt);
        let text = (await result.response).text();
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
        if (!jsonMatch || !jsonMatch[1]) {
            console.error("RESPONS AI TIDAK MENGANDUNG BLOK KODE JSON:", text);
            throw new Error("Gagal mengekstrak JSON dari respons AI.");
        }
        const jsonString = jsonMatch[1];
        const jsonResponse = JSON.parse(jsonString);

        const baseResponse = {
            status: 'success',
            reasoning: jsonResponse.reasoning,
            commentary: jsonResponse.commentary,
            action: jsonResponse.action
        };

        // ==============================================================================
        // === LOGIKA EKSTRAKSI DINAMIS BERDASARKAN SKEMA AI ===
        // ==============================================================================
        if (jsonResponse.action === 'extract_structured') {
            const { container_selector, schema } = jsonResponse;
            if (!schema) {
                throw new Error("AI tidak memberikan 'schema' untuk ekstraksi.");
            }

            const $ = cheerio.load(bodyHTML);
            const data = [];

            const extractValue = (element, schemaItem) => {
                if (!schemaItem || !schemaItem.selector) return null;
                const target = element.find(schemaItem.selector).first();
                if (target.length === 0) return null;
                switch (schemaItem.type) {
                    case 'text': return target.text().trim();
                    case 'href': return target.attr('href');
                    case 'src': return target.attr('src');
                    case 'html': return $.html(target); // Gunakan $.html() untuk mendapatkan HTML luar
                    default: return null;
                }
            };

            const scope = container_selector ? $(container_selector) : $(bodyHTML);
            if (scope.length === 0 && container_selector) {
                 console.warn(`Kontainer selector '${container_selector}' tidak ditemukan.`);
            }

            scope.each((i, el) => {
                const element = $(el);
                const structuredItem = {};
                
                // Loop dinamis melalui skema yang diberikan oleh AI
                for (const key in schema) {
                    const schemaItem = schema[key];
                    structuredItem[key] = extractValue(element, schemaItem);
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
        // Kode recovery dan error handling tidak diubah
        if (isRecovery) {
            console.error("Mode pemulihan gagal menemukan selector yang valid. Menghentikan proses.");
            throw error;
        }
        console.warn("Terjadi kesalahan, mencoba mode pemulihan...", error.message);
        const itemNameMatch = instruction.match(/dapatkan (\w+)|ekstrak (\w+)/i);
        if (itemNameMatch && bodyHTML) {
            const itemName = itemNameMatch[1] || itemNameMatch[2];
            const lookupKey = `${new URL(url).hostname}::${itemName}`;
            console.log(`Mencari ingatan di Supabase untuk kunci: ${lookupKey}`);
            const { data: savedMemory, error: dbError } = await supabase.from('fingerprints').select('fingerprint').eq('lookup_key', lookupKey).single();
            
            if (!savedMemory) {
                console.log("Mode pemulihan dibatalkan: Tidak ada ingatan yang tersimpan untuk kunci ini.");
                if (dbError) console.error("Detail error Supabase:", dbError.message);
                throw error;
            }

            console.log("Ingatan ditemukan! Meminta AI untuk mencari selector baru...");
            const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
            const recoveryPrompt = createEnhancedPrompt(instruction, url, bodyHTML, true, savedMemory.fingerprint);

            const result = await generateContentWithRetry(model, recoveryPrompt);

            let text = (await result.response).text();
            if (text.startsWith("```json")) text = text.substring(7, text.length - 3).trim();
            const newSelectorJson = JSON.parse(text);
            if (newSelectorJson.new_selector) {
                console.log(`Pemulihan berhasil! Selector baru: ${newSelectorJson.new_selector}. Mencoba ulang analisis...`);
                const newInstruction = `Ekstrak data '${itemName}' dari halaman ini menggunakan selector '${newSelectorJson.new_selector}'`;
                return navigateAndAnalyze(url, newInstruction, conversationHistory, true); 
            } else {
                console.error("AI tidak dapat menemukan selector baru dalam mode pemulihan.");
                throw error;
            }
        }
        throw error; 
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// ================== ENDPOINTS EXPRESS (TIDAK DIUBAH) ==================

app.post('/api/scrape', async (req, res) => {
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
    let { url, instruction } = req.body;
    if (!url || !instruction) { return res.status(400).json({ error: 'URL dan instruksi diperlukan' }); }
    
    const results = [];
    let currentUrl = url;
    let currentInstruction = instruction;

    for (let i = 0; i < 10; i++) {
        try {
            const result = await navigateAndAnalyze(currentUrl, currentInstruction);
            results.push(result);
            if (result.status === 'error' || result.action !== 'navigate') { break; }
            
            currentUrl = new URL(result.url, currentUrl).href;
            currentInstruction = result.instruction;
            
            if (!currentInstruction) { break; }
        } catch(error) {
            results.push({ status: 'error', message: `Langkah ke-${i+1} gagal: ${error.message}` });
            break;
        }
    }
    res.json({ status: 'completed', steps: results });
});

app.post('/api/analyze-html', async (req, res) => {
    const { html, instruction } = req.body;
    if (!html || !instruction) {
        return res.status(400).json({ error: 'Konten HTML dan instruksi diperlukan' });
    }
    try {
        const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
        const prompt = createEnhancedPrompt(instruction, "local.html", html);
        
        const result = await generateContentWithRetry(model, prompt);
        
        const response = await result.response;
        let text = response.text();
        
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
        if (!jsonMatch || !jsonMatch[1]) { throw new Error("Gagal mengekstrak JSON dari respons AI."); }
        const jsonString = jsonMatch[1];
        const jsonResponse = JSON.parse(jsonString);

        if (jsonResponse.action === 'extract_structured') {
            const $ = cheerio.load(html);
            const extractedData = {};
             // Logika ini perlu disesuaikan untuk skema dinamis juga jika endpoint ini ingin digunakan
             // Untuk saat ini, kita fokus pada /api/scrape
            res.json({ status: 'success', action: 'extract_structured', data: extractedData, reasoning: jsonResponse.reasoning, commentary: jsonResponse.commentary });
        } else {
             res.json({ status: 'success', action: 'respond', response: jsonResponse.response, reasoning: jsonResponse.reasoning, commentary: jsonResponse.commentary });
        }
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message, stack: error.stack });
    }
});

app.get('/', (req, res) => {
    res.send('AI Scraper API vL.1 (Dinamis) is running!');
});

module.exports = app;

