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

## Live status of yesterday / earlier runs (Round-16p)

Live status is per **start-date run**. "kal / parson / yesterday / 7 Sep wali
kahan hai" resolves to the *past* run (`parseStatusDate`, opposite of the booking
parser where "kal" = tomorrow). Without a date, if today's run is still idle at
its origin (multi-day trains), the router auto-probes the previous 3 days and
returns the run that is actually moving. Completed runs return their final
status/delay. Replies label the run: `[kal (08 Sep) se chali wali run]`.

## Journey intelligence — RailBook Atlas (Round-17)

`server/journey/engine.ts` is a **deterministic** ranking/recovery engine over
real provider data; the LLM only picks the tool and explains the result.

| Tool / endpoint | What it does | Data source |
| --- | --- | --- |
| `RANK_JOURNEY_OPTIONS` · `POST /api/journey/plan` | Ranks direct + connecting options: `best_overall`, `fastest`, `direct`/`fewest_changes`, `best_availability`, `cheapest`, `earliest`. Stable order, ties by train number. Returns `recovery{differentTrain, partialRoute, connecting, alternativeDates}` when the direct train has no seat. | `searchTrainsRouted`, bounded `routedClassBoard` probe (`JOURNEY_AVAIL_PROBE`, default 4) |
| `FIND_VACANT_SEATS` · `POST /api/journey/vacant` | Class-level AVAILABLE/RAC/WL counts + fare for one train segment. | `routedClassBoard` (RailCore → RailKit → RailRadar → RailYatri scrape) |
| `FIND_PARTIAL_ROUTE_SEATS` · `POST /api/journey/partial` | Same-train split (`origin→X` + `X→destination`) and same-train switch ("seat available after X"). Verifies station order, class, date, running day; probes ≤ `PARTIAL_SPLIT_LIMIT` (3) mid-halts. | timetable + class board |
| `FIND_CONNECTIONS` · `POST /api/journey/connections` | One-change connections via hubs; `layoverMinutes = departureB − arrivalA`; rejected if `< MIN_TRANSFER_MINUTES` (default 30), `> MAX_LAYOVER_MINUTES` (default 360) or negative/next-day. | two routed searches |

Honesty rules baked in: `reliability` is always `null` (no provider gives
punctuality data), `berths`/`berth` are always `null` (no configured provider —
RailCore, RailKit, RailRadar — exposes coach/berth-level or post-chart vacancy;
the engine says so in `capability.note`). The user's date is never changed —
alternative dates are suggestions only. The chat UI renders the plan as a
**BEST OPTION** card (⚡ ⏱ 🚆 💺 ₹) with **OTHER OPTIONS** chips; when the direct
train has no seat it shows "Direct seat nahi mili. Ye alternatives mile:" with
only provider-verified alternatives.

## Round-18 — capability registry, provenance, proactive alternatives, smart train picker

- **Provider capability registry** (`server/providers/capabilities.ts`, `GET /api/capabilities`): per provider (RailCore, RailKit, RailRadar, Indian Rail API, verified web sites, RailBook engine) each internal capability is `available | unavailable | needs_key | derived`. The backend only selects supported capabilities. Berth-level vacancy, post-chart vacancy and reliability scores are `unavailable` everywhere → the UI/LLM says **"Seat recovery data is currently unavailable."** — never a fake coach/berth.
- **Provenance & freshness** (`server/providers/provenance.ts`): dynamic results carry `retrievedAt, source, sourceType, requestDate, travelDate, freshness (live/fresh/recent/stale)`. Stale live data is labelled, never presented as current.
- **Data-conflict resolution**: two sources disagreeing are never blended (10 + 15 ≠ 25). Rule = source priority (RailCore > RailKit > RailRadar > IndianRailAPI > web) + freshness; if a lower-priority source is materially fresher and disagrees, the response says **"Data sources are conflicting right now. Please retry."**
- **Proactive alternatives** (§5/§6): every journey search attaches the deterministic Atlas plan (BEST FOR YOU + YOU MAY ALSO CONSIDER chips: ⚡ Fastest · 💺 Best availability · 💰 Lowest fare · 🚆 Fewest changes · 🔁 Connecting · 📅 Alternative date) — cards only when backed by real data. When a checked train is WL/RAC/low/no-class, `FIND_ALTERNATIVE_TRAINS` (`POST /api/journey/alternatives`) runs automatically: other trains (verified AVAILABLE/RAC), same-train other class, split booking, connecting, alternative dates (suggestion only — origin/destination/date never changed silently).
- **Smart train picker** (§9/§10): `SEARCH_TRAIN_BY_NUMBER` / `SEARCH_TRAIN_BY_NAME` (`GET /api/trains/pick?q=`) — exact number → exact name → normalized/fuzzy partial name (handles erail spellings like "SHTABDI") → route context. Ambiguous names open a **SELECT TRAIN** card list in chat; the user taps to choose. Typing a bare number or a short name in chat shows the picker instantly, before the LLM round-trip.
- No auto-booking: `Confirm & Book` remains the only booking action; payment/wallet/booking stay deterministic.

### Round-18c — gap-fill vs spec
- **§8 alternate boarding/destination station**: `findAlternateStationOptions` / `clusterSiblings` (`server/journey/engine.ts`) probe same-city siblings from `MULTI_STATION_CITIES` (max 2 per side, fastest train availability-verified). Attached as `plan.recovery.alternateStations` only when no good direct option; UI shows "📍 Doosra station, same city — confirm karein" cards; tapping sends an explicit new query — origin/destination are never changed silently.
- **§5 proactive plan on deterministic path**: when the LLM engine is unavailable, `/api/agent` still returns `journey` (BEST FOR YOU + chips) built from the same real search (no extra provider call).
- **§14 live-status freshness**: TRACK_TRAIN attaches `provenance{retrievedAt,source,sourceType,requestDate,travelDate,freshness}`; stale provider updates are labelled "purana update hai" instead of being presented as current.

### Round-18e — user-reported bug: "sidha card open ho jata, alternatives nahi dikhte"
- Root cause: after a journey search the client auto-opened the full-screen TrainBoard (booking continuity) which covered the chat's BEST FOR YOU / YOU MAY ALSO CONSIDER / SELECT TRAIN blocks.
- Fix: no auto-open when the agent reply carries a `journey` / `alternatives` / `trainPicker` block. BEST FOR YOU card now has an explicit **"Sabhi trains · Book →"** CTA (and "Phir bhi sabhi trains dekho / book →" when direct is unavailable) — the board opens only on that tap.
- TrainBoard: tapping a WL / RAC / Not-available / <10-seat class opens a **YOU MAY ALSO CONSIDER** sheet (`POST /api/journey/alternatives` with the cell's verified `knownRow`) — other trains verified AVL/RAC, other classes, split, connecting, alt dates; "Phir bhi … book karo" keeps the explicit user choice.

### Round-18f — real-browser E2E of every Round-18 feature (headless Chromium against the production build)
- Found & fixed: `BlockView` was missing the `onOpenBoard` prop → `ReferenceError` on render → blank reply right after the date (this is what made Round-18 look "not working"); `openBoardFor` was nested inside `handleText`. `scripts/release.sh` now fails on client undefined-name errors (TS2304/TS2552).
- Picker: one card per train number (providers return case/spelling variants). Agent: user-typed station codes (FZR, CSMT…) are used directly — no "FZR ka matlab…?" confirmation.
- Verified in-browser: date asked first → BEST FOR YOU + chips (no board auto-open) → chip list → "Sabhi trains · Book →" opens TrainBoard → WL cell tap opens YOU MAY ALSO CONSIDER sheet; "12014" / "Amritsar Shatabdi" → SELECT TRAIN cards with dep→arr; "12014 mein CC available hai?" asks date; WL query → alternatives card; `/api/capabilities` honest "Seat recovery data is currently unavailable.".

### Round-18g — Muse stays primary; general-question web answers; fare on seat rows
- **Muse duplicate tool calls**: Muse frequently emits the same tool call 2-3× in parallel (e.g. `WEB_SEARCH` ×3 for "India mein longest train journey"); each duplicate cost 5-10 s and blew the turn budget, so GPT-OSS/GLM answered instead. Now identical name+args calls execute once and every `tool_call_id` still receives the tool message → Muse finishes inside budget and remains the primary model.
- **General railway questions** already route to `WEB_SEARCH` (Wikipedia etc.) or the KB — verified live: longest journey (Vivek Express 4,154 km), Vande Bharat speed, Tatkal timings.
- **Fare on RailRadar/IndianRailAPI seat rows**: those APIs return seats without fare (fare 0 → "Fare on select", no 💰 Lowest fare chip). `withFareFilled` adds fare from RailRadar fare API → erail (web), recorded as `fareSource` (seats and fare provenance never merged).

### Round-18g-3 — Muse primary: measured & fixed
- New telemetry: every `/api/agent` response carries `modelFallbacks[{model,reason,ms,round}]` (+ structured log line). Prod showed Muse **timing out** in rounds 2+ (it got only 4–8 s after the first round, while Muse needs 20–35 s per round on NIM), so GPT-OSS/GLM answered.
- Fix: primary model always gets ≥ `AI_PRIMARY_MIN_MS` (25 s on Render) while budget remains; turn budget 120 s, per-call 40 s (Render env updated). Fallback reserve 8 s → 6 s. Muse stays primary; GPT-OSS/GLM only when Muse genuinely fails.

## Extra fallback APIs (Round-16o, optional)

Data chain per method: **RailCore → RailKit → RailRadar → Indian Rail API → verified-site web-scrape → none**. The two new providers are *additional* and fully optional — with no key set they are skipped and nothing else changes.

| Provider | Env var | Signup | Covers |
| --- | --- | --- | --- |
| RailRadar (`api.railradar.in/v1`) | `RAILRADAR_API_KEY` (`rr_live_…`) | https://railradar.in/developers — free sandbox, 1,000 req/month, no card | trains-between, seat availability, fare, live status, schedule, coach position, station + train-name autocomplete |
| Indian Rail API (`indianrailapi.com/api/v2`) | `INDIANRAILAPI_KEY` | https://indianrailapi.com (register → API key; seat availability needs Advanced/Enterprise plan) | schedule, live status, fare, coach position, station + train autocomplete, (seat availability on paid plan) |

Train-name search additionally falls back to the erail.in train list (`web_erail`) when every API is limited. General/knowledge questions that no provider can answer are auto-answered from the web (Wikipedia/KB/DDG) — never "provider se nahi mil pa rahi" for a non-booking question.
