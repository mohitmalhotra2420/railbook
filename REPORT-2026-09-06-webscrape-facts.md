# RailBook — Web-Scraping Fallback + Screenshot Bugs Fix Report
**Date:** 2026-09-06 | **Commits:** 6da1bc1 → **315ab9a** (7 commits) | **Deploy:** LIVE (Render) | **Tests:** 460/460 ✓ | **Server tsc:** 0 errors ✓

---

## 1. Naya Feature: Verified-Site Web Scraping (user request: "API se na mile to verified sites se le aao")

### `server/railway/webscrape.ts` (naya)
- **Scrape chain:** ixigo → ConfirmTkt → trainspnrstatus (jo pehle 200 + parseable data de)
- `fetchHtml`: Chrome/120 User-Agent, 9s timeout
- Parsers: `parseIxigo` (offset-safe scan), `parseConfirmTkt` ("Name - CODE" cells), `parseTrainSpnrStatus` ([#, NAME, CODE, arr, dep])
- `trainNameFromHtml`: h1/og:title se train ka naam (warna "12014" hi reh jata tha)

### `server/railway/router.ts`
- `routedSchedule()` dono branches mein **last-resort**: RailCore fail → RailKit fail → **web scrape**
- Provider labels: `web_ixigo` / `web_confirmtkt` / `web_trainspnrstatus`
- `scrapedAsSchedule()`: RailcoreSchedule-shape mein convert (runningDays/classes [], durationMinutes null)

### LIVE PROOF (prod pe, 2026-09-06):
RailCore key temporarily invalid karke test kiya (phir turant restore):
```
"12014 ka poora timetable do" →
12014 Amritsar Shtabdi — 8 stops. Route: 1. ASR Amritsar Jn (dep 04:55); ... 8. NDLS New Delhi (arr 11:02).
(Source: confirmtkt.com — railway API se nahi, verified web site se.)
```
✓ Source label har web-scraped reply mein. Key restore ke baad wapas RailCore se uppercase data aata hai (normal).

### Site research results:
| Site | Status |
|---|---|
| confirmtkt.com/train-schedule/N | ✓ PRIMARY (SSR, Node-fetch OK) |
| trainspnrstatus.com/train-schedule/N | ✓ backup |
| ixigo.com/trains/N | ⚠ Node se 403 (bot-detection) — chain mein rakha, fast-fail |
| erail, trainman, rail.yatri, trainspy, railwaysearch, etrain | ✗ dead (404/conn-fail/no-data) |

---

## 2. Screenshot ke 5 Bugs — Sab FIXED (prod verified)

| # | Screenshot sawaal | Pehle | Ab (prod) |
|---|---|---|---|
| 1 | "12014 ki top speed batana" | flat denial "mere paas available nahi" | **"Web se mila: Shatabdi Express ... run at a maximum permissible speed..."** + source label |
| 2 | "Vande Bharat ki top speed kya hai" | TRAIN_NAME hijack ("10 trains — kaunsi?") | **Vande Bharat Sleeper ka web answer** — koi train-list nahi |
| 3 | 22348 route | ✓ sahi tha | ✓ regression pass (11 stops) |
| 4 | "Maine to top speed poochi thi?" | phir flat denial | **Context ki train (12014/Shatabdi) se web answer** |
| 5 | "Kahan se kahan jaati hai" | "evidence mein nahi hai" | **22348 ka poora route** (pichhli train se) |

### Kaise fix kiya:
1. **`GENERAL_FACT_RE`** (context.ts, shared): top speed / max speed / kitni tez / average speed / kab chalu hui / history / kitne coach / engine ka naam / kaise kaam
2. **run.ts — naam-resolution skip**: fact-sawaal + koi number nahi → train-name resolve nahi (hijack khatam)
3. **run.ts — tool override**: fact-sawaal par getTimetable jaisa railway tool nahi chalta (pehle "top speed" par timetable aa jata tha)
4. **run.ts — deterministic web fallback** (model timeout par bhi):
   - Query **English** mein banti hai: train number → RailCore se naam (titlecase, SHTABDI→SHATABDI normalize) → "Amritsar Shatabdi 12014 top speed"
   - Follow-up mein number text me na ho → **context ki selected train** se
   - Retry: naam+number fail → bina number
   - Disambiguation pages ("may refer to:") skip
   - Reply: "Web se mila: ... (Source: ... — Ye railway API ka live data nahi, web-search ka jawab hai.)"
5. **agentic.ts — rule 23 strict**: "GENERAL-FACT sawaal par WEB_SEARCH PEHLA tool hai — train-list 'kaunsi?' bilkul nahi" + user-message mein dynamic System note nudge
6. **context.ts classifyFollowUp**: `kaha(n) se kaha(n)` pattern → timetable follow-up (+ Hindi कहां से कहां)

---

## 3. Prod Debugging Journey (interesting findings)

1. **Backspace bug**: Python heredoc se regex likhte waqt `\b` (single backslash) raw 0x08 control char ban gaya — regex kabhi match nahi karta tha. Char-code-level scan se pakda, fix kiya. (Ab regex-edits sirf node -e se.)
2. **DDG datacenter timeout**: Render ke AWS IPs se api.duckduckgo.com kabhi-kabhi hang → **Wikipedia ko primary** banaya, DDG secondary. Prod logs se confirm hua (webLookup fetch_error TimeoutError).
3. **SHTABDI spelling**: RailCore "SHTABDI" deta hai, Wikipedia mein "Shatabdi" — query 0 results de rahi thi. Normalize kiya.
4. **Hinglish query fail**: live test — "12014 ki top speed batana" raw query → 0 results; "Amritsar Shatabdi 12014 top speed" → 2 results. Isliye English query construction.

---

## 4. Delivery

- **Git:** `git push` ✓ (main = 315ab9a, GitHub mohitmalhotra2420/railbook)
- **Deploy:** Render auto-deploys via GitHub — **LIVE**: https://railbook-gegs.onrender.com
- **Zip:** `railbook-webscrape-facts.zip` (2.1 MB, 209 files, .env excluded)
- **Tests:** 460/460 (4 naye: kahan-se-kahan ×2 patterns, top-speed web ×2)
- **Safety unchanged:** booking-critical par web data kabhi nahi; live time/fare/seats sirf railway API se; source hamesha labeled

## 5. Baseline Changes
- Tests: 456 → **460**
- Server tsc: 0 (unchanged) | Client tsc: baseline (unchanged, koi client change nahi)
- Tools: 16 (unchanged)
