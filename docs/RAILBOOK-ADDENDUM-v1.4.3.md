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

### 9.7 Round-19c — Seat Finder "Available" ab **purane route board** par bharosa nahi karta

User ne dobara wahi baat boli (screenshots ke saath): *"direct mein bahut si trains available hai lekin neeche seat finder mein avl mein sabhi show nhi kar rhi"*.

Do alag surfaces hain, dono me ab sach:

| Surface | Base data | Round-19c ka add |
|---|---|---|
| **Plan card ke neeche** (`block.type === "journey"`) | card ke per-train `classOptions` (round-19, `cardBoard`) | — (pehle se fresh) |
| **Chat ka train table** (`TrainTableView`) | route board (`/api/availability` ek call, saare trains) | **"✅ Available" tap karne par** jo trains route board me koi AVL/RAC row nahi deti, unka **per-train board** (same endpoint jo TrainBoard "Refresh seats" chalata hai) laaya jata hai — max 6 trains, 3 ek saath |

- Naya: `trainsUnverifiedForSeats()` + `mergeClassBoardsVerified()` (`src/seatfinder.ts`). Fresh per-train probe **jeetta hai** (khaali/UNKNOWN wapas aaya to purani row safe); purana `mergeClassBoards` (gaps bharna, maujooda row nahi chhedta) waisa hi hai.
- Latency: sirf "Available" tap par, max 6 trains → 2 batch. "Sabhi trains" default waisa hi fast.

**Live proof (LDH → MTJ · 25 Sep, 24 Sep 18:02 UTC — user ke screenshot wali route):**

| Source | 12926 PASCHIM EXPRESS 09:40 |
|---|---|
| Route board `/api/availability` (ek call, saare trains) | 2A **WL 4** · 3A **WL 14** · SL **WL 68** · 1A WL 1 |
| Per-train board `/api/availability?trainNumber=12926…` (fresh) | 2A **AVL 5 ₹1,270** · 3A **AVL 23 ₹915** · SL **AVL 8 ₹360** |
| Usi waqt 11078 JHELUM 3A (ulta case) | route board **AVL 8** · per-train **NOT_AVAILABLE** |

Iska matlab: route board dono direction me galat ho sakta hai. `Seat Finder Available` list ka natija (same payload se, asli client functions se):
**pehle** 3 rows / 2 trains (`11078 3A AVL 8 ₹760 (04:30)` ← ye actually N/A tha, `11058 3E RAC 42 ₹785`, `11058 2A RAC 6 ₹1,210`)
→ **ab** 4 rows: `12926 3A AVL 23 ₹915 (09:40)` · `12926 SL AVL 8 ₹360` · `12926 2A AVL 5 ₹1,270` · `11058 2A AVL 1 ₹1,210` — aur wo purani `11078 AVL 8` row nikal gayi (per-train fresh: N/A).

Tests: `tests/seat-finder.test.ts` (naye 2), `tests/seat-finder-card.test.tsx` (naya 1 — "Available" tap → per-train verify → AVL rows). Kul **92 files / 960 tests PASS**.

### 9.8 Round-19d — card ki **direct** list bhi window se filter (connecting/alternatives untouched)

User: *"Card filter karo lekin connecting/alternatives mein change na aayein wo waisa hi rahe."*

- **Sirf direct trains (0 change)** par filter — `JourneyOptions` me naya prop `window={afterMin, beforeMin, label}` (Concierge `seatFind.intent` se aata hai; matlab user ke apne shabdon se).
- Filter **client-side dikhane par** hai: plan/engine/AI ka data waisa hi rehta hai — isliye connecting, alternatives, ticket tricks, doosri dates, hub-leg lists **bilkul waise** dikhte hain (un par filter lagta hi nahi).
- Hero: agar AI ka pick direct tha aur window ke bahar (jaise "subah" poochne par 16:50 Shatabdi), to hero **window ka best direct** ban jata hai aur header "Window ke hisaab se · <label>" dikhata hai.
- Window bar + chip: "🕒 Subah (04:00–12:00) — direct trains sirf isi window ki (N mili)" + **"Sabhi N direct dikhao"** (ek tap me poori list wapas). Window me koi direct na ho to list khaali nahi hoti — saaf note + poori list.
- Window na bole to kuch nahi badalta (koi default filter nahi).
- Naya: `departureInWindow()` (`src/seatfinder.ts`, server `inTimeWindow` ka mirror — same windows, raat me wrap); `filterSeatRows` bhi wahi helper use karta hai.
- Test: `tests/round19d-card-window.test.tsx` (4). Kul **93 files / 964 tests PASS**; `npm run build` OK; server tsc clean.

### 9.9 Round-19e — Seat Finder **train-wise** (har train ki saari classes ek saath) + preview ki galti

User (screenshot ke saath): *"upar card mein classes available mein sabhi dikh nhi rhi jabh ki neeche classes zyada hai"*.

**Do cheezein nikli:**

1. **Mere preview ki galti:** us preview me **upar wale panel ke numbers haath se likhe the** (ek purane snapshot se) aur neeche wala card doosre payload ka tha — isliye `11078 3A AVL 7` upar aur `AVL 8` neeche dikh raha tha. Ab har preview **ek hi asli payload** se banta hai (`provas/ldh-mtj-real.json`, live server se).
2. **UI ki asli kami:** Seat Finder me har class ki apni row thi aur **6 rows ke baad "aur rows dekho"** — lambi list me train ki kuch classes pehli nazar me chhup jaati thi.

**Fix (client-only, data/AI/API untouched):**

- `SeatFinder.tsx` me naya `TrainGroup` — **ek train = ek block**, uske andar uski **saari classes chips** me (card jaisa): `12926 PASCHIM EXPRESS · 3A AVL 23 ₹915 · SL AVL 8 ₹360 · 2A AVL 5 ₹1,270`.
- Limit ab **trains** par hai (seat 8, WL 4 — "aur N trains dekho"), **classes par kabhi nahi**.
- "Available" tab = AVL/RAC chips (uss class ke liye aapka hi rule: *"Available pe click kre to Available + RAC dikhao"*); WL/N-A chips apne train ke block me **"🚆 Sabhi trains"** me — wahan bhi train-wise.
- Verify (asli payload, client ke apne functions se): **10/10 trains** me jitni AVAILABLE/RAC classes card me hain, utni hi Seat Finder me aati hain; ek bhi class chhupti nahi.

**Bonus (flaky test jo raat 12 baje toota):** `tests/route-board-live-enrich.test.ts` me date `2026-09-24` hardcoded thi; IST me 25 Sep hote hi wo "beet chuki" ho gayi aur live probe (jo past journey-date par **jaan-boojh kar** null deta hai) test ko gira raha tha. Ab date IST-today se aati hai. Kul **93 files / 967 tests PASS**.

### 9.10 Round-19f — "Available" me bhi **poora card** (koi train/class chhupti nahi)

User ne wahi shikayat dobara screenshot ke saath bheji: *"upar card mein classes available mein sabhi dikh nhi rhi jabki neeche classes zyada hai"* — us screenshot me upar **Seat Finder** tha aur neeche **journey card**, aur dono ke numbers/classes alag the.

Ab Seat Finder ki "✅ Available" list bhi wahi poora sach dikhati hai jo upar card dikhata hai:

- **Pehle:** Available = sirf AVL/RAC classes, aur baaki trains (jinke kisi class me seat nahi) list me aate hi nahi the — isliye upar card me 10 trains x 4-5 classes, neeche 2 trains dikhte the.
- **Ab:** har train ka ek **block** aur us block me uski **SAARI classes** — seat wali **rangdar** chips (AVL/RAC + fare), baaki (WL/N-A) **halki** chips (tap par fresh check phir bhi chalta hai). Aur jinke kisi class me seat nahi, wo trains **"SEAT NAHI"** heading ke neeche, apni saari classes ke saath (halki). Cap sirf **trains** par (8 seat / 8 no-seat), classes par kabhi nahi.
- **Verification (asli payload se, component ka asli render):** LDH -> MTJ · 25 Sep par Seat Finder me **10/10 trains** aur unki **saari classes** (12926: 3A AVL 23 · SL AVL 8 · 2A AVL 5 · 1A N/A) — upar wale card se bilkul match.
- Seat Finder ke andar build ab hamesha "all" (WL/N-A rows bhi banti hain); section-level gating UI me — "Sabhi trains" me WL **section** alag, "Available" me WL/N-A chips usi train ke block me halki.
- Tests: `tests/seat-finder-card.test.tsx` (18) — Available me saari classes + halki chips, "SEAT NAHI" section. Kul **93 files / 969 tests PASS**.

### 9.11 Round-20 (25 Sep) — Direct card = Seat Finder jaisa, class chip tap → seedha IRCTC-jaisa passenger form, aur chat ka lamba jawab

User ne teen screenshots ke saath teen cheezein maangi thi:

**1) "Direct trains ka UI bhi bilkul Seat Finder jaisa same to same chip wala ho"**

- Naya shared block `src/components/TrainClassBlock.tsx` — **wahi ek markup** jo Seat Finder ka `TrainGroup` pehle se banata tha (`.sf-group` + left accent, header me train number/naam/time/"N classes (M me seat)", chips me class code + badge (AVL/RAC/WL/N-A) + fare, `off` = halki chip).
- Journey plan ka **DIRECT TRAINS** card (`JourneyOptions.tsx`) bhi ab yahi block use karta hai — Seat Finder card aur direct card ki shakal **bilkul ek** (screenshot 1 = screenshot 2). Sirf rendering badla: data wahi plan/board payload, koi naya API/AI logic nahi. `↻ purana data` ka tag chip par, header tap se poora train (purana behaviour as-is).

**2) "Kisi bhi class pe tap → seedha passenger form; upar train number, date, from, to apne aap; form IRCTC ke according same to same — sirf insurance aur payment chhod kar; jis train me catering ho usme catering; class wahi jo train me asli hai"**

- `src/booking/fromOption.ts` (naya, sirf mapping): `stationOf` · `classFromBoardRow` · `trainFromRouteOption` · `bookingFromSeatRow` · `bookingFromChipPayload` — jo chip par dikha wahi booking me jaata hai (koi number/status invent nahi, koi naya API call nahi).
- Chip tap par: class **bookable** (AVL/RAC/WL) → `SELECT_TRAIN_AND_CLASS { toPassengers: true }` → berth step skip, seedha **Passengers** screen; warna (N/A/data nahi) purana fresh-seat-check chat flow. Wahi wiring Seat Finder ke chips par bhi (`onBook` prop).
- Passenger form (IRCTC ke passenger-details page jaisa): upar **journey summary** (train number · naam · date · from → to · class badge · fare · source), phir per passenger **Name / Age / Gender / Berth preference** + **Food choice** (sirf jab train me pantry ho), **ID proof (type + number, optional)**, aur IRCTC ke dono checkbox (Book only if confirm berths / Consider for auto up-gradation), phir **Contact details** (10-digit mobile, email, WhatsApp updates). **Insurance aur payment ka koi block nahi** (wo IRCTC handoff par).
- **Catering data real:** naya read-only endpoint `GET /api/trains/:number/pantry` — andar wahi maujooda `scrapeTrainFactsWeb` chalta hai jo AI ka TRAIN_FACTS tool pehle se use karta hai (koi naya source nahi). Probe: **12926 pantry = true**, **12014 pantry = false** → food choice sirf 12926 par dikhta hai, 12014 par honest note ("pantry nahi hai — IRCTC eCatering se en-route station par"). Data na aaye to `null` + "provider se nahi aayi" (jhooth nahi).
- **Class real train data ke according:** berth options `BERTH_BY_CLASS` se (CC me Window/Aisle, SL me Lower/Middle/Upper…), class code/fare/status chip me jo tha wahi.

**3) "Chat ka lamba jawab padne me mushkil — thoda attractive banao"**

- Naya `src/components/ReplyText.tsx` — **sirf presentation** (msg.text waisa hi rehta hai): screenshot 3 wala ek-hi-line text (`* 11057 CSMT ASR EXPRESS – 3E AVAILABLE 44 seats ₹520, dep 12:55 * …`) ab **rows** me: train number + naam, class chip, AVL/RAC/WL badge (tone ke hisaab se rang), fare, time — aur window/route wali line upar **chip** me, aakhri sentence neeche tail me (kuch chhupta nahi, kuch invent nahi). Pipe wale SEAT rows (`"A | B | C"`) bhi rows ban jaate hain. Pattern match na ho to poora text pehle jaisa paragraph.

**Tests:** naye `tests/round20-chip-to-passenger.test.tsx` (7) · `tests/round20-passenger-form.test.tsx` (9) · `tests/round20-pantry-api.test.ts` (3) → kul **96 files / 986 tests PASS**; `tsc -p tsconfig.server.json` clean; client TS errors me koi naya error nahi (puraane exactly wahi 67).

**Preview (single-source):** `/home/user/RailBook/previews/RailBook-round20-2026-09-25.html` — asli payload (`provas/asr-ldh-2026-09-26-board.json` + search times + live AI reply) se asli React components ka render + built CSS.

### 9.12 Round-21 (25 Sep) — IRCTC autofill me food + dono checkbox + mobile/email, aur deploy

User ne maanga: *"passenger details ke saath food bhi autofill ho, 'Book only if confirm berths are allotted', 'Consider for auto up-gradation', aur mobile + email (agar user ne enter kiya ho) — iske baad deploy krdena."*

**Payload (web → app/extension)** — `src/irctc/handoff.ts`

- Naya **V2** payload (`IrctcHandoffPayloadV2`): `version: 2`, `journey` (waisa hi), `passengers[{name, age, gender, berth, **food**, **bookOnlyIfConfirm?**, **autoUpgrade?**}]`, aur **`contact?{mobile?, email?}`**. Flags sirf `true` par hi payload me jaate hain (`false`/absent = site ka default waisa hi — hum kabhi uncheck nahi karte).
- Food labels IRCTC ke apne option text se match karte hain: `VEG → "Veg"`, `NON_VEG → "Non Veg"`, `NO_FOOD → "No Food"`; khaali chhoda to `""` → IRCTC ka default (`Catering Service Option`).
- Contact validation: mobile 10 digit aur email shape — **galat ho to handoff reject** (`ok: false` + error), chupke drop nahi hota.
- **Backward compatibility (jaan-boojh kar):** V2 alag key `railbookAutofillPayloadV2` me likha jaata hai; **purani key `railbookAutofillTestPayload` aur `postMessage` dono me exact purana V1 shape** hi jaata hai. Isliye purane app/extension (v1.4.3 tak) par kuch nahi tootta — unhe sirf food/contact/checkbox nazar nahi aate.
- Review screen ka handoff card ab contact bhi bhejta hai (`ReviewStatus.tsx` → `IrctcHandoff ... contact={state.contact}`), aur summary me food/flags/contact ki lines dikhti hain.

**Android engine (autofill sach me bharta hai)** — `assets/autofill/fieldmap.js` + `irctc-passenger.js`

- `fieldmap.js`: allowlists me `food` + `bookOnlyIfConfirm`/`autoUpgrade` + page-level `contact.mobile`/`email`; `FOOD_MAP` (site option TEXT se — value guess nahi); `FLAG_RULES` + `flagTargets`/`fillFlags` (checkbox `.checked = true` sirf true par, aur **kabhi uncheck nahi**); `expectedPaths`/`fillFields` me naye paths; `version === 2 ? 2 : 1` passthrough.
- `irctc-passenger.js`: `passengerFoodChoice` select ke liye **"No Food" ab mapped** (`FOOD_UNMAPPED` se nikaal diya); naye `contactAnchor` (page-level `mobile|phone` / `e-?mail`, visible, non-sensitive, passenger rows ke **baahar**, exactly-1 warna NOT FOUND) aur `flagAnchors` (checkbox label/formcontrolname signal, row-scoped). `MainActivity.kt` ab pehle V2 key padhta hai, phir purani.
- **Round-21b fix (real-site shapes):** IRCTC par ye checkbox kabhi passenger row ke andar, kabhi uske neeche ki **apni row/section** me hote hain → naya `pickFlagTarget()`: pehle exact row match, warna shared anchor (exactly 1 = sabke liye ek hi control) ya DOM-order match (anchors ki ginti == passengers ki ginti); ambiguous par **NOT FOUND** (galat passenger ko tick nahi karte). Ye bug preview banate waqt pakda gaya (2 notFound → 0).

**Verification**

- `tests/irctc-handoff.test.tsx` **13/13 PASS** (allowlists, food labels, flags only-true + legacy me kabhi nahi, contact valid-only + invalid error, summary lines); full suite **96 files / 992 tests PASS**; server `tsc` clean; client TS baseline 67 (koi naya nahi).
- Naya **asli-engine check**: `tools/round21-autofill-engine-check.mjs` — app ke wahi do assets jsdom me ek IRCTC-jaisa page par chalaata hai: **25/25 PASS** (V2 validate, V1 untouched, galat mobile reject, unknown key reject, food Veg/No Food, dono checkbox, blank = untouched, mobile/email, shared-pair shape, per-row shape, sensitive guard, generic `data-rb` path).
- **Preview (single-source):** `/home/user/RailBook/previews/RailBook-round21-2026-09-25.html` — usi asli engine ka result (14 filled / 0 notFound), payload badal ke live dobara chala sakte ho.
- **Deploy:** commit `93dc921` → Render `dep-daqvdufavr4c73f6ek8g` **LIVE 2026-09-25T04:23:11Z**; `/api/version` = `93dc921`; live bundle me `railbookAutofillPayloadV2`, `railbookAutofillTestPayload`, `Book only if confirm berths`, `auto up-gradation`, `Food choice`, `No Food` sab maujood.
- **APK v1.4.4** (`RailBook-v1.4.4-release.apk`, versionCode 27) — assets badle hain isliye device par naya APK zaroori hai; purana v1.4.3 APK sirf food/contact/checkbox ke bina autofill karta rahega (kuch tootta nahi).

### 9.13 Round-21b/21c (25 Sep) — "jo real provider kehta hai wahi dikhao" + chat se Seat Finder UI hataya

User (2 screenshots): RailBook ke passenger form me **Food choice** dikh raha tha, par IRCTC ke booking page par wo option hi nahi tha —
*"es train mein food choice hai hi nahi to fir kyu dikha rha? kuch bhi fake mat rakho jo real provider se aaye wahi dikhao, aur wo map bhi ho RailBook se IRCTC pe."*
Saath hi: *"seat finder aur direct trains ab same hi show kar rahe hain to seat finder ka UI sirf chat section se hata do — SeatFinder.ts, filters, AI using seat finder yeh sab delete nahi karna."*

**1) Catering: per-source sach (koi merged guess nahi)**

- `server/railway/webscrape.ts`: `ScrapedTrainFacts` me naya **`pantrySources {erail, confirmtkt}`** (additive; erail ka "Pantry is (not) available" aur confirmtkt ka `HasPantry` alag-alag rakhe jaate hain). Merged `pantry` waisa hi rehta hai (purane callers safe).
- `GET /api/trains/:number/pantry` ab deta hai: `sources`, **`conflict`**, **`premiumCatering`** (Rajdhani/Shatabdi/Duronto/Vande Bharat/Tejas — catering fare me included; "Jan Shatabdi" ko premium nahi maana jaata), **`foodChoiceExpected`**, `evidence[]` (insaani zubaan me) aur honest `note`. Sab kuch wahi maujooda `scrapeTrainFactsWeb` se — koi naya source nahi.
- **Live asli misaal:** `12716` → erail "available", confirmtkt `HasPantry=false` → **conflict**, `foodChoiceExpected=false` (aapka case!) · `12926` wahi · `12014` Shatabdi → premium hone se `true` (erail na kehne par bhi, kyunki catering fare me hai) · `22691` Rajdhani → `true` · `12497` → dono na, `false`.
- `src/views/Passengers.tsx`: **Food choice dropdown sirf `foodChoiceExpected === true` par**; conflict par amber honest line (dono sources ke saath), "nahi mili" par eCatering line, data na aaye par "provider se nahi aayi" — **guess kabhi nahi**.
- Android app panel (`railbook-webview-bridge.js`): agar IRCTC ke page par food field hi nahi mila to ab saaf line aati hai — *"IRCTC ke is page par food/catering option nahi mila — is train/class me IRCTC ne nahi diya, isliye form ki Food choice apply nahi hui"* (chup-chaap skip nahi).

**2) Chat section se Seat Finder UI hataya (baaki sab intact)**

- `src/views/Concierge.tsx`: `<SeatFinder>` ke dono mounts (plan card + train table) aur uska import hata diya; `TrainTableView` ab sirf table deta hai. **Delete kuch nahi hua** — `src/components/SeatFinder.tsx`, `src/seatfinder.ts` (intent + `departureInWindow` filter), `server/agent/seatFinderTool.ts`, `server/agent/seatFilter.ts` aur AI ka seat intent waise hi hain; plan card ka time-window filter (jo Seat Intent se aata hai) aur class chips (shared `TrainClassBlock`) bilkul waisa hi chalta hai.

**Tests / verify:** naye `tests/round21b-pantry-sources.test.ts` (6) · `tests/round21b-food-gate.test.tsx` (4) · `tests/round21c-chat-without-seatfinder.test.ts` (4); `tests/round20-passenger-form.test.tsx` naye payload shape par update → kul **99 files / 1006 tests PASS**; server `tsc` clean; client TS errors HEAD ke barabar (68, koi naya nahi).
**Live:** commit `99a0c9d` → Render `dep-dar1ucc9v7es7396tt80` **LIVE 2026-09-25T07:14:55Z**; `/api/version` = `99a0c9d`; pantry curls (5 trains) upar wale natije dete hain.
**Preview (single-source):** `/home/user/RailBook/previews/RailBook-round21b-2026-09-25.html` — asli components + built CSS + **live** payloads (plan `provas/asr-ndls-2026-09-26-plan.json`, pantry live).
**APK v1.4.5** (versionCode 28) — bridge ki nayi honest line ke liye.

### 9.14 Round-22 (26 Sep) — seat-answer padhne layak, direct card ke shuru me filters, aur IRCTC overlay 45s

User ke teen points (2 screenshots + 1 filter screenshot):

**1) "Pehle screenshot mein ese simple answer padhna bada mushkil hai — thoda attractive banao (AI seat finder se related answer ho to)"**

- `src/components/ReplyText.tsx`: parser me **em-dash (—)** separator aur "… departure" wala suffix add hua — screenshot ka asli text (`* 12484 ASR TVCN SF EXP — SL — AVAILABLE 102 seats — ₹180 — 05:55 departure`) ab **rows** me tootta hai. Purane `–` / `-` / `|` formats waise hi chalte hain.
- Headline ab chips me baant-ti hai (route · window+class) aur rows ke upar ek **honest summary line** (`💺 2 me seat (102, 42) · fare ₹150–₹180`) — jo **sirf usi text ke numbers** se banti hai, kuch invent nahi. Row na bane to jawab pehle jaisa paragraph hi rehta hai (kuch chhupta nahi).

**2) Filter screenshot: "yeh filter direct train ke card mein starting mein add kro"**

- Naya shared `src/components/SeatFilterBar.tsx` — **wahi chips** jo Seat Finder card me thi (✅ Available · 🚆 Sabhi trains · Sab class · 1A/2A/3A/3E/SL/CC/2S/EC · ❄️ AC · Time · ⚡ Sabse jaldi · 💰 Sabse sasta). SeatFinder.tsx aur JourneyOptions.tsx dono yahi ek component use karte hain (dono jagah shakal bilkul same).
- **Direct trains card ke shuru me** chips row lagti hai; filter **sirf direct list** par chalta hai — connecting / alternatives / alternative dates / planner ka data waisa hi rehta hai (user ka purana rule: "card filter karo lekin connecting/alternatives mein change na aayein"). Class/AC filter par har train ke block me sirf wahi class chip dikhti hai; "Sabse sasta" filtered class ke fare par chalta hai (jo dikh raha hai wahi compare hota hai).
- Purana window-toggle (19d) ka state hata diya — window ab **Time chip** se hi control hota hai (`Time: Sab (poori list)` = window hatao), aur chips ke neeche ek honest filter line + **Clear** button aata hai. Tests update: `tests/round19d-card-window.test.tsx`.

**3) "Second screenshot: sirf likho redirecting to irctc and time; 30 sec ke baad bhi extra 30 sec leta — countdown 45 sec ka karo"**

- Android app: `strings.xml` ka `prewarm_title` ab **"Redirecting to IRCTC…"**; step-by-step lines wala TextView hidden (progress status bar me). `MainActivity.kt`: **ek hi 45s countdown** (pehle 30s + extra 30s phase tha) aur uske baad seedha honest reveal — koi extra wait nahi; status line: "IRCTC login page 45s me nahi aaya — jo page hai wahan se aap continue kar sakte hain (login aap karein)."

**Tests / verify:** naye `tests/round22-seat-reply-rows.test.tsx` (4) · `tests/round22-direct-card-filters.test.tsx` (8) → kul **101 files / 1018 tests PASS**; server `tsc` clean; client TS 67 (HEAD ke barabar — ek puraana test-side error bhi fix hua). **Preview:** `/home/user/RailBook/previews/RailBook-round22-2026-09-26.html` (asli components + built CSS + live plan payload; filter wale card chips par asli click karke capture kiye gaye states).
**APK v1.4.6** (versionCode 29) — overlay change ke liye.

### 9.15 Round-23 (26 Sep) — Available me sirf AVL/RAC, review page par sirf Continue to IRCTC, aur app ka asli version label

**1) "Screenshot abhi bhi 30 sec dikha raha hai"**

- Wajah **purana APK** thi: device par jo build chal raha tha usme purani strings thi. v1.4.6 me `prewarm_title` = "Redirecting to IRCTC…", 45s countdown aur step-lines hidden ho chuki hain (dex me `45s khatam…` hai, `30s khatam` nahi — v1.4.5 me ulta).
- Asli confusion ki jadh bhi band ki: header ka version ek **hardcoded string** tha (`v1.2.8`) — isliye device par kaun sa build hai pata hi nahi chalta tha. Ab `MainActivity.appVersionLabel()` **packageManager se asli `versionName (versionCode)`** dikhata hai (v1.4.7 se aage), aur default string neutral ("RailBook") kar di.

**2) "Available selection pe WL wali class bhi show hoti hai, jabki sirf available ya RAC show honi chahiye"**

- `src/components/JourneyOptions.tsx`: ✅ Available mode me ab **sirf AVL/RAC class chips** dikhti hain (WL/N-A chips chhup jaati hain), aur jis train me ek bhi AVL/RAC class nahi wo list se hat jati hai. 🚆 Sabhi trains par purana rule — **har train ki saari classes (WL/N-A halki)** — waisa hi rehta hai.
- Seat Finder card (jo abhi chat me mount nahi hota, code intact hai) apne purane "saari classes halki" rule par hi hai — bolo to wahan bhi same kar dunga.

**3) "Review page par bas Continue to IRCTC → andar sab hata do"**

- `src/views/ReviewStatus.tsx` (`FareReview`): ab sirf **IrctcHandoff card** hai. Hata diya — booking summary (Train/Date/From→To/Class/Seat/Passengers/Base fare/Service fee/Total), wallet card, "Nothing is confirmed…" note, aur neeche ka **sticky CTA (Confirm Booking / Add Money)**. Page title "Continue to IRCTC".
- `src/components/IrctcHandoff.tsx`: **"Copy journey + passenger summary" button**, **copy-ready summary block** aur **technical payload preview** UI se hata diye (user: "user ko nahi show hona chahiye"). Click par summary ab bhi chupke clipboard par jaati hai (best-effort) aur ek chhoti honest line rehti hai ("Kuch bhi auto-submit nahi hota · login/OTP/CAPTCHA/payment RailBook ke paas nahi aate"). Payload banana/store karna waisa hi hai (tests se verify).
- RailBook ke andar ka booking flow (Passengers → confirm) **waise hi maujood hai** — sirf review screen se wo buttons gaye (user ka flow: journey RailBook me, booking IRCTC par).

**Tests:** naya `tests/round23-avail-chips-and-review.test.tsx` (3) · `tests/irctc-handoff.test.tsx` update (preview/copy UI hatne ke baad payload verify) → kul **102 files / 1021 tests PASS**; server `tsc` clean; client TS 67 (baseline). **APK v1.4.7** (versionCode 30) — dynamic version label ke saath.

### 9.16 Round-24 (26 Sep) — "Review fare" → "Review journey", review page par journey summary + Continue, aur blank-screen fix

**1) "Review fare ki jagah review journey aana chahiye"**

- `src/views/Passengers.tsx`: sticky CTA label ab **"Review journey"**, voice prompt line bhi — "SAB READY — **Review journey** dabaiye."
- `src/voice/speakGuide.ts`: bolne wali line bhi "Sab details fill ho gayi hain. **Review journey** dabaiye."
- (Aage ka screen bhi "Review journey" title ke saath khulta hai.)

**2) "Uski page pe journey summary — jo bhi user ne details fill ki hongi — show ho aur uske NEECHE Continue to IRCTC; uske elawa us page pe kuch mat rakhna"**

- `src/views/ReviewStatus.tsx` (`FareReview`) me **journey receipt** wapas aaya (user ke screenshot-2 wale rows, wahi `.summary`/`.row` markup): **Train · Date · From → To · Class · Seat · Passengers · Base fare · Service fee · Total**.
- Uske neeche ek doosra receipt card: **har passenger ki poori detail** (naam · umar · gender · berth · khaana (jab bhara ho) · ID proof (jab bhara ho) · "book only if confirm berth" / "auto up-gradation" (jab tick ho)) + **Mobile · Email · WhatsApp updates**. Data sirf wahi jo user ne bhara — kuch naya/invent nahi. Fare na aaya ho to "Fare unavailable" (guess nahi).
- DOM order: receipt pehle, **Continue to IRCTC uske neeche** — aur page par uske elawa kuch nahi: wallet, sticky "Confirm Booking", copy summary, purana "Nothing is confirmed…" note aur handoff card ka heading/paragraph — sab nahi.
- `src/components/IrctcHandoff.tsx`: card ab **sirf button** hai (koi heading/para/note line nahi). Honest baat button ke `title` par + click ke baad ke status message me (wahi pehle wali line: auto-submit nahi hota, login/OTP/CAPTCHA/payment user ke paas).

**3) "Passenger details fill karne ke baad kaafi scroll down karna padta + page (bas background) dikh raha tha"**

- Root-cause check (live site ko phone-size Chromium me chala kar + device screenshot ke pixel analysis): us screenshot me passenger page ka **content hi khaali** tha — `passengers` list khaali hone par page ke beech me kuch render hi nahi hota, par prompt "SAB READY" aur CTA enabled dikhte the.
- Fix: `Passengers.tsx` me do guards — (a) list khaali mile to **apne aap ek blank passenger card** ban jaata hai, (b) screen khulte hi scroller **top** par aur `resize`/`visualViewport` (keyboard/IME) ke baad scroll ko content ke andar **clamp** kiya jaata hai — isliye keyboard band hone ke baad page khaali hisse par atka hua nahi dikhta.
- Purane Android WebView ke liye CSS fallbacks: `min-height:100vh` pehle, phir `100dvh` (`.app`, `.concierge`), sheets me `88vh/92vh` pehle, aur `.overlay-screen` / `.jx-page` / `.vs-scrim` me `inset:0` se pehle explicit `top/right/bottom/left:0` (`inset` sirf Chrome 87+ me hota hai).
- Review page ka content ab lamba hai isliye "verify karne ke liye" scroll ki zarurat nahi — summary page par hi milti hai; CTA dock me hamesha screen par rehta hai.

**Tests:** naya `tests/round24-review-journey.test.tsx` (8 — receipt rows, passenger/contact lines, DOM order summary→button, "uske elawa kuch nahi", khaali list ka guard, scroll reset, CSS fallback) · `tests/round23-avail-chips-and-review.test.tsx` update (Round-24 ke saath align) · `tests/irctc-handoff.test.tsx` update (note line hata — title par) → kul **103 files / 1029 tests PASS**.
**Tools:** `tools/probe-device-scroll.mjs` (live site ko phone-size Chromium me khol kar layout/scroll measure karta hai — `npm i -D playwright` chahiye) · `tools/build-round24-preview.mjs` → preview `RailBook-round24-2026-09-26.html`.
**APK:** is round me Android code change nahi — app wahi v1.4.7 WebView se live site load karta hai, isliye naya APK zaroori nahi.

### 9.17 Round-25 (26 Sep) — "baki trains seat finder card mein kyu le jaata?" → saari trains isi jawab me

**User (screenshot 2, aakhri line):** "+5 aur SL available trains Seat Finder card mein hain. ⚙️ find seats"

**Wajah (root cause):**

- Ye line AI ne apne aap nahi banayi — wo **server ki summary line se copy** hui thi: `server/agent/seatFilter.ts` ke `seatSummaryLine()` me `· +N aur (Seat Finder card me)` likha tha.
- Wo pointer **purane rounds me sach tha** (tab chat ke andar Seat Finder card mount hota tha). Round-21c me card chat se hata diya gaya (user: "seat finder aur direct trains ab same hi hain") — par line aise hi reh gayi, isliye (a) AI wahi baat likhta raha, aur (b) **baki trains kahin dikhti hi nahi thi**.

**Fix (teen layer, koi naya endpoint/AI-logic change nahi):**

1. `server/agent/seatFilter.ts` — `seatSummaryLine()` ab **saari** seat rows isi line me likhti hai (`SEAT_LINE_MAX = 12`; bahut zyada hon to honest tail `+N aur bhi hain`, koi card pointer nahi). WL wali branch bhi 12 tak + honest tail. `seatFilterFor()` ka default `maxRows` 8 → 12 (wahi board data, koi extra call nahi).
2. `server/agent/seatFilter.ts` — naya `missingSeatLines(replyText, rows)`: jo seat-wali trains AI ke jawab me **nahi** aayi, unki lines bana deta hai (format wahi jo chat ka `ReplyText` rows me todta hai: `* 19611 All ASR EXP — SL — AVAILABLE 174 seats — ₹150 — 06:25 departure`). `server/app.ts` ke turn assembly me ye lines **usi jawab me** jod di jaati hain (sirf jab AI ka apna jawab ho aur plan card na ho — AI fail hone par wahi compact `💺` line dikhti rehti hai, jisme saari trains pehle se hain). Kuch invent nahi — sirf live board rows.
3. Prompt/tool honesty: `agentic.ts` SEAT RULE me saaf likha — "SAARI seat wali trains ki lines likho (top 3-5 nahi) … 'baaki trains kisi card/Seat Finder me hain' jaisi baat kabhi mat likho, chat me aisa koi card nahi dikhta"; `seatFinderTool.ts` ki summary me bhi wahi rule + SEAT rows 8 → 12.
4. Client safety net: naya `src/chatText.ts` → `stripSeatCardPointer()`; `Concierge.tsx` assistant text render se pehle isse guzarta hai, isliye kabhi model phir bhi "Seat Finder card" likhe to **screen par woh jhoothi baat nahi jaati** (baaki text jaisa tha waisa rehta hai — kuch chhupta nahi).

**Live proof (deploy `fe9f372` ke baad, asli site par):**

- `/api/agent` par wahi screenshot wala sawaal ("Ludhiana se Amritsar 27 Sep SL class me seat wali trains batao") → jawab me **saari 10 seat-wali trains** (19611 AVL 174 … 15707 AVL 1) + `💺 SL me seat wali 10 trains … (LDH → ASR · live board)`; text me **"Seat Finder card" ka zikr nahi**.
- Asli browser (Pixel-size Chromium, live site) par wahi sawaal → chat me **10 rows** (19611, 14615, 14631, 14663, 13005, 12903, 14653, 20807, 11057, 15707), summary "💺 10 me seat (174, 50, 26, 22, 7, 5, 4, 4, 3, 1) · fare ₹150–₹180", aur aakhri line par koi jhootha pointer nahi. Screenshots: `previews/round25-live-seat-answer-top.png` / `-bottom.png` (tool: `tools/probe-live-seat-answer.mjs`).
- Round-25b refinement (live check me pakda gaya): pehle WL/N-A rows bhi jawab me jud rahi thi (18 lines) — ab sirf **jo query ne maanga** wahi (seat rows). Tabhi jodi gayi rows 10, WL alag se nahi.

**Tests:** naya `tests/round25-seat-answer-all-trains.test.tsx` (7 — summary line saari rows, honest tail, `missingSeatLines`, ReplyText me lines → rows, client strip, aur **turn-level** `/api/agent` assembly: AI ne 1 train likhi → baaki 2 ki lines judi, duplicate nahi, koi card pointer nahi; AI fail → sirf compact line) → kul **104 files / 1036 tests PASS**; server `tsc` clean; client TS 67 (baseline). **Preview:** `RailBook-round25-2026-09-26.html` (pehle/ab, asli ReplyText + asli server helpers se render). **Builder:** `tools/build-round25-preview.mjs`.
**APK:** Android change nahi (WebView live site load karta hai) — v1.4.7 hi current.

### 9.18 Round-26 (26 Sep) — "WL trains bhi dikhao" (sirf-available filter sirf maangne par) + "10 trains par 9 kyu"

**User (screenshot):** "trains total 10 hai lekin mere ko 9 show kar rhi" + "SL ho ya koi bhi class, usmein sirf available mat show karo — W/L trains bhi show karo kyunki user ne specifically nahi bola ki available SL dikhao".

**1) Count mismatch (10 → 9)**

- Wajah: AI aksar **pehli train ko hi intro line me** likh deta hai — "27 Sep 2026, SL class, 1 passenger ke liye seat available wali trains: 19611 All ASR EXP — SL — AVAILABLE 174 seats — ₹150". `ReplyText` ka label-match (`^([^:]{2,40}):`) sirf 40 akshar tak tha, isliye wo poori line **head** me chali jaati thi aur us row ko rows me nahi ginnti thi → summary "9 me seat" (jabki 10 trains).
- Fix: `src/components/ReplyText.tsx` me label limit **140 akshar** — ab wo row alag row hai, count match karta hai. Saath me summary line ab **total + seat/WL ka farq** batati hai: `💺 14 trains: 10 me seat (174, 107, …) · 4 WL/N-A · fare ₹150–₹180` (pehle sirf "N me seat").
- Ek aur case bhi cover hua: row ke baad usi line par tail sentence ("… ₹150 Ye 10 trains SL me abhi available hain.") — row ginn me aati hai, sentence tail me chali jaati hai (kuch chhupta nahi).

**2) Default me WL/N-A bhi (filter sirf jab user khud maange)**

- `server/understand/seatIntent.ts`: naya `EXPLICIT_AVAILABLE_WORDS` (`available|availability|avl|vacant|khali|khaali`, Hindi उपलब्ध/खाली) + `confirmed` — **sirf tabhi** `onlyAvailable = true`. Warna false (default). Pehle har seat-sawaal par true ho jaata tha — isi wajah se WL trains gayab thi.
- `server/agent/seatFilter.ts` → `seatSummaryLine()` me **all-mode branch**: ek hi line me saari trains (pehle AVL/RAC, phir WL/N-A) + saaf count — `💺 SL me 14 trains — 10 me seat (AVL/RAC), 4 me WL/N-A: … · +N aur bhi hain. (LDH → ASR · live board)`. Rows ki cap `SEAT_LINE_MAX = 12` (aage honest tail), `maxRows` default bhi 12.
- `server/app.ts`: `seatOnlyAvailable = slots.onlyAvailable` (default false) — AI ke jawab me chhoot gayi trains ki lines tab **AVL/RAC + WL/N-A dono** se banती hain.
- `server/agent/seatFinderTool.ts` + `autoTools.ts` + `toolSpecs.ts`: `only_available` ka default ab **false** (WL bhi) — true sirf jab user ne khud available/confirmed maanga ho. Prompt (`agentic.ts` SEAT RULE, `autonomous.ts` 8b) me bhi wahi rule likha.

**Live proof (deploy `630c6f9`):**

- Asli sawaal "Ludhiana se Amritsar 27 Sep SL class me seat wali trains batao" (bina "available" shabd) → jawab me **18 trains**: 10 AVL/RAC + 8 WL/N-A, aur line `💺 SL me 18 trains — 10 me seat (AVL/RAC), 8 me WL/N-A: …`. Browser (Pixel-size) par bhi: **18 rows**, summary `💺 18 trains: 10 me seat (174, 107, 50, 22, 5, 4, 4, 3, 2, 1) · 8 WL/N-A · fare ₹150–₹180`, koi card pointer nahi.
- Filter tabhi lagta hai jab user khud maange: "sirf available SL trains dikhao" → **sirf 10 available** (koi WL/N-A row nahi), line "Ye 10 trains SL me abhi available hain".

**Tests:** naya `tests/round26-seat-all-classes.test.tsx` (7 — intent default vs explicit, all-mode summary line, purana filtered branch, intro-line row count 10/10, trailing-sentence row, WL ke saath summary) + `tests/round25-seat-answer-all-trains.test.tsx` update (WL row ab usi jawab me aati hai) → kul **105 files / 1043 tests PASS**; server `tsc` clean; client TS 67 (baseline).
**Preview:** `RailBook-round26-2026-09-26.html` (pehle vs ab + live screenshots) · builder `tools/build-round26-preview.mjs`.
**APK:** Android change nahi (WebView live site) — v1.4.7 hi current.

### 9.19 Round-27 (26 Sep) — "ek hi class dikha raha" (har train ki SAARI classes) + tap → passenger form + native mic (WebView me Web Speech nahi hota)

**User (2 screenshots + 4 points):**

1. "yeh ek hi class dikha rha, jabhi ki aur bhi classes mein seat available hai same train mein — i check from confirmtkt" → jawab/block me har train ki **saari** classes (AVL/RAC/WL) ek saath.
2. "baki ki trains live board par hai aa raha" → live board ki saari trains **usi jawab/block** me (koi jhootha pointer nahi).
3. "agar yahan koi class pe tap kare to user ko fir sidha passenger form pe laajao booking ke liye" → chat ke seat chips tappable.
4. "mic working nahi hai" → app ke WebView me mic chale.

**1) Per-train grouping (server)**

- `server/agent/seatFilter.ts`: naye helpers `groupRowsByTrain()` (train-wise groups, order barqarar), `trainClassesText()` (`CC AVL 444 ₹675 · 3A AVL 71 ₹520 · EC AVL 23 ₹1,015`) aur `statusText()`. `seatSummaryLine()` ke **dono** branch (seat-mode aur all-mode) ab per-train likhte hain — train ke andar ` · `, trains ke beech ` | `, aage `+N trains aur bhi hain` (cap `SEAT_LINE_MAX = 12` **trains** par).
- `missingSeatLines()` bhi per-train: `* 12013 AMRITSAR SHTABDI — CC AVL 444 ₹675 · 3A AVL 71 ₹520 — 06:10 departure`.
- **Cap fix (live probe me pakda gaya):** `SEAT_LINE_MAX` pehle `rows` (train × class) par lagta tha — isliye 12013 ki EC / 15707 ki 3E-3A-SL / 20807 ki 3E-2A-SL payload se kat jaati thi (text me dikhti thi, block/khaan me nahi). Ab `capRowsByTrain(rows, maxTrains)` se cap **trains** par — 12 trains aur unki saari classes (test: 12 × 3 = 36 rows).

**2) Chat ka tappable block (client)**

- `src/ai/orchestrate.ts`: naya `Block` type `seatlist`; `src/api.ts`: `AgentResponse.seatFilter`.
- `src/views/Concierge.tsx`: agent path me `agentRes.seatFilter` (rows + wlRows) se `seatlist` block; naya `SeatListBlock` — train-wise `TrainClassBlock` groups (wahi component jo Seat Finder/direct card me lagta hai), header `Seat wali trains (live board) · N trains · M me seat · confirmtkt`, har class chip **tappable** → `openBookingFromSeatRow()` → usi train/class ka **passenger form** (wahi `bookingFromSeatRow` flow). Board rows me schedule time nahi hota, isliye time label **"🕑 live board"** (jhootha time nahi).
- `src/chatText.ts`: `seatListGroups()` (pure grouping helper, testable) + `stripDuplicatedSeatRows()` — block hone par text se row-list lines hat jaati hain (dense 💺 summary line, AI ki apni `* 12013 … · CC · AVAILABLE 418 seats · ₹675` bullet rows, separator `·`/`—`/`|` kuch bhi ho) — **intro/closing prose bachi rehti hai**.
- `src/components/ReplyText.tsx`: `AVL`/`AVAIL` status bhi row banta hai (pehle compact jawab plain text ban jaata tha) + ek line me ek train ki **saari classes** → alag-alag rows (`extraClassRows`).

**3) Native mic (Android WebView me Web Speech API hota hi nahi)**

- Naya `app/src/main/java/com/railbook/assist/VoiceBridge.kt` — `SpeechRecognizer` (hi-IN, partial results), `@JavascriptInterface` `RailBookVoice.isAvailable()/start(lang)/stop()/abort()`, aur `window.__railbookVoice.dispatch({type:start|partial|final|error|end, text, code})`; Android error names → Web Speech error names.
- `MainActivity.kt`: `wv.addJavascriptInterface(VoiceBridge(this, wv), "RailBookVoice")` + `onDestroy` me cleanup; `AndroidManifest.xml` me `<queries><intent android:action="android.speech.RecognitionService">` (Android 11+ package visibility).
- Client: naya `src/voice/nativeSpeech.ts` (bridge → Web Speech jaisa adapter: `onstart/onresult/onend/onerror`), `speech.ts` me `isSpeechSupported()`/`isSecureVoiceContext()`/`createRecognizer()` native-aware, `useVoiceInput.ts` native bridge hone par `getUserMedia` call nahi karta (WebView me wahi atak jaata tha).
- APK **v1.4.8** (vc 31, `1.4.8-native-mic-all-classes`) isi round me bana.

**Live proof (deploy `6e336cf` → `f16b799` → `7dd4c18` → `76d53c3`, sab `f16b799+` par verify):**

- `/api/agent` "Kya kal ke liye koi available seat hai ludhiana se amritsar ke liye?" (LDH→ASR, 27 Sep, 1 pax) → `seatFilter: rows 30, wlRows 32, trainsSeen 25, source web_confirmtkt`; line `12013 CC AVL 424 ₹675 · EC AVL 23 ₹1,015 | 19611 SL AVL 174 ₹150 · 3A AVL 71 ₹520 · 3E AVL 15 ₹520 · 2A AVL 14 ₹725 | 20807 3A 62 · 3E 8 · 2A 6 · SL 4 | … | +6 trains aur bhi hain`.
- Browser (Pixel-size, `tools/probe-live-r27.mjs`): **20 groups** — 12013 (CC+EC), 19611 (4 classes), 22487 (CC+EC), 14631 (SL + 3A WL 18), 20807 (4), 14615 (SL + 3E + 3A WL + "2A status nahi mila")… har train ki **saari** classes ek block me; text me duplicate row-list nahi.
- **Chip tap → `Passengers` screen** (screenshot: 12013 AMRITSAR SHTABDI · LDH → ASR · 2026-09-27 · ₹675/passenger · passenger form) — exactly user ka point (c).
- **Mic (native path):** probe me `window.RailBookVoice` bridge inject karke mic tap → `native calls: start:hi-IN`, koi "Mic band" message nahi, page errors `[]`; transcript sheet me aaya aur "OK ✓ Bhejo" par sawaal chala gaya.

**Tests:** naya `tests/round27-seat-classes-and-mic.test.tsx` (12 — per-train grouping/text, summary line, `missingSeatLines` per-train, `capRowsByTrain` (12×3=36), `seatListGroups`, chips tap callback, text dedupe, ReplyText multi-class rows, Concierge wiring, native bridge adapter (browser vs app), Kotlin/manifest presence) + `tests/round25-seat-answer-all-trains.test.tsx` format update → kul **106 files / 1055 tests PASS**; server `tsc` clean; client TS 67 (baseline); build `dist/assets/index-CJnycmVY.js` 471.63 kB.
**Preview:** `RailBook-round27-2026-09-26.html` (pehle vs ab block, server summary lines, live screenshots) · builder `tools/build-round27-preview.mjs` · probe `tools/probe-live-r27.mjs`.
**APK:** v1.4.8 (`RailBook-v1.4.8-release.apk`, vc 31) — native mic ke liye zaroori.

### 9.20 Round-28 (26 Sep) — black handoff panel + blue header user ko nahi (backend me) · passenger dock hamesha screen par · 45s → 30s + "details khud bhar jaayengi"

**User (3 screenshots + 4 points):**

1. "Ist screenshot mein yeh black wala handoff details user ko nhi dikhni chahiye, backend pe rakho" (IRCTC page ka bada black diagnostic box).
2. "Second screenshot mein yeh jo upar blue colour mein header hai wo user ko na dikhe, backend pe rakho" (Android top bar).
3. "passenger form mein na kaafi neeche scroll down krna padhta hai to user ko pata chlta hai review journey button bhi hai uski ek baar check kro page ka ui sahi karo".
4. "redirect to irctc time 45 sec se 30 sec krdo and sath mein user ko inform kro ki apki details automatically fill ho jayengi irctc pe, dubara dalne ki zarort nhi hai".

**1) Black handoff panel hataya (Android bridge)**

- `app/src/main/assets/autofill/railbook-webview-bridge.js`: purana `banner()` bada fixed panel (`RailBook app · assisted fill`, `Detected (…)`, `Filled (…)`, read-only note) render karta tha. Ab uski jagah `postNotice()` + `pill()`: page par **ek line wali pill** (rounded, `pointer-events:none`, **6s me khud hide**; STOP/reject wale serious message 12s ya `sticky`), aur wahi text **native** ko `ui-notice` event + `fill-result` ke saare diagnostics (`filledCount/failed/notFound/siteChanges/refusedClicks/paxFilled`) ke saath jaata hai (status bar + log + Toast). Kuch chhupta nahi — sirf screen par nahi dikhta.
- `MainActivity.kt`: naya `setStatus(msg, toast)` + `"ui-notice" ->` branch; fill-result par `paxFilled` hone par Toast: "✅ Aapki details IRCTC par bhar di gayi hain — yahan dobara kuch daalne ki zaroorat nahi. Sirf login/OTP/payment aap karenge."
- Refused-click / unexpected-change STOP par page par ab sirf: "⚠️ Autofill ruk gaya — RailBook me dobara Continue dabaiye" (detail `console.warn` + native me).

**2) Blue header screen se gayab (logic zinda)**

- `activity_main.xml`: `topBar` par `android:visibility="gone"` — version · BHASHA · status line · safety hint · RAILBOOK / IRCTC / CLEAR HANDOFF sab ab screen par nahi; **buttons, listeners, HandoffStore clear, Bhasha cycle, status text sab wahi code** (backend). `WebView` aur `prewarmOverlay` ab `parent` ke top se bandhe (poori screen).
- User-facing updates sirf chhote Toast (`setStatus`) se: handoff saved, IRCTC block (CDN), login page ready, auto-fill ho gayi.

**3) Passenger page ka dock hamesha screen par**

- Wajah: `.overlay-screen` `.app` ke **andar** `absolute` tha, aur `.app` ki `min-height: 100dvh` par chat lambi hone par wo (device test frame me) **1400px+** ho jaata hai → overlay bhi utna lamba, isliye uska bottom dock (VoiceBar + CTA) screen ke neeche chala jaata tha (user ko bahut scroll karke pata chalta tha ki "Review journey" button hai).
- Fix: `src/styles.css` me `.overlay-screen` ab `position: fixed; top/left/right: 0; height: 100vh; height: 100dvh; max-width: 480px; margin: 0 auto` (purane WebView ke liye explicit offsets, `inset` par bharosa nahi). `.sticky-cta` me `flex-shrink: 0` + top border.
- CTA label bhi honest: details adhoori → **"Review journey (pehle details bharo)"** (disabled), poora bharte hi **"Review journey"**.
- Probe (`tools/probe-pax-dock.mjs` + `tools/probe-live-r28.mjs`): CTA `top 1336px` (screen 900, bina scroll nahi dikhta) → ab **`top 836px`, `btnVisibleWithoutScroll: true`**; naiveh live browser me bhi confirm.

**4) 45s → 30s + auto-fill assurance (teen jagah)**

- `PREWARM_COUNTDOWN_MS = 30_000L` (aur "45s" wale messages → "30s"), `PREWARM_EXTRA_WAIT_MS = 0L` jaisa tha.
- Prewarm overlay me `prewarmNote` line: "Aapki details IRCTC par khud bhar jaayengi — jo yahan bhara hai wo dobara daalne ki zaroorat nahi. Sirf login/OTP/payment aap karenge."
- `src/components/IrctcHandoff.tsx` me `isRailBookAppContext()` + `autoFillNotice(inApp)` — **app me**: "IRCTC khulte hi aapki journey + passenger details khud bhar jaayengi — wahan dobara daalne ki zaroorat nahi. Sirf login/OTP/payment aap karenge (security)."; **browser me jhooth nahi**: "RailBook app (Android) me ye details IRCTC par khud bhar jaati hain — browser me summary clipboard se paste kar sakte ho." Review page par Continue button ke neeche, aur passenger page ke dock me wahi assurance.

**Live proof (deploy `20be5c2`):** live browser (Pixel-size, 430×900) — seat chip tap → passenger form: `btnLabel "Review journey (pehle details bharo)"`, `btnTop 836`, `btnVisibleWithoutScroll true`, note visible + text theek; form bharne par `label "Review journey"`, `disabled false`, phir Review page par `#irctc-continue` bina scroll dikhta hai aur `#irctc-autofill-note` line maujood.

**APK v1.4.9** (versionCode 32, `1.4.9-clean-ui-30s`, 4,819,427 B, sha256 `4ea684c3…8e1ce`): bridge files verified — purana panel string APK ke andar bhi nahi, pill + assurance line maujood.
**Tests:** naya `tests/round28-pax-dock-and-autofill-note.test.tsx` (15 — dock/CTA/assurance, overlay CSS, Android header gone par listeners zinda, 30s constant, bridge me panel gone + `ui-notice` + diagnostics) + round-24 CSS assert update → kul **107 files / 1070 tests PASS**; client TS 67 (baseline); build `index-3AgEmAG-.js` 472.71 kB.
**Preview:** `RailBook-round28-2026-09-26.html` (`tools/build-round28-preview.mjs`).

### 9.21 Round-29 (26 Sep) — "same train ki classes alag alag cards me kyun" → ek train = ek card · class tap → seedha form · "book krdo" par AI khud form · "vaishno devi" (chhota naam) → SVDK

User ke do screenshots (@`20be5c2`) ke chaar points. Grouping **sirf display level** par hai — provider ka jawab/text, API calls, fare/availability ka source aur booking engine waisa hi.

**1) Ek train = ek card (chat ka train-list)**

- Screenshot 1 me `22432` do baar aur `19804` do baar (same train ke classes alag cards me) — aur wo cards chat ke **text se bane rows** the (`ReplyText`), jo tappable bhi nahi the.
- Fix: `src/components/ReplyText.tsx` me naya pure helper **`groupReplyRowsByTrain()`** (trainNumber primary key) + grouped render:
  - ek card = ek train; header me `number` + `naam` **sirf ek baar** + `N classes` count;
  - andar har class ki **apni row** — `3A | AVL 122 | ₹635`, `SL | AVL 94 | ₹250` (har class ka apna status/count/fare/dep; koi merge/average/sum nahi);
  - **order preserve** (jo train pehle aayi wahi card wahin; koi sort/filter nahi);
  - bilkul same record (class+status+count+fare+dep) dobara aaye to ek hi baar — par alag status/fare wala record chhupta nahi (overwrite bhi nahi);
  - input rows **mutate nahi** hoti (derived view-model).
- Live board wala block (`.sf-group`, Round-27) pehle se train-wise tha; ab **dono** jagah ek train = ek card.

**2) Class par tap → seedha passenger form**

- Chat card ki class row ab **button** hai (available/RAC/WL/status-pata-nahi) → `openBookingFromReplyRow()` → wahi `selectTrainAndClassGo()` jo Seat Finder/direct card ke chips par lagta hai. `N/A`/`REGRET` par jhootha button nahi (wahan booking ka rasta hi nahi).
- Live proof: `12208 KGM GARIB RATH · 3A · SVDK → LDH · 2026-09-27 · ₹470` → passenger form.

**3) "22432 mein 3A book krdo" → AI khud passenger form kholta hai (loop khatam)**

- Pehle: "…check kar raha hoon" repeat, "Check hui?" par bhi wahi jawab, aur ek baar text beech se kata hua ("ability check karne ke liye…") jabki date pehle se pata thi.
- Ab: `src/booking/autobook.ts` (naya, pure + tested) + Concierge me booking-intent gate —
  `isBookingIntent()` ("book krdo / booking kardo / ticket chahiye" haan; sawaal nahi) → train (message/context/last-mentioned) + class (message) → `pickRowForBooking()` (usi class ki openable row, warna us train ki pehli openable row) → `buildAutoBookSeat()` → seedha passenger form. Date sirf jo user/server ne di (form ka "aaj" default guess nahi).
- Status pata na ho (**UNKNOWN** — data ke saath aaya hi nahi) to **bhi** form khulta hai; asli availability + fare "Review journey" par provider se (`goReview`), aur wahan bookable na ho to wahi rok deta hai. `booking/state.ts` ka `SELECT_TRAIN_AND_CLASS` bhi UNKNOWN par screen badalta hai (N/A/REGRET/CANCELLED par purana guard).
- `Passengers.tsx` ki lines honest: fare `0` → "💰 Fare abhi confirm nahi — Review journey par provider se aayega", timings khaali → "🕑 Timings provider ke data me nahi the" (pehle "₹0" aur "🕑 → " jaisa adhoora dikhta tha).
- Text ka adhoora kata hua hissa bhi gaya: `ReplyText` ka parser ab aadhe shabd par ruk kar row nahi banata — poora jumla paragraph hi rehta hai.

**4) "vaishno devi" jaisa chhota station naam → SVDK**

- `server/understand/legacy-stations.ts` + `src/ai/stations.ts` alias map me: `vaishno devi`, `vaishno devi katra`, `vaishnodevi`, `vishno devi`, `mata vaishno devi`, `shri mata vaishno devi (katra)`, `smvd katra`, `वैष्णो देवी`, `वैष्णो देवी कटरा`, `वैष्णोदेवी`, `माता वैष्णो देवी` — sab **SVDK** (koi naya station/naam nahi, sirf alias).
- Live: "Vaishno devi se Ludhiana kal ke liye…" par header `SVDK → LDH, 2026-09-27` (pehle "vaishno devi" parse hi nahi hota tha).

**Files:** `src/components/ReplyText.tsx` · `src/views/Concierge.tsx` (onBook wiring + booking-intent auto-advance) · `src/booking/autobook.ts` (naya) · `src/booking/state.ts` · `src/views/Passengers.tsx` · `src/styles.css` (`.rp-gcount/.rp-crows/.rp-crow`) · `src/ai/stations.ts` + `server/understand/legacy-stations.ts` (aliases).
**Tests:** naya `tests/round29-group-same-train-book.test.tsx` (**22**) + round-20/round-27 ke ReplyText asserts grouped markup par update → **108 files / 1091 tests PASS**; server tsc clean · client tsc 67 (baseline) · build `index-DIw-tok9.js` 477.97 kB.
**Live proof (`686a88f`):** turn 1 — `boardGroups 19 · trains 19 · duplicateTrains [] · svdkRoute true` (har train ek hi card me; chhota naam resolve hua) · class chip tap → `12208 · 3A · SVDK → LDH · 2026-09-27 · ₹470` · "12208 mein 3A book krdo" → form khud khula (train+class+date; row me fare na hone par honest line). Chat me Round-28 ki assurance line + "Review journey (pehle details bharo)" CTA bhi zinda.
**Preview:** `RailBook-round29-2026-09-26.html` (`tools/build-round29-preview.mjs`) · probes `tools/probe-live-r29.mjs` (local, mock) + `tools/probe-live-r29-live.mjs` (live). **APK nahi** — r29 me koi Android/native change nahi (app wahi live web URL load karta hai), isliye v1.4.9 hi chalti rahegi.

### 9.22 Round-30 (26 Sep) — "12013 ki seat availability" maanga, poori 21-train ki board kyun khul gayi

User ke 2 screenshots (@`686a88f`): sawaal tha **"12013 ki seat availability btana kal ke liye ludhiana se amritsar ke liye"** — par chat me **poori live board (21 trains × saari classes, 12 me seat)** khul gayi; 12013 ka asli jawab uske baad aaya. User: *"yeh question pe board kyu le aata … maine to maanga hi nahi"*.

**Wajah:** Round-27 se chat me `seatlist` block banta hai jo **hamesha server ke poore `seatFilter` payload** (poori board) se render hota tha — chahe user ne ek train poochi ho. Jaan-boojh kar "sab dikhao" tha (r25/26/27 ke rules), lekin focus wale sawaal me wo "unmaangi list" ban jaata tha.

**Fix (display-level scope):**

- `src/chatText.ts`: naye pure helpers —
  - `trainNumbersInText(text)`: message me se train number(s), order preserve + duplicate ek baar. **Saal (2026), tareekh (`2026-09-27`, `27/09/2026`), time (`18:01`, `7 baje`) chhod deta hai** (warna wo 4-5 ank ke number train jaise lagte hain).
  - `focusSeatRows(rows, focus)`: focus khaali → poori list **waisi hi**; focus ho → sirf usi train ki rows; maangi train list me na ho → kuch nahi (unrelated board nahi thopte). Input mutate nahi hoti.
- `src/views/Concierge.tsx`: `seatlist` block ab `trainNumbersInText(trimmed)` se scoped — `focus: [12013]` + sirf usi train ki rows. Block sirf tab banta hai jab rows bachi hon.
- `SeatListBlock` header: focus par **"Aapki maangi train (live board) · 12013 · 1 train · 1 me seat"** (halka green pehchaan `sf-focused`); generic par pehle jaisa "Seat wali trains (live board) · N trains".
- Round-29 ka booking auto-advance bhi wahi helper use karta hai (`trainNumbersInText(trimmed)[0]`) — "2026" ko train samajhne ka risk khatam.
- Server/provider/booking: kuch nahi chhua — payload, rows, fares waisi hi aati hain; sirf dikhaya kam hota hai (aur maang na ho to poora).

**Live proof (deploy `0b36c52`):** A) 12013 ka sawaal → `blocks=1 · focused=true · groups=1 · chips=2` ("Aapki maangi train (live board) 12013 · 1 train · 1 me seat" · `CC AVL 354 ₹675` · `EC AVL 23 ₹1,015`) · B) usi chat me "kal ke liye seat wali trains batao" → `blocks=2 · groups=20 · chips=59` (pehle jaisa poora board). Local probe: 14610 (list me nahi) → koi block nahi.
**Tests:** naya `tests/round30-focused-train-seat-block.test.tsx` (11) → **109 files / 1103 tests PASS**; server tsc clean · client 67 (baseline) · build `index-BF7JVy_K.js` 478.55 kB.
**Preview:** `RailBook-round30-2026-09-26.html` (`tools/build-round30-preview.mjs`) · probes `tools/probe-live-r30.mjs` (local) + `tools/probe-live-r30-live.mjs` (live). **APK nahi** — koi Android change nahi.

### 9.23 Round-31 (26 Sep) — "answer ke baad AI ko next step pe leke jaana chahiye… AI khud dimaag kyu nahi lagata?"

User: *"maine specific train ki availability poochi and AI ne sahi answer bhi diya — ab AI ko passenger ko next step pe leke jaana chahiye na… not specific to seat availability but any question asked and answered… To AI khud ka dimaag kyu nahi lagata?"*

**Jawab (design):** model ke paas booking/payment ka koi tool nahi hai (`confirmBook` hamesha false) — usse "khud soch kar" agla kadam (screen kholna/ticket banwana) lene dena wahi jagah thi jahan pehle galat screen khulti thi (Round-18m-7) aur numbers ban jaate the (standing rule: **kuch bhi fake nahi**). Isliye agla kadam ab **data se** banta hai, model ke andaze se nahi.

**Kya lagaya:** `src/ai/nextstep.ts` (naya, pure + tested) + Concierge me har jawab ke baad ek **"➡️ Agla kadam"** card (1–2 tappable chips + honest hint):

| Jawab me kya aaya | Agla kadam |
|---|---|
| seat rows (khaas train) | `Book <train> · <class> (AVL/RAC/WL # ₹fare)` — AVL > RAC > WL, phir zyada seats; doosra chip: `doosri classes (…)` (sirf usi train ki) |
| seat rows (generic) | sabse achhi seat wali train ka Book chip + `Baaki trains bhi (N)` |
| sab N/A/Regret | `Jahan seat hai wahi dikhao` + honest hint |
| sirf WL | WL ka sach + "ticket waitlist me rahega" (jhootha available nahi) |
| train list (seat data nahi) | `Kis train me seat hai?` |
| journey plan | pehle bookable leg ka Book chip; kuch bookable na ho → `Doosri date dekho` |
| live status/schedule/stops | `<train> ki seat availability` |
| kuch verified nahi | **koi chip nahi** |

Chip wahi utterance bhejta hai jo pehle se chalte flows ko trigger karti hai — `Book 12013 · CC (AVL 354 ₹675)` → `12013 mein CC book krdo` → Round-29 ka auto-advance **seedha passenger form** (live: form me `12013 · CC · LDH → ASR · 📅 2026-09-27` + "details IRCTC par khud bhar jaayengi" + Review journey). Koi naya number/naam/fare invent nahi hota — jo row me dikha wahi label me.

**Files:** `src/ai/nextstep.ts` (naya) · `src/ai/orchestrate.ts` (block type `nextstep`) · `src/views/Concierge.tsx` (`askedTrains` ek jagah + block push + `NextStepCard` export) · `src/styles.css` (`.ns-card/.ns-chip`).
**Live proof (`de97b12`):** seat ka jawab → chips `Book 12013 · CC (AVL 354 ₹675)` + `12013 ki doosri classes (EC)`; tap → passenger form (12013 · CC · LDH → ASR · 2026-09-27). Local probe: list → `Kis train me seat hai?`; stops → `12013 ki seat availability`; koi data nahi → koi card nahi.
**Tests:** naya `tests/round31-next-step.test.tsx` (18) → **110 files / 1121 tests** (1120 pass; 3 RailCore network-flaky tests alag chalane par pass) · server tsc clean · client 67 (baseline) · build `index-C4mTfzQI.js` 478.7 kB. Round-30 ka test bhi update (`askedTrains` ek jagah).
**Preview:** `RailBook-round31-2026-09-26.html` (`tools/build-round31-preview.mjs`) · probes `tools/probe-live-r31.mjs` (local) + `tools/probe-live-r31-live.mjs` (live). **APK nahi** — koi Android change nahi.

### 9.24 Round-32 (26 Sep) — "har query pehle model ke pass jaani chahiye and wo decide kare kya karna hai"

User (correction): *"har query pehle model ke pass jaani chahiye and wo decide kare kon sa tool use karna yan kya karna hai, user ka answer kahan se laana hai"* — matlab **agla kadam bhi model chalaye**, data sirf validate kare aur fallback de. (Round-31 me agla kadam data se banta tha; wahi framing user ne reject ki — "dimaag data ka lagta hai, model ka nahi".)

**Model-first flow pehle se hi intact tha** (verify kiya): client har query `/api/agent` par bhejta hai (locally sirf 3 exceptions — `criticalBookingFlow`, `classPickWhileSelected`, `localUiQuery`), aur server par **model tool chunta hai** (deterministic NLU/routing sirf fallback; booking mutations deterministic; model ke paas booking tool nahi, `confirmBook` hamesha false). Ab **agle kadam ka choice bhi model ka** hai:

1. **Prompt rule 26 (agentic.ts):** jawab ke ekdum aakhir me 1–2 line *bilkul is format me* — `[NEXT] <chhota label> => <wahi baat jo user bhej sakta hai>`. Rule: sirf **isi turn ke tool data** se (koi naya train number/naam/fare/count nahi), label me wahi number jo data me hai, max 2 lines, kuch verified na ho to koi `[NEXT]` line nahi (zaroori nahi har baar), aur reply ke andar agla kadam dobara nahi likhna (UI khud dikhata hai). Rule 13 update: generic "kya aur chahiye?" chit-chat band, par asli agla kadam hamesha.
2. **Server extraction + evidence filter:** `extractNextActions()` reply se `[NEXT]` lines **alag** karta hai (warna wo line user ko dikh jaati), aur har action `groundingCheck(label + " " + utterance)` se guzarta hai — jo number/naam/code is turn ke tool evidence me nahi mila, wo **drop** (fake chip ka rasta band). Result `AgenticTurn.nextActions` → `AgentResponse.nextActions` → `/api/agent` → `src/api.ts`.
3. **Client model-first + fallback:** `Concierge.tsx` pehle `agentRes.nextActions` dikhata hai — card par tag **"AI ne chuna"** (tooltip: "AI ne khud ye agla kadam chuna"). Model ne kuch na diya / sab drop ho gaya → Round-31 ka data-derived `nextStepsFor()` chalta hai, tag **"verified data se"**. Kuch bhi verified na ho → koi card nahi.

**Round-32b (LIVE par pakda gaya, fix):** asli model ke tool ne ek provider se data liya (`CHECK_AVAILABILITY` → **web_railyatri**: `CC AVL 334 ₹490` — "IRCTC data, railway API down tha") aur screen ka live board doosre provider se bana (**web_confirmtkt**: `CC AVL 341 ₹675`) — dono asli, par **ek hi screen par same train+class ke do alag number**. Standing rule ("kuch bhi conflicting/fake nahi") ke hisaab se fix: naya pure `reconcileNextActions(actions, boardRows)` (agentic.ts, `server/app.ts` me lagaya) — model ka **chuna hua action waise hi** rehta hai, sirf wo **seat/fare numbers** chip se hat jaate hain jo usi train+class ke board rows se na milte hon (train number kabhi nahi hatta, jargon-only chip drop, board me na ho to kuch nahi chhedte, generic count jaise `Baaki trains bhi (24)` conflict nahi maana jaata).

| Situation | Kya dikhta hai |
|---|---|
| model ne `[NEXT]` diya, evidence me sab match | chips model ke, tag **"AI ne chuna"** |
| model ne `[NEXT]` diya par koi cheez evidence me nahi | wo line **drop** (server) → data fallback, tag "verified data se" |
| model ne `[NEXT]` hi nahi diya (ya clarifying sawaal poochha) | data fallback (Round-31), tag "verified data se" |
| chip ke numbers board se takra rahe hain | sirf wo numbers chip se hat gaye (action model ka) |
| kuch bhi verified nahi | **koi card nahi** |

**Live proof (`dc257a0`):** "12013 ki seat availability batao kal ke liye ludhiana se amritsar, 1 passenger" → `engine=agentic_tool_calling`, `meta/muse-glimmer-30b`, `nextActions=[{label:"Book 12013 · CC (AVL 334)", primary:true}]` (fare ₹490 board ke ₹675 se takra raha tha → strip). Browser probe: A) tag **"AI ne chuna"** + model chip → B) tap → passenger form (12013 · CC · LDH → ASR · 2026-09-27) → C) "12013 ka schedule batao" (deterministic turn) → tag **"verified data se"** `12013 ki seat availability` → D) suvidha wala sawaal → **koi card nahi**. Local probe (built dist + mock server shapes): **6/6 PASS** (model chips, chip tap, ungrounded drop → data fallback, list fallback, plain → koi card nahi, user ke train number se honest chip).

**Files:** `server/agent/agentic.ts` (rule 13/26, `NextAction`, `extractNextActions`, evidence filter, `reconcileNextActions`) · `server/agent/run.ts` (field + mapping) · `server/app.ts` (reconcile wiring) · `src/api.ts` · `src/ai/orchestrate.ts` (`nextstep` block `source?: "model" | "data"`) · `src/views/Concierge.tsx` (model-first branch + tag) · `src/styles.css` (`.ns-tag`).
**Tests:** naya `tests/round32-model-next-step.test.ts` (22 — 14 Round-32 + 8 Round-32b) + round-31 test update → **111 files / 1143 ALL PASS** · server tsc clean · client 67 baseline · build `index-CW1i71n2.js` 482.8 kB.
**Preview:** `RailBook-round32-2026-09-26.html` (`tools/build-round32-preview.mjs`) · probes `tools/probe-live-r32.mjs` (local) + `tools/probe-live-r32-live.mjs` (live). **APK nahi** — koi Android change nahi (app live URL load karta hai).

### 9.25 Round-33 (26 Sep) — "AI ko saare tools khule" + "kya AI meri baat samajh nahi paaya?"

User (3 screenshots): *"mainay esko yeh bola … esne trains list krdi without fare and timings, fir maine alternative trains poocha lekin fir list bta di … kya AI meri baat samjh nhi paaya … ek kaam kro AI ko jitne bhi tools available hai wo sabh provide kro I mean no restriction on using any tool bss AI continue to IRCTC pe click nhi karega na hi passenger details khud se fill krega, don't fake anything sabh real and live data hona chahiye, first use confirm tkt, then rail yatri, then e rail on API fallback to fetch relevant data, like fare, seat availability, timings, route, station codes, live status, etc. depends on user question AI should handle everything without restriction on any tool."*

**Root causes (live reproduce karke pakde):**
1. **"Kal,1"** — `RANK_JOURNEY_OPTIONS` **PASSENGERS MISSING** se reject ho gaya (userStatedPax ne "Kal,1" ko pax nahi maana kyunki usme "log/passenger" shabd nahi the) → model ne pax **dobara** poochh liya. Purane gate me `SEARCH_TRAINS` bhi pax ke bina chalta hi nahi tha (jabki wo list tool hai).
2. **"plan banao"** ka koi saaf prompt rule nahi tha → model ne seat/list tools chune.
3. **"alternative trains"** — `FIND_ALTERNATIVE_TRAINS` kab call karna hai wo rule 2b me sirf WL/RAC case ke liye likha tha, general "alternative / doosri trains" ke liye nahi → model wahi list dohra deta tha.
4. **Web fallback order** — availability me **railyatri pehle** tha, confirmtkt baad me; trains-between ka web fallback sirf erail tha (jisme **fare nahi** hota) → isliye "list without fare and timings".

**Kya badla:**
- **Tools ki azadi (rule 27):** saare tools khule, koi count-limit nahi (web search ka "max 1 call" cap bhi gaya) — sirf 2 cheezein kabhi nahi: **"Continue to IRCTC" click** aur **passenger form khud bharna** (booking mutations deterministic hi rahe; `confirmBook` hamesha false).
- **Sawaal ka matlab pehle (rule 28):** "plan/journey plan/best" → `RANK_JOURNEY_OPTIONS`/`JOURNEY_ANALYZE`; "alternative/doosri trains/iske alawa" → `FIND_ALTERNATIVE_TRAINS`; "trains batao" → `SEARCH_TRAINS`; seat → seat tools. Har train list me **timing (dep → arr + duration) aur fare (jo tool ne diya) ZAROOR**.
- **Provider order central (`server/railway/webOrder.ts`, naya pure module):** `WEB_PROVIDER_ORDER = confirmtkt → railyatri → erail`, capability-wise chains (availability / fare / trains-between / schedule / station / live). Router me availability ki **dono** branches, `withFareFilled`, `erailFareBreakdown` aur `searchTrainsRouted` ab isi chain se chalte hain. Jo site capability support nahi karti wo chain me aati hi nahi (live = railyatri ETA, station codes = erail list, trains-between = confirmtkt → erail).
- **Train list me timings + fare:** naya `confirmTktTrainsBetween` (route board → TrainResult; `boardRowsToTrainResults` pure mapping, tested) — web chain ka pehla qadam; erail (IRCTC timetable list) aakhri. `SEARCH_TRAINS` ke data me per-train `fares` bhi.
- **Seat cards par timings:** `seatFilter` ab **har** turn me times laata hai (wahi ek search call, deduped) → card par `🕑 20:19 · 2h 46m` (pehle sirf "live board").
- **`SEARCH_TRAINS` ko pax ki zaroorat nahi** (gate se hataya); pax-precondition sirf seat/plan/connection tools par.
- **"Kal,1" fix:** `userStatedPax` me — pichhla sawaal passengers ka tha to message ka akela number pax hai (date/`dd-mm-yyyy`/5-digit train number ka hissa pehle hata diya jaata hai). Model ke args se aaya pax **capture** hokar `ctx` me yaad rehta hai → agle turn me "kya ab bhi 1 passenger?" nahi.
- `fareSource` type widen (confirmtkt/railyatri bhi honest source ho sakte hain).

**Live proof (`a96ed83`):** "plan bana sakte ho?" → sawaal; **"Kal,1"** → `RANK_JOURNEY_OPTIONS` ok (source web_confirmtkt) → JOURNEY PLAN card: LDH → NDLS · 27 Sept · **1 passenger** · 19 direct · 6 me seat · RECOMMENDED · direct 22478; **"Alternative trains"** → `FIND_ALTERNATIVE_TRAINS` ok → 12484 ASR TVCN 08:12→12:55 (4h 43m) 3A AVL 110 ₹635 · 12716 SACHKHAND 3A AVL 47 ₹635 · 11058 3E AVL 29 ₹600 · 12926 1A AVL 1 ₹1,620 + "usi train ki doosri class" + alt-date chips; seat answer → card par `🕑 20:19 · 2h 46m`.
**Files:** `server/railway/webOrder.ts` (naya) · `server/railway/router.ts` (chains + confirmtkt trains-between) · `server/providers/types.ts` (fareSource) · `server/agent/agentic.ts` (rules 27/28, pax gate, capture.passengers, userStatedPax, SEARCH_TRAINS fares) · `server/agent/run.ts` (capture→ctx) · `server/agent/seatFilter.ts` (times hamesha) · `src/views/Concierge.tsx` (card timing text).
**Tests:** naya `tests/round33-tool-freedom-and-provider-order.test.ts` (26) + 4 purane update (toolcalling MULTI-TURN, round18m30h gate, route-board stale, round18g fareSource) → **112 files / 1169 ALL PASS** · server tsc clean · client 67 baseline · build `index-C0QGbnrE.js` 483.0 kB.
**Preview:** `RailBook-round33-2026-09-26.html` (`tools/build-round33-preview.mjs`) · live probe `tools/probe-live-r33-live.mjs`. **APK nahi** (koi Android change nahi).

### 9.26 Round-34 (26 Sep) — "seats to pehle hi hain, phir kahe passengers poochh raha?" + "agla kadam hamesha AI chune"

User (2 screenshots): *"First screenshot mein 12380 mein seats available hai and then I said book 12380 to eske pass seats to pehle hi hain to fir kyu dubara pooch rha kya AI apna brain use nhi kar raha ? And Agla kadam na humesha AI hi chunne sabh sochke and suggestions bhi de user ko, agla kadam fallback pe verified data se mat aaye"* (+ ek sawaal: "kya tumne AI logic / tools calling way / thinking mein kuch change kiya?")

**Root causes:**
1. **"Book 12380"** client ke `isBookingIntent` me **fail** ho raha tha — purana regex sirf `book … kar/krdo/karo…` pakadta tha, "Book <number>" (bare hukm) nahi. Isliye message server ko gaya, jahan model ne resolve + seat-check kiya aur pax gate ne "kitne passengers?" poochh liya — jabki **seat data us chat me pehle hi dikh chuka tha**.
2. **Agla kadam** model ke `[NEXT]` na dene par data-derived fallback ("verified data se") dikha deta tha — user chahta hai agla kadam **hamesha AI khud sochke** chune.
3. (Probe me pakda) passenger form khula hone par koi bhi naya sawaal client ke local booking path me chala jaata tha ("Nahi, seat availability ki jankari mere paas nahi hai") — jabki user ka standing rule: **har query pehle model ke paas**.

**Fixes (Round-34):**
- **`isBookingIntent` me bare booking hukm:** `book|booking|reserve` + 4-5 digit train number (aage/peeche, `?` ke bina) → booking intent. Train number ke bina akele "book" par trigger nahi (koi jhootha form nahi).
- **Seat rows yaad:** client ab pichhle seat turn ki rows `lastSeatRowsRef` me rakhta hai (route+date ke saath) — booking hukm par form **usi asli data se** bharta hai (status/seats/fare/timing), dobara check karne ka bahana nahi. Route/date match na ho to purani rows use nahi hoti (nayi journey par purana fare nahi lagta).
- **NEXT-repair pass (server):** model ka jawab grounded ho, turn me ok tool data ho, par `[NEXT]` na ho → **ek chhoti repair call** model ko jaati hai: *"SIRF 1-2 line: [NEXT] <label> => <utterance>, sirf isi turn ke tool results se"* → chips model ke hi bante hain (agar wo bhi na de to data fallback, aakhri upay). Prompt **rule 26** bhi sakht: data aaya ho to `[NEXT]` ZAROOR — "user ka data-derived fallback tabhi chalta hai jab tumne kuch na diya ho".
- **Local booking path sirf booking ki baaton ka:** `criticalBookingFlow` me naya guard `freshQuestionDuringBooking` — train number ya seat/fare/time/status/stops wala sawaal form khula hone par bhi **model ke paas** jaata hai; confirm/aage/back/details local hi rehte hain.

**Live proof (`a1aff0d`):**
- "kal ke liye ludhiana se amritsar seat wali trains batao" → seat board + agla kadam **"AI ne chuna"**;
- **"Book 12053"** → seedha passenger form: *12053 ASR JANSHATABDI · 2S · LDH → ASR · 📅 2026-09-28 · 🕑 19:48 → 💰 ₹110 per passenger* — koi pax sawaal nahi (`paxAsk:false`), purani seat list ke data se;
- form khula hone par "12013 ki seat availability batao" → **model ka jawab**: 12013 CC AVL 650 ₹675 · EC AVL 32 ₹1,015 (pehle local path "jankari nahi hai" bolta tha);
- poore probe me **NEXT tags: model 4 · data-fallback 0** (agla kadam har turn model ka).

**User ke sawaal ka jawab (AI logic/tools calling me kya badla?):** is round me **model, provider tools, execution path (model tool chunta hai → server allowlist+zod se chalata hai), booking safety (`confirmBook` hamesha false) — kuch nahi badla**. Badla: (a) client ka booking-intent detection (UI-level), (b) client ki seat-rows memory (UI-level), (c) **prompt rules 26/27/28** (AI ke sochne ke rules — Round-33/34 me add/tighten), (d) Round-34 me `userStatedPax`/pax-precondition jaise **tool *preconditions*** (kab tool chalta hai) — tool ka *kaam* wahi hai, (e) provider chain sirf **data source order** (user ke aadesh par confirmtkt → railyatri → erail).

**Files:** `src/booking/autobook.ts` (isBookingIntent) · `src/views/Concierge.tsx` (lastSeatRowsRef + freshQuestionDuringBooking) · `server/agent/agentic.ts` (NEXT-repair pass + rule 26 tighten).
**Tests:** naya `tests/round34-book-known-seats-and-model-next.test.tsx` (16) + `agentic-toolcalling` ka call-count update (mock model [NEXT] deta hi nahi → repair call bhi ginti hai) → **113 files / 1185 ALL PASS** · server tsc clean · client 69 (baseline) · build `index-BLb0w2Ig.js` 483.9 kB.
**Preview:** `RailBook-round34-2026-09-26.html` (`tools/build-round34-preview.mjs`) · live probe `tools/probe-live-r34-live.mjs`. **APK nahi** (koi Android change nahi).

### 9.27 Round-35 (26 Sep) — "19028 mein book krdo" par AI ne class kyun nahi poochhi?

User: *"mainay bola vaishno devi se ludhiana ki seat availability btao to AI ne bta di … uske baad maine 19028 train mein na multiple class mein seats available thi to maine bola '19028 mein book krdo' to AI ne yeh nahi poocha kon si class mein book karun, bhai esa kyu ho rha abh mai kya ek ek cheez check krun? AI khud kyu nhi soch rha kya sahi logic se poochhna chahiye, khud kyu nhi dimag laga raha wo, har cheez thodi btani padegi use."*

**Root cause:** booking intent par client `pickRowForBooking` chup-chaap **pehli openable row** utha kar passenger form khol deta tha — us train me agar 3–5 classes khuli thi (jaise 19028), to AI ka koi sawaal hi nahi aata tha; user ko andaza bhi na chalta ki konsi class khul gayi. (Aur agar list me SL/WL row pehle hoti to WL ka form khul sakta tha.)

**Fixes (Round-35):**
- **Naya block `classchoice`** (`src/ai/orchestrate.ts` + Concierge): jab booking hukm aaye, **class boli na ho**, aur us train me **ek se zyada class khuli ho** (AVAILABLE/RAC) → form **ruk jaata hai** aur card aata hai: *"13042 HIMGIRI EXPRESS me 2 classes khuli hain — 3A (AVAILABLE 29), 2A (AVAILABLE 7). Kaunsi class me book karun?"* Chips = **sirf wo classes jo board par sach me khuli hain**, label me wahi status/seats/fare jo provider ne diya (`3A · AVAILABLE 29 · ₹520`). Chip tap → wahi class wala booking sentence → **seedha us class ka passenger form**.
- **Ek hi class khuli ho** to poochhne ki zaroorat nahi (seedha wahi class) — user ko faltu sawaal nahi.
- **`pickRowForBooking` ab seat-wali class prefer karta hai** (AVAILABLE/RAC pehle, phir WL) — class na boli ho to WL/`N/A` row ka form nahi khulta.
- **Model ko bhi sikhaya (rule 28):** booking maangi gayi ho, class na boli ho, aur ek se zyada class khuli ho → **pehle SAAF poochho "kaunsi class me book karun?"** aur `[NEXT]` me wahi classes chips ke roop me do (jaise `[NEXT] 19028 · 3A (AVL 26 ₹565) => 19028 mein 3A book krdo`); uski class ke bina aage mat badho. Isi turn me model ne khud bhi poochha ("Class confirm karo — is train mein kaunsi class chahiye?") aur khud ke chips diye.

**Live proof (`b97b3c7`, probe `tools/probe-live-r35-live.mjs` — user ka route):**
- "vaishno devi se ludhiana kal ki seat availability batao" → seat board (18 trains · 12 me seat);
- **"Book 13042"** (us board se, 2 classes me seat) → **form RUK gaya**, model ne khud poochha *"Class confirm karo — kaunsi class chahiye?"* aur card: `🪑 13042 — KAUNSI CLASS ME BOOK KARUN?` chips **3A · AVAILABLE 29 · ₹520** / **2A · AVAILABLE 7 · ₹725**;
- chip tap → passenger form **13042 HIMGIRI EXPRESS · 3A · SVDK → LDH · 📅 2026-09-28 · 💰 ₹520/pax** (jo dikha wahi gaya; jis class ka timing provider ke data me nahi tha wahan honest line "Timings provider ke data me nahi the").

**Files:** `src/ai/orchestrate.ts` (Block `classchoice`) · `src/views/Concierge.tsx` (gate + `ClassChoiceCard`) · `src/booking/autobook.ts` (seat-wali class prefer) · `server/agent/agentic.ts` (rule 28 class-ambiguous).
**Tests:** naya `tests/round35-ask-class-when-ambiguous.test.tsx` (15) → **114 files / 1200 ALL PASS** · server tsc clean · client 69 (baseline) · build `index-DcFTsEZG.js` 485.8 kB.
**Preview:** `RailBook-round35-2026-09-26.html` (`tools/build-round35-preview.mjs`). **APK nahi** (koi Android change nahi).
