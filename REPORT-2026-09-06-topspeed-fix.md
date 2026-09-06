# Report 2026-09-06 — Screenshot #3: Top-Speed Fact Flow

**Commit:** `f356115` (main, pushed) · **Deploy:** Render LIVE @ `f356115` · **Tests:** 479/479 · **Server tsc:** 0 new errors

---

## 1. Screenshot Diagnosis (Screenshot_20260906-165721_Google.png)

User: "12054 ki top speed btana" → AI ne **timetable** dikha diya (ASR→HW poora route), phir complaint par web se **"production car speed records"** (Wikipedia — गाड़ियों की नहीं, कारों की speed!) ka jawab, aur end mein "Kahan se kahan jaana hai?" — तीन अलग बग एक ही flow में:

| # | Symptom | Root cause |
|---|---|---|
| 1 | "12054 ki top speed btana" → timetable | **Agentic engine**: model ne GET_TIMETABLE tool chuna — system-prompt mein sirf soft note tha ("WEB_SEARCH pehla tool hai"), enforcement nahi. Client fallback NLU भी TRAIN_SCHEDULE intent देता है (train number milne par) |
| 2 | Web se "production car speed records" | **run.ts GENERAL_FACT web fallback**: pehla web result **unfiltered** chala jata tha — query "Hw Janshatabdi 12054 top speed" pe Wikipedia search generic "top speed" results de deta hai |
| 3 | Timeout par khali jawab → "Kahan se kahan jaana hai?" | webSearch timeout/0-results par reply **null** reh jaata tha → UI client-fallthrough (planTurn NONE intent) → "Kahan se kahan jaana hai?" |

## 2. Fixes

### Fix 1 — Agentic HARD tool-guard · `server/agent/agentic.ts`
General-fact sawaal (`GENERAL_FACT_RE`: top speed/kitni tez/kab chalu/history/kitne coach/engine ka naam) par railway data tools (GET_TIMETABLE/TRACK_TRAIN/GET_FARE/…) **hard reject** — sirf WEB_SEARCH + GET_TRAIN_INFO + TRAIN_NAME_SEARCH + GENERAL_RAILWAY_ANSWER allowed. Reject par model ko message milta hai: "ye general-fact hai, WEB_SEARCH use karo (train ka naam + number + fact)".

### Fix 2 — Railway-relevance filter · `server/agent/run.ts`
Web results ab filter hote hain:
- Reject: "may refer to:", aur title+snippet mein `production cars / street-legal / automobile / motorcycle / aircraft…` jaise non-railway words
- Accept: `train / rail / railway / express / locomotive / shatabdi / vande bharat / km/h / kmph / coach…` context hone par
- Relevant result → "Web se mila: … (Source: …)" (labeled, pehle jaisa)

### Fix 3 — Reply kabhi EMPTY nahi · `server/agent/run.ts`
Web timeout / 0 results / sab-irrelevant par honest denial: **"Train 12054 ki top speed ka reliable jawab web se abhi nahi mil paya — main railway ke verified data ke bina guess nahi karunga."** — UI fallthrough ("Kahan se kahan jaana hai?") root-cause fix.

### Fix 4 — Client fallback guard · `src/ai/orchestrate.ts`
TRAIN_SCHEDULE intent + train number + fact-words (top speed/history/…) → timetable block **nahi** — honest fact redirect (ye path sirf server-fail par chalta hai).

## 3. Prod Verification (Render @ f356115)

| Test | Result |
|---|---|
| "12054 ki top speed btana" | **"Train 12054 ki top speed ka reliable jawab web se abhi nahi mil paya — main railway ke verified data ke bina guess nahi karunga."** ✓ (na timetable, na car-records, na EMPTY) |
| "Maine to top speed poochi hai lekin" (complaint) | Wahi honest fact-reply ✓ — **"Kahan se kahan jaana hai?" गायब** |
| "gatimaan ki top speed kitni hai" (positive case) | **"Web se mila: As of 2026, India has no operational high-speed rail lines… highest speed is achieved by the Bhopal Shatabdi Express, Gatiman Express…"** ✓ (railway-relevant Wikipedia, source-labeled) |

## 4. Tests
479/479 (4 नए): irrelevant car-records reject · web-timeout never-empty · complaint follow-up बिना slot-ask · railway-relevant result pass (filter overreach nahi)

## 5. Files Changed (4)
`server/agent/agentic.ts` · `server/agent/run.ts` · `src/ai/orchestrate.ts` · `tests/intelligence.test.ts`
