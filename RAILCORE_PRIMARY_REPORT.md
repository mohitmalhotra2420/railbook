# RailCore primary + RailKit fallback — scorecard

**Date:** 2026-08-22  
**Deployment:** NOT DONE  
**Booking:** still DEMO/MOCK (`mock: true`, PNR `MOCK…`)  
**NVIDIA:** unchanged (`openai/gpt-oss-20b`, `https://integrate.api.nvidia.com/v1`, `reasoning_effort=low`, `max_tokens=768`, JSON object, 7s timeout)

Architecture now:

```
User → NVIDIA (NLU only)
     → RailCore station lookup (ranked)
     → RailCore railway data
     → RailKit fallback on HTTP error / success:false / timeout / unusable payload
     → RailKit-only: PNR + cancelled-train list
```

Default `RAILWAY_PROVIDER=railcore`. RailKit is **not** removed. Logs use `railwayProvider=railcore` or `railwayProvider=railkit_fallback`. Keys never logged.

---

## Scorecard

| Check | Result |
| --- | --- |
| RailCore primary | **PASS** |
| RailKit fallback | **PASS** |
| Station lookup | **PASS** |
| Jammu → Beas | **PASS** (JAT, BEAS from live RailCore search) |
| Train search | **PASS** (ASR→LDH 2026-08-23: **22 trains**, 12014 04:55→06:57) |
| Live status | **PASS** (12014 2026-08-22: Journey completed, New Delhi, delay 6, provider `railcore`) |
| Availability | **PASS** (12014 CC: AVAILABLE, **570** seats, railway fare **₹510**) |
| Fare | **PASS** (₹510 + service fee ₹25 = ₹535; fees not merged) |
| Train info | **PASS** (AMRITSAR SHTABDI via RailCore) |
| Timetable | **PASS** (8 stops via RailCore) |
| PNR via RailKit | **PASS** (RailCore PNR never called; dummy PNR not invented) |
| Cancellation via RailKit | **PASS** (fully 15 / partial 45) |
| RailCore failure → RailKit fallback | **PASS** (forced down: search 32 trains + live 12014 via `railkit_fallback`) |
| Kochi ranking protection | **PASS** (KFX not selected; empty/ask instead of first-hit) |
| Multi-station handling | **PASS** (Delhi `needChoice=true`, name + code chips) |
| NVIDIA | **PASS** (defaults unchanged; NLU does not invent railway facts) |
| Tests | **202/202** |
| Build | **PASS** |
| Real API data | **YES** |
| Mock data | **NO** (search/live/avail/fare/cancel from live providers) |
| Deployment | **NOT DONE** |

---

## Live smoke (real credentials, no secrets printed)

- **A. Jammu / Beas:** RailCore `stations/search` → **JAT** (JAMMU TAWI), **BEAS**. Not hardcoded.
- **B. Amritsar → Ludhiana:** RailCore `routes/trains` → 22 trains including **12014 AMRITSAR SHTABDI 04:55–06:57**.
- **C. Live 12014:** RailCore `/trains/12014/live` → completed at New Delhi, delay 6 min.
- **D. Forced RailCore failure:** RailKit served search (32 trains) and live (`Arrived NEW DELHI(NDLS) 11:08 Delay 00:06`). Log: `railkit_fallback`.
- **E. PNR:** RailKit only. Dummy `1234567890` → proper unavailable (no invented chart/status).
- **F. Cancelled:** RailKit `cancelList` → 15 fully / 45 partial.

## Behaviour kept

- Missing date: “Kab jaana hai?” — never silent today.
- Multi-turn date/pax persist.
- Both providers down → empty / 404 / UNKNOWN, never invented trains, fares, seats, live, PNR, or cancellations.
- Successful empty RailCore search is **not** merged with RailKit (no duplicate lists).

## Notes

- RailCore still has **no PNR** and **no cancelled-train list** — those stay RailKit-only.
- Kochi: live RailCore first hit is still KFX KOCHEWAHI; we **reject** it and ask instead of mapping ERS.
- Delhi: user is asked “Delhi mein kaunsa station?” with real RailCore hits (not a random first code).
- Seat/fare numbers are provider snapshots, not IRCTC live counters.
- Keys were previously pasted in chat — rotate when you can.
- **Not deployed.** Production is unchanged until you ask.
