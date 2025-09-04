// api/index.js (Versi K.1 - Ekstraksi Berbasis Objek)
// Logika dirombak untuk mengekstrak data sebagai objek terstruktur, bukan daftar terpisah.
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
console.log('Menginisialisasi server (Versi K.1 - Ekstraksi Objek)...');
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
// === FUNGSI PEMBUATAN PROMPT AI (DIROMBAK UNTUK EKSTRAKSI BERBASIS OBJEK) ===
// ==============================================================================
function createEnhancedPrompt(instruction, currentURL, bodyHTML, recoveryAttempt = false, memory = null, conversationHistory = []) {
    // --- PROMPT UNTUK MODE PEMULIHAN DARURAT (TIDAK DIUBAH) ---
    if (recoveryAttempt && memory) {
        // ... (kode pemulihan tidak diubah)
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

    // --- PROMPT UTAMA YANG BARU UNTUK EKSTRAKSI TERSTRUKTUR ---
    const historyText = conversationHistory.map(turn => {
        if (turn.human) return `Human: ${turn.human}`;
        if (turn.ai) return `You: ${turn.ai}`;
        return '';
    }).join('\n');

    return `
    ### PROFIL DAN MISI UTAMA ###
    Anda adalah "CognitoScraper v5.0", sebuah agen AI yang berspesialisasi dalam ekstraksi data web terstruktur. Misi utama Anda adalah mengubah instruksi bahasa manusia menjadi sebuah "resep" JSON yang bisa digunakan untuk mengekstrak sekelompok data yang saling berhubungan menjadi objek-objek yang rapi. Anda berpikir dalam konteks "blok" atau "kartu" data, bukan daftar individual.

    ### PROSES BERPIKIR WAJIB (STEP-BY-STEP) ###
    Sebelum menghasilkan JSON, Anda WAJIB mengikuti proses berpikir internal ini secara ketat:
    1.  **ANALISIS TUJUAN:** Apa inti dari permintaan pengguna ("${instruction}")? Apakah ini tentang mengekstrak daftar entitas yang terstruktur (misal: daftar komik, daftar produk)? Atau ini permintaan navigasi/respons biasa?
    2.  **IDENTIFIKASI KONTAINER UTAMA:** Jika tujuannya ekstraksi terstruktur, pindai HTML dan temukan **selector CSS untuk kontainer yang berulang (repeating container)**. Ini adalah "kartu" atau "blok" yang membungkus semua informasi untuk satu entitas. Contoh: '.list-update .swiper-slide' atau '.product-card'. Ini adalah bagian paling krusial.
    3.  **BUAT PETA DATA (SCHEMA):** Setelah menemukan kontainer utama, lihat ke dalamnya. Buat "peta" atau schema berisi sub-selector untuk setiap bagian data yang diminta pengguna. Sub-selector ini HARUS relatif terhadap kontainer utama.
    4.  **KONSTRUKSI PENALARAN (\`reasoning\`):** Jelaskan MENGAPA Anda memilih selector kontainer dan schema tersebut. Sebutkan nama class atau struktur HTML yang menjadi dasar keputusan Anda. Contoh: "Saya mengidentifikasi '.list-update .swiper-slide' sebagai kontainer utama karena setiap blok ini berisi satu komik lengkap dengan judul, thumbnail, dan chapter. Di dalamnya, judul ada di '.title', thumbnail di 'img', dan seterusnya."
    5.  **PEMBUATAN KOMENTAR (\`commentary\`):** Tulis sapaan singkat dan ramah untuk pengguna dalam format Markdown.
    6.  **GENERASI JSON FINAL:** Bangun objek JSON dengan sangat hati-hati sesuai dengan struktur yang ditentukan di bawah.

    ### ATURAN KETAT YANG TIDAK BOLEH DILANGGAR ###
    -   **ATURAN #0 (OUTPUT FINAL):** Respons Anda HARUS berisi SATU blok kode JSON yang valid dan lengkap. Jangan sertakan teks apa pun sebelum atau sesudah blok kode JSON.
    -   **ATURAN #1 (FOKUS PADA STRUKTUR):** Jika pengguna meminta beberapa data yang jelas-jelas berhubungan (seperti judul, thumbnail, dan chapter komik), SELALU gunakan \`action: "extract_structured"\`. Jangan gunakan action 'extract' yang lama.
    -   **ATURAN #2 (KEJUJURAN DATA):** Jika sebuah sub-selector tidak dapat ditemukan di dalam kontainer, gunakan string kosong "" sebagai selectornya di dalam schema. Jangan mengarang.
    -   **ATURAN #3 (TIPE DATA):** Untuk setiap item di dalam schema, tentukan tipe ekstraksinya ('text', 'href', 'src').

    ### STRUKTUR JSON YANG WAJIB ANDA HASILKAN ###
    \`\`\`json
    {
      "reasoning": "Penjelasan detail tentang pemilihan selector kontainer dan peta schema.",
      "commentary": "Komentar ramah untuk pengguna.",
      "action": "pilih_satu: 'extract_structured', 'navigate', 'respond'",

      // HANYA JIKA action = 'extract_structured'
      "container_selector": ".selector-css-untuk-setiap-kartu-komik",
      "schema": {
        "title": { "selector": ".sub-selector-judul-di-dalam-kartu", "type": "text" },
        "url": { "selector": "a.link-utama", "type": "href" },
        "thumbnail": { "selector": "img.gambar-thumbnail", "type": "src" },
        "latest_chapter": {
          "title": { "selector": ".chapter-title", "type": "text" },
          "url": { "selector": ".chapter-url", "type": "href" }
        }
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

    Sekarang, ikuti proses berpikir wajib dan hasilkan satu blok kode JSON yang valid.
    `;
}
    
async function navigateAndAnalyze(url, instruction, conversationHistory = [], isRecovery = false) {
    let browser = null;
    let page = null;
    let bodyHTML = '';

    try {
        // Fase Fetcher Bertingkat (Tidak diubah)
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
            browser = await puppeteer.launch({
                args: sparticuz_chromium.args,
                executablePath,
                headless: sparticuz_chromium.headless
            });

            page = await browser.newPage();
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
            
            console.log("Menunggu konten halaman asli muncul (maks. 30 detik)...");
            await page.waitForSelector('.list-update', { timeout: 30000 });
            console.log("Konten halaman asli terdeteksi.");

            bodyHTML = await page.content();
            console.log("Tier 2: Sukses! Konten didapat menggunakan browser.");
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
        // === LOGIKA EKSTRAKSI BARU UNTUK 'extract_structured' ===
        // ==============================================================================
        if (jsonResponse.action === 'extract_structured') {
            const { container_selector, schema } = jsonResponse;
            if (!container_selector || !schema) {
                throw new Error("AI tidak memberikan 'container_selector' atau 'schema' untuk ekstraksi terstruktur.");
            }

            const $ = cheerio.load(bodyHTML);
            const data = [];

            // Fungsi helper untuk mengekstrak satu nilai berdasarkan schema
            const extractValue = (element, schemaItem) => {
                if (!schemaItem || !schemaItem.selector) return null;
                const target = element.find(schemaItem.selector).first();
                switch (schemaItem.type) {
                    case 'text': return target.text().trim();
                    case 'href': return target.attr('href');
                    case 'src': return target.attr('src');
                    case 'html': return target.html();
                    default: return null;
                }
            };

            $(container_selector).each((i, el) => {
                const element = $(el);
                const structuredItem = {
                    title: extractValue(element, schema.title),
                    url: extractValue(element, schema.url),
                    thumbnail: extractValue(element, schema.thumbnail),
                    latest_chapter: {
                        title: extractValue(element, schema.latest_chapter?.title),
                        url: extractValue(element, schema.latest_chapter?.url)
                    },
                    // Anda bisa menambahkan lebih banyak field di sini jika schema AI mendukungnya
                    // genre: extractValue(element, schema.genre),
                    // rating: extractValue(element, schema.rating),
                };
                data.push(structuredItem);
            });

            // Ganti nama field 'data' menjadi 'structured_data' untuk kejelasan
            return { ...baseResponse, structured_data: data };

        }
        // ==============================================================================
        // === LOGIKA LAMA 'extract' (TETAP ADA UNTUK KASUS LAIN) ===
        // ==============================================================================
        else if (jsonResponse.action === 'extract') {
            const $ = cheerio.load(bodyHTML);
            const extractedData = {};
            for (const item of jsonResponse.items) {
                // ... (kode ekstraksi lama tidak diubah)
                if (!item.name || typeof item.name !== 'string' || item.name.trim() === '') {
                    console.warn("Melewatkan item dari AI karena tidak memiliki 'name' yang valid:", item);
                    continue; 
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
        // ... (kode recovery dan error handling tidak diubah)
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
                console.log("Mode pemulihan dibatalkan: Tidak ada ingatan yang tersimpan untuk kunci ini. Melemparkan kembali error asli.");
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
            console.log("Menutup browser...");
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

// ... (sisa endpoints tidak diubah)
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

        if (jsonResponse.action === 'extract') {
            const $ = cheerio.load(html);
            const extractedData = {};
            for (const item of jsonResponse.items) {
                if (!item.name || typeof item.name !== 'string' || item.name.trim() === '') {
                    console.warn("Melewatkan item dari AI di /analyze-html karena tidak memiliki 'name' yang valid:", item);
                    continue;
                }
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
    res.send('AI Scraper API vK.1 (Ekstraksi Objek) is running!');
});

module.exports = app;

