

**Round-43k part 2 (live verification ke baad mile do gaps bhi band):**
- **Grounded route-fact injector** (`agentic.ts routeFactLine`): khaas train + station wale kisi bhi sawaal par ("X se chalti hai?", "Y par rukti hai?", "Z tak jaati hai?") timetable ka SACHCH model ko diya jaata hai — stop ka role (origin / stop #n / aakhri stop) + arr/dep. Isse "origin X nahi hai, isliye X se nahi chalti" jaisa galat tark band.
- **Negative claim do source se:** "ye station is train me nahi" ek NEGATIVE claim hai — isliye claim se pehle doosra (web-scrape) schedule source bhi dekha jaata hai; dono chup rahein tab hi fail. (Wajah: ek provider ke stop-list me gap ho sakta hai.)
- **Shehar-sibling fact:** station route me na ho par usi SHEHAR ka koi doosra station route me ho to wahi batate hain — live: `12054 ludhiana se haridwar tak chalti hai?` → "12054 LDH par stop nahi karti; isi shehar ka **DDL (Dhandari Kalan)** route me hai — departure 09:20" (+ chip "DDL ka seat"). General hai: kisi bhi train x multi-station city par.
- **Marker scrub:** model ke control tokens (`[END]`, `(done)`) user ko kabhi nahi dikhte; `[NEXT]` chips bache rehte hain.
- Full suite **122 files / 1341 tests pass** (`/tmp/r43k-suite5.log`).

**Round-43k part 3 (live verification me pakdi gayi 2 aur cheezein):**
- **Dono side NLU se aane par verification skip ho jaati thi** (live: `12951 mumbai rajdhani haridwar` → NLU ne origin=BCT, destination=HW de diya aur code chup-chaap aage badh gaya, jabki HW us route me nahi hai) — ab har path par verify hota hai, aur jo station route me nahi wo segment endpoint bhi nahi banta.
- **Doosre source se bacha station segment endpoint nahi banega** (warna provider se ulta HW→HW jaisa data maangte).
- Full suite **122 files / 1341 tests pass** (`/tmp/r43k-suite6.log`).

**Round-43k part 4 (leak):** tool ka RAW text (`Station checks: BCT onRoute: false`, `"resolvedRoute"` jaisa JSON echo) reply me kabhi nahi — `scrubInternalNotes` me raw-tool-echo filter (`/tmp/r43k-suite7.log`).

**Round-43k part 5 (nuance har path par):** `GET_TIMETABLE` ke station line me bhi same-shehar ka route-station aata hai (`citySiblingOnRoute`) — isliye jab model timeout ho kar tool-summary fallback chalta hai tab bhi `12054 ludhiana se haridwar tak chalti hai?` ka jawab "LDH par stop nahi, **DDL (Dhandari Kalan) 09:20** se haan" hota hai, adhoora "LDH use nahi hoti" nahi. Suite 122/1341 pass (`/tmp/r43k-suite8.log`).

## §9.36 — Round-44 (28 Sep 2026): "particular station kitne baje pahuchi thi" — har phrasing, seedha jawab

**User (3 screenshots):** ek hi sawaal teen tarah se poochha aur teen alag (do galat) jawab mile:
1. `12013 ka ludhiana aarival kitne baje ka tha 27 sept ko` → theek (model ne timetable se bataya)
2. `At what time 12013 arrived ldh on 27 sept` → **"Kahan jaana hai? Station bataiye."** ❌
3. `12013 kal ludhiana kitne baje pahunchi thi ?` → live + history + timetable ka poora dump, jawab beech me chhupa; SELECT TRAIN card me **model-instruction leak** ("uska tool AB call karo…") ❌
User: "kya abh mai ek ek test kru!? Possible nhi hai… AI kyu nahi sahi answer de rha jo poocho usse. plz fix everything."

**Root causes (teen, sab general):**
- Arrival-at-station ka deterministic jawab **sirf non-AI mode** me chalta tha (`!aiFirst`); AI-first me model bharosa tha — model timeout/wrong par legacy fallback "Kahan jaana hai?" de deta tha.
- Typo (`aarival`), English phrasing (`At what time … arrived`) — regex/text me cover nahi.
- Tool ke data me **model ke liye likhi instruction** (`note: "Train resolve ho gayi. … uska tool AB call karo"`) — client TrainPicker use UI me render karta hai → user ko dikh gayi.

**Fix:**
- `simpleArrivalQuestion()` — saaf arrival sawaal (koi seat/fare/book/live/plan/list intent nahi) par **AI-first me bhi** deterministic arrival jawab pehle chalta hai. + typo-tolerant words, `eta`, English phrasings.
- `runDateLabel()` — user ka din (27 sept / kal / aaj / 27-09 / parso) jawab me: "12013 (…) — **27 Sep 2026 ki run ke liye** timetable ke hisaab se: LDH arrival 20:16, departure 20:19."
- **Binary sawaal** (`X pahunch gayi kya?`) → `arrivalBinaryTurn()`: live run data se haan/na (Journey completed ⇒ haan; run start nahi hua ⇒ "abhi nahi, aaj 16:30 se start"; route-order se current vs asked stop; NTES "Departed from X at HH:MM" line).
- **"X par rukti hai kya?"** → `stoppingQuestionTurn()`: route ke sach se haan (arr/dep ke saath, multi-station bhi) ya saaf "nahi, is route me nahi" (+ shehar-sibling).
- "kitni der rukti hai" (halt duration) bhi usi family me — timetable se "halt ~3 min".
- **Leak net:** `SEARCH_TRAIN_BY_NUMBER` ke data se model-instruction note hata di (guidance ab system prompt rule 33 "RESOLVE-ONLY RESULT" — general) + `scrubInternalNotes` me `user ko … bolo/batao` pattern; `⚠ STALE` text bhi ab seedha user-facing.
- Live precheck ("kahan hai/late") sirf non-AI mode me (AI ke paas TRACK_TRAIN/GET_TRAIN_HISTORY hai).

**Proof (live 12013, IST):** `At what time 12013 arrived ldh on 27 sept` → "…27 Sep 2026 ki run ke liye…Ludhiana Jn (LDH): arrival 20:16, departure 20:19" **1.1s** · `12013 kal ludhiana kitne baje pahunchi thi ?` → wahi **0.7s** · `12013 LDH pahunch gayi kya` → "nahi, abhi nahi pahunchi (aaj ka run 16:30 se, LDH arrival 20:16)" · `12013 kal ludhiana pahunch gayi thi kya` → "haan, pahunch chuki hai (run poori)" · `12013 haridwar par rukti hai kya` → "nahi, HW par rukti nahi (route NDLS → ASR)". Tests: `tests/round44-arrival-at-station.test.ts` (10) · full suite **123 files / 1351 tests pass**.

## §9.37 — Round-45 (28 Sep 2026): FULL AI-FIRST — model pehle, deterministic sirf rescue

**User ka challenge:** "jab AI ke paas sabhi tools hai … har query sabse pehle AI ke paas jaani chahiye … tum handler ya rules update kyu krte ho … Ese to user experience kharab ho jayega." Trade-off saaf rakha gaya → user ne chuna: **full AI-first + accuracy-only** ("sahi jawab, chahe 10-20s lage").

**Naya flow (booking hukm chhodkar har sawaal):**
1. **Model pehle** — wo khud tools chunta hai (TRACK_TRAIN / GET_TIMETABLE / CHECK_AVAILABILITY / TRACK/…). R44 ka "AI-first me bhi deterministic arrival pehle" **supersede**.
2. **Deterministic sirf 3 haalat me** (rescue net, preemption nahi):
   (a) AI off/unconfigured, (b) model fail/timeout/throw, (c) **model ka jawab us sawaal ka jawab hi na ho** (khokhla: "Kahan jaana hai? Station bataiye." ya sirf train-summary) aur hamare paas usi sawaal ka verified (real tool data) jawab maujood ho. Warna model ka jawab hi user ko jaata hai.
3. **Booking hukm** (`isBookingMutation`) pehle jaisa deterministic — 2-rok rule intact.

**Implementation (`server/agent/run.ts`):** 4 precheck blocks → named fallback functions + `!aiFirst` gates:
- `singleTrainSeatTurn(req, seeded)` · `livePrecheckTurn(req)` · `arrivalFamilyTurn(req, seeded)` · `departureTurn(req, seeded)`.
- `answerKind45(text)` (seat / arrival / live — sirf 3 qismein, per-question rule nahi) + `replyAdequateFor45(kind, reply, question)` (jawab me ASLI data hai ya nahi: seat → AVAILABLE/WL/RAC/₹/N/A; arrival → sawaal ka station + waqt ya "rukuti hi nahi"/route-line; live → waqt/delay/position).
- `deterministicRescue45(kind, req, seeded)` — qism ke hisaab se pehla verified jawab (seat → seat turn pehle, live → live turn pehle, warna arrival family pehle).
- Model-fail rescue aur adequacy net dono **isi** helper se chalte hain (duplicate logic nahi). Telemetry: `{adequacyRescue: kind, modelHad: "..."}` prod log me.

**Isi round me band kiye gaye do gap (live testing me mile):**
- **`kitni der rukti hai` hijack:** `LIVE_TODAY_RE` me "kitni der" hai, isliye halt sawaal live-status ban jaata tha → `livePrecheckTurn` ab `STOPPING_Q_RE`/`HALT_QUESTION_RE` wale sawaal nahi leta. Live: `12013 LDH par kitni der rukti hai` → "LDH par 3 minute rukti hai · arrival 20:16, departure 20:19" (42s, model ne khud).
- **Route me na hone wala station:** `12013 haridwar arrival kitne baje` → "Kahan jaana hai?" aur `… pahunch gayi kya` → live ka raw dump aa jaata tha. Ab `routeMismatchTail()` (ek hi sach-text) arrival / binary / departure teeno me + `DEPART_QUESTION_RE` me "kab chalti/chalte/nikalti" bhi. Live: "12013 ka route NDLS → ASR hai, isme Haridwar nahi aata — isliye train Haridwar pahunchti hi nahi."

**Proof (prod `4f404d7`, live battery 9 sawaal, 0 leak):** `12013 kal ludhiana kitne baje pahunchi thi ?` → 27 Sep ki run, LDH arrival 20:16 (§112s, model ne summary di → verified rescue) · `At what time 12013 arrived ldh on 27 sept` → LDH 20:16 (§117s) · `12013 haridwar arrival kitne baje` → saaf route correction (§107s) · `12013 LDH par kitni der rukti hai` → halt 3 min (§42s) · `12054 haridwar ke liye seat check krna` → CC/2S date-wise availability (§91s, rescue) · `12054 late hai kya` → "time par chal rahi hai, delay 0 min, abhi Ambala Cant Jn" (§44s). Full suite **124 files / 1359 tests pass** (`/tmp/r45-suite4.log`), naya `tests/round45-ai-first.test.ts` (6 tests) + R44 ka "AI-first me deterministic jeetta hai" wala test **R45 semantics** me update.

**Khuli baatein (agle round ke liye):**
- **Latency:** AI-first me simple sawaal 40–125s le rahe hain (model ka round 20–35s + tools; R44 me yahi 1–3s the). Knob: `AI_AGENTIC_TURN_BUDGET_MS` / `AI_PRIMARY_MIN_MS` / model chain order — user bole to 20–30s me laa denge.
- **Model ne `HWR` likh diya** (Haridwar = `HW`) — model ki slip, hamare data me sahi. Candidate: reply ke station codes ko apne station-data se verify karne wala general net.

## §9.38 — Round-46 (28 Sep 2026): station-code verification net (model ke galat code band)

**Live case (R45 battery):** `12013 haridwar pahunch gayi kya` par model ne likha "…isme **Haridwar (HWR)** station nahi aata" — route sahi tha par **code galat**: IR me Haridwar = `HW`, aur `HWR` asli me **HATWAR** hai. User code hi IRCTC me type karta hai — isliye galat code = galat data (user ka standing rule: "kuch bhi fake mat rakho").

**Fix — general verification (per-question rule nahi, R43k wahi soch):**
- Naya data: `server/data/station-codes.ts` — **8989 IR stations** (code → naam), source **datameet/railways stations.json** (data.gov.in list). Regenerate: `node tools/build-station-codes.mjs` (source repo me: `tools/station-list-source.json`).
- Naya module `server/agent/stationCodes.ts`: `verifyStationCodes(reply)` reply ke **code+naam jodi** dhoondta hai — teen forms: `Naam (CODE)`, `CODE Naam`, `Naam — CODE`; naam ko normalize karta hai (jn/junction/cantt/city suffix hata; "new" jaisa shabd nahi hata — warna New Delhi = Delhi ho jaata).
- **Sirf tab badalta hai jab naam hamare data me ho aur uska code kuch aur ho** (jaise Haridwar→HW, jabki reply me HWR), warna reply ko haath nahi lagaya jaata. Code asli station ka ho aur naam se milta ho (New Delhi ↔ Delhi, Ambala ↔ UMB/UBC) → chhod diya jaata hai; naam hi hamare data me na ho (jaise "Someplace (ZZZZ)") → kuch nahi (andaza nahi).
- **Wiring:** `scrubInternalNotes()` ke aakhir me (wahi ek darwaza jahan se model ka reply jaata hai — leak nets bhi wahi lagte hain). Telemetry: `{stationCodeFix:{label,from,to,why}}` prod log me.
- **Tests:** `tests/round46-station-codes.test.ts` (7) — live case, dono forms, unknown-code case, **false-positive battery** (10 asli reply lines: sibling DDL/Dhandari Kalan, route line, seat/fare line, "Delay: … Next stop: …", source line — sab untouched), scrub integration, aur end-to-end (model ka reply `HWR` ke saath → user ko `HW` milta hai).

**Proof (prod `2f9c008`, live 3/3, 0 leak):** `12013 haridwar pahunch gayi kya` → "…Haridwar **HW** is route par nahi hai…" (§133s) · `12013 haridwar par rukti hai kya` → "Timetable mein Haridwar/**HW** ka koi stop nahi hai" (§49s) · seat case unchanged (`12054 (ASR → HW) — 28/29 Sep CC/2S…`, §57s). Full suite **125 files / 1366 tests pass** (`/tmp/r46-suite1.log`).

**Workspace note:** is round me workspace 11th baar reset hua (HEAD stale `1b8be9f`) — `recover.sh` se `2abdaf0` wapas, `npm ci`, aur R46 ke naye files (backup se) restore; koi kaam nahi gira.
