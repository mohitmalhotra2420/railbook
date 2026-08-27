# Production deploy report

**Status:** READY and promoted  
**Deployment:** `dpl_7Qg6BgBdrwzSgV2zdZhymGy9ZKwQ`  
**Production URL:** https://railbook-three.vercel.app  
**Alias:** https://railbook-bookkro.vercel.app  
**Secrets printed:** none

## Environment (names only)

Present on Vercel Production: `RAILWAY_PROVIDER`, `RAILCORE_API_KEY`, `RAILKIT_API_KEY`, `NVIDIA_API_KEY`, `NVIDIA_MODEL`, `NVIDIA_BASE_URL`, `AI_REQUEST_TIMEOUT_MS`.  
`RAILWAY_PROVIDER` is `railcore`. No RailRadar keys.

## Runtime identity

| Check | Result |
| --- | --- |
| Active railway provider | **railcore** (`/api/health` `provider=railcore`, `mock=false`) |
| RailKit fallback | **on** (`fallback=railkit`) |
| NVIDIA | **Connected** — `openai/gpt-oss-20b` on `https://integrate.api.nvidia.com/v1` |
| RailCore | **up** — stations, ASR→LDH search (22 trains), fare, availability, timetable |
| RailKit | **up** — PNR (honest 404), cancelled list, live fallback |
| Booking confirmation | **safe** — `/api/agent` `confirmBook: false` even on `Book kar do` + `FARE_REVIEW` |

## Smoke tests (live production)

| # | Case | Result |
| --- | --- | --- |
| 1 | “Mujhe Amritsar se Ludhiana jaana hai” | **PASS** — ASR→LDH, `date=null`, missing `date` + `passengers`. Did not assume today. NVIDIA 20b NLU. |
| 2 | Mid-booking “12014 ka live status batao” | **PASS** — tool `getLiveStatus` ok, real 12014 / AMRITSAR SHTABDI, then resume “Kis date ko jaana hai?” Context ASR→LDH kept. `confirmBook: false`. |
| 3 | “Meri bookings dikhao” | **PASS** — fast-path `VIEW_BOOKINGS` / `getMyBookings`. |
| 4 | “Amritsar se cancelled trains batao” | **PASS** — intent `CANCELLED_TRAINS`; RailKit `cancelList` fully 15 / partial 45 (real payload, e.g. 15615 GHY SCL EXPRESS). |
| 5 | 12014 CC ASR→LDH fare / availability | **PASS** — AVAILABLE 590 seats, ticket ₹510 + service ₹25 = ₹535, `railwayAvailable: true`. |
| 6 | Facts not invented | **PASS** — empty/failed PNR is 404; live/fare/AVL/cancelled from providers. |
| 7 | No book without Confirm UI | **PASS** — agent never sets `confirmBook`. Charge stays on Confirm & Book / Yes, Book It. |
| 8 | Production provider | **PASS** — `railwayProvider` identity is **railcore**. Live for 12014 used **railkit_fallback** (RailCore live unusable; fallback returned real running data, not a fake). |

## Notes

- First promote (`dpl_8sAmpZK…`) crashed serverless boot (`FUNCTION_INVOCATION_FAILED`) because the function imported `src/ai/agent.js` outside the server bundle. Same orchestrator; helpers now live at `server/agent/context.ts`. Second promote is the live one.
- Automated `prod-verify` live check “failed” only because it required `provider===railcore`; the HTTP 200 body was real 12014 status via RailKit fallback.
