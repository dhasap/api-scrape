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

async function navigateAndAnalyze(url, instruction) {
    let browser;
    try {
        console.log("Meluncurkan browser dengan Puppeteer...");
        
        // Konfigurasi untuk Puppeteer agar menggunakan @sparticuz/chromium
        browser = await puppeteer.launch({
            args: sparticuz_chromium.args,
            executablePath: await sparticuz_chromium.executablePath(),
            headless: sparticuz_chromium.headless,
        });

        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle2' });
        const bodyHTML = await page.content();
        
        console.log("Konten halaman berhasil diambil, menganalisis dengan AI...");

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
        const prompt = `${instruction}. Berikan respons dalam format JSON. HTML Lengkap:\n\n${bodyHTML}`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        console.log("Respons AI diterima.");

        // Membersihkan string respons agar menjadi JSON yang valid
        if (text.startsWith("```json")) {
            text = text.substring(7, text.length - 3).trim();
        }

        const jsonResponse = JSON.parse(text);

        if (jsonResponse.action === 'extract') {
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
                            value = $(el).html();
                    }
                    data.push(value);
                });
                extractedData[item.name] = data;
            }
            return {
                status: 'success',
                action: 'extract',
                data: extractedData
            };
        } else if (jsonResponse.action === 'navigate') {
            return {
                status: 'success',
                action: 'navigate',
                url: jsonResponse.url,
                instruction: jsonResponse.instruction
            };
        } else {
            return {
                status: 'success',
                action: 'respond',
                response: jsonResponse.response
            };
        }

    } catch (error) {
        console.error("Terjadi kesalahan:", error);
        return {
            status: 'error',
            message: error.message
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
        return res.status(400).json({ error: 'URL and instruction are required' });
    }

    console.log(`Menerima permintaan untuk URL: ${url}`);
    const result = await navigateAndAnalyze(url, instruction);
    res.json(result);
});


// Endpoint baru untuk melakukan chain scraping
app.post('/api/chain-scrape', async (req, res) => {
    let { url, instruction } = req.body;

    if (!url || !instruction) {
        return res.status(400).json({ error: 'URL and instruction are required' });
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
            break; // Berhenti jika ada error atau bukan perintah navigasi
        }
        
        // Cek apakah URL absolut atau relatif
        const nextUrl = new URL(result.url, currentUrl).href;
        currentUrl = nextUrl;
        currentInstruction = result.instruction;

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
        return res.status(400).json({ error: 'HTML content and instruction are required' });
    }

    try {
        console.log("Menganalisis konten HTML dengan AI...");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
        const prompt = `${instruction}. Berikan respons dalam format JSON. HTML:\n\n${html}`;
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
            message: error.message
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

