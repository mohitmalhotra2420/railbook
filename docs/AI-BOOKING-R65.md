# RailBook · R65 — AI Booking ke 5 issues + complete booking test
**Date:** 30 Sep 2026 · **Round:** R65 (AI Booking fixes) · **Status:** shipped (commit + deploy + zip)

User ke shabd (2 screenshots ke saath):

1. "AI samjh nhi paa rha yeh AI issue hai kya?" — लुधियाना से नई दिल्ली maanga, AI ne **ulta** (New Delhi se Ludhiana) kaha.
2. "mic layout sahi kro" — passenger form par voice dock overlap.
3. "irctc auto fill nhi ho rha AI booking agent mein".
4. "jaise pehle chat mein kuch bhi poochte thye — kya yeh bhi btayega?"
5. "trains selection ke liye train board open krta hai" — behaviour review.
6. "ek baar tum complete booking test kro."

## Kya nikla aur kya badla

### 1 · Route ulta (asli bug) — FIXED
**Wajah (repro se pakda gaya):** station ke naam **Hindi (देवनागरी)** me the. Purana code sirf Latin
code/city/name match karta tha, isliye dono station ka kram pata nahi chalta tha — "New Delhi" (city)
aur "Ludhiana" (station) ka order bigad jaata tha → `from=NDLS to=LDH`.

**Fix (minimal):**
- `src/ai/stations.ts` me naya helper `findStationMentionsInText()` — wahi boundary-check, par
  **position ke saath** (देवनागरी + roman dono). Additive export, purane callers waise hi.
- `mentionIndex()` ab usi helper se position leta hai (pehle sirf Latin).
- Ek hi message me koi asli station mil gaya ho to us city ka sawaal nahi poochha jaata.
- User poora route **dobara** bata de aur wo maujooda se alag ho → naya pair maana jaata hai + asli
  provider se fresh search (`SEARCH` action), date/pax preserve.

### 2 · Passenger screen par mic layout — FIXED
Dock pehle ek **row** tha (log + head + voice panel + form ek hi line me) → buttons overlap aur input
adhoora. Ab `.aib-dock` **column stack** hai: har cheez apni line, voice-actions wrap, composer poori
width, dock me scroll + max-height. (Demo: preview file ke section 2 me before/after.)

### 3 · IRCTC autofill — EK ASLI BUG MILA aur FIX hua
Complete booking test chalate hue pakda gaya: aakhri passenger ki **berth preference** aur
"review kholo" (OPEN_REVIEW) **ek hi turn** me aate hain. App ne patch dispatch kiya, par React ke
re-render se pehle hi `goReview()` chal gaya → `validatePassengers` par `p.berthPreference` khaali mila
→ `Please fix the passenger details.` → **review screen khulti hi nahi thi**, isliye IRCTC
handoff/autofill tak baat pahunchti hi nahi thi.

**Fix:** review kholne se pehle sirf itna intezaar ki **usi turn ke passenger patches app-state me
pahunch jaayein** (`waitForPaxPatches`, max ~1.2s) — phir wahi maujooda `goReview()` (koi validation
bypass nahi, kuch skip nahi). Safety net: phir bhi review na khule to AI chup-chaap "khol rahi hoon"
nahi dohraata — saaf line deta hai ki passenger form me jo field reh gayi hai wo bhar do.

Autofill honesty (jaisa tha waisa hi): RailBook app/autofill client me details IRCTC par khud bharti
hain; bare browser me wo possible nahi — wahan AI imandaari se batata hai + apna "Continue to IRCTC"
button deta hai (summary clipboard me). Login/OTP/CAPTCHA/payment hamesha user.

### 4 · "Kuch bhi poocho" (chat jaisa) — ADDED
AI Booking me koi bhi sawaal ka jawab ab **maujooda chat brain** (`/api/agent` — wahi jo chat use
karta hai) se aata hai:
- booking ke sawaal pehle ki tarah usi booking engine se (fast, kuch badla nahi),
- usse hat kar sawaal (wallet, train time, fare, IRCTC, aam jankari) → brain se jawab, booking state
  bilkul safe,
- brain fail → booking flow waise hi chalta rehta hai + ek honest line,
- dock me chhota ishara: **💬 Kuch bhi poochho**.

### 5 · "Train board" behaviour — VERIFIED (aisa hi design hai)
Train chunne ke liye app apna asli board dikhata hai (live availability + fare ke saath) kyunki AI
train/timing/fare bana kar nahi batata. Flow: route+date → board cards → train → usi train ki saari
asli classes (chips) → class → availability verify → **passenger form khud khulta hai** → review +
IRCTC handoff. (Agar user ka matlab kuch aur tha to wo follow-up me bataayenge.)

### 6 · Hindi berth shabd (screenshot 2 se) — FIXED
"बर्थ प्रेफरेंस में विंडो सेलेक्ट करो" samajh me nahi aata tha aur wo poora vaakya **naam** ban jaata tha.
Ab Hindi berth shabd (विंडो/खिड़की/लोअर/अपर/मिडल/साइड) samajh me aate hain — **sirf us class ki valid
berth** par lagte hain (SL me "window" nahi chalti → saaf line), aur naam me berth/instruction shabd
nahi ghusne paate ("lower berth de do" par naam "Berth" ban jaata tha — wo bhi theek).

## Complete booking test (maine khud chalaya)
**Koi mock nahi:** asli Express app isi process me (asli provider chain + asli AI model), UI me poora
asli app (Concierge → AI Booking → Review → IRCTC handoff).

```
RAILBOOK_LIVE_E2E=1 npx vitest run tests/ai-booking-live-e2e.test.tsx --testTimeout=900000
```

Natija (asli data, 30 Sep 2026):

| Step | Natija |
|---|---|
| Trains (LDH→NDLS, 12 Oct 2026) | **8 trains** (chain: railcore → railkit → railradar → web confirmtkt) |
| Train · class | **11078 Jhelum Express · SL · AVAILABLE · ₹437** (sirf AVAILABLE wali class) |
| Passengers | Rahul Sharma (31, male, Lower) · Neha Sharma (29, female, Lower) |
| Review (AI khud kholta hai) | Ludhiana Junction → New Delhi · Mon 12 Oct 2026 · Train 11078 · Class SL · **Fare ₹974** |
| IRCTC handoff | asli autofill payload **6,716 bytes** (train+class+date+route+2 passengers) |
| General sawaal | "wallet me kitne paise hain?" → **Wallet ₹10000** (chat brain se) |
| Direction proof | app ki apni search query `from=LDH&to=NDLS` (ulta nahi) |

## Tests / build
- `npx vitest run` → **150 files pass · 1601 tests pass · 0 fail** (1 skipped = gated live E2E).
- R4 ke naye tests: flow 8 (direction, correction, Hindi berth, naam-noise) + UI 4 (general sawaal,
  layout CSS guard, IRCTC honest line + fallback button, post-handoff Q&A).
- `npm run build` ✓ (~1.9s) · `tsc --noEmit` me **naye error 0** (baseline ke alawa; build/vitest authoritative).

## Files
`src/ai/aiBookingFlow.ts` · `src/ai/stations.ts` · `src/views/AiBooking.tsx` · `src/styles.css` ·
`tests/ai-booking-flow.test.ts` · `tests/ai-booking-ui.test.tsx` · `tests/ai-booking-live-e2e.test.tsx` (naya)

Kuch bhi raw/internal aapko nahi dikhaya jaata. Existing architecture / AI brain / providers /
wallet / booking logic me koi change nahi — sirf upar wale fixes.

## Shipped (commit · deploy · zip)
- **Commit:** `64af0e2` → main **`64af0e20ae07ba9ae88507af228a16b11d7c7bf9`** (repo: mohitmalhotra2420/railbook)
- **Deploy:** `dep-daugnt0jo6nc738bvt4g` → **LIVE** (railbook-gegs.onrender.com, 30 Sep 13:18 UTC, commit `64af0e2`)
- **Prod verification:**
  - `/api/version` → `{"commit":"64af0e2", …}` ✓
  - deployed bundle `assets/index-EkhVigWp.js` (566,564 B) = R65 build; markers: "Kuch bhi poochho" ✓, "Review nahi khul paaya" ✓,
    "Nayi details ke saath fresh search" ✓, "RailBook app (ya autofill client) chahiye" ✓ · `VOICE_TTS_API_KEY` leak = 0 ✓
  - `tools/e2e-ai-booking-prod.mts` → **26/26 checks pass** (asli prod data)
  - `tools/e2e-r65-direction-prod.mts` → **10/10 checks pass** (Hindi route sahi direction + prod se 20 asli trains LDH→NDLS)
- **Zip (permanent, latest build included):** asset **600970407** · **37,535,812 B** · 1,574 entries ·
  sha256 `672667064d16138893c98b9e38984e3929783411f26d8d96822a37daecf7912e` · download verified
  → https://github.com/mohitmalhotra2420/railbook/releases/download/r62-2026-09-30/RailBook-FULL-2026-09-30.zip
