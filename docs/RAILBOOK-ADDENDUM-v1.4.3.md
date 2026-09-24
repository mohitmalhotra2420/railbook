# RailBook — Addendum v1.4.3 (24 Sep 2026)

**Release:** `c552093` (Render deploy `dep-daqi4mm7bikc738jp9gg` — **live**, 24 Sep 2026 13:16 UTC)
**APK:** `RailBook-v1.4.3-release.apk` — versionCode **26**, versionName **1.4.3-voice-seat-intent**

---

## 1. Naya: "bolne wala" screen (VoiceSheet)

ConfirmTkt ke "Listening" screen jaisa:

- Mic dabate hi **sheet** khulti hai — jo bolte ho wo **live** likha jata hai (interim transcript).
- **Chips** (ek tap me sawaal): Get Confirmed Ticket · AC Trains · 2A me seat? · Best Alternatives.
- **Bada mic** (level ke saath ring pulse) + **✍️ Type** (keyboard) + **✕** (cancel).
- **OK ✓ Bhejo** dabane par hi sawaal jata hai — **auto-send band** (manual commit pehle se tha, ab dikhta bhi hai).

Purana inline voice panel hata diya gaya (ek hi jagah voice UI). Naya file: `src/components/VoiceSheet.tsx` (+ `.vs-*` CSS).

## 2. Naya: server-side seat intent (AI-side samajh)

Server khud bhasha padh kar filter karta hai — `server/understand/seatIntent.ts` + `server/agent/seatFilter.ts`:

- **Class:** 1A / 2A / 3A / 3E / SL / CC / 2S / EC (+ "sab class" → sab).
- **Seat words:** seat / सीट / सीटें / बर्थ / खाली / उपलब्ध / available.
- **Sort:** "sabse sasti / low fare" → fare asc · "sabse fast / jaldi" → duration asc.
- **Time:** "5 baje ke baad" → 17:00 · "रात 8 के बाद" → 20:00 · "17:30 ke baad" → 17:30 (Hinglish + Devanagari numerals).
- **Quota** (TQ/PT/LD) aur **sirf confirmed** bhi.

AI jawab ke saath ek **seat line** append hoti hai; `seatFilter` payload bhi response me aata hai (client fallback ke liye).
Agar model jawab na de aur seat intent ho → deterministic seat reply (`source: "evidence"`).

**Feature flag:** `SEAT_FILTER_SERVER` (default **ON**; `0/false/off` → purana behaviour).

### Live proof (railbook-gegs.onrender.com, 24 Sep)

| Sawaal | Result |
|---|---|
| "Ludhiana se New Delhi 2A mein seat hai kal?" | `💺 2A me seat wali 6 trains — 14036 2A AVL 40 ₹845 · 11078 2A AVL 29 ₹825 … (LDH → NDLS · live board)` — source `evidence`, 6 rows |
| "Ludhiana se New Delhi kal 3A mein sabse sasti seat wali train" | `sort: cheapest`, `💺 3A me seat wali 3 trains · sabse sasta pehle — 11078 3A AVL 98 ₹585 · 14036 3A AVL 185 ₹600 · 22706 3A AVL 248 ₹730` |
| "लुधियाना से नई दिल्ली रात 8 के बाद स्लीपर में सीट चाहिए कल" | `classes: [SL]`, `afterMinute: 1200`, line: `💺 SL me aaj koi seat wali train nahi mili (20:00 ke baad). 1 trains ka time pata nahi chal paya.` |

"Delhi" likhne par (multi-station) pehle station choice aata hai — phir seat filter. Ye purana behaviour hai, badla nahi.

## 3. Seat Finder client layer (fallback) — pehle jaisa

`src/seatfinder.ts` + `src/components/SeatFinder.tsx`: chat ke train table **aur** journey plan card — dono par chips (✅ Confirmed only · class · Time · ⚡ Sabse jaldi · 💰 Sabse sasta), **seats upar / WL neeche**, board-only trains "time —" ke saath. Ye AI down hone par bhi chalta hai.

## 4. Jo **nahi** chhua (user condition)

- AI ka search karne ka tareeka, tools/API calling ka tareeka — **waisa hi**.
- Alternatives + connecting journeys ka logic — **waisa hi**.
- Seat filter sirf **maujooda route-board** par lagaya gaya (koi naya endpoint/tool nahi).

## 5. Tests / build

- Naye tests: `tests/server-seat-intent.test.ts` (9), `tests/voice-sheet.test.tsx` (5) — kul **90 files / 911 tests PASS**.
- `npm run build` OK.
- APK sha256: `1239b443746196316747aa78ff1966a8e2e6c3f359645e8654e78d2f9bc43226` (cert SHA-256 `c2e38a05…d176`, v1.4.2 par in-place upgrade).

---

## 6. Round-15.1 — user screenshots ke 3 fix (24 Sep, commit `b2a7b55`, deploy `dep-daqj42ou01pc738bvhf0` LIVE)

| # | Shikayat (screenshot) | Kyun ho raha tha | Fix |
|---|---|---|---|
| 1 | Results card me **Swarn Shatabdi ki sirf ek class** ("CC AVL") dikh rahi thi, jabki **EC bhi available** thi | Route board kuch classes **UNKNOWN** ke saath deta hai (12029 me `EC: UNKNOWN`), aur card UNKNOWN ko seat list me nahi dikhata | Seat Finder ab adhoori trains ka **per-train class board** laata hai (wahi `/api/availability?trainNumber=…` jo TrainBoard "Refresh seats" use karta hai) aur UNKNOWN row ki jagah **asli row** rakhta hai. Live: 12029 → `CC AVL 86` + **`EC AVL 6 ₹660`**. Max 10 trains, 3 ek saath, koi naya endpoint nahi |
| 2 | "12029 ki seat availability CC 2026-09-25 ko LDH se BEAS" → AI ne seat nahi batayi, "provider se nahi mil pa rahi" | App **`/api/agent`** (agentic) path use karta hai; humara seat-intent filter sirf `/api/agent/auto` (autonomous) me lagaya gaya tha. 6-parallel load test me provider **http_429** bhi mila | Seat intent ab **app ke path par** bhi: `parseSeatIntent` → maujooda route-board filter → jawab ke saath honest seat line (AI fail/429 ho to **akeli line**). Boli gayi train ki row pehle. Koi naya tool/endpoint/planner change nahi. Live: `💺 CC me seat wali 1 train — 12029 CC AVL 86 ₹345. (LDH → BEAS · live board)` |
| 3 | "AC trains dikhao" par **2S / SL** bhi dikh gayi thi | "AC" ko koi class-word nahi maana jaata tha → koi filter nahi lagta tha; client me `\bec\b` ka matlab galat se **CC** tha | AC = **1A/2A/3A/3E/CC/EC** (server `classGroup: "AC"` + client `acOnly` + **❄️ AC** chip, preview me bhi). `EC` (Executive Chair Car) ab CC nahi banta. Live: `💺 AC (1A/2A/3A/3E/CC/EC) me seat wali 8 trains — 12203 3A AVL 220 ₹285 · 12029 CC AVL 86 ₹345 · …` |

**Saath me:** mic permission wala message ab action batata hai — "Allow popup me Allow dabao — ya Settings → Apps → RailBook → Permissions → Microphone ON karo … chaaho to type bhi kar sakte ho".

**Jo nahi chhua:** AI search/tools/API calling, alternatives + connecting journeys logic — sab waisa hi (user condition).

**Load test (6 parallel seat sawaal):** 5 clean pass, 1 me `source=none failureReason=http_429` — ye model-provider ka rate-limit tha, aur **ab us case me bhi seat line** user ko milti hai (fallback flag `seatFilterFallback: true`).

**APK:** v1.4.3 hi chalega — app WebView me live site (`railbook-gegs.onrender.com`) kholta hai, isliye ye teeno fix app me apne aap aa gaye. Naya APK chahiye to bolo (v1.4.4 bump kar denge).

**Tests:** 90 files / **925 PASS** (`npm run build` clean).

---

## 7. Round-15.2 — naye screenshots (build `b2a7b55`) ke fix — commit `b8f510e` (LIVE)

| Screenshot | Kya dikha | Asli wajah | Fix |
|---|---|---|---|
| 1 & 4 | Seat Finder card me **SAARI 28 trains "data nahi aayi"**, SEAT 0 rows, WAITLIST 0 rows | Us waqt **route board call khaali aayi** thi (provider busy/rate-limit — hamare 6-parallel load test me bhi ek baar `http_429` mila). Card khaali board par har train ko "data nahi aayi" list kar deta tha | `fetchRouteBoard` **ek baar khud retry** karta hai, FAIL **cache nahi** hota; board poora khaali ho to card saaf kehta hai **"Live board abhi nahi aa payi (provider busy)" + ↻ Dobara try karo** (28-row confusion nahi). Saath me pehle **6 trains ka per-train board** khud try hota hai taaki asli data dikhe |
| 2 | "Mujhe kal ludhiana se beas ki 2A ki seats dikhana" → **journey plan card** dikha, seat jawab nahi | Seat line reply me **thi**, par journey card wale message me AI text **"AI note — tap karo"** me collapse ho jata hai → jawab chhup gaya | Seat line (💺 …) ab **card ke UPAR hamesha** dikhti hai (baaki text pehle jaisa note me) |
| 4 & 6 | "AC trains dikhao" → 2S/SL bhi | (round-15.1 me theek) ab AC = 1A/2A/3A/3E/CC/EC; **❄️ AC** chip live hai | — |
| — | 2A poochhne par **WL ka pata hi nahi chalta tha** | `onlyAvailable` WL rows ko hata deta tha → line "koi seat wali train nahi mili" keh kar chup ho jaati thi | Ab WL rows alag se nikaal kar line: **"💺 2A me abhi koi AVAILABLE/RAC seat nahi — WL wali 13 trains hain: 18103 2A WL 1 ₹725 · 11057 2A WL 1 ₹725 · 12483 2A WL 5 ₹770. Confirm% hum nahi dete…"** (live verified) |

**Tests:** 90 files / **928 PASS**.

### "ConfirmTkt seconds me kaise?" (user sawaal)
ConfirmTkt apna **data pipeline cache** rakhta hai (unke paas apna scraping/DB layer hai) + parallel queries, isliye instant lagta hai. Hum **live providers** (railyatri / ConfirmTkt web / erail) se per-train data laate hain — isliye kabhi provider busy hone par slow/empty milta hai (jaise screenshot 1 me). Isi liye humne retry + honest "board nahi aayi" state + per-train fallback add kiya — **jhooth nahi, dheema sahi**.

---

## 8. Round-17 — AI khud seat/filter ka sawaal handle karta hai (naya tool `findSeats`) — commit `6bbf2a8`, deploy `dep-daql08m7bikc73fr3dg0` **LIVE**

User brief: *"Haan yeh kro do not specific to 2A, user kuch bhi pooch sakta hai"* — matlab sawaal **2A tak seemit nahi**; AI khud samjhe, khud decide kare kaunsa tool chalana hai, aur **live** data se poora jawab de. Kuch bhi fake nahi.

### 8.1 Naya tool (ek hi naya hissa)

`server/agent/seatFinderTool.ts` → **`runFindSeatsTool(...)`**

| Input | Values | Note |
|---|---|---|
| `from`, `to`, `date` | station code / name, `YYYY-MM-DD` | `stationCode()` se normalize |
| `class_code` | `2A`/`3A`/`1A`/`3E`/`CC`/`EC`/`SL`/`2S`, `AC`, `ALL` | `classesFromArg()`: `AC` → 1A/2A/3A/3E/CC/EC, `ALL` → saari |
| `only_available` | bool | WL rows alag rakhta hai (`wlRows`) |
| `depart_after` | `"17:00"`, `"5 baje ke baad"`, `"raat 9 ke baad"` | `minutesFromArg()` → departure-minute filter |
| `sort_by` | `cheapest` / `fastest` | — |
| `train_numbers` | `["12029"]` | specific train ke sawaal |
| `quota`, `passengers` | optional | — |

Output: `{ ok, source, summary, data { from, to, date, classCodes, onlyAvailable, rows, wlRows, missingClass, unknownTime, summary } }`.

**Data kahan se (koi naya source nahi):** maujooda **routedRouteBoard + routedClassBoard** (wahi endpoints jo Seat Finder/TrainBoard use karte hain) — 6 trains batch me, 25s budget, per-train fallback.

### 8.2 AI ise kaise use karta hai

- Tool dono engines me register: `agentic.ts` (`FIND_SEATS` + ArgSchema + executor) aur `autonomous.ts`/`autoTools.ts` (`findSeats`; `case "findSeats"`).
- Dono **system prompts me "SEAT RULE"**: seat/class/filter ka sawaal aaya → **pehle tool, phir jawab**; apni yaad se seat kabhi nahi; WL par confirm% kabhi nahi; 3-5 trains.
- **Duplicate jawab band:** AI ne khud `findSeats` chalaya aur clean jawab likha → server wali deterministic seat line **attach nahi** hoti (`app.ts` ~L278, `autonomous.ts` ~L1027). Pehle dono aate to 2 jawab dikhte.

### 8.3 Live proof (`railbook-gegs.onrender.com`, build `6bbf2a8`, 24 Sep)

| Sawaal (LDH → BEAS, 25 Sep 2026) | AI ka tool | Time | Jawab (asli) |
|---|---|---|---|
| 2A me kaunsi train me seat hai … kal | `FIND_SEATS` | 22.5s | `14719 BKN ASR EXP · 2A · AVAILABLE 84 seats · ₹725` + "23 trains check ki gayi, 2A me seat sirf 1 train me hai" |
| AC trains dikhao | `FIND_SEATS` | 15.3s | 9 AC trains: `14719 3A 306 ₹520`, `12203 3A 220 ₹285`, `12029 CC 86 ₹345` … |
| sabse sasti seat wali | `FIND_SEATS` | 21.0s | `14679 2S 373 ₹65`, `12497 2S 80 ₹80`, `12053 2S 852 ₹90`, `14719 SL 287 ₹150` |
| sirf confirmed seat wali | `FIND_SEATS` | 20.6s | Sirf AVAILABLE list (`12053 2S 852 ₹90` …), WL hataayi |
| raat 9 baje ke baad ki trains me seat | `FIND_SEATS` | 12.5s | Saaf "koi bhi train me seat available nahi" (21:00+) — **jhooth nahi** |
| 2A me WL kitni hai | `FIND_SEATS` | 34.0s | Available + WL dono: `14719 2A AVL 84 ₹725`, `18103 WL 1 ₹725`, `12483 WL 5 ₹770` — WL par **koi confirm% nahi** |
| 12029 me CC seat hai kya | `FIND_SEATS` + `CHECK_AVAILABILITY` | 179.5s* | `12029 CC WL 1 ₹415` (railyatri/IRCTC data) + alternative `12497 CC AVL 28 ₹320` |
| AUTO mode (`/api/agent/auto`) 2A sawaal | khud chune: search + per-train availability | 19.5s | Wahi asli jawab, `toolsUsed` me AI ke apne calls |

\* Ye ek case **180s** le gaya — us waqt railway API down thi, isliye scraper fallback (railyatri/ConfirmTkt web) chala. Data sahi, sirf slow. Baaki sawaal **12.5–34s** me.

### 8.4 Jo **nahi** chhua (user condition — binding)

AI ka search karne ka tareeka, tools-aur-API calling ka way, alternatives + connecting journeys ka poora logic — **jaisa tha waisa hi**. Sirf **ek naya tool** + prompt rule + duplicate-line suppression add hua; koi purana endpoint/logic/filter nahi badla.

### 8.5 Tests / deploy

- Naye tests: `tests/find-seats-tool.test.ts` (11) — tool registry dono engines me, `classesFromArg`/`minutesFromArg`, AC = 1A/2A/3A/3E/CC/EC, WL par confirm% nahi, per-train board fallback. `tests/agentic-toolcalling.test.ts` list 23 → **24 tools**.
- Kul: **91 files / 939 tests PASS**; `npm run build` clean.
- Deploy: `dep-daql08m7bikc73fr3dg0` @ `6bbf2a8`. Pehla deploy "live" hua par `/api/version` **purana commit** dikha raha tha (stale build) → **clear-cache redeploy** ke baad `6bbf2a8` confirm.
- APK: **v1.4.3 hi chalega** — app WebView me live site kholta hai, isliye ye sab app me apne aap aa gaya. Naya APK chahiye to v1.4.4 bump kar denge.

---

## 9. Round-19 — "subah" ka time window, Seat Finder me **saari** AVL classes, seat jawab card ke upar — commits `9d17ba3` + `f3f9090`, deploy `dep-daqm8cbtqb8s73b59dt0` **LIVE**

User ke round-18 screenshots + round-19 note, teen cheezein:

1. **Seat Finder "✅ Available"** me sirf **2 trains / 3 rows** aa rahi thi — jabki usi screen ke **upar wale card** me `12926 2A AVL 5 / 3A AVL 24 / SL AVL 8`, `11078 2A AVL 8` dikh rahi thi ("direct mein bahut si trains available hai lekin neeche seat finder mein avl mein sabhi show nhi kar rhi… sabhi available classes bhi nhi aa rhi").
2. **"Mujhe kal subha ki trains btana amritsar se ludhiana ki"** → poori din ki list (14:25 / 16:50 / 18:55 bhi). "AI ko kya mera question samajh nahi aaya jo relevant tool call nahi kiya."
3. Plan/journey card ke saath seat ka jawab **"AI note — tap karo"** ke andar chhup jata tha.

### 9.1 Time window (subah / dopahar / shaam / raat + "X se pehle")

| Shabd | Window |
|---|---|
| subah / subha / savere / morning | 04:00–12:00 |
| dopahar / afternoon | 12:00–17:00 |
| shaam / evening | 17:00–21:00 |
| raat / night | 21:00 → 04:00 (wrap) |
| "12 baje se pehle" / "8 baje se pahle" | upper bound only |
| "subah 8 se pehle" | 04:00–08:00 (dono bound) |
| "raat 9 ke baad" | 21:00+ (ghadi jeetti hai) |

- Server: `server/understand/seatIntent.ts` (`TIME_WINDOWS`, `beforeMinute`, `departAfterMinute`, `departBeforeMinute`, `windowLabel`) → `server/agent/seatFilter.ts` (`inTimeWindow`, `pickSeatRows` window + `unknownTime` count, line me "Subah (04:00–12:00)").
- Tool: `findSeats` me `depart_after` ab **shabd bhi** samajhta hai (`"subah"`, `"raat"`), aur **`depart_before`** naya. Dono engines me same.
- AI: dono system prompts me **TIME-WINDOW RULE** — "subah/dopahar/shaam/raat" ka sawaal aaya to **pehla tool call FIND_SEATS** ho, aur jawab me sirf usi window ki trains; poora din ki list mat do.
- Client: `src/seatfinder.ts` me wahi WINDOWS + `beforeMin`, `src/components/SeatFinder.tsx` ke **Time** chip me 🌅 Subah / ☀️ Dopahar / 🌇 Shaam / 🌙 Raat options (auto-select jab user ne window boli ho).

> **Round-19b me ek chhupa bug bhi mila (live verify ke dauraan):** window sirf tab banti thi jab sawaal me **koi digit na ho** — "kal subha **2A** me seat" ka `2A` window ko hata deta tha. Ab sirf asli **clock reading** (`17:00`, `9 baje`) window ko rokta hai; class/train/passenger/date ke digits nahi. Server + client dono me fix (test: `tests/server-seat-intent.test.ts`).

### 9.2 Seat Finder ka data base = **card ke apne per-train rows**

- `Concierge.tsx` plan ke **direct options ke `classOptions`** (jo card me dikhte hain — per-train, har class probed, AVL/RAC/WL) ko Seat Finder ko **`cardBoard`** ke roop me deta hai; `SeatFinder.tsx` unhe **base** banata hai aur route board se sirf **missing** classes/trains jodta hai (`mergeBoardsPreferCard`).
- Isliye ab **upar card aur neeche Seat Finder ke numbers ek jaise** hain (wahi data), aur jin trains ki poori class-list card me thi wo Available list se gayab nahi hoti.
- Live proof (LDH → MTJ · 25 Sep, asli board): **pehle** 2 trains / 3 rows (`11078 3A AVL 18 · 11058 3E RAC 42 · 11058 2A RAC 6`) → **ab** 6 rows: `12926 3A AVL 23 ₹915 · 11078 2A AVL 8 ₹1,070 · 12926 SL AVL 8 ₹360 · 11078 3A AVL 7 ₹760 · 12926 2A AVL 5 ₹1,270 · 11058 2A AVL 2 ₹1,210`. Kyun badla: route board (ek call me saare trains) **purana/adhoora** ho sakta hai (12926 ko sab WL batata tha), per-train board fresh hota hai — ab card ka per-train data hi base hai. **Kuch bhi banaya hua nahi.**

### 9.3 Seat jawab card ke neeche nahi chhupta

`server/app.ts`: `hasPlanCard = journey || alternatives` — jab card hai to 💺 seat line **card ke upar** dikhti hai (pehle "AI note" me collapse ho jaati thi). Bina card wale sawaal par purana rule: AI ne khud `FIND_SEATS` chalaya ho to duplicate line nahi.

### 9.4 Live proof (build `f3f9090`, 24 Sep 17:57 UTC)

| Sawaal | AI ka tool | Time | Jawab (asli) |
|---|---|---|---|
| Mujhe kal subha ki trains btana amritsar se ludhiana ki | `FIND_SEATS` | 20.0s | Sirf **Subah 04:00–12:00**: `12014 CC AVL 357 ₹510 (04:55)`, `12318 SL AVL 95 ₹180 (05:55)`, `14720 SL AVL 388 ₹150 (08:10)`, `12926 SL AVL 151 ₹180 (07:20)` — 16:50/18:55 **gayab** |
| Mujhe kal subha **2A** me seat wali trains batao LDH se BEAS | `FIND_SEATS` | 43.8s | `14719 2A AVL 84 ₹725 (04:25)` + "23 trains check ki gayi… 10 trains me ye class hi nahi hai" |
| Mujhe kal subha ki trains batao LDH se BEAS | `FIND_SEATS` | 62.9s | `14719 3A AVL 306 ₹520 (04:25)`, `14719 SL AVL 287 ₹150`, `14631 SL AVL 154 ₹150 (04:46)`, `12029 CC AVL 86 ₹345 (11:11)` |
| LDH se BEAS kaise jau kal plan batao (koi window nahi) | `RANK_JOURNEY_OPTIONS` | 198s | Poora plan card (32 options) — jaisa pehle tha, wahi |
| 2A me seat hai kya (window ke bina) | — (server line) | 6.2s | `💺 2A me abhi koi AVAILABLE/RAC seat nahi — WL wali 13 trains hain…` + "Confirm% nahi dete" |

"Test pass hote to live par kaam kyu nahi karta tha?" — Round-19 me ye bhi theek kiya: pehle tests **hisse** test karte the (filter, parse, UI) par **turn ka assembly** aur **digit-guard** wala path koi test nahi utha raha tha. Ab `tests/round19-seat-line-turn.test.ts` asli `/api/agent` turn ka jawab check karta hai (card + 💺 line, duplicate suppression, AI-fail fallback, window slots).

### 9.5 Jo **nahi** chhua

AI ka search/planning ka tareeka, tools-aur-API calling ka flow, alternatives + connecting journeys ka poora logic, journey ranking — **jaisa tha waisa hi**. Sirf: window padhna (server+client), window wale sawaal par `findSeats` ka prompt + params, aur seat line ka dikhne ka niyam.

### 9.6 Tests / deploy

- Naye/updated: `tests/find-seats-tool.test.ts` (14), `tests/server-seat-intent.test.ts` (21), `tests/seat-finder-card.test.tsx` (12), **`tests/round19-seat-line-turn.test.ts` (naya, 6)**.
- Kul: **92 files / 957 tests PASS**; `npm run build` OK; server `tsc` clean.
- Deploy: `dep-daqm06psrm7s73dj27e0` @ `9d17ba3` → `dep-daqm8cbtqb8s73b59dt0` @ `f3f9090` (`/api/version` se confirm).
- APK: **v1.4.3 hi chalega** (app WebView me live site kholta hai) — ye sab app me apne aap aa gaya. Naya build chahiye to v1.4.4 bump kar denge.
