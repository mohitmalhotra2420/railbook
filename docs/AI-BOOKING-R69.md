# R69 — "AI Booking khulta hi nahi" ka pakka ilaaj (1 Oct 2026)

**User (1 Oct 2026, do baar):** *"AI booking open nhi ho rha … AI khud book kare seats user se data
poochke … har query AI par jaani chahiye pehle … tools/web scraping sab use kare … ek dum ChatGPT
jaisi conversational, kuch bhi fake na ho … purane chat wale architecture/AI behaviour/logic/API ko
touch mat karna … 'understanding' ki jagah 'thoda samay lagega aapki request process kar raha hun',
1 minute se zyada lage to 'thoda sa aur samay lagega' … baaki AI khud soche … booking automate ho."*

---

## 1. Pehle sach — kya nikla (bina kuch maane)

R68 ka fix (hooks early return ke upar) prod par live tha **aur kaam kar raha tha**. Ye sirf dawa nahi,
**asli browser me naapa gaya**:

- Chromium (headless) se live prod `https://railbook-gegs.onrender.com` khola → `🎫 AI Booking` dabaya →
  panel khula (dialog), koi console/page error nahi. WebView-jaisa environment (Android UA, Web Speech
  API band, `RailBookVoice` bridge maujood) bhi simulate kiya → wahi natija.
- Prod par poora flow: journey → train → class → passengers — sab chala, har message par
  `POST /api/agent/stream` (brain pehle) gaya.

To phir user ko purana crash kyun dikh raha tha? **Asli wajah mili: purana bundle zinda reh jaata hai.**

- Android app ka WebView page ko **memory me zinda** rakhta hai. Deploy hone ke baad bhi wahi purana JS
  chalta rehta hai (app background se lauta ho to reload hi nahi hota) → user ko **naya fix dikhta hi
  nahi**, aur uske paas R67 wala crashy bundle chalta rehta hai.
- Isi wajah se "fix ke baad bhi AI Booking nahi khul raha" jaisa lagta hai — halanki server theek tha.

## 2. Ab do taale lagaye (dono AI Booking ke andar)

### (a) Crash-guard — panel gir jaaye to bhi chat na gire
Pehle panel ke andar kuch bhi toota (jaise React #310) to poora chat gir jaata tha
("⚠️ chat dikha nahi paaya"). Ab panel apne `ErrorBoundary` ke andar hai:

- kuch bhi toote → sirf **AI Booking ki jagah chhota card**: "⚠️ AI Booking dikha nahi paaya" + **↻ Dobara try**;
- **chat/journey jaisi thi waisi chalti rehti hai** — screen khaali nahi hoti.
- Ye wrapper **sirf `src/views/AiBooking.tsx`** me hai; `Concierge`/chat ki file ko **haath nahi lagaya**.

### (b) Purana bundle pakadna (self-heal)
Panel khulte waqt uska build tag (header ka `7da8f67`) server ke `/api/version` se milta hai:

- **alag** → saaf line: "🔄 Naya version aa gaya hai — taaza kar raha hoon…" aur page khud taaza;
- **same / network fail / 6s timeout / session me dobara** → kuch nahi hota (koi chhed-chhad nahi).

Ye **asli browser me test** hua: `/api/version` par jaan-bujh kar alag commit diya → note dikha aur page
khud reload hua. Normal case me note nahi aata (kyunki commit same hai).

### (c) Android app (v1.5.4) — wahi jaanch app shell me
WebView page ko zinda rakhta hai, isliye app me bhi wahi check lagaya (resume par):

- page ka build tag vs server commit **alag** → page taaza (chat/journey localStorage se wapas);
- **AI Booking panel khula ho** → reload nahi, sirf saaf line: "Naya version aa gaya hai — upar ⟳ dabaiye"
  (user ki conversation beech me nahi tootgi);
- 60s cooldown, 4s timeout, fail par chup.

## 3. Baaki demands — pehle se chal rahi hain (verify ki hui)

| User ki maang | Halat | Saboot |
|---|---|---|
| Har query **pehle AI** par | ✅ | prod par har message → `POST /api/agent/stream` |
| **Sabhi tools + web scraping** | ✅ | wahi chat brain (`/api/agent`), koi tool band nahi |
| **ChatGPT jaisa conversational** | ✅ | prod jawab: asli trains + availability |
| **Kuch bhi fake nahi** | ✅ | data sirf maujooda `/api/trains` + `/api/availability` se |
| **AI khud book kare, seats user se poochke** | ✅ | flow me "Passenger N ki berth preference? Window / Aisle" (class ki asli berth list se) |
| **"understanding" → wait line** | ✅ | "⏳ Thoda samay lagega — main aapki request process kar rahi hoon…" + 60s par "⏳ Thoda sa aur samay lagega…" |
| **2 rok** | ✅ | IRCTC "Continue" user dabata hai, pax details khud nahi bharte |
| **Chat architecture / AI logic / API untouched** | ✅ | R69 me sirf `AiBooking.tsx` (+ uske tests) + app shell |

## 4. Kaam ki cheezein

- Commit **`7da8f67`** (main, pushed) · deploy **`dep-dautqjs1nsns73fmn1cg`** **LIVE** · `/api/version` → `7da8f67`
- Tests: **1629** (5 naye: App se entry, crash-guard card, `needsFreshReload`, purana-build note, same-build no-op) ·
  client `tsc` baseline 86 (koi naya nahi)
- Prod E2E: booking **26/26**, direction **10/10**; bundle `index-BfWjbhKW.js` (build tag 7da8f67)
- APK **v1.5.4** (`1.5.4-voice`, versionCode 37, 4,826,251 B, sha256 `48b9f6f8…21e35a`) — andar naya
  stale-bundle code verified

## 5. User ko kya karna hai (saaf-saaf)

1. App khula ho to **ek baar poora band karke dobara khol lein** (naya APK) — uske baad app khud page
   taaza rakhta hai; purana bundle dobara nahi atkega.
2. Ya jo bhi purana bundle khula hai usme **⟳ reload** ek baar daba dein — phir header me commit
   `7da8f67` dikhega.
