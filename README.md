# Animation AI Server

سيرفر بسيط (Node.js + Express) بيشتغل كـ"دماغ" لبلجن AI Animator. البلجن بيبعتله وصف الحركة وأسماء المفاصل، والسيرفر بيتواصل مع Google Gemini ويرجّع خطة Keyframes جاهزة.

## 1. التشغيل محليًا (اختياري، للتجربة فقط)

```bash
npm install
cp .env.example .env
# افتح .env وحط مفتاح Google Gemini API عندك بدل القيمة الوهمية
npm start
```

السيرفر رح يشتغل على `http://localhost:3000`. هاد الرابط **ما رح يشتغل جوا Roblox Studio** لأنه رابط محلي على جهازك بس - لازم تنشره على الإنترنت (خطوة 2) عشان ياخد رابط https حقيقي.

## 2. النشر على استضافة مجانية (Render)

1. أنشئ حساب مجاني على https://render.com
2. ارفع هاد المجلد (`animation-ai-server`) على GitHub كـ repository جديد
3. من لوحة Render: **New > Web Service** واختر الـrepository
4. اضبط الإعدادات:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. من قسم **Environment**، أضف متغير:
   - `GEMINI_API_KEY` = مفتاحك من https://aistudio.google.com/apikey
6. اضغط **Create Web Service** وانتظر لين يخلص النشر
7. رح تاخد رابط شكله مثلاً: `https://animation-ai-server-xxxx.onrender.com`

## 3. ربطه بالبلجن

1. افتح بلجن AI Animator جوا Roblox Studio
2. بخانة "رابط API" حط الرابط يلي أخذته من Render **بدون** `/api` بآخره، مثلاً:
   ```
   https://animation-ai-server-xxxx.onrender.com
   ```
3. تأكد إنه "Allow HTTP Requests" مفعّل من Game Settings > Security
4. جرّب توليد حركة

## ملاحظات مهمة

- **مفتاح Google Gemini API خاص فيك وسري** - لا تحطه أبدًا داخل كود البلجن نفسه (Lua) لأنه بيترفع مع أي مشروع تنشره. حطه بس بإعدادات Environment على السيرفر.
- الخطة المجانية على Render بتنام (sleep) بعد فترة عدم استخدام، فأول طلب بعد فترة راحة ممكن ياخد شوي وقت أطول (cold start).
- لو حبيت تستخدم خدمة AI ثانية غير Google Gemini، عدّل فقط الجزء يلي بيستدعي `api.anthropic.com` جوا `server.js`.
