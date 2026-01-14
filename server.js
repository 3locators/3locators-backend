require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { convertTo3Locators } = require('./3locators-algo'); // استدعاء ملف الخوارزمية

const app = express();
app.use(cors()); // للسماح للواجهة بالاتصال بالسيرفر
app.use(express.json());

// التحقق من وجود مفتاح الـ API
if (!process.env.GEMINI_API_KEY) {
    console.warn("⚠️ تحذير: لم يتم العثور على GEMINI_API_KEY في المتغيرات البيئية");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `
You are a GIS assistant converting Egyptian slang into a structured search query for OpenStreetMap (Nominatim).
Rules:
1. Nominatim works best with "Specific Name, City".
2. Strip away prepositions like "near", "beside", "in front of".
3. If the user asks for a generic category (e.g., "pharmacy"), map it to the center of the area or a famous one.
4. Input: "عايز اروح مكتبة اسكندرية" -> Output JSON: { "query": "Bibliotheca Alexandrina, Alexandria" }
5. Input: "محطة الرمل" -> Output JSON: { "query": "Mahatet El Raml, Alexandria" }
RETURN ONLY JSON.
`;

app.post('/api/search', async (req, res) => {
    const userText = req.body.text;
    console.log(`📩 طلب جديد: ${userText}`);

    try {
        // 1. استخدام Gemini لفهم النص
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent(SYSTEM_PROMPT + `\nInput: "${userText}"\nOutput JSON:`);
        const response = await result.response;
        const textResponse = response.text().replace(/```json|```/g, "").trim();
        const aiData = JSON.parse(textResponse);
        
        console.log(`🤖 Gemini اقترح: ${aiData.query}`);

        // 2. البحث في OpenStreetMap
        // نستخدم User-Agent لتجنب الحظر من OSM
        const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(aiData.query)}&addressdetails=1&limit=1`;
        
        const geoResponse = await axios.get(nominatimUrl, {
            headers: { 'User-Agent': '3locators-App/1.0 (cultnat.org)' } 
        });

        if (geoResponse.data.length === 0) {
            return res.status(404).json({ error: "لم يتم العثور على المكان، حاول كتابة الاسم الرسمي." });
        }

        const place = geoResponse.data[0];
        const lat = parseFloat(place.lat);
        const lng = parseFloat(place.lon);

        // 3. تطبيق خوارزمية 3locators
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
        console.error("❌ Error:", error.message);
        res.status(500).json({ error: "حدث خطأ في المعالجة" });
    }
});

// Render يقوم بتعيين المنفذ تلقائياً عبر process.env.PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));