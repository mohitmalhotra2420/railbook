# Report 2026-09-06 — Screenshot Diagnosis + NLU/UX Fixes + Live-Status Scrape Fallback

**Commit:** `7b53b5b` (main, pushed) · **Deploy:** Render LIVE @ `7b53b5b` · **Tests:** 475/475 · **tsc:** 0 server errors

---

## 1. Screenshot Diagnosis (Screenshot_20260906-115134_Google.png — 4 events)

| # | User ne kaha | AI ne kya kaha | Diagnosis |
|---|---|---|---|
| 1 | "12429 ka live status btana" | Fail | **Purane deploy ka bug** — RailCore live contract change पिछले round में fix हो चुका था (commits 0b45a5c/d8f5086)। अब prod: "On time, last Lucknow Nr, next Shahjehanpur" ✓ |
| 2 | "12054 ka live status" | Pass ✓ | ठीक था |
| 3 | "12054 ki seat availability?" | "Train, date, stations aur class chahiye." | **Bug (b) — UX**: train (12054) context में था, फिर भी सब slots माँगे। Date आज-default + stations auto-route हो सकते थे; सिर्फ class पूछना चाहिए था |
| 4 | "Date aaj ki ludhiana se hw ki" | "Kahan jaana hai? Station bataiye." | **Bug (c) — NLU slot-fill**: (i) NLU ने इसे नया SEARCH_TRAIN बनाया — जबकि ये availability follow-up का slot-answer था; (ii) **"hw" (Haridwar, 2-letter code) resolve नहीं हुआ** — `looksLikePlace()` का `q.length < 3` guard ब्लॉक करता था |

**Root cause (bug c-i)**: `legacy-nlu.ts` → `looksLikePlace()`: `if (q.length < 3) return false` — 2-letter railway codes (HW, BVI…) जाने-पहचाने stations होते हुए भी reject। (मज़ेदार बात: `matchStation("hw")` → HW Haridwar **देता है**, पर उससे पहले looksLikePlace का guard रोक देता था।)

## 2. Fixes

### Fix 1 — 2-letter station codes (bug c-ii) · `server/understand/legacy-nlu.ts`
`looksLikePlace()`: exact known station-code match (`/^[a-z]{2}$/i` + `stationByCode`) हो तो place मानो। अब "ludhiana se hw ki" → `from: LDH, to: HW` ✓

### Fix 2 — Smart slot-ask (bug b) · `server/agent/run.ts` + `server/agent/tools.ts`
- run.ts: `getAvailability`/`getFare` tool + train-in-context + class missing → **सिर्फ class पूछो**: "12054 LDH→HW 2026-09-06 ki kaunsi class — CC, EC, SL, 2A, 3A?"
- tools.ts: executeTool में date missing → **आज default** (dono availability + fare)
- Stations auto-route (पिछला fix 9d41f2d) pehle se — अब तीनों defaults मिलके class ko hi real user-ask banाते हैं

### Fix 3 — Availability/fare slot-RESUME (bug c-i) · `server/agent/run.ts`
Pichhla turn availability/fare के लिए fail (`lastToolOk=false`) + selectedTrainNumber + naya train-number text में नहीं + route/date slots aaye → **SEARCH_TRAIN को नया search नहीं, availability-continue मानो** (slots ctx में merge, class missing तो class पूछो)। फिर "CC" बोलने पर असली availability चलती है।

### Fix 4 — RailCore segment-fallback (availability) · `server/railway/railcore.ts`
**नया पाया गया**: RailCore `/availability/seats` **सिर्फ train endpoints पर** data देता है — intermediate segment (LDH→HW, train 12054 ASR→HW) पर `NOT_FOUND`। Fix: NOT_FOUND पर timetable से first/last stop निकालकर endpoints से retry + reply में **labeled**: "12054 CC: NOT_AVAILABLE · ₹650 · (LDH→HW segment ka direct data nahi — train ki ASR→HW availability)"। Fake कभी नहीं — जो segment का data नहीं, साफ लिखा है।

### Fix 5 — Live-status web-scrape fallback (user-authorized booking-critical) · `server/railway/webscrape.ts` + `router.ts`
Chain अब: **RailCore → RailKit → RailYatri SSR (web scrape)**:
- URL: `railyatri.in/live-train-status/<num>-<name-slug>` (name tolerant — approx नाम से भी सही train load होती है)
- `__NEXT_DATA__.pageProps.ltsData` — NTES-based: delay, current station, ETA, upcoming stations, "Train starts at 17:00" जैसे not-started messages
- Name-hint पहले context की selected train से (trainInfo dependency कम), वरना RailCore trainInfo
- Reply **source-labeled**: "(Source: railyatri.in — railway API se nahi, verified web site se.)"

**Scrape research (honest documentation)** — booking-critical के लिए कौन-सा source accessible है:
| Source | Live | Availability | Fare |
|---|---|---|---|
| RailYatri (SSR + internal API) | ✅ SSR `ltsData` (implemented) | ❌ client-side API auth-dependent (object-form POST से सिर्फ "From/To not found" — session/token के बिना) | ❌ |
| ConfirmTkt | ❌ 404-shell pages; api.confirmtkt.com = real ASP.NET server पर paths private | ❌ | ❌ |
| ixigo / trainspnrstatus | ❌ Render-IP 403 | ❌ | ❌ |
| RailMitra / RailRestro / eRail / TravelKhana / goibibo / indiarailinfo | ❌ 404/403/client-side | ❌ | ❌ |

**निष्कर्ष**: fare/availability के लिए अभी कोई publicly-accessible verified SSR source नहीं — वे RailCore API (primary) + RailKit (fallback) पर ही चलती हैं। Live-status के लिए RailYatri scrape implemented। सब attempts documented — कोई fake data कभी नहीं।

### "AI को poora API access" (screenshot point 2)
AI (agentic engine) के पास **पहले से ही सभी 16 API tools** हैं — TRACK_TRAIN, CHECK_AVAILABILITY, GET_FARE, GET_TIMETABLE, COACH_POSITION, PNR इत्यादि (`agentic.ts:44-76`)। ये नई बात नहीं थी — पहले round से ही है।

## 3. Prod Verification (Render @ 7b53b5b — sab PASS)

Screenshot का exact sequence, prod पर:
1. "12429 ka live status btana" → **"On time, last Lucknow Nr, next Shahjehanpur, delay 0 min"** ✓ (स्क्रीनशॉट में fail था)
2. "12054 ki seat availability?" → **"12054 ki kaunsi class — CC, EC, SL, 2A, 3A?"** ✓ (सिर्फ class)
3. "Date aaj ki ludhiana se hw ki" → **"12054 LDH→HW 2026-09-06 ki kaunsi class — CC, EC, SL, 2A, 3A?"** ✓ (hw→HW + resume; "Kahan jaana hai?" गायब)
4. "CC" → **"12054 CC: NOT_AVAILABLE · ₹650 · (LDH→HW segment ka direct data nahi — train ki ASR→HW availability)"** ✓ (आज की 12054 LDH 08:00 छूट चुकी — TRAIN_DEPARTED; segment-fallback label के साथ)

अतिरिक्त:
- "12054 ki LDH se HW ki seat availability kal ki CC mein" → **"12054 CC: WAITLIST · ₹650"** ✓ (kal ki सीधी — GNWL7/WL2)
- "12951 ka live status" → "On time, last Mumbai Central, next Borivali" ✓
- "12054 ka live status" → "Running 2 minutes late, last Hindan Cabin, next Roorkee" ✓
- Local full-chain (RailCore+RailKit force-fail): `routedLiveStatus("12054", undefined, "Hw Janshatabdi")` → provider **web_railyatri**, "At SAHARANPUR" ✓
- Scrape parser live tests: 12014 "Journey completed, delay 8" (RailCore से match); 12951/12429 "Train starts at 17:00/23:30" ✓

## 4. Tests
475/475 (9 नए): hw 2-letter code resolve · class-only ask · slot-resume 3-turn flow · segment-fallback label · RailYatri scraper parser (running/completed/not-started/honest-null) · URL slug build

## 5. Files Changed (9)
`server/understand/legacy-nlu.ts` · `server/agent/run.ts` · `server/agent/tools.ts` · `server/providers/types.ts` · `server/railway/railcore.ts` · `server/railway/router.ts` · `server/railway/webscrape.ts` · `tests/intelligence.test.ts` · `tests/webscrape-fallback.test.ts`
