/**
 * 3locators Core Algorithm
 * يحول الإحداثيات الجغرافية إلى كود نصي
 */
function convertTo3Locators(lat, lng) {
    // ---------------------------------------------------------
    // 🛑 مكان دمج المعادلة الحقيقية لاحقاً
    // ---------------------------------------------------------
    
    // كود مؤقت: يأخذ آخر 4 أرقام من الإحداثيات
    const latPart = Math.abs(lat).toFixed(4).split('.')[1];
    const lngPart = Math.abs(lng).toFixed(4).split('.')[1];
    
    // يحدد المدينة بناءً على خط العرض (تقريبياً للتجربة)
    let cityCode = "EGY";
    if (lat > 31) cityCode = "ALX"; // اسكندرية
    else if (lat < 30.2) cityCode = "CAI"; // القاهرة

    return `3L-${cityCode}-${latPart}-${lngPart}`;
}

module.exports = { convertTo3Locators };