# RailBook conversational orchestrator — final report

**Date:** 2026-08-23  
**Deployed:** No (not requested)

Upgrade is incremental: NVIDIA still extracts intent/slots only; RailCore/RailKit still own facts; booking still requires FARE_REVIEW + Confirm & Book.

## What landed

- Context + follow-up tools in `src/ai/agent.ts` (`mergeAgentContext`, `classifyFollowUp`, `decideTool`, `resumeBookingLine`, `neverAutoBook`).
- Safe server tools in `server/agent/tools.ts` — existing adapters only, no invented trains/fares/AVL/live/PNR.
- `POST /api/agent` → `runAgent` (understand → tool → fact reply → interrupt/resume). Always `confirmBook: false`.
- Client `planTurn` interrupt/resume: live / cancelled / wallet / bookings / fare / availability / timetable wrap booking and resume the missing slot.
- Concierge `lookupFare` / `lookupAvailability` call real `/api/fare` and `/api/availability`.
- Bugfix: `switchIntent` now defines `wrap` so wallet/bookings/live/cancelled no longer throw `ReferenceError`.

## Architecture (unchanged constraints)

```
USER → NVIDIA (NLU / slot extract) → decide tool → RailCore/RailKit → fact reply
```

| Layer | Role |
| --- | --- |
| NVIDIA `openai/gpt-oss-20b` | Intent + slots only. `reasoning_effort=low`, `max_tokens=768`, JSON object, 7s timeout. |
| RailCore | Primary: stations, search, info, timetable, live, availability, fare. |
| RailKit | Fallback + **only** PNR + cancelled-train list. |
| Deterministic code | Wallet, money, mock booking, confirm gate. |

Booking confirmation remains **DEMO/MOCK** (`mock: true`, PNR `MOCK…`).

## Test + build

```
npm test   →  230 passed / 0 failed  (14 files)
npm run build  →  tsc -p tsconfig.server.json && vite build  OK
```

## PASS / FAIL matrix

| Area | Result | Notes |
| --- | --- | --- |
| AI orchestration | **PASS** | Follow-ups map to tools; NVIDIA is NLU only. |
| Tool calling | **PASS** | `searchStations`, `searchTrains`, `getTrainInfo`, `getTimetable`, `getLiveStatus`, `getAvailability`, `getFare`, `getCancelledTrains`, `checkPNR`, `getMyBookings`, `getWallet`. No booking tool. |
| Conversation context | **PASS** | Origin / dest / date / pax / train / stage persist; never silent-today. |
| Booking | **PASS** | Missing date → date; missing pax → tickets; full slots → search. |
| Live status | **PASS** | `12014` / `12919` / lastAsked `trainNumber` → `liveTrain`. Provider or honest fail. |
| Cancelled trains | **PASS** | Intent + RailKit `cancelList` only. |
| PNR | **PASS** | Asks PNR; RailKit lookup; no invented status. |
| Ticket history | **PASS** | `meri tickets` / `meri booking check karo` → bookings. |
| Fare | **PASS** | `lookupFare` → real fare API; no invented ₹. |
| Availability | **PASS** | `lookupAvailability` or class menu; no invented seats. |
| Station lookup | **PASS** | Ranking, Delhi chips, Kochi, Jammu→Beas, Hindi aliases. |
| RailCore primary | **PASS** | Default provider + router tests. |
| RailKit fallback | **PASS** | HTTP fail / unusable → `railkit_fallback`; PNR + cancelled stay RailKit. |
| NVIDIA 20b | **PASS** | Endpoint/model/timeout unchanged; 401/429/timeout → deterministic NLU. |
| Explicit confirm | **PASS** | `neverAutoBook` unless `FARE_REVIEW`; random “haan” does not book. |
| Hallucination protection | **PASS** | Failed tools stay UNKNOWN/empty; copy refuses to invent. |
| Hindi / Hinglish / Devanagari | **PASS** | Same slots for English / Hinglish / देवनागरी. |
| Interruption / resume | **PASS** | Mid-booking live status → `liveTrain` + `resumeAsk=date` + “continue”. |
| Tests | **PASS** | 230 / 230. |
| Production build | **PASS** | Server typecheck + Vite build. |
| Deploy | **SKIP** | Not requested. |

## Agent cases 1–24 (covered)

| # | Case | Result |
| --- | --- | --- |
| 1 | Missing date | **PASS** |
| 2 | Missing passengers | **PASS** |
| 3 | Full booking search | **PASS** |
| 4 | `kal` | **PASS** |
| 5 | `2 log` | **PASS** |
| 6 | `12014 wali` | **PASS** |
| 7 | Live interrupt + resume date | **PASS** |
| 8 | Fare mid-booking, no invent | **PASS** |
| 9 | Cancelled trains | **PASS** |
| 10 | Ticket history | **PASS** |
| 11 | PNR | **PASS** |
| 12 | Timetable | **PASS** |
| 13 | Availability | **PASS** |
| 14 | `aur koi train` | **PASS** |
| 15–17 | Hindi / Hinglish / Devanagari | **PASS** |
| 18–21 | NVIDIA 401/429/timeout + RailCore→RailKit | **PASS** (understand + router suites) |
| 22 | No hallucination copy | **PASS** |
| 23 | Explicit FARE_REVIEW confirm | **PASS** |
| 24 | Context after interrupt | **PASS** |

## Non-regression (kept)

Jammu→Beas, Kochi ranking, Delhi chips (दिल्ली कैंट / न्यू दिल्ली), timetable filter (no NDLS-only trains at DLI), SELECT_SEAT does not copy berth into passenger, gender mic does not fill name, class “3” → 3A, Coupe/Cabin voice, wallet / history / mock booking, NVIDIA params, RailCore + RailKit adapters.

## Not done (on purpose)

- No deploy.
- No second NVIDIA phrasing call (cost / latency).
- No live IRCTC booking API.
- UI not redesigned.
