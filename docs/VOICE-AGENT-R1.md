# Voice Agent R1 — additive voice layer (30 Sep 2026)

**Rule:** existing AI Booking Agent / railway tools / booking state / prompts / providers / IRCTC layer = **READ-ONLY**. Voice sirf ek naya input/output layer hai.

## Naye files (koi existing file modify nahi hui)

| File | Kaam |
|---|---|
| `src/voice/voiceAgent.ts` | Thin controller: mic start (pehle TTS interrupt), `submit(text)` → **existing agent handler** (yahan koi AI logic nahi), `speak(lines)` → maujooda `voiceLinesFor()` + TTS adapter, `interrupt()`, `end()`, `setMuted()`. Kuch throw nahi karta (failure isolation). |
| `src/voice/voiceSession.ts` | Sirf voice state: `isListening · isProcessingVoice · isSpeaking · isMuted · voiceError · currentAudio`. Journey/booking/PNR yahan kabhi nahi (wo existing booking state me hai). |
| `tests/voice-agent-acceptance.test.ts` | R1 §20 ke 18 acceptance items + openai-edge-tts ka 1 extra → 19 tests, sab pass. Maujooda test files touch nahi ki gayi. |

## Reuse (duplicate nahi kiya)

- STT: `src/voice/useVoiceInput.ts` (+ `nativeSpeech.ts` native bridge)
- Agent: `src/ai/aiBookingFlow.ts` (R62/R62c/R63 ka wahi flow)
- TTS adapter: `src/voice/aiBookingVoice.ts` (+ `speakGuide.ts`, `nativeSpeak.ts`)
- Server TTS: `server/voice/tts.ts` (`GET /api/voice/config`, `POST /api/voice/tts`)

## openai-edge-tts (OpenAI-compatible) — env se, code change ke bina

```
VOICE_TTS_PROVIDER = openai              # openai-edge-tts OpenAI-compatible API deta hai
VOICE_TTS_BASE_URL = http://<host>:5050/v1
VOICE_TTS_API_KEY  = <us server ka key>  # key sirf server-side
VOICE_TTS_MODEL    = tts-1
VOICE_TTS_VOICE    = hi-IN-SwaraNeural   # male: hi-IN-MadhurNeural
```

`VOICE_TTS_BASE_URL` pehle se supported hai (`server/voice/tts.ts` → `synthOpenAi`), isliye sirf env chahiye.

## Pending hooks (approval ke bina nahi kiye)

1. `src/views/AiBooking.tsx` — inline voice state ko naye `voiceAgent/voiceSession` par shift karna (optional; aaj inline logic bhi same kaam karti hai).
2. `src/views/Concierge.tsx` — chat ki awaaz bhi server TTS se (aaj browser/device TTS par hai).
3. `server/voice/tts.ts` — chip me `voice: edge` label (cosmetic).
4. `docs/RAILBOOK-ADDENDUM-v1.4.3.md` / `START-HERE.md` — R1 entry (abhi ye naya doc hi kaafi hai).

## Interruption

Explicit: `⏹ Stop`, ya mic tap (TTS turant rukti hai, phir sunna shuru) + `voiceAgent.interrupt()`.
Auto barge-in (mic se bolte hi rukna) ke liye mic always-on karna padega — jo R62 ke "mic sirf explicit tap, background listening NEVER" rule ke against hai (user se poochha gaya hai).

## Checks

CHECK 1 build ✓ 1.88s · CHECK 2 focused **92 PASS** (flow 43 · acceptance 19 · UI 9 · voice 13 · route 8) · CHECK 3 regression **78 PASS**. Existing tests badle nahi, existing files modify nahi hui (`git diff` khaali).
