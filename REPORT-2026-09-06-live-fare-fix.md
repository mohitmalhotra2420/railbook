# RailBook — Live Status / Fare / Availability API Fix Report
**Date:** 2026-09-06 | **User report:** "API se live status ya fare nahi mil raha" | **Deploy:** LIVE (Render) | **Tests:** 466/466 ✓

---

## User ka report SAHI tha — teeno fail ho rahe the. Ab sab FIXED (prod verified).

| Sawaal | Pehle (prod) | Ab (prod) |
|---|---|---|
| "12014 ki live status" | "Live status abhi railway provider se available nahi ho pa raha" | ✅ **"12014 Amritsar Shtabdi — Journey completed, last New Delhi, delay 8 min"** |
| "12014 ki CC fare" | "Fare abhi available nahi hai" | ✅ **"ticket ₹1125, service ₹50, total ₹1175"** |
| "12014 ki CC availability" | "Availability unavailable." | ✅ **"NOT_AVAILABLE · ₹1125"** (train aaj depart ho chuki — honest) |

---

## Root Causes (3 alag bugs — live debugging se pakde)

### 1. Live Status — RailCore ne API contract badla
- `/trains/{n}/live` ab **`date` query REQUIRED** hai — bina date ke 400 aata tha
- Humara code user ki date na hone par bina date call karta tha
- Fallback `/running` 200 deta hai **per poore naye format mein** (`pd.trainCurrentPosition.*`) — purana parser usse samajh nahi paata → unusable → RailKit (quota khatam) → "both_failed"
- **Fix:** date default = aaj (IST) + naya `mapRunningPayload` parser (currentPosition/lastStationName/lastUpdatedOn/nextPTTStation)

### 2. Fare — messaging bug (API theek tha, message galat tha!)
- User "12014 ki CC fare" poochta → deterministic path mein stations missing → executeTool ka helpful "Train, date, stations chahiye" message → **run.ts usse generic "Fare abhi available nahi hai" se OVERWRITE kar deta tha!**
- Isliye user ko lagta tha fare API se hi nahi aa raha
- **Fix (a):** fail par bhi executeTool ka actual (actionable) summary — generic overwrite sirf fallback
- **Fix (b):** fare/availability mein stations missing + train number ho → **timetable se first/last stop auto-resolve** (agentic path jaisa) — ab "12014 ki fare" akele se bhi ASR→NDLS fare aata hai
- RailCore fare (GET `/fares/estimate`) theek-thaak kaam karta hai — ₹1125 live verify
- RailKit fallback ka monthly quota khatam hai (10000/10000, reset ~20 Sep) — ab fail hone par **honest reason** user ko dikhta hai (`unavailableReason`)

### 3. Availability — "TRAIN_DEPARTED" status parser mein tha hi nahi
- RailCore 200 ke saath `status: "TRAIN_DEPARTED"` bhejta tha
- `parseAvail()` usse UNKNOWN bana deta → "unusable" → RailKit (quota) → fail
- **Fix:** TRAIN_DEPARTED / CANCELLED / CHART_PREPARED / REGRET → NOT_AVAILABLE (us class mein ab booking nahi hoti — honest)

---

## Commits (is round)
1. `0b45a5c` — live date-default + /running parser + fare unavailableReason
2. `fix` — deterministic fare auto-route + fail-summary preserve (factReplyUnavailable overwrite bug)
3. `fix` — availability TRAIN_DEPARTED etc. statuses

## Verification (prod, live)
- Live: 12014 "Journey completed, delay 8 min" ✓
- Fare: 12014 CC ₹1125 ✓ (aur 12951 3A ₹3165 ✓)
- Availability: 12014 CC NOT_AVAILABLE · ₹1125 ✓, 12951 3A NOT_AVAILABLE · ₹3165 ✓
- RailCore endpoints live-test: `/live?date=` ✓, `/running` ✓, `/availability/seats` ✓, `/fares/estimate` (GET) ✓

## Known
- RailKit ka billing-cycle quota khatam (reset ~20 Sep) — RailCore primary sab de raha hai, quota wale paths ab honest reason ke saath fail hote hain
- Zip: `railbook-live-fare-fix.zip` (212 files)
