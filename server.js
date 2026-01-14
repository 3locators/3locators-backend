require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(cors());
app.use(express.json());

// التحقق من المفتاح
if (!process.env.GEMINI_API_KEY) {
    console.error("❌ ERROR: GEMINI_API_KEY is missing!");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 🛑 التعديل هنا: استخدام موديل Flash 1.5 حصراً لتجنب مشاكل الكوتة
// هذا الموديل هو الأفضل للباقة المجانية
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// ==========================================
// 🤖 توجيه الـ AI (Prompt)
// ==========================================
const SYSTEM_PROMPT = `
You are a smart GIS assistant for Egypt.
For every user request, return JSON with TWO queries for OpenStreetMap:
1. "specific": The exact place name + City.
2. "fallback": The nearest famous landmark, street name, or neighborhood + City.

Example:
Input: "عايز اروح كبدة الفلاح في محطة الرمل"
Output JSON: { 
    "specific": "Kebda El Fallah, Mahatet El Raml, Alexandria", 
    "fallback": "Mahatet El Raml Station, Alexandria" 
}
RETURN ONLY JSON.
`;

// استدعاء ملف الخوارزمية (3locators-algo.js)
let convertTo3Locators;
try {
    const algo = require('./3locators-algo');
    convertTo3Locators = algo.convertTo3Locators;
} catch (e) {
    // كود احتياطي لو الملف مش موجود
    convertTo3Locators = (lat, lng) => `3LOC-${lat.toFixed(4)}-${lng.toFixed(4)}`;
}

// ==========================================
// 🚀 معالجة الطلب
// ==========================================
app.post('/api/search', async (req, res) => {
    const userText = req.body.text;
    console.log(`📩 Request: ${userText}`);

    try {
        // 1. سؤال Gemini
        const result = await model.generateContent(SYSTEM_PROMPT + `\nInput: "${userText}"\nOutput JSON:`);
        const response = await result.response;
        const textResponse = response.text().replace(/```json|```/g, "").trim();
        
        let aiData;
        try {
            aiData = JSON.parse(textResponse);
        } catch (e) {
            aiData = { specific: userText, fallback: userText + ", Egypt" };
        }

        console.log(`🤖 Plan A: ${aiData.specific}`);

        // 2. البحث في الخريطة (Plan A)
        let nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(aiData.specific)}&addressdetails=1&limit=1`;
        let geoResponse = await axios.get(nominatimUrl, { headers: { 'User-Agent': '3locators-App/2.0' } });

        let place = null;
        let isFallback = false;

        if (geoResponse.data.length > 0) {
            place = geoResponse.data[0];
        } else {
            // 3. البحث في الخريطة (Plan B)
            console.log(`⚠️ Plan A failed. Trying: ${aiData.fallback}`);
            nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(aiData.fallback)}&addressdetails=1&limit=1`;
            geoResponse = await axios.get(nominatimUrl, { headers: { 'User-Agent': '3locators-App/2.0' } });
            
            if (geoResponse.data.length > 0) {
                place = geoResponse.data[0];
                isFallback = true;
            }
        }

        if (!place) {
            return res.status(404).json({ error: "لم نتمكن من العثور على المكان. حاول البحث باسم منطقة مشهورة." });
        }

        // 4. تطبيق خوارزمية 3locators الحقيقية
        const lat = parseFloat(place.lat);
        const lng = parseFloat(place.lon);
        const code3L = convertTo3Locators(lat, lng);

        res.json({
            found: true,
            name: isFallback ? `📍 بالقرب من: ${place.display_name.split(',')[0]}` : place.display_name.split(',')[0],
            address: place.display_name,
            lat: lat,
            lng: lng,
            code: code3L
        });

    } catch (error) {
        console.error("❌ SERVER ERROR:", error.message);
        
        // معالجة خاصة لخطأ الكوتة (429)
        if (error.message.includes('429') || error.message.includes('Quota')) {
            return res.status(429).json({ error: "ضغط شديد على السيرفر، يرجى الانتظار دقيقة والمحاولة مجدداً." });
        }
        
        res.status(500).json({ error: "حدث خطأ داخلي في السيرفر." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Stable Server running on port ${PORT}`));
