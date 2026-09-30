# R67 — AI Booking ab **AI-first** (chat ka pura brain + sabhi tools) + voice/live-status fix

**User (1 Oct 2026, 3 naye screenshots):**
1. "12054 आज अमृतसर कितने बजे पहुंची थी" → *"ये station समझ नहीं आया"* + wahi sawaal dobara — **jawab nahi aaya**.
2. Passenger form par **mic layout** theek nahi (voice panel + error line poori jagah kha rahe the).
3. AI ki **apni bola hui line mic me catch** ho rahi hai ("20986 … 11906 … ट्रेन लेनी है" transcript me).
4. Farmaan: *"kyu na hum edhr bhi AI first rakhein … AI ke pass sabhi existing tools ho jo pehle chat
   mein the, AI khud query samjhe and right tool ka use kare … AI booking fully automate kare last tak
   … agar user seat availability ke elawa live status ya general questions pooche to AI chatgpt ki tarah
   conversational form mein answer de kahin se dhoondhke — **aur yaad rahe tools mein ya AI behaviour mein
   ya AI logic ya architecture chat wala usmein koi changes nahi karna, bas AI Booking wala jo banaya hai
   usmein yeh nayi cheezein implement karna hai**."*

---

## 1 · AI-first: har turn par wahi chat brain (tools wahi, logic wahi)

`src/views/AiBooking.tsx` me turn ka rasta ab yeh hai:

```
user text ─► aiBookingTurn (wahi purana engine — booking ka malik)
   │
   ├─ engine ne samajh liya? aur ye sawaal nahi ─► booking turant aage; brain background me (quiet)
   │
   └─ engine kuch samajh na paaya YA sawaal/factual (live status · timing · fare · seat · wallet ·
      general) ─► wahi maujooda chat brain: api.agentStream (/api/agent + /api/agent/stream —
      wahi endpoint, wahi tools, wahi prompts) ─► jawab user ko (chat jaisa, conversational)
                                    │
                                    └─ brain ka slot mila? → canonical jawab → USI aiBookingTurn se
                                       dobara (validation/route/class logic bilkul wahi)
```

- Chat ke tools/prompts/server code **chhue nahi gaye** — AI Booking usi brain ko call karta hai
  (`api.agentStream`, chat ki tarah progress events ke saath).
- Model ka slot **seedha state me nahi** jaata — usi purane engine ki validation se guzarta hai.
- Brain fail/timeout → engine waisa hi (kuch toota nahi, koi fake nahi).
- Engine ki "samajh nahi aaya / dobara bata dijiye" wali khali lines tab hat jaati hain jab brain jawab
  de chuka ho; booking ka agla sawaal rehta hai.

**Screenshot-1 ka asli case:** flow "train chuno" par tha aur user ne live-status poochha. Ab engine
us sawaal ko "station" samajh kar khali line nahi deta — brain (tools: `SEARCH_TRAIN_BY_NUMBER` →
`GET_TRAIN_INFO` → `TRACK_TRAIN`) se asli jawab aata hai aur booking ki state waisi hi rehti hai.

**Latency:** engine-first hisse (slot answers) turant hain; sirf sawaal/na-samajhne wale turns par brain
ka intezaar hota hai, aur wahan chat jaisa **live progress** status me dikhta hai
("Searching trains… 3/5") — "answer nahi aaya" jaisa confusion na ho.

## 2 · Full automation (from → to → pax → train → class → seat → summary)

Engine pehle se yeh karta hai; R67 me pin kiya gaya ki AI **user se poochke** hi aage badhe:
route (from/to) → passenger count → train list se train → class → **har passenger ki details
(naam/age/gender/seats preference — berth options class ke hisaab se)** → pantry ho to khaana →
review + final "haan" par IRCTC handoff. User "aap decide karo/koi bhi" bole to engine ka pehla asli
option (saaf disclosure ke saath) — invent kuch nahi.

## 3 · Voice — teen alag cheezein theek hui

**(a) Server TTS ("Server voice abhi nahi aayi") — asli wajah:** provider (railbook-edge-tts) Render par
sota hai; cold start 20-25s leta hai aur hamara proxy usse pehle gir jaata tha (aur beech me provider
khud 502 de raha tha). Ab (`server/voice/tts.ts`, sab additive):
- upstream **timeout** (env `VOICE_TTS_TIMEOUT_MS`, default 28s) + **retry** + retry bhi fail to
  **chhote text (pehla vaakya)** se awaz,
- **same-line cache** (booking me wahi sawaal baar-baar → turant, `X-RailBook-TTS: cache`),
- `/api/voice/config` par **background warm-up** (app khulne par hi provider jaga diya jaata hai).
- Verify (prod): 1st call 0.86s, 2nd 0.23s (cache) — real MP3s (MPEG layer III, 24 kHz mono) Hindi +
  Devanagari dono ke liye.

**(b) Mic apni hi awaaz pakad raha tha (screenshot 3):** TTS khatam hone ka sahi pata nahi tha (text
length se andaza) → mic playback ke dauran khul jaata tha → speaker→mic echo. Ab teen parat:
1. **App se asli signal:** `VoiceBridge.kt` → `UtteranceProgressListener.onDone` aur MediaPlayer
   `onCompletion` → `window.__railbookTtsEnded()`; page usi par "idle" karta hai (`spokenAgoMs`),
   safety-timer sirf backup.
2. **Grace:** mic bolne ke turant baad nahi khulta (aur `aiBookingVoice.stop()` pehle).
3. **Echo filter:** transcript me AI ki boli hui line ke numbers/shabd match karein to wo input nahi
   banta (3 baar lagataar ignore ho to filter chhod deta hai — asli baat kabhi na ruke).

**(c) Passenger form ka layout (screenshot 2):** dock ka voice panel ab compact (state + transcript ek
line, buttons chhoti chips), error line ek line ki chip jise ✕ se hata sakte hain, aur dock khula ho to
screen/form ke neeche jagah chhodi jaati hai (`body.aib-docked`) — aakhri field/CTA dock ke peeche nahi
chhupta.

**Bonus fix:** `selectClass` ab apna verified class **return** karta hai (state-ref timing race) —
automation (class → passenger form) bharosemand.

## 4 · Tests

- `tests/ai-booking-ui.test.tsx` — R67 (+3): AI-first live-status jawab (engine ki khali line nahi),
  berth/seat preference AI khud poochhta hai, echo transcript input nahi banta. (R66 wale bhi update.)
- `tests/voice-edge-tts-integration.test.ts` — R67 (+4): cold-start retry, chhota-text retry, cache,
  config par warm-up.
- `tests/voice-agent-acceptance.test.ts` — warm-up ke baad bhi request-shape check (test fix).
- **Full suite: 150 files · 1619 pass · 0 fail (1 skipped = gated live E2E).** Client `tsc` purane
  baseline (86) par hi — koi naya type error nahi. Server `tsc -p tsconfig.server.json` clean.

## 5 · Prod verify (commit `6317ef8`)

- `/api/version` → `{"commit":"6317ef8"}` ✓ · bundle `assets/index-HzAWuRjq.js` me naye markers
  (`__railbookTtsEnded`, `spokenAgoMs`) ✓
- `/api/voice/tts` → **200** (Hindi + Devanagari, asli MP3; dobara wahi line = cache se 0.23s) ✓
- E2E prod: booking-flow **26/26** ✓ · direction **10/10** ✓
- Chat brain (wahi jo AI Booking ab use karta hai) user wale sawaal ka sahi jawab deta hai:
  "12054 आज अमृतसर कितने बजे पहुंची थी" → tools `SEARCH_TRAIN_BY_NUMBER → GET_TRAIN_INFO → TRACK_TRAIN`,
  honest jawab (12054 ASR se 06:50 par nikalti hai) ✓

## 6 · Kya nahi chhua (jaan-bujh kar)

Chat/Concierge ka code, `/api/agent` + uske tools/prompts, `server/railway/*`, provider/fallback chain,
booking state machine, wallet, purane tests — **sab waise hi**. Sirf: AI Booking view me brain-first
routing, AI Booking ke voice adapter me end-signal/echo parat, `server/voice/tts.ts` (hamara hi voice
proxy) me timeout/retry/cache/warm-up, aur Android `VoiceBridge.kt` me "bolna khatam" signal.
