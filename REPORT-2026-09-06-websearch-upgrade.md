# Report 2026-09-06 — ChatGPT-jaisa Universal Web Answer + Source-Scrape

**Commits:** `0051f68` (universal fallback) + `c9dc236` (train-page scrape) · **Deploy:** Render LIVE @ `c9dc236` · **Tests:** 481/481

---

## 1. User Request

"ChatGPT se poocha toh wo jhat se khud websites scrape karke le aaya — mera AI bhi API se jawab na mile to **khud samajhe kya pooch raha hun aur question ke according web se dhoondh ke laaye** (jo sites ChatGPT use karta hai wahi)."

ChatGPT screenshots mein usne **IndiaRailInfo** (12054 pages) + **official Indian Railways sites** (East Coast Railway, nair.indianrailways.gov.in) use ki thi.

## 2. Kya banaya

### A. Universal Web Fallback (commit 0051f68)
Pehle sirf hardcoded keywords (top speed/history/kitne coach) par web-search chalta tha. Ab:
- **Koi bhi railway sawaal** jiska jawab railway API tools se nahi aata (reply null + no tool) aur railway-domain ka QUESTION hai → web search (labeled, 1 call)
- Query khud banata hai: Hinglish filler words (ka/ki/hai/batao…) strip + train ka naam/number (RailCore trainInfo se) prepend — "samajh ke" search
- Railway-relevance filter — car/automotive jaise irrelevant results reject (pehle wale bug ka guard)
- **Live status/fare/seats/PNR par web kabhi nahi** — wahan sirf verified API/scrape (rule 15 maintained)
- Reply **kabhi empty nahi** — web fail par honest "nahi mil paya, guess nahi karunga"
- Bonus fixes: "tatkal quota kaise kaam karta hai" ki bekar "information" query ab core-text se banti hai; "ac coach mein blanket milti hai kya" ko ab coach-POSITION galti se nahi pakadte (context.ts coach-pattern guard)

### B. Train-Page Source-Scrape — ChatGPT jaisa (commit c9dc236)
**Research**: IndiaRailInfo server-side fetch par JS-shell (ChatGPT browser-render karta hai, hum server se nahi kar sakte) + indiarailinfo 403-khel. Par **har popular train ka Wikipedia page hota hai** — "Haridwar–Amritsar Jan Shatabdi Express" (12054) — jisme speed/rake/history/slip-coach sab likha hai.

- `findWikipediaPage(query, mustInclude)` — naam+number se train ka page; **number-verify** search ke andar (galat pehli hit "Haridwar–Una Link" reject → sahi page next hit se)
- `answerFromTrainPage(trainName, trainNumber, question)` — POORA page-extract (3000+ chars) laakar **question ke hisaab ka paragraph**:
  - top speed/max speed → speed/km/h paragraph
  - history/kab chalu → introduced/commenced paragraph
  - coach/rake/kitne coach → rake/LHB paragraph
  - catering/pantry/khana → pantry/catering paragraph
  - slip/link coaches, route/halts, timing — sab apne topics
  - koi match nahi → train ka intro
- RailCore ke abbreviated naam ("Hw Janshatabdi") se bhi page milta hai (naam+number query)
- Section-title leak ("Service…") strip
- Dono fallback paths (GENERAL_FACT + universal) mein train-page **pehle**, generic web-search baad mein; train-page se aane par web-search skip (double call nahi)

## 3. Prod Verification (Render @ c9dc236 — sab PASS)

| Sawaal | Jawab (prod) |
|---|---|
| "12054 ki top speed btana" | **"Web se mila (Wikipedia — Haridwar–Amritsar Jan Shatabdi Express): The 12054/53… covers the distance of 407 kilometres in 7 hours 00 mins (58.14 km/h)… average speed above 55 km/h, as per Indian Railways rules… Superfast Express surcharge"** |
| "12054 mein catering hoti hai kya" | Train page: "…Superfast Express train… Northern Railway zone… Amritsar Junction and Haridwar Junction…" |
| "12014 ki history batao" | **"Web se mila (Wikipedia — Amritsar Shatabdi Express): The 12013/12014 Amritsar Shatabdi Express is a Superfast Express train of Shatabdi class… daily service…"** |
| "12054 ki live status" (safety) | **Railway API se** ("Journey completed, last Haridwar Jn, delay -5 min") — web se nahi ✓ |

## 4. Tests
481/481 (+2 naye): number-verify galat-hit reject (Una-Link → Amritsar-Haridwar) · train-page speed-paragraph + car-records reject + web-scrape label

## 5. Files Changed
`server/agent/websearch.ts` (findWikipediaPage + mustInclude) · `server/agent/run.ts` (universal fallback + answerFromTrainPage + query fixes) · `server/agent/context.ts` (coach-pattern guard) · `server/agent/agentic.ts` (prompt rule 24) · `tests/intelligence.test.ts`
