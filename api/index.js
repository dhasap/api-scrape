// api/index.js (Versi D.1 - Gabungan Cerdas)
// Menggabungkan Arsitektur Prompt Lanjutan (C.1) dengan fungsionalitas
// Supabase, mode pemulihan, dan endpoint dari versi A.3.
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
console.log('Menginisialisasi server (Versi D.1 - Gabungan Cerdas)...');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const AI_MODEL_NAME = "gemini-1.5-flash-latest";

if (!GEMINI_API_KEY) {
    console.error("KRITIS: API Key Gemini tidak ditemukan.");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const app = express();
app.use(express.json({ limit: '50mb' }));

/**
 * ===================================================================================
 * FUNGSI UTAMA: PEMBUATAN PROMPT AI (createEnhancedPrompt)
 * ===================================================================================
 * Diperbarui dengan arsitektur prompt lanjutan untuk kecerdasan maksimal,
 * sambil mempertahankan mode pemulihan darurat.
 */
function createEnhancedPrompt(instruction, currentURL, bodyHTML, recoveryAttempt = false, memory = null, conversationHistory = []) {
    // ================== PROMPT UNTUK MODE PEMULIHAN DARURAT (TETAP ADA) ==================
    if (recoveryAttempt && memory) {
        return `
        PERHATIAN: ANDA DALAM MODE PEMULIHAN DARURAT.
        Misi Anda adalah menemukan selector CSS baru untuk sebuah elemen yang selector lamanya sudah tidak valid.

        **KONTEKS KEGAGALAN:**
        - Instruksi Awal Pengguna: "${instruction}"
        - Selector Lama yang GAGAL: "${memory.selector}"

        **"INGATAN" (PETUNJUK) TENTANG ELEMEN YANG DICARI:**
        - Jenis Tag Seharusnya: '<${memory.tagName}>'
        - Contoh Teks di Dalamnya: "${memory.textSample}"
        - Dulu Memiliki Atribut Seperti: ${memory.attributes.join(', ')}

        **ATURAN ANDA DI MODE INI:**
        1.  Fokus HANYA pada misi menemukan selector baru.
        2.  Analisis seluruh HTML di bawah ini.
        3.  Temukan satu elemen yang paling cocok dengan petunjuk dari "INGATAN".
        4.  Respons Anda HARUS dan HANYA berupa JSON yang valid.
        5.  Format JSON HARUS seperti ini: {"new_selector": "selector_css_baru_yang_paling_mirip_dan_stabil"}

        **HTML LENGKAP UNTUK DIANALISIS:**
        ${bodyHTML}
        `;
    }

    // ================== PROMPT STANDAR BARU (DARI VERSI C.1) ==================
    const historyText = conversationHistory.map(turn => {
        if (turn.human) return `Human: ${turn.human}`;
        if (turn.ai) return `You: ${turn.ai}`;
        return '';
    }).join('\n');

    return `
    ### PROFIL DAN MISI UTAMA ###
    Anda adalah "CognitoScraper v3.0", sebuah agen AI web scraping dengan tingkat presisi tertinggi. Misi Anda adalah mengubah instruksi bahasa manusia yang kompleks menjadi struktur data JSON yang sempurna untuk dieksekusi oleh mesin. Anda bersifat metodis, analitis, dan sangat teliti. Anda tidak pernah mengasumsikan, tetapi selalu memverifikasi berdasarkan HTML yang diberikan.

    ### PROSES BERPIKIR WAJIB (STEP-BY-STEP) ###
    Sebelum menghasilkan JSON, Anda WAJIB mengikuti proses berpikir internal ini:
    1.  **ANALISIS TUJUAN:** Apa inti dari permintaan pengguna terakhir ("${instruction}")? Apakah untuk (a) mengekstrak data, (b) menavigasi ke halaman lain, atau (c) merespons pertanyaan umum?
    2.  **EVALUASI KONTEKS:** Tinjau riwayat percakapan. Apakah permintaan saat ini merupakan kelanjutan dari tugas sebelumnya?
    3.  **PEMINDAIAN HTML:** Pindai KESELURUHAN DOKUMEN HTML yang disediakan. Identifikasi kandidat elemen yang cocok dengan permintaan.
    4.  **PEMILIHAN STRATEGI:** Tentukan selector CSS, URL tujuan, atau jawaban yang paling tepat berdasarkan analisis.
    5.  **KONSTRUKSI PENALARAN (\`reasoning\`):** Jelaskan MENGAPA Anda memilih tindakan dan selector tertentu.
    6.  **PEMBUATAN KOMENTAR (\`commentary\`):** Tulis sapaan singkat dan ramah untuk pengguna dalam format Markdown.
    7.  **GENERASI JSON FINAL:** Bangun objek JSON dengan sangat hati-hati sesuai dengan struktur yang ditentukan.

    ### ATURAN KETAT YANG TIDAK BOLEH DILANGGAR ###
    -   **ATURAN #0 (OUTPUT):** Respons Anda HARUS berisi SATU blok kode JSON yang valid dan lengkap. Anda BOLEH menulis teks biasa di luar blok JSON ini (yang akan diabaikan oleh parser), tetapi blok JSON itu sendiri harus sempurna.
    -   **ATURAN #1 (SELECTOR):** Selector CSS HARUS spesifik dan ada di dalam HTML.
    -   **ATURAN #2 (URL):** Semua URL dalam tindakan 'navigate' WAJIB absolut. Gunakan "${currentURL}" sebagai basis.
    -   **ATURAN #3 (KEJUJURAN):** Jika data yang diminta tidak ada, gunakan tindakan 'respond'.

    ### RIWAYAT PERCAKAPAN SEBELUMNYA ###
    ${historyText || "Ini adalah interaksi pertama."}

    ### STRUKTUR JSON YANG WAJIB ANDA HASILKAN ###
    {
      "reasoning": "Penjelasan singkat tentang proses berpikir Anda.",
      "commentary": "Komentar ramah untuk pengguna dalam format Markdown.",
      "action": "pilih_satu: 'extract', 'navigate', 'respond'",
      "items": [ /* jika action = extract */ ],
      "url": "...", /* jika action = navigate */
      "instruction": "...", /* jika action = navigate */
      "response": "..." /* jika action = respond */
    }

    ### DATA UNTUK DIPROSES ###
    -   **Instruksi Pengguna Terakhir:** "${instruction}"
    -   **URL Saat Ini:** "${currentURL}"
    -   **HTML Halaman untuk Dianalisis:**
        ${bodyHTML}

    Sekarang, ikuti proses berpikir wajib dan hasilkan satu blok JSON yang valid.
    `;
}
    
async function navigateAndAnalyze(url, instruction, conversationHistory = [], isRecovery = false) {
    let browser = null;
    let page = null;
    let bodyHTML = '';

    try {
        // Fase 2: Fetcher Bertingkat (TETAP ADA)
        try {
            console.log("Tier 1: Mencoba fetch standar (cepat & ringan)...");
            const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36' }});
            if (!response.ok) throw new Error(`Fetch gagal dengan status: ${response.status}`);
            const tempHtml = await response.text();
            if (tempHtml.length < 500 || tempHtml.toLowerCase().includes("enable javascript") || tempHtml.toLowerCase().includes("checking if the site connection is secure")) {
                throw new Error("Konten dari fetch standar tidak lengkap, butuh browser.");
            }
            bodyHTML = tempHtml;
            console.log("Tier 1: Sukses! Konten didapat tanpa menjalankan browser.");
        } catch (e) {
            console.log(`Tier 1 Gagal: ${e.message}. Menggunakan Tier 2 (Puppeteer)...`);
            const executablePath = await sparticuz_chromium.executablePath();
            browser = await puppeteer.launch({ args: sparticuz_chromium.args, executablePath, headless: sparticuz_chromium.headless });
            page = await browser.newPage();
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
            bodyHTML = await page.content();
            console.log("Tier 2: Sukses! Konten didapat menggunakan browser.");
        }
    
        const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
        // PERUBAHAN: Mengirim 'conversationHistory' ke prompt
        const finalPrompt = createEnhancedPrompt(instruction, url, bodyHTML, false, null, conversationHistory); 
        const result = await model.generateContent(finalPrompt);
        let text = (await result.response).text();

        // PERUBAHAN: Menggunakan parser JSON yang lebih tahan banting
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error("RESPONS AI TIDAK MENGANDUNG JSON:", text);
            throw new Error("Gagal mengekstrak JSON dari respons AI. Model mungkin memberikan jawaban naratif.");
        }
        const jsonString = jsonMatch[0];
        const jsonResponse = JSON.parse(jsonString);

        // PERUBAHAN: Menyiapkan respons dasar dengan data baru (reasoning, commentary)
        const baseResponse = {
            status: 'success',
            reasoning: jsonResponse.reasoning,
            commentary: jsonResponse.commentary,
            action: jsonResponse.action
        };

        if (jsonResponse.action === 'extract') {
            const $ = cheerio.load(bodyHTML);
            const extractedData = {};
            
            // Logika fingerprint Supabase (TETAP ADA)
            if (!page) { 
                console.log("Membuka browser sementara untuk memindai & menyimpan sidik jari...");
                if (!browser) {
                    const executablePath = await sparticuz_chromium.executablePath();
                    browser = await puppeteer.launch({ args: sparticuz_chromium.args, executablePath, headless: sparticuz_chromium.headless });
                }
                page = await browser.newPage();
                await page.setContent(bodyHTML, { waitUntil: 'networkidle0' });
            }

            for (const item of jsonResponse.items) {
                const elementHandle = await page.$(item.selector);
                if (elementHandle) { 
                    const fingerprintData = {
                        tagName: await elementHandle.evaluate(el => el.tagName.toLowerCase()),
                        textSample: (await elementHandle.evaluate(el => el.innerText)).substring(0, 150).trim(),
                        attributes: await elementHandle.evaluate(el => Array.from(el.attributes, ({name}) => name)),
                        selector: item.selector
                    };
                    const lookupKey = `${new URL(url).hostname}::${item.name}`;
                    const { error } = await supabase.from('fingerprints').upsert({ lookup_key: lookupKey, fingerprint: fingerprintData });
                    if(error) console.error("Gagal menyimpan sidik jari ke Supabase:", error);
                    else console.log(`Sidik jari untuk '${lookupKey}' berhasil disimpan/diperbarui.`);
                }
                const cheerioElements = $(item.selector);
                if (cheerioElements.length === 0) {
                    throw new Error(`Selector '${item.selector}' tidak ditemukan di halaman.`);
                }
                const data = [];
                cheerioElements.each((i, el) => {
                    let value;
                    switch (item.type) { case 'text': value = $(el).text().trim(); break; case 'href': value = $(el).attr('href'); break; case 'src': value = $(el).attr('src'); break; default: value = $(el).html(); }
                    data.push(value);
                });
                extractedData[item.name] = data;
            }
            
            return { ...baseResponse, data: extractedData };
        } 
        else if (jsonResponse.action === 'navigate') {
            return { ...baseResponse, url: jsonResponse.url, instruction: jsonResponse.instruction };
        } 
        else {
             return { ...baseResponse, response: jsonResponse.response };
        }

    } catch (error) {
        // Logika pemulihan darurat menggunakan Supabase (TETAP ADA)
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
            if (dbError || !savedMemory) {
                console.error("Tidak ada ingatan yang ditemukan di database untuk pemulihan:", dbError);
                throw error;
            }
            console.log("Ingatan ditemukan! Meminta AI untuk mencari selector baru...");
            const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
            const recoveryPrompt = createEnhancedPrompt(instruction, url, bodyHTML, true, savedMemory.fingerprint);
            const result = await model.generateContent(recoveryPrompt);
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
            console.log("Menutup browser...");
            await browser.close();
        }
    }
}

// ================== ENDPOINTS EXPRESS (TETAP ADA) ==================

app.post('/api/scrape', async (req, res) => {
    // PERUBAHAN: Menambahkan 'conversation_history'
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
    // Endpoint ini tetap sama, namun akan mendapat manfaat dari AI yang lebih baik
    let { url, instruction } = req.body;
    if (!url || !instruction) { return res.status(400).json({ error: 'URL dan instruksi diperlukan' }); }
    
    const results = [];
    let currentUrl = url;
    let currentInstruction = instruction;

    for (let i = 0; i < 10; i++) { // Maksimal 10 langkah untuk keamanan
        try {
            // Note: chain-scrape tidak menggunakan riwayat percakapan agar setiap langkah independen
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
    // Endpoint ini tetap sama, namun akan mendapat manfaat dari AI yang lebih baik
    const { html, instruction } = req.body;
    if (!html || !instruction) {
        return res.status(400).json({ error: 'Konten HTML dan instruksi diperlukan' });
    }
    try {
        const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
        const prompt = createEnhancedPrompt(instruction, "local.html", html);
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();
        
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) { throw new Error("Gagal mengekstrak JSON dari respons AI."); }
        const jsonString = jsonMatch[0];
        const jsonResponse = JSON.parse(jsonString);

        if (jsonResponse.action === 'extract') {
            const $ = cheerio.load(html);
            const extractedData = {};
            for (const item of jsonResponse.items) {
                const elements = $(item.selector);
                const data = [];
                elements.each((i, el) => {
                    let value;
                    switch (item.type) {
                        case 'text': value = $(el).text(); break;
                        case 'href': value = $(el).attr('href'); break;
                        case 'src': value = $(el).attr('src'); break;
                        default: value = $(el).html();
                    }
                    data.push(value);
                });
                extractedData[item.name] = data;
            }
            res.json({ status: 'success', action: 'extract', data: extractedData, reasoning: jsonResponse.reasoning, commentary: jsonResponse.commentary });
        } else {
             res.json({ status: 'success', action: 'respond', response: jsonResponse.response, reasoning: jsonResponse.reasoning, commentary: jsonResponse.commentary });
        }
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message, stack: error.stack });
    }
});

app.get('/', (req, res) => {
    res.send('AI Scraper API vD.1 (Gabungan Cerdas) is running!');
});

module.exports = app;

