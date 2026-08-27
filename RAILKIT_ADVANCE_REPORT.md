# RailKit Advance — capability report

**Date:** 2026-08-22  
**Deployed:** no (not deployed; review this report first)  
**Railway provider:** RailKit only  
**NLU:** NVIDIA `openai/gpt-oss-20b` @ `https://integrate.api.nvidia.com/v1`  
**Credential:** server-side `RAILKIT_API_KEY` only (not printed, not in frontend, not in git)

---

## Scorecard

| Check | Result |
| --- | --- |
| RailKit Advance authentication | **PASS** |
| Plan-level API access | **PASS** |
| Station lookup | **UNAVAILABLE** |
| Train search | **PASS** |
| Train information | **PASS** |
| Timetable | **PASS** |
| Live status | **PASS** |
| Availability | **PASS** |
| Fare | **PASS** |
| PNR | **NOT TESTABLE** |
| Cancelled trains | **PASS** |
| RailRadar runtime calls | **0** |
| NVIDIA GPT-OSS-20B | **PASS** |
| Tests | **160/160 passed** |
| Build | **PASS** |
| Real train search (ASR → LDH) | **PASS** |
| Actual booking API | **NOT AVAILABLE** |

---

## 1. Authentication / Advance plan

Authenticated with the **current server-side RailKit key** (same `railkit_` credential already in `.env`; not echoed).

This is **not** assumed from payment. Live SDK calls returned `success: true` on methods that previously failed on the free plan (availability, fare, live tracking, station board, cancel list).

Advance plan observed behaviour matches docs: **10k req/month**, SDK + REST access. **Still no station-search method.**

---

## 2. Feature results (documented SDK only)

No invented methods or URLs. Used only:

`configure`, `searchTrainBetweenStations`, `getTrainInfo`, `trackTrain`, `getAvailability`, `fareLookup`, `liveAtStation`, `cancelList`, `getTrainHistory`, `checkPNRStatus` (not live-tested).

### Station lookup — UNAVAILABLE

RailKit has **no city/station search API**.

| Query | Result |
| --- | --- |
| Ludhiana | Local catalog **LDH** |
| Kochi | Local alias **ERS** (Ernakulam Jn) |
| Amritsar | Local catalog **ASR** |
| Delhi | Local catalog **NDLS / DLI / NZM** |

Hardcoded aliases were **kept** because RailKit still cannot resolve city names. Unresolved names stay placeholders; we do **not** invent codes.

`liveAtStation("LDH")` **does** work (station **board**, not name search): 12 trains in next 2 hours.

### Train search — PASS (real, not mock)

**Amritsar → Ludhiana** · `23-08-2026` · `searchTrainBetweenStations("ASR","LDH","23-08-2026")`

- `success: true`
- **32 trains**
- latency **~810 ms**
- `mock: false`

Sample (API fields, not invented):

| No. | Name | Dep | Arr |
| --- | --- | --- | --- |
| 19326 | ASR INDB EXP | 01:50 | 04:15 |
| 12204 | SHC GARIB RATH | 04:00 | 06:20 |
| 12014 | AMRITSAR SHTABDI | 04:55 | 06:57 |
| 14542 | ASR CDG EXP | 05:10 | 07:12 |
| 12716 | SACHKHAND EXP | 05:30 | 07:35 |

Honest mapping note: **19326** search row `to_stn_code` is **DDL** (Dhandari Kalan). `getTrainInfo` route confirms **19326 does not stop at LDH**. Availability for 19326 + LDH correctly failed: `not an intermediate station of train`. We keep the API codes; we do not rewrite DDL → LDH.

### Train information / timetable — PASS

`getTrainInfo("19326")` → `success: true` in **~5.3 s**  
`trainInfo` + **26-stop route** (ASR → INDB).  
Schedule API now returns those stops. No fake coach map.

### Live status — PASS (with documented date rules)

`trackTrain` **requires** `DD-MM-YYYY`. Omitting date → `Invalid date format.`  
Future date → `Date cannot be greater than today`.  
Adapter therefore sends **today (Asia/Kolkata)** when the client omits a date.

Live sample, train **12014** on **22-08-2026**:

- status: **Yet to start from its source**
- current: **AMRITSAR (ASR)**
- next: first upcoming stop from timeline
- delay: **On Time → 0** (empty lastUpdate stays `null`, not invented)

Board train **14609 Hemkunt Express** also tracked with today's date.

### Availability — PASS

Real train **12014** ASR → LDH · **23-08-2026** · quota **GN**

| Class | Status | Text | Fare (API) |
| --- | --- | --- | --- |
| CC | AVAILABLE | AVL **527** | ₹**480** |
| EC | AVAILABLE | AVL **28** | ₹**805** |

**12716 SL** same route/date: `rawStatus: NOT AVAILABLE` → UI **NOT_AVAILABLE** (not a fake waitlist).

**19326 SL ASR → DDL**: GNWL / **WL 40**.

Class chips are shown only from `getTrainInfo.classes` **or** a successful `getAvailability` probe. Search payload has no classes; we do **not** invent SL/3A. TrainBoard no longer auto-queues availability for all 32 trains (quota-safe). Refresh / train tap loads seats.

### Fare — PASS

`fareLookup("12014","ASR","LDH","23-08-2026","CC","GN")` → `success: true`

- railway **totalFare = ₹480** (base 269 + reservation 40 + superfast 45 + gst 22 + catering 20 + dynamic 81)
- **Not** the app `service_fee`
- Failed lookup → `railwayAvailable: false`; UI shows **Fare unavailable**, not ₹0 ticket fare

### PNR — NOT TESTABLE

No authorized real PNR was provided. Dummy PNR was **not** used to declare the feature dead.

**PNR endpoint not fully live-tested.**

### Cancelled trains — PASS

`cancelList()` → `success: true` · fully cancelled **6** · partial **44**.

### Booking — NOT AVAILABLE

RailKit is railway **data**, not IRCTC booking.

Confirm still issues **`MOCK…` PNR** with `mock: true`. UI keeps **Mock / demo booking**. Never presented as a real railway PNR.

---

## 3. Date + multi-turn (unchanged, still green)

**“Mujhe Amritsar se Ludhiana jaana hai”**  
origin=Amritsar, dest=Ludhiana, **date missing** → **“Bilkul. Kab jaana hai?”**  
No silent search of today.

**“Mujhe aaj Amritsar se Ludhiana jaana hai”**  
date = today → search allowed.

**“Mujhe 22 August ke liye 2 ticket chahiye” → “Amritsar se” → “Ludhiana”**  
origin=ASR, dest=LDH, date=**2026-08-22**, pax=**2**. Date is **not** asked again.

---

## 4. Safety

- RailRadar runtime files/imports: **gone**. Grep of provider/app/env/adapter/`.env.example`: **0** `RAILRADAR_` / `railradar.in`.
- NVIDIA unchanged: model **openai/gpt-oss-20b**, base **https://integrate.api.nvidia.com/v1**, `reasoning_effort=low`, `max_tokens=768`, JSON object, 7s timeout.
- Architecture: User → NVIDIA slots → state machine → RailKit facts → UI.
- Never invent trains, timings, fares, seats, delays, PNR, or live location.
- Keys stay server-side. Chat key was pasted earlier — **rotate when convenient**.

---

## 5. Tests / build

```
npm test   →  160/160 passed
npm run build  →  PASS
```

Regressions added: missing date, aaj, pax/date persist, real search payload shape, Advance availability/fare/live/timetable mapping, MOCK booking, RailRadar = 0, NVIDIA defaults, no invented trains on SDK failure.

---

## 6. Deploy

**Not deployed.** Live Vercel is still the pre-RailKit-Advance build until you review this and explicitly ask to deploy.

If you want it live next:

1. Set Vercel `RAILKIT_API_KEY` + `RAILWAY_PROVIDER=railkit`
2. Remove any leftover `RAILRADAR_*`
3. Keep NVIDIA env as-is
4. Do **not** upload `.env`
