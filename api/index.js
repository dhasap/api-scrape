// api/index.js (Versi R.1 - Final Lengkap)
// Menggabungkan arsitektur Q.1 (Limiter, Mode Jujur) dengan endpoint tambahan dari versi G.1.
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
console.log('Menginisialisasi server (Versi R.1 - Final Lengkap)...');
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

// Prompt AI (v8.0 - Mode Fotografer dengan Limiter) - Dipertahankan sebagai yang tercanggih
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

        // Logika Ekstraksi Dinamis
        if (jsonResponse.action === 'extract_structured') {
            const { container_selector, schema, limit } = jsonResponse; // Ambil limit dari respons AI
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
                    case 'html': return target.html(); // Mengambil Inner HTML
                    default: return null;
                }
            };

            const scope = container_selector ? $(container_selector) : $(bodyHTML);
            if (scope.length === 0 && container_selector) {
                 console.warn(`Kontainer selector '${container_selector}' tidak ditemukan.`);
            }

            // Terapkan limit
            const limitedScope = (typeof limit === 'number' && limit > 0) ? scope.slice(0, limit) : scope;

            limitedScope.each((i, el) => {
                const element = $(el);
                const structuredItem = {};
                
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
            throw error;
        }
        console.warn("Terjadi kesalahan, mencoba mode pemulihan...", error.message);
        const itemNameMatch = instruction.match(/dapatkan (\w+)|ekstrak (\w+)/i);
        if (itemNameMatch && bodyHTML) {
            const itemName = itemNameMatch[1] || itemNameMatch[2];
            const lookupKey = `${new URL(url).hostname}::${itemName}`;
            const { data: savedMemory } = await supabase.from('fingerprints').select('fingerprint').eq('lookup_key', lookupKey).single();
            
            if (!savedMemory) {
                throw error;
            }

            const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
            const recoveryPrompt = createEnhancedPrompt(instruction, url, bodyHTML, true, savedMemory.fingerprint);
            const result = await generateContentWithRetry(model, recoveryPrompt);
            let text = (await result.response).text();
            if (text.startsWith("```json")) text = text.substring(7, text.length - 3).trim();
            const newSelectorJson = JSON.parse(text);
            if (newSelectorJson.new_selector) {
                const newInstruction = `Ekstrak data '${itemName}' menggunakan selector '${newSelectorJson.new_selector}'`;
                return navigateAndAnalyze(url, newInstruction, conversationHistory, true); 
            } else {
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

// ================== ENDPOINTS EXPRESS (Diperluas dengan Fitur dari G.1) ==================

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
    const { html, instruction } = req.body;
    if (!html || !instruction) {
        return res.status(400).json({ error: 'Konten HTML dan instruksi diperlukan' });
    }
    try {
        const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
        const prompt = createEnhancedPrompt(instruction, "[http://local-file.com](http://local-file.com)", html); 
        
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
    res.send('AI Scraper API vR.1 (Final Lengkap) is running!');
});

module.exports = app;

