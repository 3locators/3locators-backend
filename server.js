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
    console.error("❌ Critical Error: GEMINI_API_KEY is missing in Environment Variables!");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ==========================================
// 🧠 الدالة الذكية لاختيار الموديل (Self-Healing)
// ==========================================
let cachedModelName = null;

async function getWorkingModel() {
    if (cachedModelName) return cachedModelName;

    try {
        console.log("🔍 Asking Google for available models...");
        // استخدام REST API مباشرة لمعرفة المتاح
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`;
        const response = await axios.get(url);
        
        const models = response.data.models;
        // البحث عن أول موديل "Gemini" يدعم توليد المحتوى
        const bestModel = models.find(m => 
            m.name.includes("gemini") && 
            m.supportedGenerationMethods.includes("generateContent")
        );

        if (bestModel) {
            // حذف كلمة "models/" من الاسم لأن المكتبة تضيفها تلقائياً أحياناً
            const cleanName = bestModel.name.replace("models/", "");
            console.log(`✅ Selected Model: ${cleanName}`);
            cachedModelName = cleanName;
            return cleanName;
        }
    } catch (error) {
        console.error("⚠️ Failed to list models, falling back to 'gemini-pro'");
    }
    
    return "gemini-pro"; // اسم احتياطي أخير
}

// ==========================================
// 🗺️ إعدادات النظام
// ==========================================
const SYSTEM_PROMPT = `
You are a GIS assistant. Convert Egyptian slang to OpenStreetMap search queries.
Input: "عايز اروح مكتبة اسكندرية" -> Output JSON: { "query": "Bibliotheca Alexandrina, Alexandria" }
Input: "محطة الرمل" -> Output JSON: { "query": "Mahatet El Raml, Alexandria" }
RETURN ONLY JSON.
`;

// استدعاء ملف الخوارزمية (تأكد من وجود الملف بجواره)
let convertTo3Locators;
try {
    const algo = require('./3locators-algo');
    convertTo3Locators = algo.convertTo3Locators;
} catch (e) {
    // دالة مؤقتة في حالة عدم وجود الملف
    convertTo3Locators = (lat, lng) => `3LOC-${lat.toFixed(4)}-${lng.toFixed(4)}`;
}

app.post('/api/search', async (req, res) => {
    const userText = req.body.text;
    console.log(`📩 Request: ${userText}`);

    try {
        // 1. اختيار الموديل ديناميكياً
        const modelName = await getWorkingModel();
        const model = genAI.getGenerativeModel({ model: modelName });

        // 2. سؤال Gemini
        const result = await model.generateContent(SYSTEM_PROMPT + `\nInput: "${userText}"\nOutput JSON:`);
        const response = await result.response;
        const textResponse = response.text().replace(/```json|```/g, "").trim();
        
        let aiData;
        try {
            aiData = JSON.parse(textResponse);
        } catch (e) {
            // محاولة تصحيح JSON لو الـ AI رد بنص عادي
            console.warn("⚠️ AI Response wasn't strict JSON, retrying...");
            aiData = { query: userText + ", Egypt" }; 
        }
        
        console.log(`🤖 AI Query: ${aiData.query}`);

        // 3. البحث في الخريطة (OSM)
        const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(aiData.query)}&addressdetails=1&limit=1`;
        const geoResponse = await axios.get(nominatimUrl, {
            headers: { 'User-Agent': '3locators-App/1.0' } 
        });

        if (geoResponse.data.length === 0) {
            return res.status(404).json({ error: "لم نجد مكاناً بهذا الاسم، حاول توضيح الاسم أكثر." });
        }

        const place = geoResponse.data[0];
        const lat = parseFloat(place.lat);
        const lng = parseFloat(place.lon);

        // 4. توليد الكود
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
        console.error("❌ SERVER ERROR:", error.message);
        // طباعة تفاصيل الخطأ لو كان من جوجل
        if (error.response) console.error("Google Error Detail:", error.response.data);
        
        res.status(500).json({ error: "حدث خطأ في النظام، يرجى المحاولة لاحقاً." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
