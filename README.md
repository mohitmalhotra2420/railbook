# RailBook

AI-first railway booking: tell RailBook the journey in Hindi, English, or Hinglish.

**Architecture: AI-driven tool calling.** `POST /api/agent` sends the user's request to **NVIDIA GPT-OSS-20B** (`https://integrate.api.nvidia.com/v1`, `NVIDIA_MODEL`). The MODEL decides which approved tools to call — multi-step, in any order it needs:

```
USER → NVIDIA GPT-OSS-20B (understands request, SELECTS approved tools)
     → SERVER executes each tool call securely (provider keys NEVER reach the model)
     → RailCore PRIMARY → RailKit FALLBACK (every tool result carries `source`)
     → tool result returned to the model → model may chain the next tool
     → final GROUNDED response (train no./₹/seats/delay must exist in tool evidence)
```

Approved tool allowlist (nothing else can ever execute): `SEARCH_TRAINS`, `GET_TRAIN_INFO`, `GET_TIMETABLE`, `TRACK_TRAIN`, `CHECK_AVAILABILITY`, `GET_FARE`, `CHECK_PNR`, `GET_CANCELLED_TRAINS`, `GENERAL_RAILWAY_ANSWER`, `JOURNEY_ANALYZE` (Atlas journey intelligence — fastest/cheapest/earliest/best-value, alternative dates, connections — deterministic engine output the model explains). No arbitrary URLs, no invented tools; args are zod-validated and URL-bearing args are rejected.

If GPT-OSS-20B is missing, times out, errors, or goes ungrounded, the **deterministic NLU + tool-routing fallback** answers instead (architecture preserved). Booking/payment mutations (passengers, fare review, payment, confirm) NEVER reach the model — they stay in the deterministic booking engine, and `confirmBook` is always `false`. Slot extraction for `/api/understand` also runs server-side with the same NVIDIA NIM account. Per-request timeout: `AI_REQUEST_TIMEOUT_MS` (default 7000); agentic turn budget: `AI_AGENTIC_TURN_BUDGET_MS` (default 30000).

Primary UI is a travel concierge (voice + text). The only structured form is passenger details. Backend booking, wallet, and the mock railway provider are unchanged.

## Honest status

The default **production railway provider is RailCore** (`RAILWAY_PROVIDER=railcore`, server-side `RAILCORE_API_KEY`). RailKit stays installed as **fallback**, and is the only source for **PNR** and **cancelled-train list**. RailRadar is not used. NVIDIA still only understands language — it never invents trains, seats, fares, live location, or PNRs. Station lookup uses RailCore `GET /v1/stations/search` with ranking (Kochi first-hit KFX is rejected). Seat/fare numbers are provider snapshots, not a live IRCTC booking counter. Booking confirmation remains a **mock PNR** unless a real booking API exists.

- Demo bookings are labelled **Mock / demo booking**.
- Mock PNRs always start with `MOCK`.
- Nothing is marked confirmed until the provider returns success.
- Coach position/composition RailCore `GET /v1/trains/:number/coach-position` se aati hai (RailCore-only; RailKit isme fallback nahi). Na aaye to UI honestly kehta hai — fake layout kabhi nahi banata.
- Voice/chat bhi coach position samajhta hai: "12014 ki coach position batao" / "coach dikhao" / "12926 की कोच पोजिशन" — TrainBoard par diagram sheet khulti hai, Concierge mein composition ka jawab aata hai.
- Connecting a licensed/authorized railway API later should only require a new adapter under `server/providers/` plus server-side env vars.

This project does **not** scrape IRCTC, call unofficial APIs, or invent production PNRs.

## Deploy on Vercel

```bash
npx vercel login
npx vercel --yes --prod
```

Frontend (`dist`) + `/api/*` Express function dono deploy hote hain. Mock provider default hai — secrets Vercel dashboard pe `RAILWAY_*` se add karo, frontend bundle mein nahi.

Microphone: `Permissions-Policy: microphone=(self)` already set.

## Run

```bash
cp .env.example .env
npm install
npm test
npm run dev
```

- Client: `http://localhost:5173` (proxies `/api` to the server)
- API: `http://localhost:3001`

## Environment

See `.env.example`. Secrets stay on the server:

| Variable | Purpose |
| --- | --- |
| `RAILWAY_PROVIDER` | Default `railcore`. Explicit `railkit` / `mock` / `authorized` override. |
| `RAILCORE_API_KEY` | Server-only RailCore key (never frontend) |
| `RAILKIT_API_KEY` | Server-only RailKit fallback / PNR / cancel-list key (never frontend) |
| `RAILWAY_API_BASE_URL` | Optional licensed-provider stub |
| `RAILWAY_API_KEY` | Server-only licensed-provider key |
| `RAILWAY_API_SECRET` | Server-only licensed-provider secret |
| `WALLET_INITIAL_BALANCE` | Demo wallet opening balance |
| `SERVICE_FEE_INR` | Per-passenger service fee |
| `MOCK_FORCE_FAIL` | Force mock confirmations to fail |
| `NVIDIA_API_KEY` | Server-only NVIDIA NIM key for `/api/understand` |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1` |
| `NVIDIA_MODEL` | Chat model id (default `openai/gpt-oss-20b`) |
| `AI_REQUEST_TIMEOUT_MS` | NVIDIA request timeout (default 7000, max 20000) |

Add them in **Vercel → Project Settings → Environment Variables** for Production and Preview. Never put keys in the Vite client bundle or git. If `NVIDIA_API_KEY` is unset, `/api/understand` uses deterministic Hindi/English/Hinglish NLU.

Admin catalog (no API key in the browser): `#/admin/models` → **Check NVIDIA models**.

```
User message → POST /api/understand (structured slots)
            → booking state
            → validation → search → class → passengers → fare
            → explicit confirm → booking API
```

The model cannot book. Confirmation and provider calls stay on the backend.

## Architecture

```
server/agent/agentic.ts       AI tool-calling loop (allowlist, grounding, provider routing, repair pass, time budget)
server/agent/run.ts           AI-FIRST runAgent: model picks tools; deterministic NLU/tools = fallback only
server/understand/            Structured AI + fallback NLU (no src/ imports)
server/providers/types.ts     Provider contract
server/providers/mock.ts      Deterministic mock inventory
server/providers/authorized.ts Stub for a licensed provider
server/railway/router.ts      RailCore primary → RailKit fallback routing (`source` on every result)
server/app.ts                 HTTP API (POST /api/agent accepts multi-turn `history`)
src/views/Concierge.tsx       Chat UI: AI-first agent turn with visible tool trace, deterministic booking fallback
src/booking/state.ts          Booking state machine (payment/confirm never model-driven)
```

Multi-turn state: the client sends back `context` (origin/destination/date/passengers) and the last 8 conversation turns as `history`, so "Amritsar se Delhi jaana hai" → "Kis date ko?" → "Saturday" continues without re-asking. The model asks for genuinely missing info instead of silently assuming today's date.

Provider operations: search, availability, fare, create, confirm, retrieve, cancel.

Booking states: `SEARCHING` → `RESULTS_FOUND` → `TRAIN_SELECTED` → `CLASS_SELECTED` → `PASSENGERS_PENDING` → `FARE_REVIEW` → `PAYMENT_PENDING` → `BOOKING_PENDING` → `CONFIRMED` | `FAILED` | `CANCELLED`.

Changing the date, train, or class clears downstream selections so stale cards cannot linger.

## Tests

`npm test` covers search, empty routes, date-change resets, passenger validation, wallet shortfall, mock success/failure, and PNR retrieval.
