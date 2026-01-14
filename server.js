require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// التحقق من المفتاح
if (!process.env.GEMINI_API_KEY) {
    console.error("❌ ERROR: GEMINI_API_KEY is missing!");
}

// ==========================================
// 🤖 إعدادات الذكاء الاصطناعي (مباشر بدون مكتبة)
// ==========================================
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

const SYSTEM_PROMPT = `
You are a GIS assistant. 
Return JSON with TWO queries for OpenStreetMap:
1. "specific": Exact place name + City.
2. "fallback": Nearest landmark/street + City.
Example: "كبدة الفلاح محطة الرمل" -> {"specific": "Kebda El Fallah, Mahatet El Raml, Alexandria", "fallback": "Mahatet El Raml Station, Alexandria"}
RETURN ONLY JSON.
`;

// استدعاء ملف الخوارزمية
let convertTo3Locators;
try {
    const algo = require('./3locators-algo');
    convertTo3Locators = algo.convertTo3Locators;
} catch (e) {
    convertTo3Locators = (lat, lng) => `3LOC-${lat.toFixed(4)}-${lng.toFixed(4)}`;
}

// ==========================================
// 🚀 معالجة الطلب
// ==========================================
app.post('/api/search', async (req, res) => {
    const userText = req.body.text;
    console.log(`📩 Request: ${userText}`);

    try {
        // 1. الاتصال المباشر بجوجل (REST API)
        // هذا يتجاوز مشاكل المكتبة تماماً
        const aiResponse = await axios.post(
            `${GEMINI_API_URL}?key=${process.env.GEMINI_API_KEY}`,
            {
                contents: [{
                    parts: [{ text: SYSTEM_PROMPT + `\nInput: "${userText}"\nOutput JSON:` }]
                }]
            },
            { headers: { 'Content-Type': 'application/json' } }
        );

        // استخراج النص من رد جوجل
        const candidates = aiResponse.data.candidates;
        if (!candidates || candidates.length === 0) throw new Error("No response from AI");
        
        const textResponse = candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();
        
        let aiData;
        try {
            aiData = JSON.parse(textResponse);
        } catch (e) {
            aiData = { specific: userText, fallback: userText + ", Egypt" };
        }

        console.log(`🤖 AI Plan A: ${aiData.specific}`);

        // 2. البحث في الخريطة (OSM)
        let place = null;
        let isFallback = false;

        // محاولة 1
        let geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(aiData.specific)}&addressdetails=1&limit=1`;
        let geoRes = await axios.get(geoUrl, { headers: { 'User-Agent': '3locators-App/2.0' } });
        
        if (geoRes.data.length > 0) {
            place = geoRes.data[0];
        } else {
            // محاولة 2
            console.log(`⚠️ Plan A failed. Trying: ${aiData.fallback}`);
            geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(aiData.fallback)}&addressdetails=1&limit=1`;
            geoRes = await axios.get(geoUrl, { headers: { 'User-Agent': '3locators-App/2.0' } });
            
            if (geoRes.data.length > 0) {
                place = geoRes.data[0];
                isFallback = true;
            }
        }

        if (!place) return res.status(404).json({ error: "لم نتمكن من العثور على المكان." });

        // 3. التكويد
        const lat = parseFloat(place.lat);
        const lng = parseFloat(place.lon);
        const code3L = convertTo3Locators(lat, lng);

        res.json({
            found: true,
            name: place.display_name.split(',')[0],
            address: place.display_name,
            lat: lat,
            lng: lng,
            code: code3L
        });

    } catch (error) {
        console.error("❌ ERROR:", error.response ? error.response.data : error.message);
        
        // التعامل مع خطأ الكوتة (429)
        if (error.response && error.response.status === 429) {
            return res.status(429).json({ error: "السيرفر مشغول حالياً (Quota Exceeded). يرجى المحاولة بعد دقيقة." });
        }

        res.status(500).json({ error: "خطأ داخلي" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Direct-Mode Server running on port ${PORT}`));
