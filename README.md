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

### Round-18h — browser E2E of general questions / Muse / seat+fare web-scrape
- Client bug: "Bharat ki pehli train kab chali thi" never reached the server — `classifyFollowUp` treated "pehli train" as a list pick ("Pehle trains search karni hongi"). Knowledge phrasing (kab/kahan/history/bharat/india/…) now bypasses `train_pick`.
- Verified live in Chromium: longest journey (Muse + Wikipedia), first train 1853 (Muse + Wikipedia), Rajdhani vs Shatabdi (KB+web), 12014 CC seats **with fare** (RailRadar seats + fare fill), and with all API keys removed seats+fare still come from railyatri.in (web) — CC AVL ₹1,125.

### Round-18i — rules questions prefer KB, fact questions prefer web
- Browser E2E: "IRCTC tatkal booking kab shuru hoti hai" got a generic IRCTC Wikipedia paragraph (no timing). `WEB_SEARCH` now checks `RULES_TOPIC_RE` (tatkal/RAC/WL/chart/PNR/refund/luggage/ID/quota/concession…) and answers from the stable KB first (10:00 AM AC / 11:00 AM non-AC). Fact questions (longest/fastest/zones/history/largest) still go to Wikipedia topic-page first.
- `railKbAnswer` normalises "X ka matlab/meaning kya hai" → "X kya" so "RAC ka matlab kya hai" hits the KB.

### Round-18j — 0 direct trains → same-city stations probed automatically (§8)
- Browser E2E "Ludhiana se Mumbai sleeper mein seat hai kya 20 September ko": "Mumbai" resolved to BCT → 0 direct → the agent asked the user to try another station. `SEARCH_TRAINS` now probes cluster siblings (`findAlternateStationOptions`) and returns "YOU MAY ALSO CONSIDER: LDH→BDTS (12926, 12904); LDH→CSMT (11058)" with an explicit instruction to confirm with the user (origin/destination are never switched silently). `AlternateStationOption.allTrainNumbers` added; ranking failures no longer drop a real option.

### Round-18k — build tag + no-cache index.html (stale-UI diagnosis)
- The user kept reporting behaviour that no longer exists on the deployed build. Now the header shows a small build tag (short commit, e.g. `9dd6e9c`) and `GET /api/version` returns `{commit, startedAt, primaryModel, fallbackModel}`. If the header tag ≠ `/api/version.commit`, the browser is serving a cached bundle → hard refresh.
- `index.html` is served with `Cache-Control: no-store`; hashed `/assets/*` are `immutable` (1y). Previously everything was `max-age=0`, which some mobile browsers/CDNs still revalidated lazily.

### Round-18l — "AI journey summary" for any route (screenshot parity)
- `planJourney()` now returns `summary` — a deterministic plain-language line built ONLY from retrieved data: `Best plan: <train> <dep→arr>, <duration> (<class avail>). If it slips, route via <hub> (<legs>, layover) / take <alt train>. Or shift to <Day dd Mon> — N trains.` Shown in the journey card ("AI journey summary" panel), fed to Muse as `JOURNEY SUMMARY` in `RANK_JOURNEY_OPTIONS`, and used verbatim when every model times out (replaces the old model-instruction text that leaked into replies).
- "Goa" is now a multi-station region (MAO/VSG/THVM/KRMI) — RailRadar lookup returned "GOA Gohad Road Halt".
- "is weekend" → date-ask offers the real Sat/Sun dates (never assumed).
- Route-level seat question without a train ("Amritsar se Goa … confirm seat hai?") no longer hits `getAvailability` ("Train, date, stations aur class chahiye") — it goes through the journey flow.
- Muse latency note: no model/timeout config changed in this round. Muse on NIM measures 20–40 s per tool round (see Round-18g-3); when NVIDIA is loaded it exceeds the 40 s per-call cap and GPT-OSS/GLM answer with the same deterministic data.

### Round-18m — "1" picks the 1st train · seat data on fallback · live-status date chooser
- **"1" after a train list** = first train of that list (`resolveTrainNumber` bare-index; only when route is set and no station choice is pending). Reply confirms the train and asks class; never books.
- **Seat availability on fallback:** RailRadar/erail search rows have no class list and RailCore schedule is blocked → `routedClassBoard` had no class codes → probe never ran ("Seat data nahi"). New `webTrainClasses()` discovers classes from the erail fare page (12h cache); the railyatri/railradar seat probe now runs — LDH→NDLS best became 12014 (EC AVL) instead of a WL Vande Bharat.
- **Live status → choose the run date:** "12424 kahan hai" (no date cue) → `routedLiveDates()` probes today-3…today through the same provider chain and returns ONLY dates that have a run (`liveDates` in `/api/agent`); UI shows chips "Aaj (Thu 10) · chal rahi", "Kal (Wed 9) · chal rahi", "Tue 8 · poori" … Tap → "12424 2026-09-09 ka live status" → that run. Explicit cues (kal/parson/date) still go straight to the run.

### Round-18m-2 — stale web rows shown (⚠), alt-date seat proof, no duplicate connections
- **RailYatri rows older than 24h** are no longer hidden (that left cells as "↻ Refresh"): they come through with `stale: true` → UI shows "AVL 80 ⚠" / "WL 13 ⚠" (last known) and never counts as proven seat for ranking/recovery.
- **Alternative date** now probes the fastest train's seat on that date → chip/summary say "22478 CC AVL 43" or "… WL 68"; the summary says "shift to <date>" only with proven AVL/RAC, otherwise "N trains run, seat status unverified". Count is trains, never seats.
- **Connecting journey** — recovery block shows the first 2; the "🔁 Connecting" chip lists only the remaining ones (no duplicates).

### Round-18m-3 — connecting journeys: boarding station, train name, real dates, per-leg seat
- Every connecting leg now shows **train name + boarding/alighting station name (code) + calendar date** (no more bare "+1d"), plus a "↓ Yahan train badlo: Ambala Cant Jn (UMB)" marker.
- **Seat per leg:** `probeConnectionLegs()` probes leg A (origin→hub) and leg B (hub→destination) separately — never origin→destination on a train that doesn't go there. Tapping a leg asks for that leg's segment and date only.

### Round-18m-5 — connecting routes only when BOTH legs have seats
- `bookableConnections()` keeps a connection only if **every leg** has provider-proven, fresh AVL/RAC; WL / N-A / unknown / stale legs are dropped (never shown as an "alternative").
- More candidates: fixed hubs (up to 10 connections) + **route-derived hubs** (`routeDerivedHubs()` — junction/major stops from the direct trains' timetable, e.g. JAT→BDTS tries PTKC/LDH/NDLS/SWM/RTM/BH), all legs probed, then filtered.
- When nothing passes: card + `plan.notes` say "Connecting routes mile lekin kisi mein dono trains par seat available nahi thi — isliye connecting option nahi dikhaya." Summary's "route via X" line lists per-leg seats.

### Round-18m-12 — Every train × every class seat-probe, stale-AVL tier, RAC as option

Bug (user screenshot LDH→SRE "kal"): planner said "direct mein koi seat nahi" while the board showed 12588 1A AVL 2 and 14682 2S AVL 559. **Engine fault, not AI**: `JOURNEY_AVAIL_PROBE` defaulted to 4 → only the 4 fastest trains were seat-checked; the rest were silently counted as "no seat".

- `planJourney`: probes **every direct train (bounded 20) × every class** in parallel; `RouteOption.classOptions[]` = full class board (AVL/RAC/WL/N-A, stale flag), `probed` flag per train.
- `directUnavailable` only when every probed train has no fresh AND no stale bookable row. New `directStaleAvailable`: AVL/RAC seen only in 24h+ web cache → "available (not fresh) — verify" tier (never "seat nahi"). Unprobed trains → explicit note ("seat data nahi aayi — 'seat nahi' nahi maana").
- Ranking pax-aware: fresh bookable for N pax → stale bookable → rest. `recommendedOf` / summary / UI hero share one rule: fresh same-train book-from-earlier beats a stale or slower best.
- UI: hero shows "All classes (this train)" (RAC rows included), new **"Seat check · every train, every class"** section listing each direct train's full board + unprobed trains; pills show the stale tier.
- Tests: `tests/round18m12-probe-all.test.ts` (724 total).

### Round-18m-11 — Station-safety fix (prayagraj ≠ Agra), alt-row book/board/deboard, audit strip

- **Bug (screenshot):** "ludhiana se prayagraj" → AGC. Root cause: `matchStation()` ka `q.includes(city)` — "pr**agra**j" ke andar "agra" substring. Fix: city sirf **whole-word** match; fuzzy matcher ke liye `DISTINCT_CITIES` guard (raipur→Jaipur jaisi 1-edit galtiyan bhi band). Prayagraj/Allahabad ab `MULTI_STATION_CITIES` group (PRYJ → PCOI → PRRB → PYGS); goods/power-plant sidings aur "PRYJ2" duplicates options se hidden (`isPassengerStation`).
- **Same-train alternatives rows:** ab har row mein hero jaisi strip — **Book from / Boarding / Deboarding** (station name, code, time, +1d), duration · board-at, other-class chips.
- **Audit strip** card ke upar: "Checked for N pax: x/y direct trains · a trains × b earlier-stop segments (leg-1, every class) · via HUB: p + q trains (leg-1 + leg-2)" — sirf real counts. Book-from-earlier scan ab train origin tak (15 stops) jaata hai.
- Tests: `tests/round18m11-station-safety.test.ts` (5).

### Round-18m-10 — Leg-wise joint planning (all trains per leg), AI-written "kyun chuna", pax gate hardening

- **Leg-wise plan (`plan.legPlans[]`):** direct seat na mile to top hub (e.g. NDLS) ke liye **Leg 1 = origin→hub ki HAR train** aur **Leg 2 = hub→destination ki HAR train** (10+10, parallel) par pax-aware seat probe (`expandLegPlan`). UI mein "Connecting · leg-wise seat options": upar **AI ka joint best combo**, phir "Leg 1 · N of M with seats" / "Leg 2 · N of M with seats" lists — user apna combo bhi bana sakta hai. `buildLegPlans()` baaki hubs ko probed connections se group karta hai.
- **"AI ne ye plan kyun chuna" — AI-written:** `aiWhyPoints()` model (Muse primary 12s → gpt-oss 12s → rules) ko sirf **facts sheet** deta hai (`whyFactsSheet`: har direct train ka seat status, bfe options, leg-wise counts, pre-computed COMPARISON/PRACTICAL/RISK lines, explicit RECOMMENDED/REJECTED). Output grounding-checked: unknown train no./₹ amount, WL train ko "confirmed" bolna, galat "fastest" claim → point drop; 4–5 se kam ho to rules-based points se top-up. `whySource: "ai"|"rules"` → UI "AI-WRITTEN" tag.
- **Passenger gate:** bare "2" → server explicit search text banata hai (model "2 se kya matlab" nahi poochta); client deterministic `resumeAsk` par bhi `lastAsked` set karta hai. Station-pick / date-follow-up flows ke baad bhi gate fire hota hai (verified).
- Tests: `tests/round18m9-pax-gate.test.ts` (+3: buildLegPlans, facts sheet, UI wiring).

### Round-18m-9 — Passenger-aware planning, full-route 2-leg search, journey card v3

- **Passenger gate:** origin + destination + date pata hone par, train dhundhne/seat verify karne se PEHLE AI poochta hai "kitne passengers hain? (1–6)". Jawab ("2") deterministic resume ban kar poori search chalata hai — origin/destination/date change nahi hote. Seats ab `seats ≥ passengers` par hi "confirmed" maani jaati hain (RAC sirf ≤2 pax).
- **Joint 2-leg planning:** leg-1 = train ke origin se boarding tak HAR station × HAR class × HAR train (`findBoardFromEarlier(passengers)`); leg-2 = boarding → destination full route par har train ki availability (`findConnections` fan-out 8 legs/hub, 40 candidates, 24 probes). `bookableConnections()` class-agnostic — jis class mein pax ke liye seat ho wahi leg par dikhti hai; AI seat-proven + fastest combo chunta hai.
- **"AI ne ye plan kyun chuna":** `journeyWhyPoints(plan)` 4–5 genuine, data-driven points banata hai (kitni direct trains check hui, bfe seat+fare, duration vs fastest, other classes, IRCTC boarding note, connecting comparison) → `journey.whyPoints[]`.
- **Journey card v3 (`.jx-*`):** header "RAILBOOK ATLAS · JOURNEY PLAN" LDH → LKO + date/pax/trains pills; status pills (Direct / Recommended / Connecting); hero "RECOMMENDED · SAME TRAIN" (train, class AVL badge, 3-col Book-from / Boarding / Deboarding strip, duration·direct·fare row, Available/Other classes chips, "Availability may have changed" note, orange "Seat check 2A →", navy "SABHI TRAINS · BOOK →", light-blue why-list); Same-train alternatives (+N options), Connecting card, Other dates (N alternatives), Explore options chips, footer source/last-checked.
- Tests: `tests/round18m9-pax-gate.test.ts`; 4 older tests updated for the gate (now pass `2 logon ke liye`).

### Round-18m-8 — journey card layout v2 (results page, not chat) + new RailCore/RailKit keys

- Chat prose collapses into an "AI note" pill when a journey card is the answer; the card is the result.
- Card: navy route hero (`LDH → LKO`, date/class/train pills) → status pills (Direct: seat nahi · Same train pichhle station se: 2A AVL 36 · Connecting …) → **BEST FOR YOU** hero = the fresh seat-proven book-from-earlier option (ConfirmTkt-style Book from / Boarding / Deboarding strip, duration/seat/fare grid, all seat classes as chips, LDH→LKO vs PHR→LKO key-value lines, "Seat check" + "Sabhi trains · Book" CTAs) → collapsible "AI ne ye plan kyun chuna" → numbered sections with counts (aur same-train options, doosri train, connecting, doosri date, doosra station) → YOU MAY ALSO CONSIDER tabs.
- Keys rotated (RailCore `rk_live_0yKp…`, RailKit `railkit_c842…`) in `.env` and Render env; RailCore search/availability verified live again.

### Round-18m-7 — date survives station pick; no auto TrainBoard; ConfirmTkt-style options for EVERY train & class

- **Date kept across the station-choice turn.** "Ludhiana se Varanasi jaana hai kal" → "1. BSB / 2. BCY" → "Bsb" no longer re-asks the date. Root cause: `mergeAgentContext` (server + client) treated the picked station as a *new route* (`routeChanged`) and reset `date/dateProvided`; a pick that resolves a `pendingDestinationChoice`/`pendingOriginChoice` is now exempt. The station-pick turn also returns the full **journey planner card** (`planJourney`) instead of a plain table.
- Deterministic path fix: the server-verified station pick is stripped from the NLU's `unresolvedTo/From` before `mergeAgentContext` (it was still counted as a "new route" → date reset on prod).
- **Full-screen TrainBoard never auto-opens** after an agent reply (`AUTO_BOARD=false` in `Concierge.tsx`) — the chat journey card is the planner; the board opens only from "Sabhi trains · Book →" / a train pick.
- **Book-from-earlier like ConfirmTkt:** `findBoardFromEarlier` now probes up to `BOARD_EARLIER_TRAINS` (10) direct trains × `BOARD_EARLIER_STOPS` (5) earlier stops, keeps **every** AVL/RAC class (`classOptions`, `bookableRows`), includes stale web-cache rows flagged ⚠ (fresh first), computes boardAt→destination `durationMinutes`, and ranks **fresh seat → AVL>RAC → least travel time → nearest stop**. Card shows up to 8 options with class chips; summary leads with the seat-proven least-time option, lists the other classes and the option count.
- **Connections show every seat class per leg** (`RouteLeg.classOptions` from `probeConnectionLegs`), in the leg rows and in the summary ("12426 3A AVL 5/SL RAC 3, …").

### Round-18m-6 — honest "best plan" + ConfirmTkt-style "book from earlier station"
- **Ranking fix:** a seat-proven (fresh AVL/RAC) option always outranks WL/N-A/unknown — even a connecting route; "no seat data" no longer ties with AVAILABLE (13152 bug). Connecting option's combined availability = weakest leg.
- **Summary says why:** "… (SL WL 27) — kisi option mein confirmed seat nahi; ye sabse kam WL/fastest direct hai" or "— direct trains mein seat nahi, is route par dono legs available".
- **Book from earlier station** (`findBoardFromEarlier`, `recovery.boardFromEarlier`): for each WL direct train, timetable → up to 3 stops before origin → probe bookFrom→destination → keep AVL/RAC. Card shows Book from / Boarding / Deboarding (e.g. 13308: book Phillaur Jn PHR 19:00, board Ludhiana Jn LDH 19:55 — 2A AVL 19 ₹1545). Summary leads with it when best is WL. Provider-proven only, never invented.

## Extra fallback APIs (Round-16o, optional)

Data chain per method: **RailCore → RailKit → RailRadar → Indian Rail API → verified-site web-scrape → none**. The two new providers are *additional* and fully optional — with no key set they are skipped and nothing else changes.

| Provider | Env var | Signup | Covers |
| --- | --- | --- | --- |
| RailRadar (`api.railradar.in/v1`) | `RAILRADAR_API_KEY` (`rr_live_…`) | https://railradar.in/developers — free sandbox, 1,000 req/month, no card | trains-between, seat availability, fare, live status, schedule, coach position, station + train-name autocomplete |
| Indian Rail API (`indianrailapi.com/api/v2`) | `INDIANRAILAPI_KEY` | https://indianrailapi.com (register → API key; seat availability needs Advanced/Enterprise plan) | schedule, live status, fare, coach position, station + train autocomplete, (seat availability on paid plan) |

Train-name search additionally falls back to the erail.in train list (`web_erail`) when every API is limited. General/knowledge questions that no provider can answer are auto-answered from the web (Wikipedia/KB/DDG) — never "provider se nahi mil pa rahi" for a non-booking question.
