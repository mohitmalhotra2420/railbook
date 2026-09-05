# NEMOTRON ULTRA BENCHMARK REPORT
## nvidia/nemotron-3-ultra-550b-a55b vs openai/gpt-oss-20b (RailBook AI semantic planner)

**Date:** 2026-09-05 · **Benchmark ONLY — koi deploy/production change NAHI hua.** GPT-OSS-20B production-primary waisi hi hai.

---

## Setup (fairness guarantees)

| Item | Value |
|---|---|
| Candidate model | `nvidia/nemotron-3-ultra-550b-a55b` (NVIDIA API, existing `NVIDIA_BASE_URL` + existing `NVIDIA_API_KEY` — key kabhi expose/log nahi hui) |
| Baseline model | `openai/gpt-oss-20b` (current primary) |
| Selection mechanism | `AGENTIC_MODEL` env — **sirf benchmark script set karta hai**; prod kabhi nahi. Prod default path (NVIDIA_MODEL + chain) byte-for-byte unchanged. 440/440 tests green after integration. |
| Same prompt/tools | ✅ EXACT same system prompt, AGENTIC_TOOLS definitions, JSON schema, allowlist, zod validation, URL-strip, grounding guards, date resolver, conversation state, RailCore adapter, RailKit fallback, deterministic comparison. Sirf model ka naam badla. Prompt mein zero optimization for Nemotron. |
| Test cases | User-specified A–L (12 cases, 13 agentic turns per leg — L multi-turn) |
| Real agentic calls | **GPT-OSS: 13 turns / 22 AI calls** · **Nemotron: 13 turns / 24 AI calls** — sab live NVIDIA API se. Fault injection: **NONE**. Railway data: sab real (RailCore primary / RailKit fallback). |
| Timeouts (fair) | Dono legs: 75s per AI call, 200s turn budget (550B ko room; GPT-OSS fast hai, isse farak nahi padta) |
| NLU note | Benchmark **AI semantic planner ko isolate** karta hai (`known={}` — production deterministic-NLU pre-fill ke bina). Dono models same conditions. |
| TTFR | N/A (non-streaming API) |
| Secret leak guard | AI request bodies mein railway keys kabhi nahi mile — dono legs clean ✓ |

**Environment noise (dono legs par barabar):** RailCore 20/min per-minute limit kuch turns mein 429 diya (D/C comparison bursts); RailKit fallback window monthly-quota-exhausted hai → "both_failed" provider failures environmental hain, model ki quality nahi. Harness pacing 15s/turn.

---

## ⚠️ Scoring correction (transparent)

As-run automated checks mein **ek bug tha**: C/E checks camelCase args (`trainNumber`) maangte the jabki zod schemas **natively snake_case** hain (`train_number`, `class_code`). Nemotron ne schema PERFECTLY follow kiya tha. Recorded raw args se post-hoc re-grade kiya (koi re-run/cherry-picking nahi):

- **As-run score:** GPT-OSS 9/12 · Nemotron 7/12
- **Corrected score:** GPT-OSS 9/12 · **Nemotron 9/12 — TIED**

Nemotron ke C/E "fail" environmental the (route-availability + provider failures), args sahi the. GPT-OSS ke C/E/G fail asli model-level gaps hain.

---

## Per-case results (turn latency = total agentic turn)

| Case | Prompt (short) | GPT-OSS-20B | ms | Nemotron Ultra | ms |
|---|---|---|---|---|---|
| A | Amritsar→Ludhiana kal | ✅ SEARCH_TRAINS, date=tomorrow | 16939 | ✅ SEARCH_TRAINS, date=tomorrow | 13028 |
| B | sabse fast train | ✅ JOURNEY_ANALYZE | 7850 | ⚠️ date poochha (kal konsa?) | 4514 |
| C | 12014 CC avail+fare | ❌ koi tool nahi + **ungrounded reply caught** → honest fallback | 2446 | ✅ CHECK_AVAILABILITY+GET_FARE+GET_TRAIN_INFO (sahi args; tools route/429 fail → honest) | 5627 |
| D | 12014 vs 14542 Ludhiana jaldi | ✅ GET_TIMETABLE ×2 + compare | 5436 | ✅ GET_TIMETABLE ×2 + compare | 9738 |
| E | 12014 abhi kahan? | ❌ date poochha (live status ko date nahi chahiye) | 3046 | ✅ TRACK_TRAIN (provider fail → honest unavailable) | 11669 |
| F | date ke bina | ✅ date poochha | 458 | ✅ (ungrounded attempt caught → honest fallback) | 17448 |
| G | "Aaj" explicit | ❌ "Aaj" ignore karke date poochha | 575 | ✅ SEARCH_TRAINS date=today | 13144 |
| H | Hinglish sabse jaldi | ✅ JOURNEY_ANALYZE, kal | 10032 | ✅ JOURNEY_ANALYZE, kal | 15649 |
| I | ambiguous Delhi | ✅ needs_choice → station options | 514 | ❌ planner-level: 0 tools, ungrounded caught → honest-unavailable (prod pipeline deterministic relay se rescue hota) | 31044 |
| J | RAC vs WL | ✅ GENERAL_RAILWAY_ANSWER | 7720 | ✅ GENERAL_RAILWAY_ANSWER | 36247 |
| K | "jaldi Delhi chhod de…" | ✅ search + grounded | 2830 | ⚠️ origin=Delhi read karke destination poochha (defensible interpretation, no hallucination) | 10666 |
| L | multi-turn "Kal" | ✅ state preserved, date filled, no re-ask | 26274 | ✅ state preserved, date filled, no re-ask | 13834 |

**Corrected: GPT-OSS 9/12 · Nemotron 9/12** (B, K = nemotron ke defensible behavioral choices, strictly fail; I = asli planner gap; GPT-OSS ke C/E/G = asli gaps).

---

## Latency benchmark (CRITICAL difference)

| Metric | GPT-OSS-20B | Nemotron Ultra | Ratio |
|---|---|---|---|
| **Turn latency avg** | 7,010 ms | 15,217 ms | **2.17×** |
| **Turn latency p50** | 5,436 ms | 13,144 ms | **2.42×** |
| **Turn latency p95** | 26,274 ms | 36,247 ms | **1.38×** |
| AI call latency avg / p50 / p95 | 3,303 / 2,444 / 10,001 ms | 6,884 / 4,101 / 27,330 ms | 2.08× |
| Worst 3 turns | 26.3s, 16.9s, 10.0s | **36.2s, 31.0s, 17.4s** | — |
| Model calls (13 turns) | 22 | 24 | +9% |
| Tool calls / ok | 8 / 6 | 12 / 6 | +50% round trips |
| Fallback-trigger rate | 2/12 turns | **5/12 turns** | 2.5× |

**Platform warning:** Nemotron ke 2 turns (I=31.0s, J=36.2s) **~30s Vercel function wall paar karte hain** — production mein yeh turns hard-fail hote (deterministic fallback). GPT-OSS ka worst turn 26.3s ke andar hai.

---

## Quality score comparison

| Dimension | GPT-OSS-20B | Nemotron Ultra | Notes |
|---|---|---|---|
| Tool selection accuracy | 6/8 tool-cases | **7/8** tool-cases | Nemotron C/E sahi tools chuni; GPT-OSS ne C/E mein koi tool nahi |
| Argument accuracy | 8/8 calls valid | **12/12 calls valid** | Dono 100% schema-valid; nemotron snake_case schema perfect follow karta hai |
| Multi-tool accuracy | 1/2 (C ✗, D ✓) | **2/2** (C ✓, D ✓) | C planning nemotron jeeta (execution environmental fail) |
| Date understanding | 3/4 | **4/4** | GPT-OSS "Aaj" miss (G); Nemotron A/G/H + kal sab sahi |
| Hindi/Hinglish | ✅ | ✅ | Dono H pass |
| Missing-slot handling | ✅ | ✅ | Dono honest poochte hain, assume nahi |
| Ambiguity handling | **✅** | ❌ (planner-level) | I: GPT-OSS needs_choice relay; Nemotron prod-rescue par depend |
| Grounding (server guard) | 1 caught event (C) | 2 caught events (F, I) | Dono mein guard ne ungrounded output pakad ke honest reply se replace kiya — **koi hallucination user tak nahi pahuncha** |
| Hallucination count (user-visible) | **0** | **0** | Heuristic unverified-numbers: GPT-OSS 5, Nemotron 0 |
| JSON validity | 100% | 100% | Zero invalid_args dono |
| Agentic success rate | 9/12 | 9/12 | Corrected tie |
| Avg / p50 / p95 latency | 7.0s / 5.4s / 26.3s | 15.2s / 13.1s / 36.2s | **2.2× slower** |
| Fallback rate | 2/12 | 5/12 | Nemotron 2.5× zyada fallback-trigger |

Hygiene (dono 100%): koi unknown tool nahi, koi malformed JSON nahi, koi Harmony/template leakage nahi, koi internal tool-syntax exposure nahi, sab turns sufficient results ke baad ruke (≤4 steps). Tool-failure recovery: dono honest-unavailable dete hain, fake data kabhi nahi.

---

## Section 8: 550B worth the latency? — **NAHI.**

RailBook priorities ke hisaab se:

1. **Correct railway data** — Tie. Dono 100% server-side grounding ke andar; dono mein caught ungrounded events replace hue. User-visible hallucination dono mein 0.
2. **Correct tool selection** — Nemotron HALKA sa aage (7/8 vs 6/8, C/E planning). Par GPT-OSS bhi 9/12 overall.
3. **Low hallucination** — GPT-OSS 1 caught vs Nemotron 2 caught (user-visible dono 0).
4. **Low latency** — **GPT-OSS decisively jeeta: 2.2× faster avg, 2.4× p50, worst-case 26s vs 36s.**
5. **Hindi/Hinglish** — Tie.
6. **Low model round trips** — GPT-OSS jeeta (22 AI calls + 8 tools vs 24 + 12).

Nemotron ki quality-marginal-gain (tool selection C/E) latency/reliability cost justify nahi karti: 2.2× slower, 2.5× zyada fallback triggers, aur 2/13 turns production wall (~30s) paar — jo 550B reasoning depth ka seedha natija hai.

---

## FINAL VERDICT

# **B) SIMILAR QUALITY BUT SLOWER**

## Recommendation: **KEEP GPT-OSS-20B PRIMARY**

- Quality overall **tied** hai (9/12 corrected dono) — profiles different hain (GPT-OSS: ambiguity-handling behtar; Nemotron: tool-selection/date-discipline halki behtar), par koi decisive quality advantage NAHI.
- Latency **decisively worse** (2.2×) + production wall violations (31s/36s turns) + 2.5× fallback rate + zyada round trips.
- RailBook ke liye 550B ka cost (latency + reliability) uski marginal planning-gain se kahin zyada hai.

**Production status: UNCHANGED.** GPT-OSS-20B primary + deterministic NLU fallback + RailCore primary + RailKit fallback — waisa hi. Koi deploy, push-to-production, env change NAHI hua. Benchmark code (`AGENTIC_MODEL` override + `scripts/nemotron-benchmark.mts`) local commit mein hai; prod kabhi `AGENTIC_MODEL` set nahi karta.

---

### Appendix: methodology details
- Legs: `BENCH_MODEL=gptoss` / `BENCH_MODEL=nemotron npx tsx scripts/nemotron-benchmark.mts` — same script, same 12 prompts, temp 0, `now` fixed per-leg run.
- `reasoning_effort` GPT-OSS family ko hi bheja jata hai (Nemotron ko nahi — API usse accept nahi karti); yeh pehle se aisa hi tha, benchmark ne change nahi kiya.
- Nemotron leg 503-transient (1 probe call) encounter hua tha pre-run; benchmark turns mein koi 503 nahi.
- Raw evidence: `NEMOTRON_BENCH_gptoss.json`, `NEMOTRON_BENCH_nemotron.json` (per-turn: tools+args+ok+source, replies, model/tool latencies, model calls, grounded flags, hygiene, hallucination heuristics, regrade notes).
