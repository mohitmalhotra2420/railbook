# Round-14 Report — Nemotron-3.5-Lightning-30B-A3B vs GPT-OSS-20B (2026-09-07)

**Status: BENCHMARK ONLY — koi push, koi deploy, koi prod config change NAHI hua.**
Local `.env` mein nayi NVIDIA + RailCore keys daali gayi (Render/Vercel par abhi NAHI).

---

## 0. TL;DR (seedha jawab)

| Sawaal | Jawab |
|---|---|
| Lightning har cheez samajhta hai? | **Language samajh acchi hai** (Hinglish, typo, multi-turn) — GPT-OSS jitni hi. |
| Correct tools use karta hai? | **Simple queries par haan** (search/live/compare/general). **Complex/ambiguous par nahi** — galat args banata hai (`origin=Ludhiana, destination=Ludhiana`), WEB_SEARCH par bhaag jaata hai, date silently assume karta hai. |
| Kaun better hai? | **GPT-OSS-20B (abhi ka prod primary) hi better hai.** Lightning primary nahi banana chahiye. |
| Fallback (HF GLM) vs Lightning? | Lightning **fallback slot ke liye theek** hai (thinking=OFF mode mein) — GLM ke saath ya GLM ke pehle rakh sakte hain. |
| Prod agentic zinda hai? | **Haan** — verify kiya (`engine: agentic_tool_calling`, model `gpt-oss-20b`, 3/3 queries). |

---

## 1. Setup

- Script: `scripts/lightning-benchmark.mts` — **same system prompt, same 16 tools, same zod validation, same grounding guards, same providers**; sirf model badla.
- 12 cases (A–L): basic journey, fastest, multi-tool, compare, live, missing-date, today, Hinglish, ambiguous-Delhi, general-Q, weird-NL, multi-turn.
- Teen legs:
  1. `gptoss` — `openai/gpt-oss-20b` (prod primary)
  2. `lightning` — Nemotron-3.5-Lightning, **thinking=ON** (model default)
  3. `lightning-nothink` — Nemotron-3.5-Lightning, **thinking=OFF** (`chat_template_kwargs.enable_thinking=false`)
- **Fix in script:** pichhla "gptoss" run asal mein `.env` ke `NVIDIA_MODEL=deepseek` par chala tha (LIGHTNING_BENCH_gptoss.json mein `modelUsed: deepseek-v4-flash` tha, 35–128s/turn). Ab har leg `AGENTIC_MODEL` pin karta hai — fair A/B.

### Key verification (nayi keys)
| Key | Result |
|---|---|
| NVIDIA `nvapi-…(key 1)` | ✅ gpt-oss 598ms · Lightning 992ms · deepseek-v4-flash **39s** (hang confirm, prod mein use mat karo) |
| RailCore `rk_live_…(new)` (nayi) | ✅ 200 — stations/schedule/live sab aa raha |
| RailCore `rk_live_…(old)` (purani) | ❌ 402 `CREDITS_EXHAUSTED` — **prod (Render) abhi bhi isi par hai** → `/api/health` bol raha `railcore: blocked, credits_exhausted`, sab RailKit fallback se chal raha |

---

## 2. Scorecard

| | **GPT-OSS-20B** (prod) | **Lightning thinking=ON** | **Lightning thinking=OFF** |
|---|---|---|---|
| Pass (checker) | 7/12 | 7/12 | 8/12 |
| **Pass (manual review, behaviour sahi)** | **10/12** | **5/12** | **7/12** |
| AI call latency avg / p50 | **4.5s / 2.6s** | 18.3s / 17.5s | 6.6s / 4.7s |
| Turn latency avg / p50 | **10.9s / 7.4s** | 36.7s / 38.3s | 24.5s / 20.0s |
| Tool calls / ok | 13 / 10 | 8 / 7 | 28 / 22 (over-calling) |
| Timeouts / 5xx | 0 | 1 timeout (60s) + 1 HTTP 502 | 0 |
| Reasoning-text leak in reply | 0 | **3 cases** ("Here's a thinking process: 1. Analyze…") | 0 |
| Garbage output | 0 | **1** ("here=here, here=here…" ×30) | 1 ("**Amritsar (for help)" truncated) |
| Secret leak (AI bodies) | none | none | none |

> "Manual review" = maine har reply padh kar dekha ki user ko sahi jawab mila ya nahi. Checker do jagah GPT-OSS ko galat fail kar raha tha (model `train_number` snake_case bhejta hai, server sanitize karta hai — reply bilkul sahi thi). Yeh checker fix kar diya hai.

---

## 3. Case-by-case (kya hua asal mein)

| Case | GPT-OSS-20B | Lightning ON | Lightning OFF |
|---|---|---|---|
| **A** Amritsar→Ludhiana kal | ✅ SEARCH_STATIONS×2 → SEARCH_TRAINS, date=kal, 20 trains, sabse fast 22488 | ✅ SEARCH_TRAINS direct (17.7s model) | ✅ sahi, par reply mein poori 5-train list dump (rule 12 violate) |
| **B** ASR→Delhi sabse fast | ✅ JOURNEY_ANALYZE → Delhi ambiguous → 6 station options poochhe | ⚠️ **Khud NDLS chun liya** (rule 11 violate), 47s | ✅ options poochhe (server relay) |
| **C** 12014 CC availability+fare | ✅ CHECK_AVAILABILITY (server ne fare bhi de diya) — "NOT_AVAILABLE, ₹1125" | ❌ **60s TIMEOUT, koi reply nahi** | ✅ 2.7s, sahi jawab |
| **D** 12014 vs 14542 Ludhiana | ✅ GET_TIMETABLE×2 → "12014 06:57 vs 14542 07:12, 12014 jaldi" | ✅ sahi (49s) | ❌ **JOURNEY_ANALYZE(Ludhiana→Ludhiana)** → SEARCH_TRAINS(LDH→LDH)×2 → WEB_SEARCH×2 → garbage. Tool-plan hi galat. |
| **E** 12014 abhi kahan | ✅ TRACK_TRAIN, 5s | ✅ 25s | ✅ 13.5s |
| **F** date missing | ✅ "Kis date ko jaana hai?" 1.2s | ⚠️ ungrounded → fallback text | ❌ **Aaj ki date silently assume karke search kar di** (rule 5 violate — yeh sabse bada red flag hai) |
| **G** aaj ASR→LDH | ⚠️ ungrounded_numbers (ISM) → honest fallback (retry par pass hota hai) | ✅ 53s | ✅ 39s |
| **H** "bhai kal amritsar se delhi sabse jaldi" | ✅ Delhi options poochhe | ❌ 51s, ungrounded → fallback | ⚠️ khud NDLS pick, par jawab sahi |
| **I** ASR→Delhi (ambiguous) | ✅ pehle date poochhi (rule 5 = date first) | ❌ **HTTP 502** | ❌ "Amritsar: 2 stations, Delhi: 14 stations" — bas, na options na sawaal |
| **J** RAC vs WL | ✅ KB-grounded, sahi | ❌ **"Here's a thinking process: 1. Analyze User Input…"** user ko dikha | ✅ KB-grounded, sahi |
| **K** weird NL (Delhi shaam tak) | ✅ origin+date poochha (sahi — origin diya hi nahi tha) | ❌ thinking-text leak | ⚠️ 6 tool calls (Delhi→Delhi, ANVT→NDLS, DEC→NDLS…) step budget khatam, 62s |
| **L** multi-turn "Kal" | ✅ SEARCH_TRAINS ASR→NDLS kal, 4 trains, 6.8s | ❌ "here=here, here=here…" garbage | ❌ "**Amritsar (for help)" truncated |

---

## 4. Verdict

### GPT-OSS-20B (abhi primary) — **RAKHO**
- Sabse tez (2.6s p50 per call), sabse stable (0 timeout/5xx), rules follow karta hai (date pehle poochho, Delhi khud mat chuno, list dump mat karo).
- Do hi kamzori: (G) kabhi-kabhi ungrounded token → honest fallback; (A) reply mein extra trains list (grounding pass karti hai, par lambi).

### Lightning thinking=ON — **NAHI (kahin bhi nahi)**
- 17.5s p50 per call = turn 38s — Vercel 30s wall/turn budget ke andar multi-step fit hi nahi hota.
- Reasoning text (`reasoning_content`) ko jab `content` khali ho to code `msg.content ?? msg.reasoning_content` uthata hai → **"Here's a thinking process…" user ko dikh jaata hai**. Yeh prod mein embarrassing hai.
- 1 timeout + 1 HTTP 502 + 1 garbage loop in 12 turns.

### Lightning thinking=OFF — **sirf FALLBACK ke liye OK, primary NAHI**
- Speed theek (4.7s p50) aur simple queries sahi.
- Par **planning kamzor**: origin=destination wale args, WEB_SEARCH par bhaagna, date assume karna, station options relay na karna, over-calling (28 calls vs 13). Yeh sab GPT-OSS nahi karta.
- Fallback ke roop mein value: NVIDIA NIM par hai (HF GLM se alag endpoint nahi, par alag model), 1s ping — GPT-OSS down ho to simple queries bach jaayengi.

### Recommended chain (agar approve karo — abhi apply NAHI kiya)
```
NVIDIA_MODEL=openai/gpt-oss-20b                              # primary (unchanged)
NVIDIA_FALLBACK_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b  # naya: NIM par 2nd chance
NEMOTRON_THINKING=off                                        # zaroori — warna thinking leak
HF_MODEL=zai-org/GLM-5.3-Flash                               # 3rd: cross-provider (unchanged)
```
Chain: GPT-OSS → Lightning(OFF) → GLM. Per-model 8s reserve stagger already hai (Round-13), to dead primary fallback ko nahi maarega.

---

## 5. Prod agentic health (verify kiya @ 16:25 IST)

| Query | engine | model | ms |
|---|---|---|---|
| "hello ji kaise ho" | `agentic_tool_calling` ✅ | gpt-oss-20b | 25.9s (Render cold start) |
| "12014 aur 14542 mein kaunsi Ludhiana jaldi" | `deterministic` (arrival-at-station fast-path, expected) | — | 1.8s |
| "RAC aur WL mein kya difference" | `agentic_tool_calling` ✅ | gpt-oss-20b | 13.5s |
| `/api/ai-ping` | ok, 1133ms | gpt-oss-20b | |

**Agentic ZINDA hai.** Par ek prod issue mila jo AI ka nahi, data ka hai:

> ⚠️ **`/api/health` → `railcore: blocked, reason: railcore_credits_exhausted`** — prod abhi purani RailCore key par hai jiske credits khatam. Sab data RailKit fallback se aa raha (aur schedule confirmtkt scrape se). **Nayi key Render env mein daalni padegi** — yeh deploy nahi, sirf env var change + restart hai. Tumhari haan ke baad karunga.

---

## 6. Code changes (local only, uncommitted)

| File | Change | Risk |
|---|---|---|
| `server/agent/agentic.ts` | +5 lines: `NEMOTRON_THINKING=off` → `chat_template_kwargs.enable_thinking=false` sirf `nvidia/nemotron*` models par. Env unset = zero behaviour change. | none (opt-in) |
| `scripts/lightning-benchmark.mts` | Har leg `AGENTIC_MODEL` pin, `lightning-nothink`/`deepseek` legs, snake_case arg check | bench only |
| `.env` | NVIDIA + RailCore nayi keys | local only |
| Tests | **545/545 pass** | |

Artifacts: `bench-gptoss-r14.json`, `bench-lightning-think-on-r14.json`, `bench-lightning-think-off-r14.json`.

---

## 7. Follow-up jo main suggest karta hoon (tumhari approval par)

1. **Render env: `RAILCORE_API_KEY` nayi key** — prod data quality turant sudhregi (abhi credits-exhausted block hai). Restart ke alawa kuch nahi.
2. **Render env: `NVIDIA_API_KEY` nayi key** — agar purani key bhi rotate karni hai.
3. **`reasoning_content` leak guard** — agentic.ts line ~1897 `msg.content ?? msg.reasoning_content` ko sirf tab use karo jab content genuinely khali ho AUR text "thinking process" jaisa na ho. Chhota fix, Lightning ya kisi bhi thinking-model ko chain mein daalne se pehle zaroori.
4. Fallback chain mein Lightning(OFF) add karna — optional, section 4 dekho.

**Abhi kuch push/deploy nahi hua. Bolo kya karna hai.**
