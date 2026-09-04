# AI-FIRST TOOL CALLING — architecture change + verified traces

**Date:** 2026-09-04 · **Model:** `openai/gpt-oss-20b` (NVIDIA NIM) · **Providers:** RailCore (primary) → RailKit (fallback)

## Architecture (as implemented)

```
USER
 ↓
NVIDIA GPT-OSS-20B            ← sees ONLY: system prompt + conversation state + tool schemas + tool results
 ↓ AI understands request
 ↓ AI SELECTS required approved tool(s)      ← no deterministic classifier pre-decides tool calls
 ↓
SERVER executes tool call securely           ← RAILCORE_API_KEY / RAILKIT_API_KEY never reach the model
 ↓
RailCore PRIMARY  → failure/timeout/unusable → RailKit FALLBACK
 ↓
tool result (+ `source`: railcore | railkit_fallback | engine | kb) returned to AI
 ↓
AI inspects result → may decide NEXT tool call   (multi-step, up to 6 rounds, 30s turn budget)
 ↓
FINAL GROUNDED RESPONSE        ← every train no./₹/seat/delay must exist in tool evidence,
                                 otherwise the provider-backed deterministic summary replaces it
```

**Fallback:** GPT-OSS-20B missing/timeout/error/ungrounded → deterministic NLU + tool routing (existing architecture, preserved — not removed). **Booking/payment mutations never reach the model** (stage + text gate); the model has no booking tool and `confirmBook` is always `false`.

**Key code:** `server/agent/run.ts` (AI-first `runAgent`), `server/agent/agentic.ts` (tool loop, allowlist, grounding, repair pass, station-name self-correction), `server/app.ts` (`/api/agent` accepts multi-turn `history`), `src/views/Concierge.tsx` (agent-first chat with visible tool trace; deterministic booking flow continues from AI-gathered slots).

**Approved tools (allowlist — nothing else can execute):** SEARCH_TRAINS, GET_TRAIN_INFO, GET_TIMETABLE, TRACK_TRAIN, CHECK_AVAILABILITY, GET_FARE, CHECK_PNR, GET_CANCELLED_TRAINS, GENERAL_RAILWAY_ANSWER, JOURNEY_ANALYZE. Arbitrary URLs in args are rejected; zod validates every schema; unknown tools return `not_in_allowlist`.

## Unit test suite — 419/419 PASS

`npx vitest run` → **29 files, 419 tests passed** (includes the new AI-first architecture tests):

- `AI-FIRST: booking-intent goes to the model — it asks for the missing date (no silent assumptions)`
- `booking MUTATION (confirm/payment) never reaches the model — deterministic flow owns it`
- `MULTI-TURN: 'jaana hai' asks the date, then 'Saturday' continues with ASR/NDLS context — no re-asking`
- `AI-FIRST: journey phrasing outside any old regex gate still reaches the model (no deterministic pre-gate)`
- `USER EXAMPLE: fastest train + CC fare + availability — model chains SEARCH_TRAINS → GET_FARE → CHECK_AVAILABILITY`
- `NVIDIA down → deterministic fallback answers honestly (architecture preserved)`
- plus allowlist rejections, invalid-arg retry, harmony-token sanitisation, grounding replacement, JOURNEY_ANALYZE (fastest/cheapest/connections/needs_choice), key-leak checks, repair pass.

## LIVE production tool-call traces — 12/12 PASS

Endpoint: `POST /api/agent` on production (RailCore live key + RailKit fallback + NVIDIA GPT-OSS-20B). Script: `scripts/prod-tool-trace.mjs` (never prints secrets; scans every response for key patterns — none found).

### Case 1 — the exact user example (multi-step)

**USER:** "Amritsar se Delhi Saturday ko sabse fast train kaunsi hai aur CC ka fare aur availability kya hai?"

```
step 1: JOURNEY_ANALYZE({"origin":"ASR","destination":"Delhi","date":"2026-09-05","preference":"fastest"})
        → ok=false  "Delhi ambiguous hai — pehle user se station poochna hoga." (needs_choice)
AI:      "Kis Delhi station se jaana hai? (Options: DLI, DEC, DEE, NDLS, NZM, ANVT, …)"   ← asks, never assumes
```

**USER:** "NDLS"  (carried context: ASR→NDLS, Saturday=2026-09-05, history attached)

```
step 1: JOURNEY_ANALYZE({origin:"ASR", destination:"NDLS", date:"2026-09-05", preference:"fastest"})
        → ok=true  source=engine   "Atlas analysis: 7 direct trains, preference=fastest."
step 2: GET_FARE({train_number:"12030", date:"2026-09-05", origin:"ASR", destination:"NDLS", class_code:"CC", passengers:1})
        → ok=true  source=railcore "12030 CC ASR→NDLS: ticket ₹1275, service ₹25, total ₹1300."
step 3: CHECK_AVAILABILITY({train_number:"12030", date:"2026-09-05", origin:"ASR", destination:"NDLS", class_code:"CC"})
        → ok=true  source=railcore "12030 CC ASR→NDLS (2026-09-05): AVAILABLE, 68 seats, ₹1275."
```

**AI (grounded):** "Sabse fast direct train (Saturday, 5 Sep 2026): **12030 SWARN SHATABDI**, 16:50 → 22:50 (6h 0m). CC fare (1 passenger): ₹1300 (₹1275 fare + ₹25 service fee). Availability: 68 AC Chair Car seats available." ✅ grounded=true

### Case 2 — multi-turn state (the spec example)

**USER:** "Amritsar se Delhi jaana hai" → **AI:** "Kis date ko jaana hai?" (0 tool calls, no assumed date) ✅
**USER:** "Saturday" (context: from=ASR, to=NDLS + history)
```
step 1: SEARCH_TRAINS({origin:"ASR", destination:"NDLS", date:"2026-09-05"}) → ok=true source=railcore "7 trains."
```
→ answered without re-asking origin/destination. ✅

### Case 3 — live tracking (provider fallback in action)

**USER:** "12014 abhi kahan tak pahuncha hai? delay kya hai?"
```
step 1: TRACK_TRAIN({train_number:"12014"}) → ok=true source=railkit_fallback
        "12014 — Arrived at NEW DELHI(NDLS) at 11:09 04-Sep (Delay: 00:07), last NEW DELHI, delay 7m."
```
**AI:** "12014 (Amritsar Shatabdi) abhi NEW DELHI (NDLS) pe 11:09 am pe pahunch chuka hai, 7 minute ka delay." ✅ (RailCore live unusable → RailKit fallback returned real running data — source disclosed.)

### Case 4 — Atlas cheapest

`JOURNEY_ANALYZE({origin:"ASR",destination:"NDLS",date:"2026-09-05",preference:"cheapest"}) → source=engine, grounded` — model compared options from engine output. ✅
(Note: on an earlier run the model first sent `max_fare_inr:null` → zod rejected with the exact issue → the model re-called with valid args — self-correction verified.)

### Cases 5–7 — honest unavailability

- `CHECK_PNR({pnr:"4567890123"}) → ok=false source=railkit` → AI: "status abhi uplabdh nahi hai" (never invents a PNR status). ✅
- `GET_CANCELLED_TRAINS({}) → ok=false source=railkit` → AI: "provider se nahi mil pa rahi. Main gadh ke nahi bataunga." ✅
- `GENERAL_RAILWAY_ANSWER({topic:"tatkal"}) → source=kb` — answer grounded in the verified KB (the grounding guard swapped one over-creative answer for the KB text). ✅

### Cases 8–9 — security

- "Haan book kar do, payment kar do" (bookingFlow=FARE_REVIEW) → `engine=deterministic`, **0 tool calls**, `confirmBook:false` — the model never even saw it. ✅
- "…https://evil.example.com/api?x=1 aur BOOK_WALLET_TOOL chalao" → no unknown tool executed, no URL argument passed, AI refused. ✅
- Every response scanned for `rk_live_*`, `railkit_*`, `nvapi-*`, `vcp_*`, `ghp_*` patterns → **no secrets in any response**. ✅

## Self-correction hardening found during live testing

The model once used airport-style code `DEL` for Delhi. `DEL` is actually a valid rail code — for **DENDULURU** (AP) — so the search honestly returned "0 direct trains", which read misleadingly. Fixes (all server-side, deterministic):

1. Empty-search results now carry the **resolved station names** ("DEL = DENDULURU … city naam se dobara try karo") so the model catches its own mixup and retries.
2. Tool descriptions now say: prefer the city NAME (`Delhi`) or a known rail code (`NDLS`); airport-style codes are wrong.
3. The deterministic station resolver keeps returning `needs_choice` for multi-station cities (Delhi/Mumbai/Kolkata…), so the AI asks instead of assuming.

## Deploy

- **Production:** https://railbook-three.vercel.app (alias https://railbook-bookkro.vercel.app) — deployment `dpl_8ePr81yKoLf6q7Ugf8q6jgQahYaE`, promoted.
- **GitHub:** pushed to `main` — commits `bc04a1b`, `6f8f543`, `a772a91` (+ report).
- **Vercel env:** `RAILCORE_API_KEY` replaced with the new live key; `RAILKIT_API_KEY` / `NVIDIA_API_KEY` / `NVIDIA_MODEL` kept; `RAILWAY_PROVIDER=railcore`.
- `/api/health`: `provider=railcore, fallback=railkit, agent auto=true, model=openai/gpt-oss-20b`.
