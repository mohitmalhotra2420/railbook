# GLM-5.3-Flash Adversarial Validation Report (PRE-PRODUCTION)

**Date:** 2026-09-05 · **Status: PARTIAL — HF QUOTA BLOCKER** · **Deploy: NAHI HUA** (GPT-OSS-20B production-primary, mandate ke mutabik)

## Mandated report items

| Item | Result |
|---|---|
| **HF authentication** | ✅ 200 OK — bearer token valid (server-side `HF_TOKEN`, kabhi print/log nahi hua; leak-guard: sab runs mein HF bodies/responses clean) |
| **Actual model used** | ✅ `zai-org/GLM-5.3-Flash` (HF router `https://router.huggingface.co/v1` — har served turn ka `modelUsed` yehi) |
| **Tool calling success** | ✅ Jahan GLM ne serve kiya: native OpenAI-style `tool_calls`, valid JSON args, allowlist+zod+grounding pipeline se guzre. SEARCH_TRAINS, JOURNEY_ANALYZE (sahi `preference` arg ke saath), TRACK_TRAIN, GET_FARE, CHECK_AVAILABILITY (tool-level), multi-tool chaining — sab real RailCore data ke saath |
| **Structured JSON success** | ✅ Tool-call arguments har served turn mein parseable/valid zod JSON; koi bad-JSON reject nahi hua live turns mein |
| **Latency** | Chat probe ~586–997 ms (pre-depletion). Agentic turn average: 2775–3239 ms (multi-step turns, RailCore calls included). 402-fails ~120–200 ms fast-fail |
| **Fallback behaviour** | ✅ 12a (HF 503 outage): deterministic engine + **real RailCore fare (₹)** reply, failure reason recorded. 12b (hung server + 4s timeout): abort honored → deterministic fallback real live-status reply. RailKit fallback window monthly-quota-exhausted hai → honest "available nahi hai" (koi fake data nahi) |
| **Tests passed/failed** | **9 pass / 1 partial-quality / 4 quota-blocked** (neeche table) |

## Test matrix (12 mandated tests)

| # | Test | Status | Evidence |
|---|---|---|---|
| — | HF auth + model identity | ✅ PASS | run2, run3 (200, model confirmed) |
| 1 | SEARCH_TRAINS — real RailCore search | ✅ PASS | run1, run2 |
| 2 | JOURNEY_ANALYZE — Atlas analysis | ✅ PASS | run2 (GLM ne `preference` arg sahi diya, ~14 real timetable calls se analysis; run1 ka fail transient RailCore minute-limit tha, pacing se fix) |
| 3 | TRACK_TRAIN — live status | ✅ PASS | run1, run2 |
| 4 | GET_FARE — CC fare real data | ✅ PASS | run3 (₹ fare grounded) |
| 5 | CHECK_AVAILABILITY | ⚠️ PARTIAL | run3: tool call + real railcore availability OK, **par grounding guard ne final reply mein bina-evidence number/token pakda** (t.grounded=false). Reply-text capture ab harness mein hai — retest pending |
| 6 | Multi-tool (train+fare+availability) | ✅ PASS | run3 (chained, complete answer) |
| 7 | Train comparison 12014 vs 12030 | ❓ QUOTA-BLOCKED | http_402 — measure nahi hua |
| 8 | Hindi/Hinglish | ❓ QUOTA-BLOCKED | http_402 — measure nahi hua |
| 9 | Missing date — no silent assume | ❓ QUOTA-BLOCKED | http_402 — measure nahi hua |
| 10 | Ambiguous 'Delhi' — clarify, silent pick nahi | ❓ QUOTA-BLOCKED | http_402 — measure nahi hua |
| 11 | Malformed AI output (FAULT-INJECTED) | ✅ PASS | run1–4 sab: unknown tool / harmony-token / bad JSON / URL-in-args — allowlist+zod+URL-strip guards ne sab reject kiye |
| 12 | AI timeout/failure fallback | ✅ PASS (12a+12b) | run2–4: deterministic fallback + real provider data, failure reasons recorded |

**Fault-injected calls (explicit list):** test 11 (scripted GLM misbehavior), 12a (HF 503), 12b (abort-honoring hung-server fetch + `AI_AGENTIC_TIMEOUT_MS=4000`). Baaki sab calls live/real the. Koi mock railway data nahi.

## 🚫 BLOCKER: HF monthly included credits depleted

Suite ke **beech mein** HF ne `http_402` dena shuru kiya:

> `"You have depleted your monthly included credits. Purchase pre-paid credits to continue using Inference Providers. Alternatively, subscribe to PRO to get 20x more included usage."`

- Run 1: tests 1–3 serve hue, phir 402. Run 2: 1–3 phir se pass. Run 3: 4–6 pass. Run 4: **hard 402 sab pe (auth bhi)** — window poori tarah khatam.
- Yeh **availability/kaafi-billing issue hai, GLM quality issue NAHI** — jahan GLM ne serve kiya wahan sab green (sirf test-5 ka grounding flag exception).
- **Resolve karne ke liye (user action):** HF account mein pre-paid credits kharidein YA PRO subscribe karein (20x included usage) YA kisi funded token se `HF_TOKEN` update karein. Uske baad:
  ```
  GLM_SKIP="1,2,3,4,6" npx tsx scripts/glm-adversarial-test.mts
  ```
  (tests 5, 7, 8, 9, 10 + guards re-run honge; pehle se passed tests ka RailCore budget waste nahi hoga)

## Integration snapshot (code — committed, deploy NAHI hua)

- `server/env.ts`: `hfToken`/`hfModel`/`hfBaseUrl` getters + `agenticProvider` (`AGENTIC_PROVIDER`, default `nvidia` → prod behaviour unchanged)
- `server/agent/agentic.ts`: `AgenticTransport` + `agenticTransport()` — NVIDIA path (GPT-OSS-20B + nemotron chain, `reasoning_effort`) byte-for-byte waisi hi; HF path single GLM model, **no `reasoning_effort`** (HF reject karta hai). GLM sirf validated tool plans produce karta hai — allowlist + zod + URL-strip + grounding guard sab waise hi. GLM ko RailCore/RailKit credentials kabhi nahi milti (Authorization header sirf HF token).
- `scripts/glm-adversarial-test.mts`: 12-test suite + `GLM_SKIP` support, RailCore pacing (20/min limit), host-count + secret-leak guard, abort-honoring timeout injection, guaranteed JSON report write.
- Tests: **440/440** (default NVIDIA path) — GLM changes se prod path untouched.
- RailCore (nayi key `rk_live_…`): 200 OK; suite runs ne ~93 daily calls + ~450 credits use kiye (quota healthy).

## Harness bugs found & fixed during validation

1. **Timeout-injection fake AbortSignal ignore karta tha** → await kabhi settle nahi hota → Node event-loop drain → **silent exit(0) before report write**. Fix: fake ab `init.signal` abort pe `AbortError` reject karta hai (real fetch jaisa). Production code mein yeh bug **nahi** tha (real fetch signal honor karta hai).
2. **RailCore pacing missing** → suite ke andar 20/min limit trip → spurious tool-fails (run 1 ka test-2). Fix: tests ke beech 10s pacing.
3. **12b trains-query ka deterministic reply by-design null hota hai** (client `searchTrains` intent se TrainBoard kholta hai) — test ab live-status query use karta hai jiska deterministic fallback real text reply deta hai.
4. `ToolTraceStep.rejected` type-nahi-hai access fix (`ok === false` hi reject/fail signal hai).

## Verdict

**GLM-5.3-Flash ko production-primary NAHI banaya ja sakta abhi** — mandate ke mutabik poora 12-test suite pass hona chahiye. Jo measure hua (8/11 GLM-behaviour tests + auth) woh sab green hai aur integration architecture proven hai; par **tests 5 (grounded re-check), 7, 8, 9, 10 baaki hain** — HF credits top-up ke baad hi possible. Production GPT-OSS-20B primary + deterministic NLU fallback par **waisi hi chal rahi hai** (koi deploy nahi hua).

**Raw evidence:** `GLM_ADVERSARIAL_REPORT.run2.json`, `.run3.json`, `.run4.json` (per-run records) + `GLM_ADVERSARIAL_REPORT.json` (merged best-evidence).
