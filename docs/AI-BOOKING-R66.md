# R66 — Hindi passenger count samajhna + asli voice (architecture wahi)

**User ki report (screenshots, 30 Sep):**
1. *"एक पैसेंजर है" par AI samajh hi nahi paaya* aur usi turn me **wahi route/date lines dobara** bol di.
2. *"tts ki voice nahi aa rahi"*.
3. Chahte hain: **"jaise mera AI chat me samajh jaata tha waise hi edhr bhi samjhe"**, aur TTS **"jaise
   ChatGPT par voice conversation hoti hai"** — *"but remember mera architecture, AI behaviour, AI
   working, tools, AI logic wo nhi change hone chahiye."*

---

## 1. Samajhna — root cause aur fix (`src/ai/aiBookingFlow.ts`)

**Asli wajah:** JavaScript ka `\b` **ASCII-only** hai. Isliye `\bएक\b` jaisa koi bhi pattern Devanagari
par **kabhi match hi nahi karta tha** — matlab file me pehle se maujood Hindi keywords (jaise "यात्री",
"पैसेंजर") bhi chup-chaap bekaar pade the. "एक पैसेंजर है" → koi pax nahi mila → engine ne wahi
pichhla sawaal dohra diya.

**Fix (naya engine nahi — wahi flow engine):**
- `tokenRe(word)` — `\b` ki jagah Unicode lookbehind/lookahead (`(?<![\p{L}\p{N}])` … `(?![\p{L}\p{N}])`),
  Latin aur Devanagari dono par kaam karta hai.
- `PAX_WORDS`: एक, दो, दोनों, तीन, चार, पाँच, पांच, छह, छः + १–६ (Devanagari digits, `asciiDigits()` se).
- `PAX_KW`: पैसेंजर/पैसेंजर्स, सवारी, व्यक्ति, बंदा, जन (पहले से maujood shabd ab sach me match karte hain).

| User ne kaha | Pehle | Ab |
|---|---|---|
| "एक पैसेंजर है" | ❌ null | ✅ 1 |
| "एक यात्री" | ❌ null | ✅ 1 |
| "तीन लोग हैं" | ❌ null | ✅ 3 |
| "२ पैसेंजर" | ❌ null | ✅ 2 |
| "do log" | ✅ 2 | ✅ 2 |

**Repeat-lines bug:** route/date/pax ki confirmation line ab **sirf usi turn ke naye badlaav** par bolti
hai (`routeChanged` / `dateChanged` / `paxChanged`, city-block me `routeNew`). Screenshot wali line —
"Ludhiana Junction se Amritsar Junction ✅ … tarikh note kar li" — dobara nahi aayegi jab tak user khud
kuch badal na de.

**Imandaari (no fake):** jab sach me kuch samajh na aaye (`nothingChanged && stillMissing`) to saaf line:
*"Ye passenger count samajh nahi aaya — dobara bata dijiye (jaise "2 passengers")."* — chup-chaap wahi
sawaal dohraana band.

## 2. "Chat jaisa samjhe" — maujooda brain use, naya engine nahi (`src/views/AiBooking.tsx`)

Local engine ko samajh na aaye (chup rahe **ya** imandaari se "samajh nahi aaya" bole) to wahi
**maujooda chat NLU** — `POST /api/understand` (jo Concierge/chat use karta hai) — se **sirf wohi ek
slot** samjha jaata hai jo flow maang raha hai. Uska jawab `canonicalFromNlu()` se canonical shabd
banta hai aur **wapas usi purane `aiBookingTurn`** ko diya jaata hai:

```
user text ─► aiBookingTurn (wahi purana engine)
                │  slot aage nahi badha? (aur sawaal bhi nahi?)
                ▼
        /api/understand  (lastAsked = jo flow poochh raha tha)
                │  canonical jawab (misal: "1")
                ▼
        wahi aiBookingTurn dobara  ─► state/validations/route/class logic — sab wahi
```

- Model ka slot **seedha state me nahi** jaata — usi purane engine ki validation se guzarta hai.
- Brain fail/timeout → wahi local turn chalta hai (kuch nahi toota, koi fake nahi).
- Architecture, tools, prompts, booking/state machine, railway code — **chhue nahi gaye**.

## 3. Voice — asli wajah aur fix

**Asli wajah (silence ka reason):** Android WebView ki default autoplay policy
(`mediaPlaybackRequiresUserGesture = true`) + har turn par **naya `new Audio()`** → async `play()`
policy me block. Device TTS par bharosa karna reliable nahi tha.

**Fix (additive, maujooda voice layer ke andar):**
- `src/voice/aiBookingVoice.ts` — ek **persistent audio element** (har turn naya nahi), user gesture ke
  andar **silent-WAV unlock** (naya dep `unlockAudio`), aur native bridge ka fallback.
- `src/voice/nativeSpeak.ts` — `hasNativeAudio()` / `nativePlayAudioBase64()` / `nativeStopAudio()`.
- Android `VoiceBridge.kt` — `audioAvailable()`, `playAudioBase64(b64, mime)` (base64 → MediaPlayer,
  USAGE_MEDIA/CONTENT_TYPE_SPEECH), `stopAudio()`, aur `MainActivity.kt` me
  `settings.mediaPlaybackRequiresUserGesture = false` (dono copies synced).
- Jab server TTS aaye: **app me ho to native MP3 player** (policy bypass) warna persistent element;
  fail ho to device voice + UI me **imandaari se** reason (`server-failed` / `playback-blocked` /
  `no-output`) — koi chup-chaap silence nahi.

**ChatGPT jaisi voice conversation (turn-taking):** user mic tap karke voice ON kare, AI jawab bol chuke
to **mic khud wapas sunta hai** (320 ms ke baad) — 12 s tak band nahi rehta — condition bas yahi: `voice.listening ||
speaking || busy` khatam hone par. Mic **sirf user ke tap se** ON hota hai (background listening nahi);
"⌨️ Type instead" / "✕ End voice" / Mute par loop band. User AI bolte waqt mic dabaye to AI chup
(barge-in). Dock me bhi poora voice panel (mute/stop/Type instead/End voice) ab hamesha dikhta hai.

## 4. Tests

- `tests/ai-booking-flow.test.ts` — R66 (+4): Hindi pax battery, repeat-lines guard, honest line.
- `tests/ai-booking-voice.test.ts` — R66 (+5): playback-block → device voice + honest issue,
  server-fail issue, clean state, `unlockAudio` gesture, native bridge (base64) route.
- `tests/ai-booking-ui.test.tsx` — R66 (+2): brain fallback se slot samajhna + asli search; voice
  conversation loop (mic khud wapas sunta hai, "End voice" par band).
- **Full suite: 150 files · 1612 pass · 0 fail (1 skipped = gated live E2E).** `tsc` purane baseline
  par hi (86, koi naya type error nahi).

## 5. Prod par live verify (commit `a773702`, deploy `dep-daujvdg473hc73bhip2g`)

- `/api/version` → `{"commit":"a773702"}` ✓ · `/api/voice/config` → `serverTts: true`, `tts-1` ✓
- `/api/understand` (lastAsked = passengers): "अकेला जा रहा हूँ" → **pax 1** ✓, "ek jana" → 1 ✓,
  "do log" → 2 ✓
- E2E prod: **26/26** booking-flow checks ✓ · **10/10** direction checks ✓
