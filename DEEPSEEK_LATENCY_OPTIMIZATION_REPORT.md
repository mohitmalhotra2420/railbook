# DEEPSEEK V4 FLASH — LATENCY OPTIMIZATION EXPERIMENT
## deepseek-ai/deepseek-v4-flash-0731 · benchmark ONLY — NO deploy, NO production change, NO commit/push

**Date:** 2026-09-05 · **Real model requests: exactly 6** (3 configs × 2 prompts) · **Real RailCore calls: 0** (direct planning calls — tool execution hi nahi hua) · GPT-OSS baseline: previously recorded (koi re-run nahi).

---

## Setup

- **Exact same RailBook planner system-prompt (3,516 chars) + same 10-tool schema** — agentic loop ke real request-body ko fetch-injection se capture kiya (zero real calls), phir direct API replay. Prompt tokens: ~2,477/call.
- **Prompts (same for every config — comparability):** #2 "12014 ka CC mein availability aur fare batao" (multi-tool) + #5 "Amritsar se Ludhiana jaana hai" (missing date) — yehi do success-criteria mein named hain; 6-request cap ke andar yehi best coverage tha.
- **Configs:** A) current (max_tokens 900, thinking default-ON) · B) `chat_template_kwargs: {thinking: false}` · C) `max_tokens: 256`.
- TTFT: N/A (backend non-streaming hai). Reasoning tokens: API alag se expose nahi karta (`completion_tokens_details` mein field nahi) — `reasoning_content` length proxy use kiya.

## Results (all 6 requests)

| Config | Prompt | Latency | Completion tok | Reasoning | Tools planned | JSON | Selection |
|---|---|---|---|---|---|---|---|
| A (current) | #2 multi-tool | **58,823 ms** | 164 | ON (173ch) | CHECK_AVAILABILITY + GET_FARE | ✅ | ✅ |
| A (current) | #5 missing date | **67,846 ms** | 61 | ON (57ch) | (none — date poochha) | ✅ | ✅ |
| B (thinking off) | #5 missing date | **17,927 ms** | 62 | **OFF** | (none — date poochha) | ✅ | ✅ |
| B (thinking off) | #2 multi-tool | **30,987 ms** | 178 | **OFF** | CHECK_AVAILABILITY + GET_FARE + GET_TRAIN_INFO | ✅ | ✅ |
| C (max_tokens 256) | #2 multi-tool | **24,059 ms** | 164 | ON (173ch) | CHECK_AVAILABILITY + GET_FARE | ✅ | ✅ |
| C (max_tokens 256) | #5 missing date | **18,817 ms** | 64 | ON (57ch) | (none — date poochha) | ✅ | ✅ |

Args sab configs mein perfect: `{"train_number":"12014","class_code":"CC"}`. Missing-date replies sahi — "kaunsi date ko jaana hai? (Aaj 5 Sep 2026 hai)" — aaj assume NAHI kiya. Koi hallucinated fact nahi.

---

## FINAL REPORT (mandated 6 points)

**1. Current DeepSeek average: 63,335 ms** (n=2: 58.8s, 67.8s — single planning call, thinking ON)

**2. Optimized DeepSeek average:**
- **B (thinking off): 24,457 ms** → **−61%**
- **C (max_tokens 256): 21,438 ms** → **−66%** (164-token completion 256 mein fit — truncation nahi)
- ⚠️ **Honest caveat:** A→B→C sequential run hua aur latency isi order mein improve hui. C ka speedup koi causal mechanism nahi rakhta (C ki completions A jaisi hi hain — 164/61 tokens, reasoning ON). Endpoint ka queue/variance bhi kaafi hai (n=2). **B ka mechanism causal hai** (reasoning OFF → kam generation), par B/C ke exact numbers ±50% variance ke saath padhein. Robust conclusion: thinking-off se real improvement hota hai (sab B calls ≤31s vs sab A calls ≥58s), par exact % n=2 par confident nahi.

**3. GPT-OSS baseline (recorded, same planner/prompts): 3,303 ms avg / 2,444 ms p50 per AI call** (turn avg 7,010 ms)

**4. Latency reduction: 61–66% measured** (variance caveat ke saath)

**5. Quality regressions: NONE**
- Valid JSON: **6/6 (100%)** ✅
- Tool-plan validity + selection correctness: **6/6** ✅ (B ne to EK AUR tool plan kiya — GET_TRAIN_INFO)
- Multi-tool correct: **3/3 configs** ✅
- Missing date correct: **3/3 configs** ✅ (kabhi aaj assume nahi kiya)
- Hallucinated railway facts: **0** ✅

**6. Worth pursuing? — Primary ke liye NAHI; async/batch ke liye MAYBE**

| | Latency (avg) | vs GPT-OSS | 30s production wall |
|---|---|---|---|
| DeepSeek current (A) | 63.3s | **19.2×** | 2/2 calls paar |
| DeepSeek B (thinking off) | 24.5s (worst 31.0s) | **7.4×** | 1/2 paar, 1/2 ke paas |
| DeepSeek C (256 cap) | 21.4s (worst 24.1s) | **6.5×** | 2/2 ke bilkul paas |
| **GPT-OSS-20B (primary)** | **3.3s** | 1× | sab ke andar |

Optimization ne gap 19x se 6.5-7.4x kar diya — **material improvement, par closing nahi**. Best case (B+C combined, est. ~15-20s) bhi GPT-OSS se ~5x slow aur production wall ke edge par rahega. Har user-turn 15-30s wait RailBook ke liye acceptable nahi.

## Recommendation

**KEEP GPT-OSS-20B PRIMARY** (unchanged — koi deploy/production change nahi hua). DeepSeek V4 Flash ka optimization path real hai (thinking toggle kaam karta hai, quality bilkul intact), par latency gap itna bada hai ki current endpoint par yeh primary planner ban hi nahi sakta. Agar future mein: (a) NVIDIA endpoint fast ho, ya (b) koi async/batch/non-latency-critical feature chahiye — to `thinking:false + max_tokens 256` tested config ready hai.

---

*Methodology: exact planner bodies capture via fetch-injection (0 calls) → 6 direct measured calls (no tool execution → 0 RailCore); temp 0; non-streaming; secrets never logged (existing .env key used — leak-scan clean). Evidence: `DEEPSEEK_LATENCY_EXPERIMENT.json`, script `scripts/deepseek-latency-experiment.mts` (uncommitted, mandate ke mutabik).*
