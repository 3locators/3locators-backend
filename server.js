require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(cors());
app.use(express.json());

// التحقق من وجود المفتاح
if (!process.env.GEMINI_API_KEY) {
    console.error("❌ ERROR: GEMINI_API_KEY is missing!");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ==========================================
// 🧠 دالة اختيار الموديل تلقائياً (لضمان العمل دائماً)
// ==========================================
let cachedModelName = null;
async function getWorkingModel() {
    if (cachedModelName) return cachedModelName;
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`;
        const response = await axios.get(url);
        const bestModel = response.data.models.find(m => 
            m.name.includes("gemini") && m.supportedGenerationMethods.includes("generateContent")
        );
        if (bestModel) {
            cachedModelName = bestModel.name.replace("models/", "");
            console.log(`✅ AI Model Selected: ${cachedModelName}`);
            return cachedModelName;
        }
    } catch (e) { console.error("⚠️ Model discovery failed, defaulting."); }
    return "gemini-1.5-flash"; // Fallback
}

// ==========================================
// 🤖 توجيه الـ AI (Prompt) - استراتيجية البدائل
// ==========================================
const SYSTEM_PROMPT = `
You are a smart GIS assistant for Egypt.
Your goal is to help OpenStreetMap (Nominatim) find locations.
OSM often fails with specific shop names but works well with landmarks/streets.

For every user request, return JSON with TWO queries:
1. "specific": The exact place name (english or arabic) + City.
2. "fallback": The nearest famous landmark, street name, or neighborhood + City.

Example 1:
Input: "عايز اروح كبدة الفلاح في محطة الرمل"
Output JSON: { 
    "specific": "Kebda El Fallah, Mahatet El Raml, Alexandria", 
    "fallback": "Mahatet El Raml Station, Alexandria" 
}

Example 2:
Input: "محل زارا في سيتي ستارز"
Output JSON: {
    "specific": "Zara, City Stars, Cairo",
    "fallback": "City Stars Mall, Cairo"
}

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
    console.log(`📩 New Request: ${userText}`);

    try {
        // 1. الذكاء الاصطناعي يحلل الطلب
        const modelName = await getWorkingModel();
        const model = genAI.getGenerativeModel({ model: modelName });
        
        const result = await model.generateContent(SYSTEM_PROMPT + `\nInput: "${userText}"\nOutput JSON:`);
        const response = await result.response;
        // تنظيف الرد من أي علامات Markdown
        const textResponse = response.text().replace(/```json|```/g, "").trim();
        
        let aiData;
        try {
            aiData = JSON.parse(textResponse);
        } catch (e) {
            // محاولة تصحيح الخطأ لو الرد نصي
            aiData = { specific: userText, fallback: userText + ", Egypt" };
        }

        console.log(`🤖 Plan A (Specific): ${aiData.specific}`);
        console.log(`🤖 Plan B (Fallback): ${aiData.fallback}`);

        // 2. البحث في الخريطة (المحاولة الأولى)
        let nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(aiData.specific)}&addressdetails=1&limit=1`;
        let geoResponse = await axios.get(nominatimUrl, { headers: { 'User-Agent': '3locators-App/2.0' } });

        let place = null;
        let isFallback = false;

        // فحص النتيجة الأولى
        if (geoResponse.data.length > 0) {
            place = geoResponse.data[0];
        } else {
            // 3. البحث في الخريطة (المحاولة الثانية - الخطة البديلة)
            console.log("⚠️ Plan A failed. Trying Plan B...");
            nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(aiData.fallback)}&addressdetails=1&limit=1`;
            geoResponse = await axios.get(nominatimUrl, { headers: { 'User-Agent': '3locators-App/2.0' } });
            
            if (geoResponse.data.length > 0) {
                place = geoResponse.data[0];
                isFallback = true;
            }
        }

        // إذا فشلت المحاولتان
        if (!place) {
            return res.status(404).json({ error: "لم نتمكن من العثور على المكان بدقة. حاول البحث باسم معلم مشهور قريب." });
        }

        // 4. تجهيز النتيجة النهائية
        const lat = parseFloat(place.lat);
        const lng = parseFloat(place.lon);
        const code3L = convertTo3Locators(lat, lng);

        res.json({
            found: true,
            // لو استخدمنا البديل، نوضح للمستخدم
            name: isFallback ? `📍 بالقرب من: ${place.display_name.split(',')[0]}` : place.display_name.split(',')[0],
            address: place.display_name,
            lat: lat,
            lng: lng,
            code: code3L,
            note: isFallback ? "تم تحديد أقرب معلم معروف للمكان المطلوب" : "تم تحديد المكان بدقة"
        });

    } catch (error) {
        console.error("❌ SERVER ERROR:", error.message);
        res.status(500).json({ error: "حدث خطأ داخلي في السيرفر." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Smart Server running on port ${PORT}`));
