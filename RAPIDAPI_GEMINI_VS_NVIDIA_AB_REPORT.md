# RapidAPI Gemini Pro AI New vs NVIDIA A/B report

Date: 2026-08-23 (Asia/Calcutta). Cases: 28 (25 core + 3 Hinglish extras).

**This run could not score RapidAPI Gemini language quality.** Live calls to the documented host `gemini-pro-ai-new.p.rapidapi.com` returned **HTTP 403** (`You are not subscribed to this API`) and **HTTP 429** (`Too many requests`). The RapidAPI key is present and accepted by the gateway (not 401), but the account is **not subscribed** to Gemini Pro AI New. No key is written here.

Documented request used (from RapidAPI Gemini Pro AI playground, sibling of “New”):

`POST https://gemini-pro-ai-new.p.rapidapi.com/`  
headers: `Content-Type`, `x-rapidapi-host`, `x-rapidapi-key`  
body: Google-style `{ model, contents: [{ role, parts: [{ text }] }] }`

NVIDIA column is the **production understand stack** (NLU fast-path + NVIDIA when needed).

**Mode:** RapidAPI Gemini is SHADOW / EVALUATION only. NVIDIA remains the production default.
RapidAPI Gemini output is never applied to the customer reply, never runs tools, never books, never debits the wallet. NVIDIA “wins” below are **API subscription/quota failures**, not language-quality wins.

| Provider | Role | Host / model |
|---|---|---|
| NVIDIA | production / primary | openai/gpt-oss-20b |
| RapidAPI Gemini Pro AI New | shadow / eval | gemini-pro-ai-new.p.rapidapi.com / gemini-2.5-pro |

## Headline scores

| Metric | NVIDIA | Gemini |
|---|---:|---:|
| Intent accuracy | 100% | 0% |
| Entity accuracy | 82.1% | 0% |
| Tool-selection accuracy | 100% | 39.3% |
| JSON validity | 100% | 0% |
| Context accuracy | 100% | 96.4% |
| Missing-slot handling | 100% | 100% |
| Safety accuracy | 100% | 100% |
| Average latency | 679 ms | 79 ms |
| P95 latency | 2770 ms | 292 ms |
| Timeout / error rate | 0% | 100% |

## Per-case

| # | Utterance | NVIDIA intent | Gemini intent | NVIDIA entities | Gemini entities | NVIDIA tool | Gemini tool | JSON N/G | Context | Missing | Safety G | NVIDIA ms | Gemini ms | Winner |
|---:|---|---|---|---|---|---|---|---|---|---|---|---:|---:|---|
| 1 | Mujhe Amritsar se Ludhiana jaana hai | BOOK_TRAIN | — | Amritsar→Ludhiana  pax=— | —→—  pax=— | updateBookingState | — | Y/N | N Y / G Y | N Y / G Y | Y | 1848 | 292 | nvidia |
| 2 | Kal Amritsar se Delhi ki 2 ticket book karni hain | BOOK_TRAIN | — | Amritsar→Delhi 2026-08-24 pax=2 | —→—  pax=— | updateBookingState | — | Y/N | N Y / G Y | N Y / G Y | Y | 2242 | 31 | nvidia |
| 3 | 12014 ka live status batao | LIVE_TRAIN_STATUS | — | —→—  pax=— 12014 | —→—  pax=— | getLiveStatus | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 194 | nvidia |
| 4 | 12014 mein CC available hai? | CHECK_AVAILABILITY | — | —→—  pax=—  CC | —→—  pax=— | getAvailability | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 87 | nvidia |
| 5 | 12014 ka CC fare? | CHECK_FARE | — | —→—  pax=—  CC | —→—  pax=— | getFare | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 31 | nvidia |
| 6 | CC kya hota hai? | GENERAL_RAILWAY_KNOWLEDGE | — | —→—  pax=—  CC | —→—  pax=— | none | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 29 | nvidia |
| 7 | meri ticket history dikhao | VIEW_BOOKINGS | — | —→—  pax=— | —→—  pax=— | getMyBookings | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 34 | nvidia |
| 8 | PNR check karo | CHECK_PNR | — | —→—  pax=— | —→—  pax=— | checkPNR | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 29 | nvidia |
| 9 | wallet mein kitne paise hain? | VIEW_WALLET | — | —→—  pax=— | —→—  pax=— | getWallet | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 33 | nvidia |
| 10 | Jammu se Beas jaana hai | BOOK_TRAIN | — | Jammu→Beas  pax=— | —→—  pax=— | updateBookingState | — | Y/N | N Y / G Y | N Y / G Y | Y | 1625 | 31 | nvidia |
| 11 | pehli wali | SELECT_TRAIN | — | —→—  pax=— | —→—  pax=— | selectTrain | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 30 | nvidia |
| 12 | doosri wali | SELECT_TRAIN | — | —→—  pax=— | —→—  pax=— | selectTrain | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 32 | nvidia |
| 13 | 12014 wali | SELECT_TRAIN | — | —→—  pax=— | —→—  pax=— | selectTrain | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 36 | nvidia |
| 14 | 12014 aur 14542 mein kaunsi better hai? | COMPARE_TRAINS | — | —→—  pax=— | —→—  pax=— | compareTrains | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 296 | nvidia |
| 15 | 12014 ka live status batao | LIVE_TRAIN_STATUS | — | —→—  pax=— 12014 | —→—  pax=— | getLiveStatus | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 34 | nvidia |
| 16 | Kal | SEARCH_TRAIN | — | Amritsar→Ludhiana 2026-08-24 pax=— | —→—  pax=— | searchTrains | — | Y/N | N Y / G Y | N Y / G Y | Y | 1600 | 28 | nvidia |
| 17 | Nahi, Ludhiana se jaana hai | BOOK_TRAIN | — | Ludhiana→Delhi  pax=— | —→—  pax=— | updateBookingState | — | Y/N | N Y / G N | N Y / G Y | Y | 2511 | 31 | nvidia |
| 18 | 12014 cancel hai? | CANCELLED_TRAINS | — | —→—  pax=— 12014 | —→—  pax=— | getCancelledTrains | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 178 | nvidia |
| 19 | Amritsar se cancelled trains batao | CANCELLED_TRAINS | — | —→—  pax=— | —→—  pax=— | getCancelledTrains | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 100 | nvidia |
| 20 | Haan book kar do | BOOK_TRAIN | — | Amritsar→Ludhiana 2026-08-24 pax=— | —→—  pax=— | updateBookingState | — | Y/N | N Y / G Y | N Y / G Y | Y | 2770 | 34 | nvidia |
| 21 | 12014 abhi kaha hai? | LIVE_TRAIN_STATUS | — | —→—  pax=— 12014 | —→—  pax=— | getLiveStatus | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 176 | nvidia |
| 22 | 12014 kitni late hai? | LIVE_TRAIN_STATUS | — | —→—  pax=— 12014 | —→—  pax=— | getLiveStatus | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 29 | nvidia |
| 23 | fast wali kaunsi hai? | SELECT_FASTEST | — | —→—  pax=— | —→—  pax=— | selectTrain | — | Y/N | N Y / G Y | N Y / G Y | Y | 2774 | 30 | nvidia |
| 24 | Nahi, parso | SEARCH_TRAIN | — | Amritsar→Ludhiana 2026-08-25 pax=— | —→—  pax=— | searchTrains | — | Y/N | N Y / G Y | N Y / G Y | Y | 1672 | 268 | nvidia |
| 25 | Nahi, 3 passengers | BOOK_TRAIN | — | —→—  pax=3 | —→—  pax=— | updateBookingState | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 29 | nvidia |
| 26 | bhai 12014 abhi kaha hai | LIVE_TRAIN_STATUS | — | —→—  pax=— 12014 | —→—  pax=— | getLiveStatus | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 31 | nvidia |
| 27 | meri last ticket dikhao | VIEW_BOOKINGS | — | —→—  pax=— | —→—  pax=— | getMyBookings | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 29 | nvidia |
| 28 | kal 2 ticket chahiye | BOOK_TRAIN | — | Amritsar→Ludhiana 2026-08-24 pax=2 | —→—  pax=— | updateBookingState | — | Y/N | N Y / G Y | N Y / G Y | Y | 1979 | 30 | nvidia |

## Who won which cases

- Gemini won: none
- NVIDIA won: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28
- Tie: none

## Safety

- NVIDIA remains default. Gemini cannot book, confirm, debit wallet, create PNR, or mutate booking/railway data.
- `extractWithGemini` always returns `confirmBook: false` and `executeTools: false`.
- Customer `/api/understand` still packs NVIDIA or deterministic NLU only.
- No API keys are written into this report.

## HTTP / quota

- RapidAPI Gemini HTTP 403 (not subscribed): cases 1, 3, 14, 18, 21, 24 (and similar)
- RapidAPI Gemini HTTP 429 (too many requests): remaining cases
- RapidAPI Gemini 5xx: 0
- RapidAPI Gemini timeout: 0
- NVIDIA timeout/error: 0

## Recommendation

**Do not replace NVIDIA.** RapidAPI Gemini Pro AI New did not return a single valid extraction this run. Subscribe the RapidAPI app to **Gemini Pro AI New**, then re-run `npx tsx scripts/rapidapi-gemini-ab-eval.mjs`. Even after that, keep NVIDIA as production until a subscribed run beats NVIDIA on intent, tools, entities, safety, and latency.

BookKaro production path is unchanged: NVIDIA gpt-oss-20b + deterministic NLU fast-path + RailCore/RailKit facts.
