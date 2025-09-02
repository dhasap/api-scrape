// api/index.js (Versi A - Fondasi Kuat & AI Cerdas)
// Menggabungkan semua fitur terbaik: Stealth, Fetcher Bertingkat, dan Ingatan Supabase
// dengan sistem prompt yang diperbarui untuk kecerdasan maksimal.
require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

// Fase 1: Menggunakan Puppeteer + Stealth untuk kemampuan Anti-Bot
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const sparticuz_chromium = require('@sparticuz/chromium');

puppeteer.use(StealthPlugin());

// Fase 3: Koneksi ke Supabase untuk "Ingatan" Jangka Panjang
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// --- Konfigurasi ---
console.log('Menginisialisasi server (Versi A - Fondasi Kuat & AI Cerdas)...');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const AI_MODEL_NAME = "gemini-1.5-pro-latest"; // Menggunakan model Pro untuk tugas kompleks

if (!GEMINI_API_KEY) {
    console.error("KRITIS: API Key Gemini tidak ditemukan.");
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const app = express();
app.use(express.json({ limit: '50mb' }));

/**
 * Ini adalah jantung dari "Otak AI".
 * Ia membangun sebuah prompt yang sangat detail untuk model AI,
 * memberikannya peran, aturan ketat, dan format output yang presisi.
 * @param {string} instruction - Instruksi asli dari pengguna.
 * @param {string} currentURL - URL halaman yang sedang dianalisis.
 * @param {string} bodyHTML - Konten HTML halaman.
 * @param {boolean} recoveryAttempt - Flag yang menandakan apakah ini mode pemulihan.
 * @param {object|null} memory - "Ingatan" dari Supabase untuk mode pemulihan.
 * @returns {string} - Prompt yang lengkap dan siap dikirim ke AI.
 */
function createEnhancedPrompt(instruction, currentURL, bodyHTML, recoveryAttempt = false, memory = null) {
    // ================== PROMPT UNTUK MODE PEMULIHAN DARURAT ==================
    if (recoveryAttempt && memory) {
        return `
        PERHATIAN: ANDA DALAM MODE PEMULIHAN DARURAT.
        Anda adalah AI spesialis pemulihan scraper. Misi Anda adalah menemukan selector CSS baru untuk sebuah elemen yang selector lamanya sudah tidak valid.

        **KONTEKS KEGAGALAN:**
        - Instruksi Awal Pengguna: "${instruction}"
        - Selector Lama yang GAGAL: "${memory.selector}"

        **"INGATAN" (PETUNJUK) TENTANG ELEMEN YANG DICARI:**
        - Jenis Tag Seharusnya: '<${memory.tagName}>'
        - Contoh Teks di Dalamnya: "${memory.textSample}"
        - Dulu Memiliki Atribut Seperti: ${memory.attributes.join(', ')}

        **ATURAN ANDA DI MODE INI:**
        1.  Abaikan instruksi awal pengguna. Fokus HANYA pada misi menemukan selector baru.
        2.  Analisis seluruh HTML di bawah ini dengan teliti.
        3.  Temukan satu elemen yang paling cocok dengan petunjuk dari "INGATAN".
        4.  Respons Anda HARUS dan HANYA berupa JSON yang valid. Jangan ada teks atau penjelasan lain.
        5.  Format JSON HARUS seperti ini: \`{"new_selector": "selector_css_baru_yang_paling_mirip_dan_stabil"}\`

        **HTML LENGKAP UNTUK DIANALISIS:**
        \`\`\`html
        ${bodyHTML}
        \`\`\`
        `;
    }

    // ================== PROMPT STANDAR UNTUK OPERASI NORMAL ==================
    return `
    Anda adalah "ScrapeMind", sebuah agen AI web scraping yang sangat canggih, logis, dan teliti.
    Misi utama Anda adalah menerjemahkan instruksi bahasa manusia menjadi perintah JSON yang presisi untuk dieksekusi oleh mesin scraper.

    **ATURAN UTAMA YANG TIDAK BOLEH DILANGGAR:**
    -   **ATURAN #0 (PALING PENTING):** Respons Anda WAJIB berupa satu objek JSON yang valid. Jangan pernah menulis teks, salam, penjelasan, atau markdown (\`\`\`json) di luar JSON itu sendiri.
    -   **ATURAN #1 (PRESISI):** Selalu cari selector CSS yang paling spesifik dan stabil. Prioritaskan ID (#), lalu class yang unik (.class-unik), dan hindari tag umum (seperti 'div' atau 'a') jika memungkinkan.
    -   **ATURAN #2 (URL ABSOLUT):** Saat melakukan navigasi, URL yang Anda berikan HARUS absolut. URL halaman saat ini adalah "${currentURL}". Jika Anda menemukan link relatif seperti "/chapter/5", Anda WAJIB menggabungkannya menjadi "${new URL('/chapter/5', currentURL).href}".
    -   **ATURAN #3 (PIKIRKAN LANGKAH BERIKUTNYA):** Untuk navigasi, instruksi berikutnya harus jelas dan bisa dieksekusi. Contoh: "Setelah mengklik link chapter, ekstrak judul chapter dari tag h1".

    **TIGA TINDAKAN YANG BISA ANDA AMBIL (PILIH SATU):**

    ---
    **1. TINDAKAN: "extract"**
    * **Gunakan jika:** Pengguna meminta untuk MENGAMBIL, MENCARI, atau MENDAFTAR data dari halaman.
    * **Struktur JSON WAJIB:**
        \`\`\`json
        {
          "action": "extract",
          "items": [
            {
              "name": "nama_data_yang_diminta_secara_spesifik",
              "selector": "selector_css_paling_stabil_untuk_elemen_ini",
              "type": "pilih_salah_satu_dari_opsi_di_bawah"
            }
          ]
        }
        \`\`\`
    * **Opsi untuk "type":**
        * `'text'`: Untuk mengambil konten teks yang terlihat oleh manusia (contoh: "Chapter 1: The Beginning").
        * `'href'`: KHUSUS untuk mendapatkan nilai dari atribut 'href' pada tag \`<a>\`.
        * `'src'`: KHUSUS untuk mendapatkan nilai dari atribut 'src' pada tag \`<img>\`, \`<script>\`, dll.

    ---
    **2. TINDAKAN: "navigate"**
    * **Gunakan jika:** Pengguna meminta untuk PINDAH HALAMAN (klik link, pergi ke halaman berikutnya, dll).
    * **Struktur JSON WAJIB:**
        \`\`\`json
        {
          "action": "navigate",
          "url": "url_absolut_dan_lengkap_hasil_resolusi_dari_ATURAN_2",
          "instruction": "instruksi_baru_yang_jelas_dan_bisa_dieksekusi_untuk_halaman_tujuan"
        }
        \`\`\`

    ---
    **3. TINDAKAN: "respond"**
    * **Gunakan jika:** Pengguna bertanya sesuatu yang bisa dijawab langsung dari teks, jika instruksi tidak jelas, atau JIKA DATA YANG DIMINTA TIDAK ADA di halaman.
    * **Struktur JSON WAJIB:**
        \`\`\`json
        {
          "action": "respond",
          "response": "jawaban_lengkap_dan_informatif_dalam_bentuk_teks"
        }
        \`\`\`
    ---

    **PROSES BERPIKIR ANDA SEBELUM MENJAWAB:**
    1.  Apa tujuan inti dari instruksi pengguna: mengambil data, pindah halaman, atau menjawab pertanyaan?
    2.  Pilih satu dari tiga tindakan (\`extract\`, \`Maps\`, \`respond\`) yang paling sesuai.
    3.  Jika \`extract\` atau \`Maps\`, identifikasi elemen target. Rancang selector CSS yang paling kuat dan tidak mudah rusak.
    4.  Jika \`Maps\`, pastikan URL sudah absolut sesuai ATURAN #2.
    5.  Konstruksi respons JSON dengan sangat hati-hati sesuai struktur yang diwajibkan.

    **KONTEKS ANDA SAAT INI:**
    -   Instruksi Pengguna: "${instruction}"
    -   URL Saat Ini: "${currentURL}"
    -   HTML Halaman untuk Dianalisis:
    \`\`\`html
    ${bodyHTML}
    \`\`\`

    Sekarang, laksanakan misi Anda. Berikan satu respons JSON yang valid.
    `;
}
    
async function navigateAndAnalyze(url, instruction, isRecovery = false) {
    let browser = null;
    let page = null;
    let bodyHTML = '';

    try {
        // Fase 2: Fetcher Bertingkat untuk efisiensi
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
        const finalPrompt = createEnhancedPrompt(instruction, url, bodyHTML);
        const result = await model.generateContent(finalPrompt);
        let text = (await result.response).text();

        // Membersihkan respons AI dari markdown
        if (text.startsWith("```json")) text = text.substring(7, text.length - 3).trim();
        const jsonResponse = JSON.parse(text);

        if (jsonResponse.action === 'extract') {
            const $ = cheerio.load(bodyHTML);
            const extractedData = {};
            
            // Fase 3: Logika "Mengingat"
            if (!page) { // Jika kita pakai fetch, butuh browser sementara untuk memindai
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
                // Menyimpan sidik jari jika elemen ditemukan oleh Puppeteer
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

                // Melakukan ekstraksi dengan Cheerio yang cepat
                const cheerioElements = $(item.selector);
                if (cheerioElements.length === 0) {
                    // Jika Cheerio gagal, ini memicu error untuk masuk ke mode pemulihan
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
            
            return { status: 'success', action: 'extract', data: extractedData };
        } 
        else if (jsonResponse.action === 'navigate') {
            return { status: 'success', action: 'navigate', url: jsonResponse.url, instruction: jsonResponse.instruction };
        } 
        else { // action 'respond'
             return { status: 'success', action: 'respond', response: jsonResponse.response };
        }

    } catch (error) {
        // Fase 3: Logika "Memulihkan"
        if (isRecovery) {
            console.error("Mode pemulihan gagal menemukan selector yang valid. Menghentikan proses.");
            throw error; // Lemparkan error asli setelah gagal pulih
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
                throw error; // Lemparkan error asli jika tidak ada ingatan
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
                // Membuat instruksi baru yang lebih spesifik untuk AI agar tidak salah lagi
                const newInstruction = `Ekstrak data '${itemName}' dari halaman ini menggunakan selector '${newSelectorJson.new_selector}'`;
                // Memanggil kembali fungsi ini dengan instruksi baru dan flag pemulihan
                return navigateAndAnalyze(url, newInstruction, true); 
            } else {
                console.error("AI tidak dapat menemukan selector baru dalam mode pemulihan.");
                throw error; // Lemparkan error asli jika AI gagal
            }
        }
        
        throw error; // Lemparkan error asli jika tidak masuk ke logika pemulihan
    } finally {
        if (browser) {
            console.log("Menutup browser...");
            await browser.close();
        }
    }
}

// ================== ENDPOINTS (TIDAK ADA PERUBAHAN) ==================
// Semua endpoint Express di bawah ini tetap sama persis seperti kode asli Anda.
// Mereka hanya berfungsi sebagai "pintu masuk" untuk memanggil fungsi utama 'navigateAndAnalyze'.

app.post('/api/scrape', async (req, res) => {
    const { url, instruction } = req.body;
    if (!url || !instruction) {
        return res.status(400).json({ error: 'URL dan instruksi diperlukan' });
    }
    const result = await navigateAndAnalyze(url, instruction);
    res.json(result);
});

app.post('/api/chain-scrape', async (req, res) => {
    let { url, instruction } = req.body;
    if (!url || !instruction) { return res.status(400).json({ error: 'URL dan instruksi diperlukan' }); }
    const results = [];
    let currentUrl = url;
    let currentInstruction = instruction;
    for (let i = 0; i < 10; i++) { // Maksimal 10 langkah untuk keamanan
        const result = await navigateAndAnalyze(currentUrl, currentInstruction);
        results.push(result);
        if (result.status === 'error' || result.action !== 'navigate') { break; }
        try {
            currentUrl = new URL(result.url, currentUrl).href;
            currentInstruction = result.instruction;
        } catch (e) {
            results.push({ status: 'error', message: `Invalid URL: ${result.url}` });
            break;
        }
        if (!currentInstruction) { break; }
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
        const prompt = createEnhancedPrompt(instruction, "local.html", html); // URL dummy untuk analisis lokal
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();
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
                        case 'text': value = $(el).text(); break;
                        case 'href': value = $(el).attr('href'); break;
                        case 'src': value = $(el).attr('src'); break;
                        default: value = $(el).html();
                    }
                    data.push(value);
                });
                extractedData[item.name] = data;
            }
            res.json({ status: 'success', action: 'extract', data: extractedData });
        } else {
             res.json({ status: 'success', action: 'respond', response: jsonResponse.response });
        }
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message, stack: error.stack });
    }
});

app.get('/', (req, res) => {
    res.send('AI Scraper API is running!');
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

module.exports = app;

