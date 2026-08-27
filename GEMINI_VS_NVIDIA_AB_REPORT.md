# Gemini vs NVIDIA A/B report

Date: 2026-08-23 (Asia/Calcutta). Cases: 25. Re-run after a new `GEMINI_API_KEY`.

**This run could not score Gemini quality.** Google Generative Language API rejected the new key on every call (`HTTP 400` / `API key not valid`) via both `x-goog-api-key` and `?key=` on v1 and v1beta. The key value is **not** written here.

Fix for a real A/B: create a valid [Google AI Studio](https://aistudio.google.com/apikey) key, enable **Generative Language API** on that Cloud project, put it in server-only `GEMINI_API_KEY`, then re-run `npx tsx scripts/gemini-ab-eval.mjs`.

**Mode:** Gemini is SHADOW / EVALUATION only. NVIDIA remains the production default.
Gemini output is never applied to the customer reply, never runs tools, never books, never debits the wallet. NVIDIA “wins” below are **auth failures**, not language-quality wins.

| Provider | Role | Model |
|---|---|---|
| NVIDIA | production / primary | openai/gpt-oss-20b |
| Gemini | shadow / eval | gemini-3.6-flash |

## Headline scores

| Metric | NVIDIA | Gemini |
|---|---:|---:|
| Intent accuracy | 100% | 0% |
| Entity accuracy | 80% | 0% |
| Tool-selection accuracy | 100% | 40% |
| JSON validity | 100% | 0% |
| Context accuracy | 100% | 96% |
| Missing-slot handling | 100% | 100% |
| Safety accuracy | 100% | 100% |
| Average latency | 958 ms | 114 ms |
| P95 latency | 4490 ms | 255 ms |
| Timeout / error rate | 0% | 100% |

## Per-case

| # | Utterance | NVIDIA intent | Gemini intent | NVIDIA entities | Gemini entities | NVIDIA tool | Gemini tool | JSON N/G | Context | Missing | Safety G | NVIDIA ms | Gemini ms | Winner |
|---:|---|---|---|---|---|---|---|---|---|---|---|---:|---:|---|
| 1 | Mujhe Amritsar se Ludhiana jaana hai | BOOK_TRAIN | — | Amritsar→Ludhiana  pax=— | —→—  pax=— | updateBookingState | — | Y/N | N Y / G Y | N Y / G Y | Y | 2944 | 95 | nvidia |
| 2 | Kal Amritsar se Delhi ki 2 ticket book karni hain | BOOK_TRAIN | — | Amritsar→Delhi 2026-08-24 pax=2 | —→—  pax=— | updateBookingState | — | Y/N | N Y / G Y | N Y / G Y | Y | 1949 | 70 | nvidia |
| 3 | 12014 ka live status batao | LIVE_TRAIN_STATUS | — | —→—  pax=— 12014 | —→—  pax=— | getLiveStatus | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 76 | nvidia |
| 4 | 12014 mein CC available hai? | CHECK_AVAILABILITY | — | —→—  pax=—  CC | —→—  pax=— | getAvailability | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 125 | nvidia |
| 5 | 12014 ka CC fare? | CHECK_FARE | — | —→—  pax=—  CC | —→—  pax=— | getFare | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 70 | nvidia |
| 6 | CC kya hota hai? | GENERAL_RAILWAY_KNOWLEDGE | — | —→—  pax=—  CC | —→—  pax=— | none | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 114 | nvidia |
| 7 | meri ticket history dikhao | VIEW_BOOKINGS | — | —→—  pax=— | —→—  pax=— | getMyBookings | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 281 | nvidia |
| 8 | PNR check karo | CHECK_PNR | — | —→—  pax=— | —→—  pax=— | checkPNR | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 67 | nvidia |
| 9 | wallet mein kitne paise hain? | VIEW_WALLET | — | —→—  pax=— | —→—  pax=— | getWallet | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 150 | nvidia |
| 10 | Jammu se Beas jaana hai | BOOK_TRAIN | — | Jammu→Beas  pax=— | —→—  pax=— | updateBookingState | — | Y/N | N Y / G Y | N Y / G Y | Y | 1927 | 68 | nvidia |
| 11 | pehli wali | SELECT_TRAIN | — | —→—  pax=— | —→—  pax=— | selectTrain | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 76 | nvidia |
| 12 | doosri wali | SELECT_TRAIN | — | —→—  pax=— | —→—  pax=— | selectTrain | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 147 | nvidia |
| 13 | 12014 wali | SELECT_TRAIN | — | —→—  pax=— | —→—  pax=— | selectTrain | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 73 | nvidia |
| 14 | 12014 aur 14542 mein kaunsi better hai? | COMPARE_TRAINS | — | —→—  pax=— | —→—  pax=— | compareTrains | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 75 | nvidia |
| 15 | 12014 ka live status batao | LIVE_TRAIN_STATUS | — | —→—  pax=— 12014 | —→—  pax=— | getLiveStatus | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 139 | nvidia |
| 16 | Kal | SEARCH_TRAIN | — | Amritsar→Ludhiana 2026-08-24 pax=— | —→—  pax=— | searchTrains | — | Y/N | N Y / G Y | N Y / G Y | Y | 1736 | 64 | nvidia |
| 17 | Nahi, Ludhiana se jaana hai | BOOK_TRAIN | — | Ludhiana→Delhi  pax=— | —→—  pax=— | updateBookingState | — | Y/N | N Y / G N | N Y / G Y | Y | 7004 | 74 | nvidia |
| 18 | 12014 cancel hai? | CANCELLED_TRAINS | — | —→—  pax=— 12014 | —→—  pax=— | getCancelledTrains | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 254 | nvidia |
| 19 | Amritsar se cancelled trains batao | CANCELLED_TRAINS | — | —→—  pax=— | —→—  pax=— | getCancelledTrains | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 255 | nvidia |
| 20 | Haan book kar do | BOOK_TRAIN | — | Amritsar→Ludhiana 2026-08-24 pax=— | —→—  pax=— | updateBookingState | — | Y/N | N Y / G Y | N Y / G Y | Y | 4490 | 56 | nvidia |
| 21 | 12014 abhi kaha hai? | LIVE_TRAIN_STATUS | — | —→—  pax=— 12014 | —→—  pax=— | getLiveStatus | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 255 | nvidia |
| 22 | 12014 kitni late hai? | LIVE_TRAIN_STATUS | — | —→—  pax=— 12014 | —→—  pax=— | getLiveStatus | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 71 | nvidia |
| 23 | fast wali kaunsi hai? | SELECT_FASTEST | — | —→—  pax=— | —→—  pax=— | selectTrain | — | Y/N | N Y / G Y | N Y / G Y | Y | 1938 | 83 | nvidia |
| 24 | Nahi, parso | SEARCH_TRAIN | — | Amritsar→Ludhiana 2026-08-25 pax=— | —→—  pax=— | searchTrains | — | Y/N | N Y / G Y | N Y / G Y | Y | 1951 | 54 | nvidia |
| 25 | Nahi, 3 passengers | BOOK_TRAIN | — | —→—  pax=3 | —→—  pax=— | updateBookingState | — | Y/N | N Y / G Y | N Y / G Y | Y | 0 | 67 | nvidia |

## Who won which cases

- Gemini won: none
- NVIDIA won: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25
- Tie: none

## Safety

- NVIDIA remains default. Gemini cannot book, confirm, debit wallet, create PNR, or mutate booking/railway data.
- `extractWithGemini` always returns `confirmBook: false` and `executeTools: false`.
- Customer `/api/understand` still packs NVIDIA or deterministic NLU only.
- No API keys are written into this report.

## Recommendation

NVIDIA scored at least as well as Gemini on this set. **Do not replace NVIDIA.**
Keep Gemini in shadow/eval if you want more samples.

BookKaro production path is unchanged: NVIDIA gpt-oss-20b + deterministic NLU fast-path + RailCore/RailKit facts.
