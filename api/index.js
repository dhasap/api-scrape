// api/index.js (Versi X.3 - Otak AI Cerdas)
// Versi final dengan prompt AI cerdas, tanpa logika proxy di backend.
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
console.log('Menginisialisasi server (Versi X.3 - Otak AI Cerdas)...');
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

// Fungsi dan Prompt untuk Misi Pengintaian (Tidak diubah)
function createReconPrompt(skeletalHtml) {
    return `
    ### PROFIL DAN MISI UTAMA ###
    Anda adalah "ReconAI", seorang ahli arsitektur front-end yang sangat berpengalaman. Misi Anda HANYA SATU: menganalisis kerangka HTML dari sebuah halaman web dan mengidentifikasi **satu selector CSS** yang paling mungkin menjadi **kontainer utama untuk konten dinamis** yang akan dimuat oleh JavaScript.
    ### PROSES BERPIKIR WAJIB (STEP-BY-STEP) ###
    1.  **ANALISIS STRUKTUR:** Pindai keseluruhan HTML yang diberikan. Abaikan header, footer, sidebar, dan menu navigasi. Fokus pada area konten utama di tengah halaman.
    2.  **IDENTIFIKASI PETUNJUK:** Cari petunjuk dalam nama class atau ID yang mengindikasikan sebuah daftar atau area konten utama. Petunjuk umum meliputi kata-kata seperti: "list", "posts", "items", "main", "content", "grid", "latest", "results".
    3.  **PEMILIHAN KANDIDAT TERBAIK:** Dari beberapa kemungkinan, pilih SATU selector yang paling spesifik namun tetap cukup umum untuk menjadi kontainer utama. Hindari selector yang terlalu spesifik yang mungkin hanya menargetkan satu item.
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
        return jsonResponse.dynamic_container_selector || 'body';
    } catch (error) {
        console.error("Gagal menjalankan Misi Pengintaian AI:", error);
        return 'body';
    }
}


// --- PROMPT AI CERDAS (Versi 9.0) ---
function createEnhancedPrompt(instruction, currentURL, bodyHTML, conversationHistory = []) {
    const historyText = conversationHistory.map(turn => {
        if (turn.human) return `Human: ${turn.human}`;
        if (turn.ai) return `You: ${turn.ai}`;
        return '';
    }).join('\n');

    return `
    ### PROFIL DAN MISI UTAMA ###
    Anda adalah "CognitoAgent v9.0", seorang agen AI cerdas dengan DUA kemampuan utama: Navigasi dan Ekstraksi. Misi Anda adalah memahami niat pengguna secara akurat dan memilih tindakan yang paling tepat berdasarkan analisis mendalam.

    ### PROSES BERPIKIR WAJIB (WAJIB DIIKUTI SECARA BERURUTAN) ###
    1.  **ANALISIS NIAT PENGGUNA (LANGKAH KRITIS):** Ini adalah langkah PALING PENTING. Baca instruksi terakhir pengguna ("${instruction}") dan tentukan SATU dari tiga kemungkinan niat utama dengan prioritas sebagai berikut:
        * **NIAT #1: NAVIGASI (PRIORITAS TERTINGGI):** Apakah pengguna ingin PINDAH ke halaman lain? Cari kata kunci eksplisit seperti "klik", "pindah ke", "buka halaman", "pergi ke", "navigasi ke", "menu", "halaman popular", "next page", "halaman selanjutnya". Jika niat ini terdeteksi, Anda WAJIB menghasilkan \`action: "navigate"\`. JANGAN melakukan scraping meskipun ada data yang bisa diambil.
        * **NIAT #2: EKSTRAKSI DATA:** Apakah pengguna ingin MENGAMBIL atau MENGUMPULKAN INFORMASI dari halaman SAAT INI? Cari kata kunci seperti "scrape", "ambil data", "dapatkan daftar", "ekstrak", "cari judul", "apa saja isinya". Jika tidak ada niat navigasi yang terdeteksi, dan ada permintaan data, maka tujuan Anda adalah menghasilkan \`action: "extract_structured"\`.
        * **NIAT #3: RESPON UMUM:** Apakah pengguna hanya bertanya, memberikan pernyataan, atau instruksinya tidak jelas? Jika tidak ada niat navigasi atau ekstraksi yang jelas, tujuan Anda adalah menghasilkan \`action: "respond"\` untuk memberikan jawaban atau meminta klarifikasi.

    2.  **EKSEKUSI BERDASARKAN NIAT:**

        * **JIKA NIAT = NAVIGASI:**
            a.  Pindai keseluruhan HTML untuk menemukan elemen tautan (\`<a>\`) yang teks atau atributnya paling cocok dengan instruksi pengguna (misal: teks "Popular" atau "Next").
            b.  Ekstrak nilai atribut \`href\` dari tautan tersebut. Jika tautan tidak ditemukan, laporkan dalam \`reasoning\` dan pilih \`action: "respond"\`.
            c.  Buat objek JSON dengan \`action: "navigate"\`. Sertakan \`url\` yang ditemukan dan buat instruksi lanjutan yang relevan, seperti "analisa halaman baru ini".

        * **JIKA NIAT = EKSTRAKSI DATA:**
            a.  Ikuti "Filosofi Kejujuran Data": Nama kunci (key) dalam skema HARUS diambil dari nama class/atribut HTML yang paling relevan. Jangan menerjemahkan (misal: gunakan "post-title", bukan "judul_artikel").
            b.  Default tipe ekstraksi adalah \`'html'\`. Hanya gunakan \`'text'\`, \`'href'\`, atau \`'src'\` jika diminta secara eksplisit.
            c.  Identifikasi selector CSS untuk kontainer item yang berulang jika pengguna meminta daftar.
            d.  Jika pengguna menyebutkan batasan jumlah (misal: "5 item teratas"), Anda WAJIB menyertakan field \`"limit": 5\` dalam JSON Anda.
            e.  Buat objek JSON dengan \`action: "extract_structured"\`.

    ### ATURAN KETAT YANG TIDAK BOLEH DILANGGAR ###
    -   **ATURAN #0 (OUTPUT FINAL):** Respons Anda HARUS berisi SATU blok kode JSON yang valid dan HANYA itu.
    -   **ATURAN #1 (HIERARKI NIAT):** Analisis NIAT NAVIGASI selalu didahulukan. Jika ada keraguan antara navigasi dan ekstraksi, PILIH NAVIGASI.
    -   **ATURAN #2 (SATU AKSI):** Hanya pilih SATU nilai untuk kunci \`action\`: \`"navigate"\`, \`"extract_structured"\`, atau \`"respond"\`.

    ### CONTOH OUTPUT BERDASARKAN NIAT ###

    **Contoh untuk NIAT NAVIGASI (Perintah: "pindah ke halaman popular"):**
    \`\`\`json
    {
      "reasoning": "Niat pengguna terdeteksi sebagai NAVIGASI karena perintah 'pindah ke halaman popular'. Saya menemukan elemen \`<a>\` dengan teks 'Popular' yang mengarah ke '/series/popular' dan akan melakukan navigasi.",
      "commentary": "Baik, saya akan menavigasi ke halaman Popular sekarang.",
      "action": "navigate",
      "url": "/series/popular",
      "instruction": "Setelah berada di halaman popular, analisa dan berikan saran scraping."
    }
    \`\`\`

    **Contoh untuk NIAT EKSTRAKSI (Perintah: "ambil 5 judul teratas"):**
    \`\`\`json
    {
      "reasoning": "Niat pengguna adalah EKSTRAKSI DATA karena perintah 'ambil 5 judul teratas'. Saya mengidentifikasi kontainer '.list-update_item' dan membuat skema untuk mengambil judul dan gambar dengan batas 5 item.",
      "commentary": "Siap! Berikut adalah 5 item teratas dari halaman ini.",
      "action": "extract_structured",
      "limit": 5,
      "container_selector": ".list-update_item",
      "schema": {
        "title": { "selector": "h3.title", "type": "text" },
        "image_url": { "selector": ".thumb img", "type": "src" }
      }
    }
    \`\`\`

    ### DATA UNTUK DIPROSES ###
    -   **Instruksi Pengguna Terakhir:** "${instruction}"
    -   **URL Saat Ini:** "${currentURL}"
    -   **HTML Halaman untuk Dianalisis:**
        ${bodyHTML}
    `;
}
    
async function navigateAndAnalyze(url, instruction, conversationHistory = [], userAgent = null) {
    let browser = null;
    let page = null;
    
    // --- Mendefinisikan User-Agent ---
    const defaultUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36';
    const finalUserAgent = userAgent || defaultUserAgent;

    // --- LANGKAH MANAJEMEN SESI (Tidak diubah) ---
    const session_key = new URL(url).hostname;
    let savedCookies = [];
    try {
        console.log(`Membaca sesi untuk '${session_key}' dari Supabase...`);
        const { data, error } = await supabase
            .from('sessions')
            .select('cookies')
            .eq('id', session_key)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.warn("Gagal membaca sesi dari Supabase:", error.message);
        } else if (data && data.cookies) {
            savedCookies = data.cookies;
            console.log(`✓ Sesi ditemukan, ${savedCookies.length} cookie akan disuntikkan.`);
        } else {
            console.log("Tidak ada sesi sebelumnya yang ditemukan untuk domain ini.");
        }
    } catch (dbError) {
        console.error("Error saat mengakses Supabase untuk membaca sesi:", dbError);
    }
    
    try {
        let finalHtml = ''; 

        // Fase Fetcher Bertingkat (Tier 1)
        try {
            console.log(`Tier 1: Mencoba fetch standar dengan User-Agent: ${finalUserAgent}`);
            const response = await fetch(url, { headers: { 'User-Agent': finalUserAgent }});
            if (!response.ok) throw new Error(`Fetch gagal: ${response.status}`);
            const tempHtml = await response.text();
            
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
            await page.setUserAgent(finalUserAgent);
            console.log(`Puppeteer User-Agent diatur ke: ${finalUserAgent}`);

            if (savedCookies.length > 0) {
                console.log("Menyuntikkan cookie ke browser...");
                await page.setCookie(...savedCookies);
                console.log("✓ Cookie berhasil disuntikkan.");
            }

            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
            
            console.log("Memberi waktu 10 detik bagi Cloudflare untuk menyelesaikan pemeriksaan...");
            await new Promise(resolve => setTimeout(resolve, 10000));
            console.log("Waktu tunggu selesai, melanjutkan proses.");

            const initialHtml = await page.content();
            console.log("Menjalankan Misi Pengintaian...");
            const dynamicSelector = await getDynamicContentSelector(initialHtml);
            
            if (dynamicSelector && dynamicSelector !== 'body') {
                 console.log(`AI Navigator merekomendasikan untuk menunggu selector: '${dynamicSelector}'`);
                 await page.waitForSelector(dynamicSelector, { timeout: 30000 });
                 console.log("Konten dinamis terdeteksi.");
            } else {
                console.log("AI Navigator tidak menemukan selector spesifik.");
            }

            finalHtml = await page.content();
            console.log("Tier 2: Sukses! Konten final telah didapat.");

            console.log("Mengambil cookie sesi saat ini dari browser...");
            const currentCookies = await page.cookies();
            if (currentCookies && currentCookies.length > 0) {
                console.log(`Menyimpan/memperbarui ${currentCookies.length} cookie untuk sesi '${session_key}'...`);
                const { error: upsertError } = await supabase
                    .from('sessions')
                    .upsert({ id: session_key, cookies: currentCookies, updated_at: new Date().toISOString() });
                
                if (upsertError) {
                    console.error("Gagal menyimpan sesi ke Supabase:", upsertError.message);
                } else {
                    console.log("✓ Sesi berhasil disimpan ke Supabase.");
                }
            } else {
                console.log("Tidak ada cookie untuk disimpan dari sesi ini.");
            }
        }
    
        const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });
        const finalPrompt = createEnhancedPrompt(instruction, url, finalHtml, conversationHistory); 
        
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
        console.warn("Terjadi kesalahan:", error.message);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// ================== ENDPOINTS EXPRESS ==================

app.post('/api/scrape', async (req, res) => {
    const { url, instruction, conversation_history, userAgent } = req.body;
    if (!url || !instruction) {
        return res.status(400).json({ error: 'URL dan instruksi diperlukan' });
    }
    try {
        const result = await navigateAndAnalyze(url, instruction, conversation_history, userAgent);
        res.json(result);
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/api/chain-scrape', async (req, res) => {
    let { url, instruction, userAgent } = req.body;
    if (!url || !instruction) { return res.status(400).json({ error: 'URL dan instruksi diperlukan' }); }
    
    const results = [];
    let currentUrl = url;
    let currentInstruction = instruction;
    const conversationHistory = []; 

    for (let i = 0; i < 10; i++) { 
        try {
            const result = await navigateAndAnalyze(currentUrl, currentInstruction, conversationHistory, userAgent);
            results.push(result);
            conversationHistory.push({ human: currentInstruction });
            conversationHistory.push({ ai: result.commentary || "Melanjutkan navigasi." });
            if (result.status === 'error' || result.action !== 'navigate' || !result.url) {
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
    res.send('AI Scraper API vX.3 (Otak AI Cerdas) is running!');
});

module.exports = app;

