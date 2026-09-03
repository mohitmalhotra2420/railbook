# RailBook

AI-first railway booking: tell RailBook the journey in Hindi, English, or Hinglish.

Understanding runs **server-side** (`POST /api/understand`) through **NVIDIA NIM** (`https://integrate.api.nvidia.com/v1`). Default chat model: `openai/gpt-oss-20b` (`NVIDIA_MODEL`). The model never books — search, fare and confirmation stay in the booking engine. If NVIDIA is missing, times out, or errors, deterministic Hindi/English/Hinglish NLU is used. Per-request timeout: `AI_REQUEST_TIMEOUT_MS` (default 7000).

Primary UI is a travel concierge (voice + text). The only structured form is passenger details. Backend booking, wallet, and the mock railway provider are unchanged.

## Honest status

The default **production railway provider is RailCore** (`RAILWAY_PROVIDER=railcore`, server-side `RAILCORE_API_KEY`). RailKit stays installed as **fallback**, and is the only source for **PNR** and **cancelled-train list**. RailRadar is not used. NVIDIA still only understands language — it never invents trains, seats, fares, live location, or PNRs. Station lookup uses RailCore `GET /v1/stations/search` with ranking (Kochi first-hit KFX is rejected). Seat/fare numbers are provider snapshots, not a live IRCTC booking counter. Booking confirmation remains a **mock PNR** unless a real booking API exists.

- Demo bookings are labelled **Mock / demo booking**.
- Mock PNRs always start with `MOCK`.
- Nothing is marked confirmed until the provider returns success.
- Coach position/composition RailCore `GET /v1/trains/:number/coach-position` se aati hai (RailCore-only; RailKit isme fallback nahi). Na aaye to UI honestly kehta hai — fake layout kabhi nahi banata.
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
server/understand/            Structured AI + fallback NLU (no src/ imports)
server/providers/types.ts     Provider contract
server/providers/mock.ts      Deterministic mock inventory
server/providers/authorized.ts Stub for a licensed provider
server/app.ts                 HTTP API
src/booking/state.ts          Booking state machine
```

Provider operations: search, availability, fare, create, confirm, retrieve, cancel.

Booking states: `SEARCHING` → `RESULTS_FOUND` → `TRAIN_SELECTED` → `CLASS_SELECTED` → `PASSENGERS_PENDING` → `FARE_REVIEW` → `PAYMENT_PENDING` → `BOOKING_PENDING` → `CONFIRMED` | `FAILED` | `CANCELLED`.

Changing the date, train, or class clears downstream selections so stale cards cannot linger.

## Tests

`npm test` covers search, empty routes, date-change resets, passenger validation, wallet shortfall, mock success/failure, and PNR retrieval.
