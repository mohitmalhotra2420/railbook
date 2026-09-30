# R68 — AI Booking crash fix + "har query pehle AI" + apne-aap wait messages (1 Oct 2026)

**User (screenshot + farmaan):** *"AI booking open nhi ho rha"* (screen par `chat dikha nahi paaya` +
`React error #310`), aur: *"har query AI par jaani chahiye pehle … wo tools, ya web scraping jitne bhi
tools available hai sab use kare … ek dum conversational hona chahiye like ChatGPT … bss kuch bhi fake na
ho … jab AI bole ki understanding to uski jagah likhdo ki thoda samay lagega, aapki request process kar
raha hoon; agar 1 minute se zyada lage to fir kehdena ki thoda sa aur samay lagega, ya AI khud soche from
time to time kya kehna hai — sab AI handle kare … purane chat wale architecture/AI behaviour/AI
logic/API ko **touch mat karna**; jo abhi karna wo AI Booking wale me karna hai."*

---

## 1 · Crash (React #310) — asli wajah aur fix

**Wajah:** R67 me dock-spacing wala `useEffect` **`if (!open) return null;` ke neeche** chala gaya tha.
`open = false` par component us line par laut jaata tha (hook call hi nahi hota), aur `open = true` hone
par wahi effect ek **extra hook** ban jaata tha → React: *"Rendered more hooks than during the previous
render"* (#310) → Concierge ka error boundary → aapko `chat dikha nahi paaya` dikhta tha.
Matlab: crash **AI Booking kholte hi** hota tha — theek jaisa aapne bataya.

**Fix:** wo effect (aur is round ke naye hooks) poore hooks wale hisse me, early return se **upar**.
Dock ka kaam wahi (`body.aib-docked` se passenger form ke neeche jagah).
**Do permanent guards add kiye:**
- behaviour test: `AiBooking` ko band mount karke phir kholna (crash nahi hona chahiye), aur dock mode me
  jaana,
- **structural test:** file me `if (!open) return null;` ke **baad koi hook nahi** — dobara ye galti
  khud-ba-khud pakdi jayegi.

## 2 · "Har query AI par jaani chahiye PEHLE" (aapki demand)

Ab **har user message sabse pehle wahi maujooda chat brain** ke paas jaata hai —
`api.agentStream` → `/api/agent` + `/api/agent/stream`, matlab **wahi tools + web scraping + wahi
prompts/logic**. Brain jo samajhta hai, wo **canonical jawab** ban kar **usi purane booking engine** ko
diya jaata hai; engine ka apna reading fallback me rahata hai.

- **Sawaal / factual turn** (live status, timing, fare, seat, wallet, PNR, general): poora intezaar AI ka,
  aur jawab user ko dikhta hai — flow ki state bilkul waisi hi rehti hai.
- **Chhote slot answers** jahan engine turant samajh chuka hai (jaise "2", "CC", "12014"): AI ko phir bhi
  call chalti hai (pehle), par user 12s se zyada model ke liye na ruke — late jawab chup-chaap ignore
  (dobara turn nahi chalta, booking peeche nahi jaati).
- Chat/Concierge, server agent/tools/prompts, API, railway/booking code — **kuch nahi chhua**; sab kuch
  AI Booking view ke andar hi hai.

## 3 · Wait messages — aapke shabdon me

- Brain kaam karte waqt (jargon "Thinking…"/"Understanding your request" ki jagah):
  **"⏳ Thoda samay lagega — main aapki request process kar rahi hoon…"**
- **1 minute se zyada** lagne par: **"⏳ Thoda sa aur samay lagega — bas ho raha hai…"**
- Server se **asli phase** aaye ("Checking availability… 3/5") to wahi dikhta hai — koi fake percentage
  nahi, koi jhoothi umeed nahi.
- Voice panel me bhi "⏳ Process kar rahi hoon…" (pehle "Thinking…").

## 4 · Booking automation (seats tak) — waise hi, user se poochke

AI khud: route (from → to) → passengers → train list se train → class (+ asli availability verify) →
passenger form khud kholta hai aur **har passenger ka naam/umar/gender aur seat (berth/window/aisle)
preference user se poochhta hai** → pantry ho to khaana → review khud → aapke **"haan"** par IRCTC
handoff/autofill. Kuch bhi invent nahi hota; jo data provider deta hai wahi dikhta hai.

## 5 · Verify

| Check | Result |
|---|---|
| Full suite | **1622 pass / 0 fail** (1 skipped = gated live E2E) — R68 ke naye 4 tests (crash behaviour + structural guard + brain-first + wait line) |
| `tsc` client | purana baseline (86) — koi naya type error nahi |
| `tsc` server | clean |
| prod E2E booking | 26/26 · direction 10/10 |

**Deliverables:** code commit `0006eb4` · deploy `dep-daumkk3ncjis73fhh450` (LIVE) ·
APK `RailBook-v1.5.3-release.apk` (1.5.3-voice) · zip `RailBook-FULL-2026-10-01.zip`.
