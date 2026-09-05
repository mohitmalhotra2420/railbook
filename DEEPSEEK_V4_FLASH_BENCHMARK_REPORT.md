# DEEPSEEK V4 FLASH — COMPACT BENCHMARK REPORT
## deepseek-ai/deepseek-v4-flash-0731 vs openai/gpt-oss-20b (production primary — UNCHANGED)

**Date:** 2026-09-05 · **NO deploy · NO production change · NO commit/push** (mandate ke mutabik). GPT-OSS-20B ab bhi production primary hai.

---

## VERDICT: **NOT READY** (quality strong, latency disqualifying)

# Tests: **11/12 PASS** (corrected; as-run 10/12 — T9 check-regex fix, neeche note)

| Field | Value |
|---|---|
| Real DeepSeek calls | **11 turns / 21 AI calls** (T11/T12 fault-injected — zero real calls) |
| Real RailCore calls | **31** (sirf T1 search, T5 availability/fare, T6 comparison, T7 live status — mandate ke mutabik) |
| Mocked tool-result turns | T2, T3, T4, T8, T9, T10, T11, T12 (RAILWAY_PROVIDER=mock — planning test, data synthetic) |
| Tool planning | **PASS** |
| Multi-tool | **PASS** (T5: CHECK_AVAILABILITY + GET_FARE dono ok, args sahi) |
| Hindi/Hinglish | **PASS** (T3) |
| Comparison | **PASS** (T6: dono timetables, deterministic winner, no invented winner) |
| Missing date | **PASS** (T2: poochha, assume nahi) |
| Ambiguity | **PASS** (T4: Delhi clarification, silent pick nahi) |
| Grounding | **PASS-with-1-flag** (T5: "WL" status token ungrounded pada → guard ne **pakda + honest disclaimer append kiya** — silent hallucination ZERO) |
| Fallback | **PASS** (T12: injected 503 → deterministic NLU fallback + injected timeout → abort honored, dono no-crash) |
| Avg latency (turn) | **58,461 ms** |
| GPT-OSS avg latency (recorded) | **7,010 ms** |

---

## Per-test detail

| Test | Result | Notes |
|---|---|---|
| T1 SEARCH/BASIC (real RailCore) | ✅ | SEARCH_TRAINS, date=tomorrow (2026-09-06), ASR→LDH, valid args, grounded |
| T2 MISSING DATE (mock) | ✅ | Date poochha, aaj assume nahi kiya, koi invented train nahi |
| T3 HINGLISH+FASTEST (mock) | ✅ | Tool plan sahi: route ASR→Delhi, kal, fastest intent, grounded |
| T4 AMBIGUOUS DELHI (mock) | ✅ | Station clarification poochha, koi silent pick / invented station nahi |
| T5 MULTI-TOOL (real RailCore) | ⚠️ | **Planning perfect**: CHECK_AVAILABILITY + GET_FARE dono called, dono OK, args `train_number=12014, class_code=CC` sahi. Final reply mein "WL" status token evidence se match nahi hua → **grounding guard ne flag kiya + reply mein honest disclosure append hui** ("AI ka jawab providers ke data se match nahi hua — sirf verified data dikha raha hoon"). Fare figures (₹1250/₹1300) tool-data se the. 90.4s turn. |
| T6 COMPARISON (real RailCore) | ✅ | GET_TIMETABLE dono trains (12014, 14542), backend deterministic comparison, winner invented nahi, grounded |
| T7 LIVE STATUS (real RailCore) | ✅ | TRACK_TRAIN, train_number=12014, honest reply (provider liveStatus flaky tha phir bhi koi invented location/delay nahi) |
| T8 GENERAL RAILWAY (mock) | ✅ | GENERAL_RAILWAY_ANSWER called, **zero railway provider calls**, RAC/WL explain |
| T9 UNEXPECTED NL (mock) | ✅ (re-graded) | "Kal subah…jaldi Delhi pahucha de" → date kal=2026-09-06 sahi + destination Delhi sahi + **origin poochha** ("kis station/city se jaana hai?") — correct agentic behavior. As-run check-regex ne "kis station/city se" phrasing miss ki thi; recorded reply se re-grade, koi re-run nahi. |
| T10 MULTI-TURN (mock) | ✅ | Origin/destination preserved, "Kal" → date fill, known slots re-ask nahi (114.5s — slowest turn) |
| T11 MALFORMED GUARD (injected) | ✅ | Unknown tool (BOOK_WALLET_TOOL) allowlist-reject, harmony-token tool-name reject, invalid JSON reject, URL-in-args reject — koi unsafe execution nahi, zero real model calls |
| T12 PROVIDER FAILURE (injected) | ✅ | 503 → deterministic NLU fallback (non-empty, failure recorded); timeout → abort honored → fallback. No crash. Zero real DeepSeek calls. |

**Scoring correction (transparent):** as-run 10/12 → corrected **11/12** (T9 regex fix, recorded data se post-hoc, re-run nahi). T5 hi asli flag hai.

---

## LATENCY — the disqualifier

| Metric | GPT-OSS-20B (recorded) | DeepSeek V4 Flash | Ratio |
|---|---|---|---|
| **Turn latency avg** | 7,010 ms | **58,461 ms** | **8.3×** |
| Turn latency p50 | 5,436 ms | **63,576 ms** | 11.7× |
| Turn latency slowest | 26,274 ms | **114,547 ms** | 4.4× |
| AI call latency avg / p50 / slowest | 3,303 / 2,444 / 10,001 ms | **30,412 / 24,599 / 61,363 ms** | 9.2× |
| Model calls per turn | 1.7 | 1.9 | — |
| Tool calls (ok) | 8 (6) | 12 (8) | — |

**Production wall:** DeepSeek ke **11 mein se 8 turns (73%) ~30s Vercel function wall paar** karte hain (T1 87.8s, T3 63.6s, T4 49.6s, T5 90.4s, T6 71.7s, T7 109.3s, T8 35.8s, T10 114.5s). Production mein yeh turns hard-timeout hote → deterministic fallback — matlab **primary model ke roop mein yeh effectively kabhi chal hi nahi sakta** current infra par. GPT-OSS ka worst turn (26.3s) wall ke andar hai.

---

## COMPARISON: GPT-OSS-20B vs DeepSeek-V4-Flash

| Metric | GPT-OSS-20B (recorded run) | DeepSeek-V4-Flash (this run) |
|---|---|---|
| Tool selection | 6/8 tool-cases (C: koi tool nahi, E: date-ask) | **7/7 tool-cases** (T5/T7 mein sahi tools — GPT-OSS ke C/E gaps yahan nahi) |
| Tool arguments | 100% schema-valid | **100% schema-valid** (snake_case `train_number`/`class_code` perfect) |
| Multi-tool | ❌ (C: no tools + ungrounded caught) | **✅ (T5 dono tools ok)** |
| Hindi/Hinglish | ✅ | ✅ |
| Missing date | ✅ | ✅ |
| Ambiguity | ✅ | ✅ |
| Comparison | ✅ | ✅ |
| Grounding | 1 caught event (C) — guard ne replace kiya | 1 caught flag (T5 "WL") — guard ne disclose kiya; **dono mein silent hallucination = 0** |
| JSON validity | 100% | 100% |
| Fallback | ✅ (prior validation) | ✅ (T12) |
| **Average latency** | **7,010 ms** | **58,461 ms (8.3×)** |

*(GPT-OSS numbers: previously recorded NEMOTRON_BENCH_gptoss.json — same cases, same prompts, same generous timeouts; koi GPT-OSS re-run nahi kiya.)*

---

## Pass criteria check (mandate)

1. No critical safety/grounding failure — ✅ (ek non-critical flag, caught + disclosed)
2. Tool schemas valid — ✅ 100%
3. Multi-tool planning — ✅
4. Missing date — ✅
5. Hindi/Hinglish — ✅
6. Comparison planning — ✅
7. Ambiguous station not guessed — ✅
8. Failure fallback — ✅
9. **Latency acceptable vs GPT-OSS — ❌ FAIL (8.3× avg, 11.7× p50, 73% turns production wall paar)**

## FINAL RECOMMENDATION

# **KEEP GPT-OSS-20B PRIMARY**

DeepSeek V4 Flash ki **planning quality genuinely achhi hai** (11/12 — GPT-OSS ke recorded 9/12 se bhi behtar tool-selection/args), zero silent hallucination, guards ke saath clean behaviour. **Par latency usko disqualify karti hai**: har turn ~1 minute, p50 63.6s — production 30s wall se 2× upar, GPT-OSS se 8.3× slow. Agar kabhi yeh model ek dedicated async/batch ya non-latency-critical path ke liye chahiye ho to quality profile kaam karega — primary planner ke liye NOT READY.

**Production status: UNCHANGED. No deploy, no commit/push, koi env change nahi.** (Benchmark files sirf local workspace mein hain: `scripts/deepseek-benchmark.mts`, `DEEPSEEK_BENCH.json`, yeh report.)

---

*Methodology notes: existing NVIDIA integration + existing agentic architecture (AGENTIC_MODEL benchmark-only override — prod kabhi set nahi karta); same system prompt/tools/allowlist/zod/grounding; reasoning_effort sirf GPT-OSS family ko jata hai; temp 0; TTFR N/A (non-streaming); secrets kabhi log nahi hue (leak-guard clean); mocked turns explicitly listed upar.*
