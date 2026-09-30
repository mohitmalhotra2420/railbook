# openai-edge-tts integration (Voice Agent R2 — 30 Sep 2026)

**Provider:** https://github.com/travisvn/openai-edge-tts (OpenAI-compatible: `POST /v1/audio/speech`)
**Rule:** existing AI Booking Agent / railway tools / booking flow / state machine = **untouched**. Ye sirf TTS provider ka integration hai.

## Chain (sab maujooda code, koi naya endpoint nahi)

```
User speech → useVoiceInput (STT) → existing AI Booking Agent (aiBookingFlow)
   → existing result → aiBookingVoice (TTS adapter) → api.voiceTts → POST /api/voice/tts
   → server/voice/tts.ts → {VOICE_TTS_BASE_URL}/audio/speech → MP3 → bajta hai
```

## Env (Render par set karna hai)

```
VOICE_TTS_PROVIDER=openai                  # openai-edge-tts OpenAI-compatible hai
VOICE_TTS_BASE_URL=https://<edge-tts-host>/v1
VOICE_TTS_API_KEY=<us server ka key>       # sirf server-side; client kabhi nahi dekhta
VOICE_TTS_MODEL=tts-1
VOICE_TTS_VOICE=hi-IN-SwaraNeural          # male: hi-IN-MadhurNeural
```

`VOICE_TTS_BASE_URL` configurable hai (code me hard-code nahi). Provider default bhi wahi hain jo brief me maange: `tts-1` + `hi-IN-SwaraNeural` (env se har waqt badal sakte hain).

## Is round me kya badla (minimal-change rule)

| File | Change |
|---|---|
| `server/voice/tts.ts` | **Sirf defaults**: `OPENAI_DEFAULT_MODEL = "tts-1"`, `OPENAI_DEFAULT_VOICE = "hi-IN-SwaraNeural"` (+ comment). Adapter ka baaki poora behaviour (validation, `{base}/audio/speech`, Bearer key server-side, `response_format: "mp3"`, 501/502, no-store, key kabhi response me nahi) waise ka waisa. |
| `tests/voice-edge-tts-integration.test.ts` (naya) | Brief ke §14 ke 12 verification points (15 tests). |
| `tools/check-edge-tts-e2e.mts` (naya) | Asli HTTP check: local OpenAI-compatible TTS server + hamara asli app server → 10/10 pass (koi mock nahi). |
| `src/voice/voiceAgent.ts`, `src/voice/voiceSession.ts`, `tests/voice-agent-acceptance.test.ts`, `docs/VOICE-AGENT-R1.md` (R1 ke naye files) | Isi commit me ja rahe hain (R1 ka kaam — koi existing file us round me bhi nahi chhui thi). |

**Full zip me latest build bhi shamil hai** (`railbook/dist/` — `npm run build` ka Vite output, 30 Sep 2026).

**Nahi chhua:** AI Booking Agent (`src/ai/aiBookingFlow.ts`), prompts, tool contracts, state machine, railway/booking/wallet logic, IRCTC handoff, `/api/voice/config` ka behaviour, `/api/voice/tts` ka contract, provider/fallback chain.

## Verification

- `npx vitest run tests/voice-edge-tts-integration.test.ts` → **15/15** (items 1–12 of the brief)
- `npx tsx tools/check-edge-tts-e2e.mts` → **10/10** (asli HTTP; upstream URL `/v1/audio/speech`, auth header, request body, MP3 bytes, male-voice env switch, 502 + no leak)
- CHECK 2 focused → **107 PASS** (flow 43 · acceptance 19 · edge-tts 15 · UI 9 · voice 13 · route 8) · CHECK 3 regression → **78 PASS** · build ✓

---

## ✅ PRODUCTION LIVE VERIFICATION (30 Sep 2026, user ke env values ke baad)

**Render env set kiye gaye** (service `srv-dae34rqd0e5s73evgjsg`, purane 26 vars safe — total 31):

```
VOICE_TTS_PROVIDER = openai
VOICE_TTS_BASE_URL = https://railbook-edge-tts.onrender.com/v1
VOICE_TTS_API_KEY  = (set — value yahan nahi likhi jaati)
VOICE_TTS_MODEL    = tts-1
VOICE_TTS_VOICE    = hi-IN-SwaraNeural
```

**Deploy:** `dep-daufmqgu01pc73f2v53g` (commit `5d11303`) → **live** (12:07 UTC).
*(Ek galti bhi pakdi gayi: pehla trigger purane commit `1b8be9f` par chala gaya tha — wo deploy turant **cancel** kiya gaya, phir sahi commit par deploy hua.)*

**Prod proof (`https://railbook-gegs.onrender.com`):**

| Check | Result |
|---|---|
| `GET /api/voice/config` | `{"provider":"openai","serverTts":true,"model":"tts-1","languages":["hi-IN","en-IN"]}` |
| `POST /api/voice/tts` (Hindi) | **HTTP 200 · audio/mpeg · 48,528 B · 1.87s** (MPEG layer III, 24 kHz mono) |
| `POST /api/voice/tts` (English) | **HTTP 200 · audio/mpeg · 36,432 B** |
| Purane endpoints | `/api/meta` `/api/wallet` `/api/trains` `/api/trains/:n/pantry` — sab **200** |
| Key leak | bundle me `Mohit@2420` → **0 baar**, `/api/voice/config` me → **0 baar**; edge-tts URL bhi client bundle me nahi |
| Voice chain | `useVoiceInput` → existing agent → `aiBookingVoice` → `/api/voice/tts` → edge-tts → **asli MP3** |

Sample audio (prod se download): `RailBook/proof/voice-prod-hi-2026-09-30.mp3`
