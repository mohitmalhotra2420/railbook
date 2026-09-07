# Round-14b Report — `meta/muse-glimmer-30b` vs GPT-OSS-20B vs Lightning (2026-09-07)

**Status: BENCHMARK ONLY — koi push, koi deploy, koi prod env change NAHI.**
Nayi NVIDIA key (`nvapi-…(key 2)`) sirf benchmark process ke env mein use hui — `.env` mein NAHI likhi (wahan `nvapi-…(key 1)` hai). Batao kaunsi prod ke liye rakhni hai.

---

## 0. TL;DR

| Sawaal | Jawab |
|---|---|
| Muse-Glimmer samajhta hai? | **Haan — sabse achhi Hinglish/Hindi samajh + sabse natural replies** teeno mein. Devanagari mein Devanagari jawab, typo ("tarin", "dilli", "ludiyana") samajh gaya, injection/out-of-domain politely handle. |
| Correct tools? | **Haan, ek bug ke baad.** Model `train_number` ko JSON **number** (12014) bhejta tha, string nahi — hamara zod schema reject karta tha → 5× retry loop. **Fix kiya (`z.coerce.string`)** → 6/12 se **9/12**. |
| Speed? | **Sabse tez**: 1.9s p50 per call, 5.8s p50 per turn (GPT-OSS 2.3s / 6.0s; Lightning-OFF 4.7s / 20s). |
| Kaun better? | **Muse-Glimmer ≥ GPT-OSS-20B.** Muse: better language + multi-tool + speed. GPT-OSS: zyada conservative (0 hallucination flags), 3 hafte prod-proven. Dono se Lightning bahut peeche. |
| Recommendation | **Abhi primary mat badlo.** Pehle Muse ko **fallback #1** banao (GPT-OSS → Muse → GLM), 1–2 din prod traffic pe `modelUsed` dekho, phir swap decide karo. Muse NIM pe naya model hai — catalogue drift (deepseek jaisa hang / 410) ka risk dekhna hai. |

---

## 1. Setup (fair A/B)

- Same harness: `scripts/lightning-benchmark.mts` — same system prompt, same 16 tools, same zod, same grounding, same RailCore/RailKit.
- **Muse run 1** → number-arg bug pakda → schema fix → **Muse run 2** + **GPT-OSS run 2** dono fixed code par.
- Extra 8 hard cases (`scripts/agentic-extra-cases.mts`): typo, Devanagari, out-of-domain, prompt-injection, context-switch, PNR, info-only, general-fact.

### Key/model check
| | Result |
|---|---|
| `nvapi-…(key 2)` | ✅ valid, 81 models catalogue, `meta/muse-glimmer-30b` listed |
| Muse ping | 702ms; **thinking model** (`reasoning_content` deta hai) par reasoning short (100–260 chars), `content` alag se aata hai — Lightning jaisa leak nahi |
| Thinking toggle | `chat_template_kwargs.thinking/enable_thinking=false`, `reasoning_effort=low` — koi farak nahi (already light). Koi special param zaroori nahi. |

---

## 2. Scorecard (sab fixed code par)

| | **GPT-OSS-20B** (prod) | **Muse-Glimmer-30B** | Lightning OFF | Lightning ON |
|---|---|---|---|---|
| Checker pass | 7/12 | **9/12** | 8/12 | 7/12 |
| **Manual review (user ko sahi jawab)** | 10/12 | **11/12** | 7/12 | 5/12 |
| AI call p50 | 2.3s | **1.9s** | 4.7s | 17.5s |
| Turn p50 | 6.0s | **5.8s** | 20s | 38s |
| Tool calls / ok | 12 / 7 | 14 / 10 | 28 / 22 | 8 / 7 |
| Hallucination flags | **0** | 3 (sab benign: `IST`, `EC`, 12716 jo list mein tha) | 18 | 12 |
| Timeout / 5xx / garbage | 0 | 0 | 0 / 0 / 1 | 1 / 1 / 1 |
| Thinking-text leak | 0 | **0** | 0 | 3 |
| Extra 8 hard cases | 6/8 | **7/8** | — | — |

---

## 3. Case-by-case (Muse run 2 vs GPT-OSS run 2)

| Case | GPT-OSS-20B | Muse-Glimmer |
|---|---|---|
| **A** ASR→LDH kal | ⚠️ SEARCH_STATIONS×2 phir **date poochh li** (kal bola tha!) | ✅ SEARCH_TRAINS date=kal, 20 trains, fastest 22488 + subah ke options |
| **B** ASR→Delhi fastest | ✅ JOURNEY_ANALYZE → Delhi options | ⚠️ date poochhi (rule 5 = date first, technically sahi; checker fail) |
| **C** 12014 CC avail+fare | ⚠️ CHECK_AVAILABILITY fail → **date poochhi** | ✅ CHECK_AVAILABILITY + GET_FARE, "₹1125 + ₹50 = ₹1175, availability unavailable" |
| **D** 12014 vs 14542 | ✅ TIMETABLE×2, "12014 06:57 vs 07:12" | ✅ INFO×2 + TIMETABLE×2, same verdict + dep/arr detail |
| **E** 12014 kahan | ✅ | ✅ |
| **F** date missing | ✅ "Kis date ko?" | ✅ (ungrounded→fallback in run 2, run 1 mein perfect "Kis date ko? Aaj 07 Sep hai…") |
| **G** aaj ASR→LDH | ❌ ungrounded (ISM) → fallback text (dono runs mein) | ✅ 20 trains, fastest + earliest |
| **H** bhai kal sabse jaldi | ✅ Delhi options | ✅ Delhi options + date acknowledge |
| **I** ASR→Delhi | ✅ date poochhi | ❌ ungrounded (NZM apni knowledge se likha) → fallback |
| **J** RAC vs WL | ✅ | ✅ (zyada detailed) |
| **K** weird NL | ✅ origin poochha | ❌ ungrounded (NZM) → fallback |
| **L** multi-turn "Kal" | ✅ | ✅ Delhi options (known ctx NDLS ignore kiya, par options relay sahi) |

### Extra hard cases
| Case | GPT-OSS | Muse |
|---|---|---|
| T1 typo "ludiyana se dilli kal ki tarin" | ✅ (origin `LDN` galat code banaya, par server ne Delhi options diye) | ✅ origin `Ludhiana` sahi, Delhi options |
| T2 "12014 की कोच पोजिशन" | ✅ Devanagari, coach list | ✅ Devanagari + numbered + E/C class explain |
| T3 pizza | ✅ "Sorry, railway only" (English, rukha) | ✅ Hinglish, polite, redirect |
| T4 injection | ✅ refuse | ✅ refuse |
| T5 "arre chhodo, 12904 kitni late" | ❌ **GET_TRAIN_HISTORY** galat dates (kal/parso) — "data nahi" | ✅ **TRACK_TRAIN** → "On time, 0 min" |
| T6 PNR | ✅ | ✅ |
| T7 "jaana nahi, bas 12030 route" | ✅ full route | ✅ full route |
| T8 vande bharat top speed | ❌ ungrounded (160) → fallback | ❌ WEB_SEARCH ×6 loop, step budget khatam |

**Muse ki 2 kamzori** (I, K, T8): ambiguous city par kabhi-kabhi apni knowledge se `NZM` likh deta hai (grounding guard pakad leta hai → safe fallback, par user ko generic text milta hai), aur WEB_SEARCH pe results se satisfy nahi hota to same query 6 baar repeat. Dono prompt-tuning se theek ho sakte hain (e.g. "WEB_SEARCH max 1 call" already rule 23 mein hai — Muse ise ignore karta hai; hard cap code mein lagana chahiye).

---

## 4. Code changes (local, uncommitted, tests 545/545)

| File | Change | Kyun |
|---|---|---|
| `server/agent/agentic.ts` | `train_number`/`pnr` schemas: `z.string()` → `z.coerce.string()` (regex gate same) | Muse number bhejta hai; **GPT-OSS/koi bhi model ko fayda**, risk zero (regex `^\d{4,6}$` waise hi enforce) |
| `server/agent/agentic.ts` | `NEMOTRON_THINKING=off` opt-in (pichhle round se) | Lightning ke liye; env unset = no-op |
| `scripts/lightning-benchmark.mts` | `muse` leg + `BENCH_NVIDIA_KEY` override | bench only |
| `scripts/agentic-extra-cases.mts` | naya — 8 hard cases, `BM=<model>` se koi bhi model | bench only |

**Yeh coerce fix prod mein jaana chahiye chahe model badle ya na badle** — abhi GPT-OSS bhi kabhi-kabhi number bhej sakta hai aur silently fail hota.

---

## 5. Prod status (is round mein dobara verify)
- Agentic zinda: ✅ (pichhle round ke 3 live queries, model gpt-oss-20b)
- ⚠️ **RailCore purani key credits-exhausted** — prod abhi bhi RailKit/scrape fallback par. Nayi `rk_live_…(new)` local `.env` mein hai, Render pe nahi.

---

## 6. Recommendation (tumhari approval chahiye — abhi kuch NAHI kiya)

**Option A — Safe (main yahi suggest karta hoon):**
```
NVIDIA_MODEL=openai/gpt-oss-20b                 # primary rahe (proven)
NVIDIA_FALLBACK_MODEL=meta/muse-glimmer-30b     # NAYA: fallback #1 (Lightning nahi)
HF_MODEL=zai-org/GLM-5.3-Flash                  # fallback #2 (unchanged)
```
+ coerce fix deploy + WEB_SEARCH hard-cap (1/turn) + RailCore nayi key Render pe.
2 din baad `/api/agent` responses mein `modelUsed` dekh kar swap decide.

**Option B — Aggressive:** Muse primary, GPT-OSS fallback. Bench pe better hai, par NIM pe naya model — 1 din mein hang/410 ho gaya to (deepseek jaisa) fallback stagger bachayega, phir bhi har query +8s slow hogi.

**Lightning:** kisi bhi slot mein nahi.

Bolo: A ya B, kaunsi NVIDIA key prod pe (key 1 ya key 2), aur RailCore key Render pe daalun?
