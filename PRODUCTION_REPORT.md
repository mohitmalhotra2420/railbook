# Production report — RailCore primary + RailKit fallback

**Deployed:** 2026-08-22  
**Deployment id:** `dpl_Hcn9ZrmtRthFfRbvfE1MLjyQzkUp`  
**State:** READY / PROMOTED  
**Aliases:** `railbook-three.vercel.app`, `railbook-bookkro.vercel.app`

Verified on the live URL after promotion. No secrets printed.

---

## Scorecard

| Item | Result |
| --- | --- |
| Deployment | **PASS** |
| Production URL | https://railbook-three.vercel.app |
| Active railway provider | **railcore** (`mock: false`, fallback `railkit`) |
| RailCore station lookup | **PASS** |
| Jammu → Beas | **PASS** (JAT / BEAS from live RailCore) |
| Train search | **PASS** (ASR→LDH 2026-08-23: 22 trains; 12014 AMRITSAR SHTABDI 04:55→06:57, 2h 02m) |
| Live status | **PASS** (12014, provider `railcore`: Journey completed, New Delhi, delay 6, last 2026-08-22T11:08 +05:30) |
| Availability | **PASS** (12014 CC: AVAILABLE, 478 seats, railway fare ₹510) |
| Fare | **PASS** (railway ₹510 + service fee ₹25 = ₹535) |
| Train information | **PASS** (Shatabdi Express) |
| Timetable | **PASS** (8 stops, provider `railcore`) |
| RailCore → RailKit fallback | **PASS** (wired: health `fallback=railkit`; cancelled + PNR served by RailKit; no RailCore PNR/cancel calls) |
| PNR via RailKit | **PASS** (dummy PNR not invented; 404 unavailable) |
| Cancelled trains via RailKit | **PASS** (provider `railkit`, fully 15 / partial 45) |
| Kochi ranking protection | **PASS** (KFX not selected) |
| NVIDIA | **PASS** (`openai/gpt-oss-20b`, NLU only) |
| Tests | **203/203** |
| Build | **PASS** |
| Real API data | **YES** |
| Mock railway data | **NO** |
| Booking | **DEMO/MOCK** — confirmation still issues `MOCK…` PNRs |

---

## Production env (names only)

Set on Vercel Production:

- `RAILWAY_PROVIDER=railcore` (was `railkit`)
- `RAILCORE_API_KEY` (created, encrypted)
- `RAILKIT_API_KEY` (kept)
- `NVIDIA_API_KEY` / `NVIDIA_BASE_URL` / `NVIDIA_MODEL` (kept)
- `AI_REQUEST_TIMEOUT_MS` (kept)

No `RAILRADAR_*`. No `NEXT_PUBLIC_*` keys. Responses and logs checked — no secrets leaked.

## Behaviour checked live

- “Amritsar se Ludhiana” without date → date missing, not assumed today. NVIDIA/NLU source `ai`.
- “23 August ko Amritsar se Ludhiana” → date `2026-08-23` kept.
- Delhi station search → `needChoice=true` with DLI / DEC / DEE / NDLS.
- Ludhiana junction ranked **LDH** ahead of DDL (Dhandari Kalan).

RailKit remains installed. PNR and cancelled-train list still RailKit-only.
