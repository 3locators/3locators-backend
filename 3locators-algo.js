/**
 * 3locators Core Algorithm (Server Side)
 * Extracted from: Pro Final Code
 * Function: Converts Lat/Lng to 10-Character Digital Address
 */

const BASE35 = '0123456789ABCDEFGHIJKLMNPQRSTUVWXYZ';
const BASE35_LENGTH = BASE35.length;
const CODE_CHARS_PER_COORD = 5;
const WORLD_LAT_RANGE = 180;
const WORLD_LON_RANGE = 360;

// دالة مساعدة لتحويل الأرقام لنظام Base35
const toBase = (n) => {
    let r = '';
    let t = n;
    if (t === 0) return '00000';
    while (t > 0) {
        r = BASE35[t % 35] + r;
        t = Math.floor(t / 35);
    }
    // التأكد أن الطول دائماً 5 خانات
    return r.padStart(5, '0');
};

/**
 * الدالة الرئيسية لتحويل الإحداثيات
 * @param {number} lat - خط العرض
 * @param {number} lng - خط الطول
 * @returns {string} - الكود المنسق (مثال: 1234-AB-CD-EF)
 */
function convertTo3Locators(lat, lng) {
    // 1. التأكد من نوع البيانات
    const latVal = parseFloat(lat);
    const lngVal = parseFloat(lng);

    // 2. الثوابت الجغرافية
    const minLat = -90;
    const minLon = -180;

    // 3. معادلات القياس (Scaling Logic)
    // نستخدم Math.pow بدلاً من ** لضمان التوافق مع كل نسخ Node.js
    const latScale = Math.pow(BASE35_LENGTH, CODE_CHARS_PER_COORD) / WORLD_LAT_RANGE;
    const lonScale = Math.pow(BASE35_LENGTH, CODE_CHARS_PER_COORD) / WORLD_LON_RANGE;

    // 4. الحساب (Encoding)
    const sLat = Math.round((latVal - minLat) * latScale);
    const sLon = Math.round((lngVal - minLon) * lonScale);

    // 5. دمج الكود (5 حروف للعرض + 5 حروف للطول)
    const rawCode = toBase(sLat) + toBase(sLon);

    // 6. التنسيق (Formatting) لجعل الكود مقروءاً
    // التنسيق المستخدم: XXXX-XX-XX-XX
    return `${rawCode.substring(0,4)}-${rawCode.substring(4,6)}-${rawCode.substring(6,8)}-${rawCode.substring(8,10)}`;
}

module.exports = { convertTo3Locators };
