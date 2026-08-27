# RailCore vs RailKit — capability report

**Date:** 2026-08-22  
**Deployment:** NOT DONE  
**NVIDIA:** unchanged (`openai/gpt-oss-20b` @ `https://integrate.api.nvidia.com/v1`)  
**RailKit:** still in the app, still default provider  
**RailCore:** new adapter only (`server/railway/railcore.ts`)  
**Keys:** server-side only; not printed here

RailCore docs used: [https://railcore.tech/docs](https://railcore.tech/docs)  
Base URL: `https://ir.railcore.tech/v1`  
Auth header: `X-RailCore-Key`

---

## Scorecard

| Capability | RailKit | RailCore |
| --- | --- | --- |
| Authentication | PASS | **PASS** (HTTP 200 on live `/stations/search`) |
| Station lookup | FAIL / UNAVAILABLE (no documented method) | **PASS** |
| Train search | PASS | **PASS** |
| Train information | PASS | **PASS** |
| Timetable | PASS | **PASS** |
| Live status | Mixed (often IRCTC error; today 12014 worked) | **PASS** (same train/date) |
| Availability | PASS (forecast snapshot) | **PASS** (numbers differ) |
| Fare | PASS | **PASS** (numbers differ) |
| PNR | NOT TESTABLE (no authorized test PNR) | **NOT TESTABLE** — **no documented PNR route** |
| Cancellation (cancelled trains) | PASS (`cancelList`) | **NOT AVAILABLE** — no documented cancelled-trains route |

---

## 1. RailCore authentication

Real request: `GET /v1/stations/search?q=Jammu` with server-side key.

- HTTP **200**
- latency **~1864 ms**
- `success: true` + station results

**RailCore authentication: PASS**

Not assumed from env existence.

---

## 2. Station lookup (high priority)

Documented: `GET /v1/stations/search?q=&limit=`

| Query | First result (actual API) |
| --- | --- |
| Jammu | **JAT** JAMMU TAWI |
| Beas | **BEAS** BEAS |
| Ludhiana | **LDH** LUDHIANA JN |
| Amritsar | **ASR** AMRITSAR JN |
| Delhi | **DLI** DELHI (not NDLS first) |
| Kochi | **KFX** KOCHEWAHI first — **not ERS** |

**Jammu se Beas:** first hits are **JAT** and **BEAS** from live RailCore search. Not hardcoded.

Kochi city alias is weak on RailCore’s first page of results. Honest: lookup API works; ranking for some aliases is imperfect.

**Station lookup: PASS**

---

## 3. Train search — Amritsar → Ludhiana · 2026-08-23

Documented: `GET /v1/routes/trains?from=ASR&to=LDH&date=2026-08-23`

- HTTP 200, **22 trains**, **~1329 ms**, not mock

Sample (RailCore):

| No. | Name | Dep | Arr | Dur |
| --- | --- | --- | --- | --- |
| 12014 | AMRITSAR SHTABDI | 04:55 | 06:57 | 122 min |
| 14542 | ASR CDG EXP | 05:10 | 07:12 | 122 min |
| 12716 | SACHKHAND EXP | 05:30 | 07:35 | 125 min |

RailKit same route/date previously returned **32 trains** (includes more services such as 19326). Counts differ; both are live provider lists, not invented.

**Train search: PASS**

---

## 4. Live status — same train 12014 · 2026-08-22

### RailCore `GET /v1/trains/12014/live?date=2026-08-22` (~574 ms)

- status: **COMPLETED** / Journey completed  
- current: **New Delhi (NDLS)**  
- delay: **6 min**  
- last update: **2026-08-22T11:08:00+05:30**  
- next station: none (journey done)  
- source field on current stop: `ixigo` (RailCore provenance)

### RailKit `trackTrain("12014","22-08-2026")` (~1328 ms)

- statusNote: **Arrived at NEW DELHI(NDLS) at 11:08 22-Aug (Delay: 00:06)**  
- current: **NDLS**  
- lastUpdate: **22-Aug-2026 11:08**  
- delay: **6 min**

Same train, same day: **both agree** NDLS + 6 min late.  
RailCore was more reliable historically in this project (12054 still failed on RailKit IRCTC error). Today 12014 worked on both.

**Live status: PASS** (RailCore). RailKit: **PASS on this sample**, still **FAIL on some trains**.

---

## 5. Availability — 12014 ASR→LDH · 2026-08-23 · CC · GN

| | RailCore | RailKit |
| --- | --- | --- |
| Status | AVAILABLE | AVAILABLE |
| Seats | **570** (`AVAILABLE-0570`) | **489** (`AVL 489`) |
| Railway fare in payload | total **₹510** (fare 490 + catering 20) | **₹480** |
| last_updated | 2026-08-21T09:26:59+05:30 | calendar snapshot |

Neither is claimed as official IRCTC live counter. **Do not treat as identical.**

**Availability: PASS** (real API; numbers differ)

---

## 6. Fare — 12014 ASR→LDH · CC

| | RailCore `/fares/estimate` | RailKit `fareLookup` |
| --- | --- | --- |
| Railway fare | **₹510** | **₹480** (base 269 + extras = 480) |
| Service fee | **not** included (RailBook adds separately) | same |

**Fare: PASS**

---

## 7. Train info / timetable — 12014

RailCore `GET /trains/12014`: AMRITSAR SHTABDI, ASR→NDLS, daily.  
RailCore schedule: 8 stops, 367 min full run, classes CC/EC.  
RailKit `getTrainInfo`: same name + route payload.

**Train info: PASS**  
**Timetable: PASS**

---

## 8. PNR / cancelled trains

- **PNR:** no documented RailCore PNR path in the 32-operation map. Undocumented `/pnr/…` → `endpoint not found`. **NOT TESTABLE** (no fake PNR used to declare broken).
- **Cancelled trains:** no documented list endpoint. Undocumented `/trains/cancelled` is not a cancel-list API. **NOT AVAILABLE**.

RailKit still has `cancelList` and `checkPNRStatus`.

---

## 9. NVIDIA / date / multi-turn

Unchanged.

- “Mujhe Jammu se Beas jaana hai” → date missing → **Kab jaana hai?** (no silent today search)
- “22 August ke liye 2 ticket” → Amritsar se → Ludhiana → date **2026-08-22**, pax **2**, date not re-asked

Architecture: User → NVIDIA slots → state machine → RailKit **or** RailCore facts → UI.

---

## 10. Code

- `server/railway/railcore.ts` — REST adapter, logs `{ railwayProvider, railwayMethod, railwayLatencyMs, railwaySuccess }` only  
- `RAILWAY_PROVIDER=railcore` optional; **default remains railkit**  
- Booking still **MOCK**  
- `.env` has `RAILCORE_API_KEY` (gitignored)

---

## Final checklist

RailCore authentication: **PASS**  
Station lookup: **PASS**  
Jammu → Beas: **PASS**  
Train search: **PASS**  
Live status: **PASS**  
Availability: **PASS**  
Fare: **PASS**  
Train info: **PASS**  
Timetable: **PASS**  
PNR: **NOT TESTABLE**  
Cancellation: **NOT AVAILABLE**  
RailKit comparison: **PASS** (both exercised; seats/fares differ)  
NVIDIA: **PASS**  
Real API data: **YES**  
Mock data: **NO** (evaluation calls)  
Deployment: **NOT DONE**
