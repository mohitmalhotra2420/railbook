# RailBook — Addendum v1.4.3 (24 Sep 2026)

**Release:** `c552093` (Render deploy `dep-daqi4mm7bikc738jp9gg` — **live**, 24 Sep 2026 13:16 UTC)
**APK:** `RailBook-v1.4.3-release.apk` — versionCode **26**, versionName **1.4.3-voice-seat-intent**

---

## 1. Naya: "bolne wala" screen (VoiceSheet)

ConfirmTkt ke "Listening" screen jaisa:

- Mic dabate hi **sheet** khulti hai — jo bolte ho wo **live** likha jata hai (interim transcript).
- **Chips** (ek tap me sawaal): Get Confirmed Ticket · AC Trains · 2A me seat? · Best Alternatives.
- **Bada mic** (level ke saath ring pulse) + **✍️ Type** (keyboard) + **✕** (cancel).
- **OK ✓ Bhejo** dabane par hi sawaal jata hai — **auto-send band** (manual commit pehle se tha, ab dikhta bhi hai).

Purana inline voice panel hata diya gaya (ek hi jagah voice UI). Naya file: `src/components/VoiceSheet.tsx` (+ `.vs-*` CSS).

## 2. Naya: server-side seat intent (AI-side samajh)

Server khud bhasha padh kar filter karta hai — `server/understand/seatIntent.ts` + `server/agent/seatFilter.ts`:

- **Class:** 1A / 2A / 3A / 3E / SL / CC / 2S / EC (+ "sab class" → sab).
- **Seat words:** seat / सीट / सीटें / बर्थ / खाली / उपलब्ध / available.
- **Sort:** "sabse sasti / low fare" → fare asc · "sabse fast / jaldi" → duration asc.
- **Time:** "5 baje ke baad" → 17:00 · "रात 8 के बाद" → 20:00 · "17:30 ke baad" → 17:30 (Hinglish + Devanagari numerals).
- **Quota** (TQ/PT/LD) aur **sirf confirmed** bhi.

AI jawab ke saath ek **seat line** append hoti hai; `seatFilter` payload bhi response me aata hai (client fallback ke liye).
Agar model jawab na de aur seat intent ho → deterministic seat reply (`source: "evidence"`).

**Feature flag:** `SEAT_FILTER_SERVER` (default **ON**; `0/false/off` → purana behaviour).

### Live proof (railbook-gegs.onrender.com, 24 Sep)

| Sawaal | Result |
|---|---|
| "Ludhiana se New Delhi 2A mein seat hai kal?" | `💺 2A me seat wali 6 trains — 14036 2A AVL 40 ₹845 · 11078 2A AVL 29 ₹825 … (LDH → NDLS · live board)` — source `evidence`, 6 rows |
| "Ludhiana se New Delhi kal 3A mein sabse sasti seat wali train" | `sort: cheapest`, `💺 3A me seat wali 3 trains · sabse sasta pehle — 11078 3A AVL 98 ₹585 · 14036 3A AVL 185 ₹600 · 22706 3A AVL 248 ₹730` |
| "लुधियाना से नई दिल्ली रात 8 के बाद स्लीपर में सीट चाहिए कल" | `classes: [SL]`, `afterMinute: 1200`, line: `💺 SL me aaj koi seat wali train nahi mili (20:00 ke baad). 1 trains ka time pata nahi chal paya.` |

"Delhi" likhne par (multi-station) pehle station choice aata hai — phir seat filter. Ye purana behaviour hai, badla nahi.

## 3. Seat Finder client layer (fallback) — pehle jaisa

`src/seatfinder.ts` + `src/components/SeatFinder.tsx`: chat ke train table **aur** journey plan card — dono par chips (✅ Confirmed only · class · Time · ⚡ Sabse jaldi · 💰 Sabse sasta), **seats upar / WL neeche**, board-only trains "time —" ke saath. Ye AI down hone par bhi chalta hai.

## 4. Jo **nahi** chhua (user condition)

- AI ka search karne ka tareeka, tools/API calling ka tareeka — **waisa hi**.
- Alternatives + connecting journeys ka logic — **waisa hi**.
- Seat filter sirf **maujooda route-board** par lagaya gaya (koi naya endpoint/tool nahi).

## 5. Tests / build

- Naye tests: `tests/server-seat-intent.test.ts` (9), `tests/voice-sheet.test.tsx` (5) — kul **90 files / 911 tests PASS**.
- `npm run build` OK.
- APK sha256: `1239b443746196316747aa78ff1966a8e2e6c3f359645e8654e78d2f9bc43226` (cert SHA-256 `c2e38a05…d176`, v1.4.2 par in-place upgrade).

---

## 6. Round-15.1 — user screenshots ke 3 fix (24 Sep, commit `b2a7b55`, deploy `dep-daqj42ou01pc738bvhf0` LIVE)

| # | Shikayat (screenshot) | Kyun ho raha tha | Fix |
|---|---|---|---|
| 1 | Results card me **Swarn Shatabdi ki sirf ek class** ("CC AVL") dikh rahi thi, jabki **EC bhi available** thi | Route board kuch classes **UNKNOWN** ke saath deta hai (12029 me `EC: UNKNOWN`), aur card UNKNOWN ko seat list me nahi dikhata | Seat Finder ab adhoori trains ka **per-train class board** laata hai (wahi `/api/availability?trainNumber=…` jo TrainBoard "Refresh seats" use karta hai) aur UNKNOWN row ki jagah **asli row** rakhta hai. Live: 12029 → `CC AVL 86` + **`EC AVL 6 ₹660`**. Max 10 trains, 3 ek saath, koi naya endpoint nahi |
| 2 | "12029 ki seat availability CC 2026-09-25 ko LDH se BEAS" → AI ne seat nahi batayi, "provider se nahi mil pa rahi" | App **`/api/agent`** (agentic) path use karta hai; humara seat-intent filter sirf `/api/agent/auto` (autonomous) me lagaya gaya tha. 6-parallel load test me provider **http_429** bhi mila | Seat intent ab **app ke path par** bhi: `parseSeatIntent` → maujooda route-board filter → jawab ke saath honest seat line (AI fail/429 ho to **akeli line**). Boli gayi train ki row pehle. Koi naya tool/endpoint/planner change nahi. Live: `💺 CC me seat wali 1 train — 12029 CC AVL 86 ₹345. (LDH → BEAS · live board)` |
| 3 | "AC trains dikhao" par **2S / SL** bhi dikh gayi thi | "AC" ko koi class-word nahi maana jaata tha → koi filter nahi lagta tha; client me `\bec\b` ka matlab galat se **CC** tha | AC = **1A/2A/3A/3E/CC/EC** (server `classGroup: "AC"` + client `acOnly` + **❄️ AC** chip, preview me bhi). `EC` (Executive Chair Car) ab CC nahi banta. Live: `💺 AC (1A/2A/3A/3E/CC/EC) me seat wali 8 trains — 12203 3A AVL 220 ₹285 · 12029 CC AVL 86 ₹345 · …` |

**Saath me:** mic permission wala message ab action batata hai — "Allow popup me Allow dabao — ya Settings → Apps → RailBook → Permissions → Microphone ON karo … chaaho to type bhi kar sakte ho".

**Jo nahi chhua:** AI search/tools/API calling, alternatives + connecting journeys logic — sab waisa hi (user condition).

**Load test (6 parallel seat sawaal):** 5 clean pass, 1 me `source=none failureReason=http_429` — ye model-provider ka rate-limit tha, aur **ab us case me bhi seat line** user ko milti hai (fallback flag `seatFilterFallback: true`).

**APK:** v1.4.3 hi chalega — app WebView me live site (`railbook-gegs.onrender.com`) kholta hai, isliye ye teeno fix app me apne aap aa gaye. Naya APK chahiye to bolo (v1.4.4 bump kar denge).

**Tests:** 90 files / **925 PASS** (`npm run build` clean).
