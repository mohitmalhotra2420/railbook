

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

## §9.39 — Round-47 (28 Sep 2026): chat ki UI padhne-layak (sections + chips + timetable) aur naya header

**User (screenshot, 28 Sep):** "first screenshot mein dekho etna lamba chat padhna kitna mushkil ho rha, thoda attractive banao so that readable ho, clean UI ho, response ko clear cards, larger text, spacing, status chip aur timetable sections mein divide kiya jaaye" + "header bhi wahan se payment ka sign hta do aur header bhi better banao naye buttons rakho yeh purane htado". Scope boundary saaf: **"baki AI, API, backend, architecture kuch mat touch Krna"**.

**Kya kiya (sirf `src/` — koi server/AI/API change nahi):**
- **Naya component `src/components/AnswerCard.tsx`** — prose jawab ko padhne-layak sections me:
  1. **status chips** — jo baat reply me sach me likhi hai wahi chip banti hai (delay/on-time/stale/cancelled/scheduled/date/WL/available). Kuch invent nahi; na ho to chip hi nahi.
  2. **headline** — pehla jumla bada (16.5px, weight 650).
  3. **timetable board** — arrival/departure waqt bade numbers me + station code/naam (do shakal: `Ludhiana Jn (LDH)` aur `Ludhiana Jn LDH par`).
  4. **body** — baaki jumle alag-alag, line-height 1.62, sections ke beech spacing; waqt/date/₹/seat-count highlight.
  5. **source footer** — `Source: …` chhota aur muted (pehle body ke andar chipka tha; ab paragraph ke aakhir me chipka ho to bhi alag ho jaata hai).
  - Model ke `**bold**` markers ab highlight ban jaate hain (literal asterisk user ko nahi dikhta).
  - `⚙️ Route/schedule dekha → Live position dekhi` jaisi tool-line ab **chips** me — prose ke andar nahi.
- **Wiring:** `ReplyText` ka fallback (jab seat rows na mile) aur Concierge ka AI-note path dono AnswerCard par. Seat-rows wala `ReplyText` path **waise hi** hai (data bilkul same).
- **Header:** ₹ (wallet/payment) button header se **hata diya** (wallet booking flow ke apne buttons — `onWallet` — se khulta rehta hai). Purane text-glyphs `✚ ▦ ☰` ki jagah naye **SVG icons** (`IconChat`, `IconBoard`, `IconGrid`, `IconTicket` gold accent) — 42px tap target, hover/active states, gradient topbar + build-tag chip. Booking ka safar ab **dots + ticks** stepper me (✓ Journey · **Train** · 3 Passengers · 4 Payment) — labels wahi 4.
- **Readability polish:** user bubble 15px, thread padding, `msg-kicker` refine, assistant text sections me.

**Tests:** `tests/round47-chat-ui.test.tsx` (8) — chips sirf text se, timetable/station (dono shakal), screenshot ka asli jawab (headline + board + chips + source + **koi lafz chhupta nahi**, jumla-wise check), inline-source footer, tool-line chips, ReplyText integration, header glyph/₹ assertions, stepper+CSS. 3 purane UI tests (R20/R22/R29) **R47 semantics** me update: pehle "prose paragraph hi rehta hai" assert karte the — ab AnswerCard sections + whitespace-insensitive "poora text maujood" check. Full suite **126 files / 1374 tests pass** (`/tmp/r47-suite1.log`).

**Preview:** `tools/build-round47-preview.mts` asli React components se render + asli built CSS inline karta hai (preview aur app bilkul ek jaise) — `/home/user/RailBook/previews/RailBook-round47-2026-09-28.html` (95943 B), pehle (screenshot wala look) vs ab, side-by-side dono phone frames.

**Proof (prod `69992d5`, live):** deployed CSS/JS bundle me naye classes maujood (`ac-board`/`ac-chip`/`ai-step` — grep se verify). Build: `npx vite build` clean (83.55 kB CSS / 494 kB JS).

## §9.40 — Round-48 (29 Sep 2026): seat card me SAARI classes (parser fix)

**User (2 screenshots, 29 Sep):** "green wale portion mein sabhi classes mein available seats sahi bta rha lekin neeche card mein sabhi classes show nhi ho rhi" — green line (server ka asli data) me `12054 2S AVL 660 ₹150 · CC AVL 17 ₹480` likha tha, par usi train ka card "1 class" (sirf 2S) dikha raha tha; `15015` ki 4 classes me se 3; `12030` / `12204` / `12498` ke cards hi nahi ban rahe the.

**Root cause (UI parser — `src/components/ReplyText.tsx`):** server ki compact seat line me **train ka naam nahi hota** (`12054 2S AVL 660 ₹150 · CC AVL 17 ₹480`). Purana `ROW_RE` naam maangta tha, isliye:
- `2S AVL 660 ₹150` ko **naam** maan leta tha aur agla class chip (`CC`) hi asli row ban jaata tha → pehli class gayab, aur baaki classes `rest` (plain text) me chali jaati thin;
- pehla segment ("💺 sab class me seat wali 19 trains — 12054 …") lead-in hone ki wajah se `rowOf` hi fail karta tha → us train ka card banta hi nahi tha;
- fare me trailing comma aa jaata tha (`₹510,`).

**Fix (sirf UI, AI/API/backend untouched):**
- `ROW_COMPACT_RE` + `COMPACT_HEAD_RE`: number ke turant baad class code ho to **compact row** (naam khaali) — jaisa text me hai waisa hi.
- Train ke naam me ab **ank nahi** aate (`[^…\d]{2,60}`) — "2S AVL 660 ₹150" kabhi naam nahi ban sakta.
- Lead-in `… — 12054 …` / `… : 12054 …` head chip me alag (aur lead-in khud row na ho — negative lookahead).
- Fare regex `₹\s?\d(?:[\d,]*\d)?` — trailing comma band (teenon regexes me).
- `groupReplyRowsByTrain`: same train+class+status+count+fare do jagah likha ho (AI ki per-train lines **aur** neeche ki compact line dono me — 29 Sep ka live case) to card me **ek hi baar**, aur jo info kisi ek me thi wo bachi rehti hai (`dep` fill; input rows mutate nahi hoti).

**Proof (aapke exact text par + live):** `parseReply(SCREENSHOT_LINE)` → 12 cards, 26 class rows; `12054 → [2S AVAILABLE 660, CC AVAILABLE 17]`, `14680 → [2S, CC]`, `12014 → [CC, EC]`, `15015 → [3E, SL, 2A, 1A]`, `15708 → 4 classes`; lead-in head chip me; render me cards 12 aur `.rp-crow` 26. Live (prod text): `sab class me seat wali trains batao` → 19 cards / 54 rows, `12054` 2 classes, `15015` 4 classes; dono-sections wala case ab duplicate nahi (12054 = 2 rows).
**Suite:** 127 files / **1379 tests** pass (`/tmp/r48-suite2.log`); naye `tests/round48-seat-card-all-classes.test.tsx` (5) + purane R20/R22/R25/R26/R27/R29 wire formats waise hi pass.
**Live:** code `60c7401` + `e501ddc` → deploy `dep-datd2pdg1s2s738tlm9g`, `/api/version` = `e501ddc`, bundle me naya parser confirm.
**Preview:** `RailBook-round48-2026-09-29.html` (pehle vs ab phones + train-wise before/after table).

## §9.41 — Round-49 (29 Sep 2026): board me sirf wahi trains jo maangi hui station TAK JAATI HAIN

**User (3 screenshots, 29 Sep):** `Mujhe ludhiana se SVDK jaana hai kal confirm seat findout krke do` — chat me `12265 JAT DURONTO EXP` aur `13151 KOAA JAT EXPRES` bhi seat rows ke saath aa gayi, jabki dono **Jammu Tawi (JAT) par khatam** hoti hain, SVDK (Katra) tak jaati hi nahi. User: *"maine to svdk tak maangi hai confirm seat wo fir jammu ki kyu dikha rha beech mein"*.

**Root cause:** ConfirmTkt ka route-board `to` ke "paas ka bada station" wali trains bhi deta hai (Katra ke liye JAT) — provider data me gadbad nahi, par user ke liye wo **unbookable** hai: na seat us segment ki hoti hai, na train wahan jaati hai.

**Fix (general — wahi tool-level verification usool, per-question rule nahi):**
- Naya module `server/agent/routeSegment.ts`: board ke har train ka route **provider timetable** (`routedSchedule`, 6h cache, 6 parallel) se dekha jaata hai; jo train `to` tak nahi jaati (ya `from` par rukti hi nahi / order ulta hai) wo list se **hat jati hai**. **Route pata na chale to train rakhi jaati hai** (andaza nahi — sirf verified-negative hataate hain). Telemetry: `{routeDrop:{from,to,dropped:["12265(JAT)", …]}}`.
- **Saaf note** (`routeDropNote`): *"ℹ️ 12425 JAMMU RAJDHANI (last stop JAT), … 12265 JAT DURONTO EXP (last stop JAT) — ye SVDK tak nahi jaati, isliye list se hata di."* — reply line me, `FIND_SEATS` output me (taaki AI bhi wahi sach bole), aur client card me (`dropNote` → `seatFilter` serializer → `api.ts` types → `SeatListBlock` me amber note strip).
- Lagaya teen jagah: `seatFilterFor` (chat line + card rows), `seatFinderTool` (FIND_SEATS pool — AI un trains ki rows likh hi nahi sakta), aur `/api/availability` route-board (wahi bug class UI board me).

**Proof (prod `6531728`, live):** `Mujhe ludhiana se SVDK jaana hai kal confirm seat findout krke do` → `LDH → SVDK` par sirf **20433 JAMMU MAIL** aur **11449 JBP SVDK EXP** (dono sach me SVDK jaati hain) + note me 13 hati trains (`12425, 14661, 12413, 12265, 13151, 11077, 12207, 18309, 12355, 12237, 22431, 15651, 12549`). Control: `LDH → JAT` maangne par `12265 / 13151 / 12237` **waise hi list me** rehti hain (koi false drop nahi). Live spot-check: `12919 Malwa` SVDK=true (rakhi), `15651 → last JAT` / `12549 → last MCTM` (hati).
**Suite:** 128 files / **1386 tests** pass; naya `tests/round49-seat-segment-verify.test.ts` (7) — servesSegment (order/ulta/unknown), filter + note, resolver-fail par train rakhna, seatFilterFor, FIND_SEATS, JAT maangne par no-drop, aur client-payload wiring.
**Deploy:** `0ebce68` (main fix) + `6531728` (dropNote client tak) → deploy `dep-datk4anlot8c73fsu7hg`, `/api/version` = `6531728`.

## §9.42 — Round-50 (29 Sep 2026): "JAT tak wali trains ka alag section" + dikhaayi wali seat rows LIVE

**User (29 Sep, R49 ke jawab par):** *"Haan banado"* — JAT tak khatam hone wali trains ka **alag section** (IRCTC bhi `LDH → Katra` search me yahi trains dikhata hai). Saath me naya bug: *"12265 mein 2S seat availability IRCTC pe and confirmtkt pe bhi show ho rhi thi but mere app mein nahi"* (10:03 ka screenshot: `2S WL —` — number hi nahi, jabki IRCTC par us class ka apna status tha).

**Root cause (2 hisse):**
1. **Freshness:** ConfirmTkt board apni **purani cache** serve karta hai aur status non-empty hone par chain use "success" maan leti hai → wahi purana row app tak chala jaata hai (2S ka row `stale`/istedat bhi galat lagti thi). Aur CT ka `cacheTime` **IST me** likha hota hai (bina zone) → `Date.parse` usko UTC maan kar timestamp 5:30 ghante *future* me chala jaata tha (purani row "fresh" dikhti thi, UI ka "last updated" bhi aage chhapta tha).
2. **UI:** R49 ke baad JAT tak wali trains list se hat gayi thin — par unme seats thi, aur user unhe IRCTC par dekh bhi raha tha; unko chhupana bhi jhooth tha, unhe beech me dikhana bhi.

**Fix (general, per-question rule nahi):**
- `server/agent/routeSegment.ts` → naya `nearbyCandidatesNote(trains, dropped, from, to)`: hati hui trains jinme **seat-detih class** (AVAILABLE/RAC) hai, unka saaf alag section — *"🧭 JAT tak (aage ka safar khud): 12265 JAT DURONTO EXP (2A AVL 5 · 3A AVL 10) | 13151 KOAA JAT EXPRES (SL AVL 8) | 12237 BEGUMPURA EXP (1A AVL 1)"* + *"(Inme LDH→JAT tak ka ticket hota hai, SVDK ka nahi.)"*. Sirf WL wali train ka offer nahi (jhootha offer band). Wiring: `seatFilterFor` (`nearbyNote` + line), `seatFinderTool` (FIND_SEATS summary me `NEARBY:` line — AI bhi yahi sach likhta hai), `app.ts` serializer → `api.ts` → `orchestrate.ts` → `Concierge.tsx` (`.sf-note.near` blue note) → `styles.css`.
- `server/railway/router.ts` → naya export `enrichTrainsFreshness` (`enrichFocusTrains` wrapper): chat/card wale seat jawab me bhi wahi freshness pass jo `/api/availability` ke focus trains par chalta tha — dikhaayi jaane wali trains (seat wali pehle, phir WL; max 6) ke stale/UNKNOWN/future-dated rows ka live probe (18s budget). Live row na mile to purani row waise hi (kuch invent nahi).
- `secondOpinionRow()` (naya, wahi file): chain ka row fresh nahi (30 min se purana / `stale` / future-dated) ya seat nahi dikha raha, to **IRCTC-sourced RailYatri** se cross-check — seat wali + fresh row jeetti hai, warna jo zyada fresh ho; dono na ho to chain ka row waise hi. (Fresh + seat wali row par extra call nahi — latency bachti hai.)
- `server/railway/confirmtkt.ts` → naya `ctCacheTimeMs()`: `cacheTime` 3h+ future me ho to IST maan kar 5:30 ghata do — purani row ab `fresh` nahi lagti (probe hota hai) aur `updatedAt` sahi chhapta hai.

**Proof (live, 29 Sep ~10:50 IST):** `LDH → SVDK 2026-09-30` board 7 trains → main rows sirf **20433 / 11449** (SVDK tak), aur `🧭 JAT tak` section me **12265 (2A AVL 5 · 3A AVL 10) | 13151 (SL AVL 8) | 12237 (1A AVL 1)**; `dropNote` waise hi 13 hati trains. Control `LDH → JAT`: koi drop nahi (`dropNote null`), aur 12265 ki **2S row ab number ke saath** — `2S WL 1 ₹225` (pehle `WL —`), 3A `AVL 10`, 2A `AVL 5`, SL `WL 3`. Dono live sources ek hi baat keh rahe hain: ConfirmTkt API `2S = RLWL9/WL1 ₹225` (cacheTime 10:40) aur RailYatri/IRCTC `RLWL9/WL1 ₹225` (updated 10:46) — subah (09:13) IRCTC par 2S AVAILABLE ₹225 thi, yaani seat bhar gayi; ab app **live row** dikhata hai, purani cache par atakta nahi. Exact user sawaal par agent: 23.6s, deterministic + `nearbyNote`/`dropNote` dono client payload me.
**Suite:** 130 files / **1397 tests** pass; naye `tests/round50-seat-freshness-nearby.test.ts` (8) + `tests/round50-live-second-opinion.test.ts` (3); ek purana test (`route-board-live-enrich` ka "17 ghante purani SL row") naye vyavhaar ke hisaab se update — ab fresher row (RailYatri/IRCTC) jeetti hai.
**R50b (usi round me, prod live check par mila):** live row me count na ho (RailYatri ka `RLWL/AVAILABLE` jaisa status) to `AVL —` ke bajaye saaf **`AVL`** — `seatFilter` ki line + `fmtRow` + nearby section ka `classBit` + `ReplyText`. (Prod check me `20433 3E AVL — ₹565` dikh raha tha; ab `3E AVL ₹565`.)
**Deploy:** `0db7048` → deploy `dep-datkn6qd0e5s73cgmvgg`; `b604eaf` (R50b) → deploy `dep-datkpp7avr4c73dusd50` — `/api/version` = `b604eaf` MATCH.
**Prod verify (b604eaf):** (1) `Mujhe ludhiana se SVDK jaana hai kal confirm seat findout krke do` → 7.0s, rows sirf `20433`, `dropNote` + **`nearbyNote`** dono reply aur client payload me (`🧭 JAT tak … 12265 (2A AVL 5 · 3A AVL 10) | 13151 (SL AVL 8) | 12237 (1A AVL 1)`); (2) `LDH se JAT kal confirm seat batao` → 7.0s, **koi drop nahi** (`nearbyNote null`), 12265 `3A AVL 10 · 2A AVL 5`, 20433 `3E AVL ₹565` (dash gaya).
**Preview:** `RailBook-round50-2026-09-29.html` (pehle vs ab phones + 2S ka poora sach table).

## §9.43 — Round-51 (29 Sep 2026): user ki wording ("Yaar LDH se…") + confirm/available par SAARI classes

**User (29 Sep, build b604eaf ke do screenshots):**
1. `Yaar LDH se SVDK ke liye kal ke liye confirm seat find out karke do na` → app ne jawab diya *`"Yaar Ldh" ke liye exact station chahiye — station ka naam ya code bataiye.`* — jabki "Ldh" = LDH. User: *"purane build mein to AI meri wording ko samjh rha tha latest build mein kyu nhi"*.
2. *"12265 mein 2S available seat nahi show hui thi … sabhi class kyu nahi show hoti jabh bhi specifically confirm, available poocho"*.

**Root cause (1):** `legacy-stations.matchStation` poore phrase par exact/alias/city-word match karta tha; "Yaar Ldh" / "bhai ldh" / "kal ldh" jaise phrase se kuch match nahi hota tha → wahi phrase `unresolvedFrom` ban jaati thi → `routedStationSearch("Yaar Ldh")` kuch nahi deta → "exact station chahiye" sawaal (aur `atlasFallback`/rescue se wahi jawab user tak). Purane builds me model isse apne aap samajh jaata tha, par deterministic rescue path me ye gap tha.

**Fix (1) — general, tool-level (per-question rule nahi):** `stationWordInPhrase()` — poore-phrase wale saare purane checks ke **baad**, phrase ke andar ka saaf station word dhoondha jaata hai (alias/code list se, word-boundary Unicode-safe). Do shartein: (a) exactly **ek** station nikle (poora route likha ho — "ldh se svdk" — to yahan se kuch nahi; wo from/to parser ka kaam hai), (b) koi **cluster-city** (delhi/mumbai/kolkata…) hit na ho (unke liye clarification hi chahiye). Isse NLU ka from/to **aur** AI-extraction (`mapExtraction` bhi `matchStation` hi use karta hai) dono theek hote hain — jo bhi filler likho ("yaar", "bhai", "kal", "please"), station word phaans nahi jaata.

**Root cause (2):** "confirm/available" maangne par `seatSummaryLine` ka seat-branch sirf `pick.seat` (AVAILABLE/RAC rows) likhta tha — usi train ki baaki classes (jaise 12265 ki 2S/SL/1A) line me aati hi nahi thin (card rows+wlRows jodta hua tha, par text aur card match nahi karte the — R48 ka usool tuth raha tha).

**Fix (2):** ab jawab me jo train hai, uski **SAARI classes** usi line me aati hain — AVAILABLE/RAC pehle, phir usi train ki WL/N-A rows status ke saath (`12265 3A AVL 10 ₹860 · 2A AVL 5 ₹870 · 1A WL 1 ₹1,435 · SL WL 3 ₹355 · 2S WL 1 ₹225`). Sirf-WL trains list me **nahi** aati (R25 ka usool: available-only filter trains par lagta hai, train ke andar classes chhupane par nahi). AI path me bhi: `runFindSeatsTool` ab `OTHER CLASSES (inhi trains ki baaki classes — inhe bhi status ke saath likho, chhupao mat): …` line + instruction *"Har train ki line me uski SAARI classes likho"* bhejta hai. Sab data live board se — kuch banaya nahi jaata.

**Proof (local, AI on, aapka exact sawaal):** `Yaar LDH se SVDK ke liye kal ke liye confirm seat find out karke do na` → 21.1s, NLU `from=LDH, to=SVDK`, koi unresolved nahi, jawab: `* 20433 JAMMU MAIL — 1A AVL 1 ₹1,530 · 3E AVL 1 ₹625 — 01:47 departure` + `💺 … 20433 1A AVL 1 ₹1,530 · 3E AVL 1 ₹625 · 2A WL 1 ₹925 · 3A WL 1 ₹675 · SL N/A ₹270` + drop note + `🧭 JAT tak …`. Probe: `matchStation("Yaar Ldh")=LDH`, `"bhai ldh"=LDH`, `"kal ldh"=LDH`; control: `"delhi"`/`"mumbai"`/`"blorp xqz"` → undefined (clarification wahi).
**Suite:** 131 files / **1402 tests** pass; naya `tests/round51-station-filler-allclasses.test.ts` (5).
**Preview:** `RailBook-round51-2026-09-29.html` (pehle vs ab phones).

## §9.44 — Round-52 (29 Sep 2026): “har query AI ke paas — deterministic path chale hi na”

**User (29 Sep, bbb7c84 ke baad):** *“purane builds me model isse apne aap samajh jaata tha, to ab bhi purane build jaisa hi rakho ki model apne aap samjhe sab — AI first for everything and deterministic path chle hi na, deterministic path khtm krdo; bas AI pe hi har query jaaye aur wo decide kare kaun sa tool kaun sa API, jaise ChatGPT mein hota hai.”*

**Root cause (asli wajah — poore round ka nichod):** `server/agent/run.ts` me `isBookingMutation()` ka regex akela **`confirm`** shabd par bhi match kar leta tha (`/confirm(?:\s*karo|…)?/`). Isliye `"…kal ke liye confirm seat find out karke do na"` **booking hukm** maan liya jaata tha → `aiFirst = false` → poora AI-first flow **skip** → jawab deterministic engine deta tha. Isi liye 7 second me jawab aata tha aur model ne koi tool chalaya hi nahi — aur user ko lagta tha “AI meri baat samajh hi nahi raha”, jabki model ko mauka hi nahi mila tha. (Probe se pakka hua: `runAgenticTurn` kabhi call hua hi nahi; `agenticConfigured()=true`, `AI_OWNS_FLOW` unset.)

**Fix (1) — booking-hukm detector sahi kiya (`run.ts`):** mutation ab ASLI hukm hi hai — `book kar do`, `12919 book krdo`, `ticket book kar`, `booking karo`, `confirm & book`, `confirm karo/kar do`, `payment kar do`, `paise de do`, `haan book`. “confirm” **khud** sirf tab mutation hai jab sawaal me seat/availability context na ho (`CONFIRM_IMPERATIVE_TEXT && !SEAT_CONTEXT_TEXT`). Yaani: *“confirm seat”, “confirmed seat wali trains”, “2S confirm hai kya”, “seat availability confirm karo”* = **seat sawaal** (AI-first), *“haan confirm karo”* = booking hukm (deterministic booking flow waise hi).

**Fix (2) — model health ordering (`agentic.ts`):** `orderModelChain()/noteModelOutcome()/_clearModelHealth()` — jo model haal hi me (10 min) fail hua ho wo chain ke **aakhir** me chalta hai; healthy model pehle. Default chain fast-first: `ENV NVIDIA_MODEL=openai/gpt-oss-20b`, `NVIDIA_FALLBACK_MODEL=meta/muse-glimmer-30b` (Render env bhi update kiya). `AI_AGENTIC_TURN_BUDGET_MS=90000`, `AI_AGENTIC_TIMEOUT_MS=45000`. Muse bade agentic prompt par 30–70s leta hai — isliye wo ab default primary nahi (per-call timeout par turn fail hota tha aur deterministic rescue jawab de deta tha).

**Fix (3) — tools bhi user ki wording samajhte hain:** naya `server/agent/stationArg.ts` `resolveStationArg()` + `legacy-stations.matchStationStrict()` (sirf pakka match: code/naam/alias/filler-hatane-ke-baad-1-2-shabd/fuzzy, cluster-city → undefined) — `FIND_SEATS`, `SEARCH_TRAINS`, `JOURNEY_ANALYZE` ke station args isse resolve hote hain. NLU ka purana **loose** `matchStation()` (R51) waisa hi rakha (“Delhi Saturday ko 2 passengers ke liye sabse fast…” jaisa lamba tail tootta nahi), isliye R51 ka fix intact hai. `resolveStationRef()` (agentic) me bhi “2–5 akshar = code” check ab **asli code** (8,989 ka local dataset) par hi lagta hai — “delhi”/“katra” jaise city naam galti se code ban kar lookup fail nahi karte.

**Fix (4) — capability/meta sawaal bhi model ka:** `run.ts` ka capability gate `&& !aiFirst` (system-prompt rule 28 model ko honest capability batata hai). Fixed jawab sirf AI-off / key-gayab / model-fail par.

**Fix (5) — saari classes model ke jawab me:** `FIND_SEATS_DESCRIPTION` + prompt ka SEAT RULE: jawab me tool ke `summary` (rows **+** wlRows) ki SAARI entries likhni hain — “sirf AVAILABLE rows likhna adhoora hai”. Pehle model sirf AVAILABLE line likh deta tha (1 row) aur uske WL/baaki classes chhup jaati thin.

**Proof (local, AI on, aapke exact sawaal):** `Yaar LDH se SVDK ke liye kal ke liye confirm seat find out karke do na` → **`engine: agentic_tool_calling`**, model `openai/gpt-oss-20b`, `toolTrace: FIND_SEATS ✓` (24 s), jawab me 7 trains × saari classes live board se (`20433 1A AVL 1 ₹1,530 · 2A WL 1 ₹925 · 3A WL 1 ₹675 · 3E WL 1 ₹625 · SL N/A ₹270`, `11449 … SL WL 62 ₹240`, `12919 … SL WL 18 ₹270` …) + `[NEXT]` chip; doosra probe (rule tighten ke baad) 49 s, table format me wahi sab. Capability sawaal `tum kya kar sakte ho` bhi `agentic_tool_calling` (11.6 s, model ke shabdon me). Model ne khud station (LDH/SVDK), date (kal) aur tool choose kiya.

**Suite:** 132 files / **1410 tests** pass (pehle wale 7 fails: 5 model-default tests + capability source-assert + “delhi airport” station test — sab intentional update, dekho neeche), naya `tests/round52-ai-owns-everything.test.ts` (8): model-health ordering, `matchStationStrict`/`resolveStationArg` (filler ✓, “Delhi airport” ✗), `resolveStationArg`+`FIND_SEATS` integration, booking-hukm detector (asli hukm ✓ / seat sawaal ✗), aur app-level test ki “confirm seat” sawaal par **engine `agentic_tool_calling`** hi chalta hai.
**Preview:** `RailBook-round52-2026-09-29.html` (pehle vs ab phones + kya badla).

**R52b — model route-level seat sawaal par sahi tool chune (rule 32):** prod probe me dikha ki model route-level seat sawaal (`LDH se JAT kal confirm seat batao`) par `JOURNEY_ANALYZE` chun leta tha — wo tool **passengers** maangta hai, isliye turn wahin atak jaata tha (aur phir deterministic rescue jawab de deta). Rule 32 me ab saaf line hai: *route-level seat sawaal (do station ke beech, koi ek train+class fix nahi, pax bhi nahi bataya) → **FIND_SEATS** (pax optional); aise sawaal par JOURNEY_ANALYZE/RANK_JOURNEY_OPTIONS mat chalao.* Local probe (dono sawaal, rule ke baad): `LDH se JAT kal confirm seat batao` → 51.9s, `FIND_SEATS ✓`, 3 trains × saari classes; `Yaar LDH … SVDK` → 73.8s, `FIND_SEATS ✓`, 7 trains × saari classes + `[NEXT]` chip.

**R52c — prod (Render) se NVIDIA NIM par chat-call hang (`/api/ai-ping` evidence):** prod par model kabhi jawab deta hi nahi tha. Iska pakka saboot: `/api/ai-ping` (chhota "Reply with exactly: OK" request, 30–35s timeout) → `openai/gpt-oss-20b`, `meta/muse-glimmer-30b`, `nvidia/nemotron-3.5-lightning-30b-a3b`, `deepseek-ai/deepseek-v4.1-flash` **sab timeout**; jabki `GET /api/admin/nvidia` (wahi host, `/models`) **494ms** me chalta hai aur sandbox se wahi chat-call **1–2.5s** me jawab deta hai. Yaani NIM tak connection theek hai, par Render ke shared egress IP se `/chat/completions` queue me atak jaata hai (Nemotron-nano ne turant `503 Worker local total request limit reached (16/16)` diya). HF fallback bhi dead hai (`HF router: included credits depleted`). Isliye:
- **retry-queue** (`agentic.ts`): `modelQueue` dynamic — timeout par (aur ≥45s budget bacha ho, aur turn ke pehle round me) wahi model **ek baar dobara** try hota hai; http-error par nahi (wo access/key ka issue hota hai).
- **IPv4-first DNS** (`server/index.ts`: `dns.setDefaultResultOrder("ipv4first")`) — Render par IPv6 route hang ka shak.
- Render env: `AI_AGENTIC_TURN_BUDGET_MS=180000`, `AI_AGENTIC_TIMEOUT_MS=45000`, `AI_PRIMARY_MIN_MS=20000`, `HF_MODEL` khaali (dead provider chain se hata).
**Prod verify (5877a20):** `LDH se JAT kal confirm seat batao` → **agentic**, `FIND_SEATS ✓`, 184s (gpt-oss attempt timeout → muse ne jawab diya), jawab: `💺 sab class me seat wali 3 trains — 12265 3A AVL 10 ₹860 · 2A AVL 5 ₹870 · 1A WL 1 ₹1,435 · 2S WL 1 ₹225 · SL WL 3 ₹355 | 20433 1A AVL 1 ₹1,270 · 3A AVL 1 ₹565 · 2A WL 1 ₹770 · 3E WL 1 ₹565 · SL N/A ₹225 | 13151 2A AVL 1 ₹725 · 3A N/A ₹520 · 3E N/A ₹520 · SL N/A ₹195`; `tum kya kar sakte ho` → **agentic** 169s, model ke shabdon me poora capability jawab (train search/plan, live status, seat+fare, PNR, station board, rules, booking handoff). Yaani prod par bhi ab **jawab AI deta hai** — latency NIM ke queue ki wajah se 170–185s tak jaati hai (aapne 45s+ accept kiya hai; queue clear hone par wahi jawab 20–50s me aata hai, jaise local par).

## §9.45 — Round-53 (29 Sep 2026): text = cards (ek hi live data) · app me back button · naya provider sirf env se

**User ke 4 point:** (1) *“Green portion wali trains card mein nahi dikh rhi”* (screenshot: text “17 trains”, neeche cards me kuch aur/kam); (2) latency se zyada **quality** priority; (3) *“kon sa model best work karega mere railbook ke liye, uski key main baad mein dunga”*; (4) Android app: *“back buttons nahi hai”* + *“ek baar IRCTC pe autofill hogya to reopen pe bhi RailBook directly IRCTC se open hoti hai, not from starting”*.

**Root cause (cards ka gap):** jawab ka **text** model ke `FIND_SEATS` result se banta tha, par **cards** (`app.ts`) ke liye `seatFilterFor()` **dobara** board fetch karta tha — do alag snapshots (aur `maxRows` ka 12-train cap). Isliye text me saari trains/classes, cards me kuch aur. Yahi “green portion wali trains card me nahi” ka asli karan tha.

**Fix (1) — ek hi data:** `agentic.ts` me `SearchCapture.seat` add — `FIND_SEATS` ke result ka poora capture (**rows, wlRows, from/to/date, source, dropNote, nearbyNote, trainsSeen, onlyAvailable, classCodes**). `run.ts` `AgentResponse.seatCapture` return karta hai; `app.ts` me capture maujood ho (aur date valid ho) to **`seatFilterFor()` skip** — cards seedha usi capture se bante hain. Yaani text aur cards ab kabhi alag ho hi nahi sakte.

**Fix (2) — card payload ka apna cap:** naya `SEAT_PAYLOAD_MAX_TRAINS = 60` (pehle 12). Text line ka `SEAT_LINE_MAX = 12` waisa hi hai — par line ke tail me honest pointer: `+N trains aur bhi hain — neeche poori live list me` (R25 ka rule bani rahi hai: “card” shabd par trains chhupane ka bahana nahi banta). `app.ts` me `seatCardPointer` — jab model ke jawab me rows na hon, tab bhi 1 honest line (`➕ N trains ke rows neeche cards me hain (live board se) — jaise 12265, 20433, 13151, 11058 …`), 15-line wall nahi.

**Fix (3) — “confirm bola to confirm dikhao”:** `app.ts` me `seatOnlyAvailable` hone par payload ke `wlRows` **sirf unhi trains ke** rakhe jaate hain jinme seat mili hai (usi train ki baaki classes chhupti nahi — Round-51 usool intact). Colors/status real: WL rows live board ke.

**Fix (4) — naya provider sirf ENV se (aapki key ke liye):** `server/env.ts` me `AI_LLM_BASE_URL` + `AI_LLM_API_KEY` + `AI_LLM_MODELS` (comma chain) — set hote hi **poora AI stack** (agentic brain, NLU/extraction, journey decisions) usi OpenAI-compatible endpoint par chala jaata hai; `nvidiaBaseUrl/nvidiaApiKey/nvidiaModel/nvidiaFallbackModel` overrides; `hfFallback` chain se hat jaata hai. Aadha config (key ke bina) = kuch nahi hota → purana NVIDIA path bilkul safe. Recommendation doc: `docs/MODEL-RECOMMENDATION.md` (Groq free `openai/gpt-oss-120b` primary; quality-first OpenRouter chain `claude-sonnet-4.6` → `z-ai/glm-5` → `gpt-oss-120b`; Cerebras `zai-glm-4.7` tez fallback; Sarvam Hinglish layer; **Groq par `llama-3.3-70b-versatile` 16 Aug 2026 se retired**). Sabak: NIM prod par queue-stuck (30–60s) — wahi model Groq par 1–2s; chain me do alag provider rakho.

**Fix (5) — Android app (v1.5.0, APK bana):** nav bar (Bar visible, 48dp) — **‹ Back · ⌂ RailBook home · ⟳ Reload** + right me label (RailBook / IRCTC). `goBackSmart()`: IRCTC par ho → history saaf karke **RailBook home**; RailBook ke andar → WebView `goBack()`; home par → “dobara dabao to exit” (2.2s)। `onResume()`: app background se wapas aayi aur page IRCTC par hai (ya Android ne restore kiya) → wapas **RailBook home** (chat web app ke localStorage se wahin mil jaati hai); `openRailbook()` ke 4s andar history clear (IRCTC ki purani entry peeche na rah jaye). Prewarm ke dauraan (IRCTC jaan-boojh kar khul raha ho) chhedte nahi. APK v1.5.0: `versionCode 33`, `versionName 1.5.0-nav-quality` · `RailBook-v1.5.0-release.apk` (4,823,319 B, SHA256 `55fe7412ad993c6f4cbd0eaf619bb0d3803a57eae3dd44082443abb838954265`) + `RailBook-Android-v1.5.0-Source.zip` (117,232 B) — `/home/user/RailBook/APKs/`.

**Proof (local, aapke sawaal):** `LDH se JAT kal confirm seat batao` → `engine: agentic_tool_calling`, `openai/gpt-oss-20b`, `FIND_SEATS ✓`, **22.2s** · board me **20 trains**, seat-wali 4 (`12265, 12445, 12237, 20433`) · payload **10 seat rows + 9 WL rows** · **text ke trains = card ke trains (dono 12265,12445,12237,20433)** · reply me 4-train table (saari classes) + “*All trains listed above have at least one confirmed seat (AVL)*” + `[NEXT] Book 12265 · 3A (AVL 10 ₹860)`. Cards usi payload se render (preview me asli payload se dikhaya).

**Tests:** naye `tests/round53-text-cards-and-provider.test.ts` (6: 16-train board par payload me saari trains; FIND_SEATS → capture.seat; app-level “confirm” par cards me sirf seat-wali trains; honest tail; AI_LLM_* override on/off) + `tests/round53-app-nav-and-irctc-return.test.ts` (5 source-guards: nav bar ids, `goBackSmart`, `onResume` IRCTC-return, `updateWhereLabel`, version 1.5.0/33). Full suite **134 files / 1421 tests PASS**.

**Preview:** `RailBook-round53-2026-09-29.html` (pehle vs ab phones, Android nav bar mock, provider table).

**R53b/R53c — cards ka train-set ab THEEK se text se match karta hai (prod probe se pakda gaya):**
- **R53b:** prod (0bd2aee) probe me dikha ki model `FIND_SEATS` ko `only_available` **bhejta hi nahi** (user ne “confirm seat” maanga tha, par tool args me true nahi gaya) — isliye cards me poore board ke 12 trains (52 WL rows) aa gaye, jabki jawab me 4 trains. Fix: capture branch me `seatOnlyAvailable = cap.onlyAvailable || slots.confirmedOnly` (saaf “confirm/confirmed” wording; “seat availability batao” jaisa sawaal available-only nahi hai, wahan saari trains — WL bhi — chahiye).
- **R53c:** ulta mismatch bhi mila — `“saari trains ki seat availability batao”` par model 12 trains likhta hai (WL wali bhi) par cards me sirf 4 (seat-wali) reh gayi thin. Fix (general): **cards ke trains = jawab me likhi 5-digit trains ∩ payload ke trains**; jawab me koi train number na ho (capability/PNR jaise sawaal) to poora payload waisa hi (kuch chhupta nahi). Class-level detail (usi train ki baaki classes) payload se hi.
- **R53c (formatting):** usi probe me model ne pivot-jaise table banaya jisme `2A WL, 2A WL (2) … (9)` repeat ho gaya. `FIND_SEATS` summary me saaf instruction: *har train ek line, table/pivot mat banao, ek hi class/status ek hi baar* — probe me ab saaf per-train lines.

**Prod verify (c259803):** `LDH se JAT kal confirm seat batao` → **agentic**, `FIND_SEATS ✓`, **34s**, payload trains `11077, 12237, 15651` = jawab ke trains (**MATCH**); `LDH se JAT kal saari trains ki seat availability batao` → **agentic**, `FIND_SEATS ✓` (2 calls), **19s**, payload `11077, 12207, 12237, 12355, 12475, 12919, 15651, 18309, 22431` = jawab ke trains (**MATCH**). Suite: **134 files / 1423 tests PASS** (`round53-text-cards-and-provider` ab 8 tests).

**Final chain (R53/R54):** `d4dda38` → `f893a2c` → `6660596` → `84494a1` → `0bd2aee` → `50b23b6` → `c259803` → `6adfcf4` → `2d745a6` → `161cf03` → `938fc51` → `b5e3a40` → `2109cf4` → `1cdc071` → `6cd72e9` → `d32ed39` → **`f43f63f`** — prod LIVE (`/api/version` MATCH).

**R53e — cards kabhi chhote nahi, kabhi bade nahi (pointer bhi sach):**
- **Cards ab tool ka POORA snapshot dikhate hain** (R53c ka "jawab me likhi trains" wala filter hata diya). Kyun: us filter se ek naya jhooth bana — jawab ke saath jo pointer line judti thi (`➕ 8 trains ke rows neeche cards me hain …`) un trains ke naam batati thi jo cards me aati hi nahi thin. Ab text me kam trains ho to card me poori class-detail rehti hai + pointer line sach bolti hai.
- **Fabricated-train guard segment-level** (line-level nahi): `·`/`|` se judi line me sirf wahi hissa hatta hai jisme aisa 5-digit number ho jo kisi tool ke data me nahi; baaki jawab (aur model ki wording) bacha rehta hai.
- **Do FIND_SEATS calls wale turn:** khaali result pehle wale kaam ka capture overwrite nahi karta (warna cards ka data hi khatam — prod probe me payload 0, jawab me 2 trains).
- **Jab KISI train me confirmed seat hi na ho:** tool WL rows poora deta hai (warna model ke paas honest jawab ka data nahi hota aur grounding check jawab reject kar deta), aur cards bhi WL trains dikhate hain — text+cards dono: *"is waqt koi confirmed seat nahi hai… ye trains WL me hain"*.
- **Test:** `round53-text-cards-and-provider` ab **12 tests**.

**R53f — user "confirm" bole to tool me `only_available` force:** prod probe me model ne `only_available: false` bhej diya (user "confirm" maang raha tha) → tool ne WL trains ka poora data diya, model ne 9 trains likh di, par cards (confirm ke hisaab se) sirf 3 seat-wali trains dikhate the. Fix (`agentic.ts` FIND_SEATS case): user ki wording confirmedOnly ho to flag force — model ke paas WL-only trains likhne ko hoti hi nahi.
**Prod verify (f43f63f):** `LDH se JAT kal confirm seat batao` → payload 5 = jawab 5 (**MATCH**, 21s); `Yaar LDH se SVDK … confirm seat find out karke do na` → payload 3 = jawab 3 (**MATCH**, 11s). Suite **134 files / 1427 tests PASS**.

**Final chain (R53/R54):** `d4dda38` → `f893a2c` → `6660596` → `84494a1` → `0bd2aee` → `50b23b6` → `c259803` → `6adfcf4` → `2d745a6` → `161cf03` → `938fc51` → `b5e3a40` → `2109cf4` → `1cdc071` → `6cd72e9` → `d32ed39` → `f43f63f` → **`6f5b94e`** — prod LIVE (`/api/version` MATCH).

## §9.46 — Round-54 (29 Sep 2026): "ChatGPT sahi tool kaise chunta hai?" — aur uske liye humne kya kiya

**User ka sawaal:** *"ChatGPT ke developer ne sab tools pehle se nahi likhe honge, phir bhi wo har sawaal par sahi tool kaise chun leta hai? Humara AI bhi waisa hi kare."*

**Jawab ka nichod (poora doc: `docs/TOOL-ROUTING-EXPLAINER.md`)** — 5 pillars: (1) tool ka **description** instruction hota hai ("jab X poochhe to pehle ye"), (2) **policy layer** = thode general rules (30/31/32/33/34), (3) model ki **general reasoning** (intent padhna pretraining se), (4) **feedback loops** — grounded check, adequacy net, tool-fail par agla tool, ambiguity par ek saaf sawaal, (5) **eval batteries** — har release par alag-alag sawaalon ki routing jaanch, aur failure ka ilaaj rule/description me (us sawaal par patch nahi).

**R54 me humne kya add kiya:**
- **Tool-recovery HINT (`agentic.ts`)**: jab koi tool fail hota hai, us ke result ke saath model ko **usi kaam ke agle tools ki list** chali jaati hai (`TRACK_TRAIN` ✗ → `GET_STATION_BOARD, GET_TIMETABLE, WEB_SEARCH` try karo; `CHECK_PNR` ✗ → `WEB_SEARCH`; `FIND_SEATS` ✗ → `CHECK_AVAILABILITY, SEARCH_TRAINS`). Model ko rule yaad rakhne ki zaroorat nahi — hint data ke saath aata hai (ChatGPT ke loop wala hissa). Test: `round53-text-cards-and-provider` (13 tests).
- **Eval battery repo me permanent**: `tools/round54-routing-battery.mts` — 12 alag-alag sawaal (live status, route, seat, train+class seat, fare, PNR, cancellation, station board, rules, GK, coach position, route+timing) aur har ek ka sahi tool family; report PASS / KB / FAIL. Aaj ka result: **10/12 model ne khud sahi tool chuna**, 2 (rules aur GK) **curated KB** se 0 second me verified jawab (R40b design — model ki memory se galat number aa sakta hai, jaise R40 me 4,273 km).
- **Aage ka tarika (provider/key aane par):** battery har release par; FAIL ka ilaaj tool description/policy me — per-question patch kabhi nahi.

### §9.46b — Round-54b (29 Sep 2026): zero-tool self-repair + prod routing battery

**User ka sawaal (dobara):** *"ChatGPT har sawaal par sahi tool kaise chun leta hai? Humara AI bhi waisa hi perfectly kare."* Jawab ke 5 pillars `docs/TOOL-ROUTING-EXPLAINER.md` me hain (tool ka description = instruction · policy rules · model ki general reasoning · **feedback loops** · eval battery). Is round me do cheezein ZAMEEN par utaari gayin:
1. **Tool-recovery HINT (R54):** tool fail hone par model ko usi kaam ke agle tools ki list di jaati hai (`CHECK_PNR ✗ → WEB_SEARCH try karo`, `TRACK_TRAIN ✗ → GET_STATION_BOARD/GET_TIMETABLE`, `FIND_SEATS ✗ → CHECK_AVAILABILITY/SEARCH_TRAINS`) — prod battery me live dikha: `CHECK_PNR✗ → WEB_SEARCH` aur `GET_COACH_POSITION✗ → GET_TRAIN_INFO`.
2. **Zero-tool self-repair (R54b):** LIVE sawaal par model bina tool jawab de (data jaise numbers ya "access nahi hai") → server ek corrective round bhejta hai aur model sahi tool chala kar usi data se jawab deta hai. Legit clarification (station/passenger/date) exempt. Test: `tests/round54-self-repair.test.ts` (2).
3. **Eval battery permanent + prod mode:** `tools/round54-routing-battery.mts` (12 sawaal; `--prod` se live server par). **Prod result (5df4cd4): 10/12 PASS + 2 KB-path (curated KB, 0s)** — local wahi natija.

## §9.47 — Round-55 (29 Sep 2026): "in me se best train batao" samajhna + list ka turn-to-turn sthir rehna

**User ke 2 screenshots (29 Sep):** (1) "ASR se LDH 3A me seat batao" par pehli baar list me SACHKHAND 12716 dikhi, agli baar gayab — jaise list badal gayi; (2) phir "esmein se best train batao" bola to AI ne poori list dobara dump kar di. User: *"ChatGPT ka dekho usne samjh liya… waisa hi perfectly samjhe."* Teen asli wajahein milin:

1. **Model ka chupke lagaya time-window (sabse bada karan):** user ne waqt bola hi nahi tha, par model ne FIND_SEATS ko `depart_after: subah / 04:00–12:00` bhej diya → us window ke bahar wali trains (jaise Sachkhand) list se gayab. **Fix (general):** `seatPick.ts` → `askedTimeWindow()` (subah/savere/dopahar/shaam/raat/8 baje/12:30/am-pm/morning…). User ke shabdon me waqt na ho to `dropUnaskedWindow()` model ke args se window hata deta hai — data chhupane ka koi bahana nahi. Aur jab hataaya jaata hai, tool ke result me model ko saaf note milta hai ("server ne tumhara window hata diya — POORE din ka board hai, jawab me window ka zikr mat karo") + rule 36, warna model apne (na-lagi) window ko jawab me likh deta tha.
2. **History truncation:** assistant ke pichhle jawab 700 chars par kat jaate the — list ke trains follow-up ke context se hi gayab ho jaate the. Ab assistant history 1500 chars (user 700) — list poori context me rehti hai.
3. **"in me se best" ka koi handling nahi tha:** ab `seatPick.ts` → `isPickFollowup()` (≥2 candidates + best/behtar/sabse acchi/recommend… ya follow-up shabd + train/wala), `previousListTrains()` (pichhle assistant jawab se max 12 train numbers), aur `pickBestTurn()` (run.ts) jo **wahi candidates** `FIND_SEATS(train_numbers=…)` se live re-check karke jawab me **EK best + "Kyun:" + "Runner-up:"** likhta hai (poori list dobara nahi). Sorting: AVAILABLE → seats desc → departure → RAC → WL. Adequacy gate `answerKind45 → "pick"` (1–3 numbers + best-word) + rescue order pick → single-train → general.

**Test:** `tests/round55-pick-and-window.test.ts` (8) — pure units + asli `executeApprovedTool("FIND_SEATS")` par: window drop hone par 19:45 wali train bhi aati hai (Sachkhand wapas), window maange jaane par filter lagta hai, pick turn me sirf pichhli list ke candidates check hote hain.

4. **Chhoti par asli rukawat (routing battery ne pakdi):** pick follow-up me 12 candidates ka comma-string 71 chars ka hota tha, par tool schema `train_numbers` ko 60 chars tak hi leta tha → model ka pehla call schema-fail. Ab limit 200 (20 trains). Aur ek purani gap bhi band hui: *"12094 me 3A me kitni seat khali hai kal"* (train number diya, station nahi) par tool pehle hi "kahan se, kahan tak" pooch leta tha — ab `FIND_SEATS` ka from/to optional hai aur **server khud us train ka POORA route timetable se** le leta hai (origin → destination), summary me saaf likh kar ki ye route timetable se liya gaya (user ne nahi bataya). Do chhoti robustness cheezein bhi: model `from: ""` bheje to bhi chalta hai, `sort_by` me ulta-seedha shabd (jaise "availability") poore call ko fail nahi karta (ignore ho jaata hai), aur agar model train number args me bhejna bhool jaaye par user ke sawaal me number ho → server sawaal se hi number utha leta hai.

5. **Soft-field safety net (R55f — is round ki sabse aam galti ka ilaaj):** live probes me baar-baar dekha ki model ka **poora tool call sirf ek soft field** ki wajah se marta tha (`passengers: 0` → "≥1 chahiye", `sort_by: "availability"` → enum galat, lamba `train_numbers`). Ab `executeApprovedTool` me zod ke bataye galat fields **hata kar dobara parse** hota hai — baaki call chalti hai (server default/auto behaviour lagata hai) aur model ko summary me saaf note milta hai ki kaun sa field gira (taaki wo uske liye alag se user ko na sataye). Sirf tab fail hota hai jab hataane ke baad bhi call valid na ho (jaise `date: "kal"`). Test: `tests/round55-pick-and-window.test.ts` §(f).

6. **Model fail/timeout par bhi pick (R55g):** prod probe me primary model timeout (45s) → fallback 500 → deterministic path ne poori list dump kar di (asal screenshot wali galti dobara). Ab model fail wale branch me bhi sawaal "pick" hai to pehle `pickBestTurn` chalta hai (chhota "Best + Kyun + Runner-up" jawab), tab hi list-wala path. Test §(g).

**Live probe (2 turn, asli providers):** turn1 "ASR se LDH kal 3A me seat batao" → 12 trains (12716 SACHKHAND sameth, koi jhoothi window nahi); turn2 "esmein se best train batao" → *"Best: 18104 ASR TATA EXP – 3A AVAILABLE 69 seats ₹520 … Kyun: sabse zyada confirmed seats aur sasta fare. Runner-up: 12926 PASCHIM EXP – 3A AVAILABLE 64 seats ₹565"* — koi dump nahi, wahi list.

## §9.48 — Round-56 (29 Sep 2026): "ChatGPT samajh gaya, mera AI kyu nahi?" — context, not rules

**User ka sawaal (2 screenshots + ChatGPT ka jawab):** *"ChatGPT ke developer ne har baar naya rule thodi likha… tum kitne rule likhoge? ChatGPT ne samajh liya, mera AI kyu nahi?"* Ye bilkul sahi sawaal hai, aur jawab architecture me hai — niyamon me nahi.

**Asli wajah (code me mili, guess nahi):**
1. **Context katta tha.** Pichhla assistant jawab model ko 1500 characters tak hi jaata tha (pehle 700). 12-trains wali list 900–1200 chars ki hoti hai — yaani model ne apni hi pichhli list poori **kabhi dekhi hi nahi**. ChatGPT ke paas poora thread hota hai; isliye "in me se best" uske liye aasan hai. Yahan wo andha tha.
2. **Har turn naya board.** Follow-up par bhi app naya live board maangta tha — user ke apne screenshots me list 5 trains → 14 trains badal gayi, Sachkhand (12715) doosri baar aaya pehli baar nahi. ChatGPT ne kuch fetch hi nahi kiya: sawaal usi list ka tha.
3. **Phir ek chhota free model**, jo adhoori list + "naya data laao" wale mahaul me reasoning nahi kar paaya.

**Fix (structural, ek hi usool — per-question rule nahi):**
- Assistant history 4000 chars (poori list), user 1500.
- Pichhli list hone par ek system block: **PICHHLA JAWAB (user abhi yahi screen par dekh raha hai — trains: …)** + wahi text poora + usool: *list-reference sawaal → usi list se jawab, naya board nahi, poori list dobara nahi; fresh board sirf naya route/date/train/class ya "abhi/live" par.*
- Rule 35 ko phrase-list se hata kar usool bana diya (in me se/2nd wala/usme se/jo bheja tha … "best" tak seemit nahi).
- Deterministic `pickBestTurn` ab sirf **rescue** hai (model fail/khokhla jawab) — jaisa R45 ka usool hai.

**Test:** `tests/round56-conversation-memory.test.ts` (3) — outgoing model request capture kar ke naapta hai: poori 12-trains list (pehla aur aakhri number dono) model ke paas gayi, "PICHHLA JAWAB" block + usool gaya, aur control (list hi na ho to block nahi).

**Bonus (R56b):** pick ka adequacy gate pehle sirf `best`-jaise shabdon par chhota jawab sweekar karta tha — "inme se 2nd wala kaunsi hai" jaise chunav par model ka sahi jawab bhi replace ho jaata tha. Ab gate usool par hai: chunav ka lafz ho to ranked chhota jawab (≤6 trains) theek, lafz na ho to data wala 1–3 trains; poora board dump khokhla. Live: *"Inme se 2nd wali train **12926 PASCHIM EXPRESS** hai. ASR → LDH, 30 Sep 2026, 3A · AVAILABLE 61 seats · ₹565"*.

## §9.49 — Round 57 (29 Sep 2026): jawab ka apna layout (table/bullet) + seat board se Connecting/Alternative page + leg-wise Book

**User (Chrome screenshot: Google ka "shikanji vs jaljeera" table jawab):** *"Ek to na yeh layout ui sahi kro connecting trains ka and secondly automatically ui table form mein yan bullet form mein aaye and secondly available mein connecting ka option jo next page pe open ho and alternate trains ka options bhi dikhe and connecting trains mein na user ko booking ka option and alternate mein bhi and na zip nhi load ho rha workplace mein dubara do."* Scope: **UI-only** (data/AI/API ko chhua nahi).

**Kya bana:**

1. **Chat jawab auto table (ya bullet) — jaise ChatGPT/Google deta hai.** `ReplyText` me naya `SeatCompareTable`: jab jawab me **2+ trains ki seat rows** hain to wahi rows (jo pehle hi text se parse hoti thi — kuch naya nahi banaya) table me: **Train · Class · Status · Fare · Dep**. Upar chhota **Table / Cards** toggle (default table). Row tap → usi train/class ka passenger form (`onBook(r, groupOf(r))`), footer hint "*row par tap = passenger form*". Bina-rows wale jawab bilkul pehle jaise.
2. **Prose jawab bullets me.** `AnswerCard` me `rest` sentences ab heading + bullet list (`ac-bullets`), aur "Label: text" wale jumle me label **bold** — lamba deewar-jaisa paragraph nahi.
3. **Seat board se next page.** `SeatListBlock` ke neeche do naye button: **Connecting trains · Leg 1 → Leg 2** aur **Alternative trains & dates** → `onOpenPage(page, from, to, date)`. Concierge `openPlanPage()` wahi route/date ka poora plan maangta hai (*"<from> se <to> <date> ka poora plan banao — connecting trains aur leg-wise seat bhi dikhao (<pax> passenger ke liye)"*), aur plan block **usi page** par khulta hai (`pendingPlanPageRef` + `consumePlanPage()` one-shot → JourneyOptions `initialPage`). Page ka data server ke asli plan se hi aata hai.
4. **Connecting aur Alternative dono me booking.** `JourneyOptions` me `bookableOf(leg)` + `bookLeg()`: har connecting leg par **`Book Leg N · <class>`** (AVAILABLE/RAC = green, WL/N-A = amber) aur leg ke class chips par bhi **Book**; alternative/leg lists me bhi. Bina verified class (availability.classCode) koi button nahi — jhootha booking nahi. Tap par `onBookLeg` → `onBookClass` (ticket segment `ticketFrom/ticketUpto`, availability row, date) → wahi passenger form jo chips se khulta hai.
5. **Layout saaf.** Leg cards ka spacing/hierarchy, leg number badge, boarding/deboarding + date per leg, layover line ("Change @ UMB · layover 33m"), Book button alag row me (`.jx-lrow-book` full-width).

**Bug fix (same round, testing me mila):** leg card `<button>` ke andar class-chip/Book ke `<button>` the — HTML me nested button invalid hai (browser hoist kar deta hai). Leg card ab `div role="button"` + `tabIndex` + Enter/Space handling → andar ke Book taps sahi jagah jaate hain (vitest me validateDOMNesting warning pehle aa rahi thi, ab nahi).

**Test:** `tests/round57-chat-table-and-connect-book.test.tsx` (9) — table default (2+ rows) + toggle + row tap → 12926 booking callback, control (1 row = no table), bullets + bold label, seat board ke dono next-page callbacks (aur callback na ho to button nahi), connecting ke dono legs par Book + click ka payload (15098/LDH/3A/2026-09-30), aur availability ke bina Book nahi. Full suite **138 files / 1459 tests PASS**; `tsc -p tsconfig.server.json` clean.

**Deploy:** `c2573f2` → prod `/api/version` MATCH (startedAt 2026-09-29T16:30:14.944Z). Preview (real data: ASR→LDH live board + LDH→JAT poora plan): `previews/RailBook-round57-2026-09-29.html`.

## §9.50 — Round 58 (29 Sep 2026): "results page blank" — ek undefined naam poora app gira deta tha (+ zip halka)

**User (screenshots 22:28/22:29):** *"Yeh pehle ese search krta hai fir results page blank aa rha and secondly zip workspace mein nhi load ho rha plz …give me zip workspace bhi over load hai"*

**Asli wajah (playwright + prod console se, andaza nahi):** R57 me `BlockView` ke props me **`onOpenPlanPage` destructure hona reh gaya tha**, par use kiya gaya tha. Jawab aate hi render ke waqt:
```
ReferenceError: onOpenPlanPage is not defined
    at BlockView …
```
React ne poora tree **unmount** kar diya → screen par sirf khaali cream page (kuch bhi nahi, composer bhi nahi). Server side bilkul theek tha (jawab 15s me aa gaya) — sirf UI mara.

**Fix (3 layer, taaki ye class dobara kabhi na ho):**
1. **Asli bug:** `onOpenPlanPage` BlockView ke props me destructure ho gaya. Verify playwright se — wahi sawaal ab poori tarah render hota hai (pills, class rows, per-train cards, seat board).
2. **ErrorBoundary (naya, general):** app-level + har message (text) + har card ke around. Ab koi bhi render error sirf apni jagah "⚠️ … dikha nahi paaya" card deta hai (retry + refresh buttons ke saath); baaki chat, purane messages aur composer chalta rehta hai. `resetKey` se naya message aane par boundary khud reset.
3. **Gate:** `tools/check-undefined-names.sh` — frontend `tsc` me purane type-noise (TS2322/2339/18047…) hain, par **undefined name** (TS2304/TS2552) hamesha runtime crash hota hai; wahi 2 codes ab fail karte hain. R58 se pehle yahi line prod par 1 error deti thi.

**Bonus fix (usi screenshot me dikha):** progress line "**18/6** checks completed" — total done se chhota. Ab `router.getAvailability` ke andar **har asli provider check** par `addChecks(1)` + `finally { checkDone() }` (dedupe/limit ke andar, isliye double count nahi) aur `turnScope.checkDone` me safety net (`total < done` → `total = done`). Naya test: `tests/round58-checks-count.test.ts` (3).

**Tests:** `tests/round58-blank-screen.test.tsx` (5 — boundary fallback, ek card phatne par doosra theek, retry, seat board wiring, asli prod reply ka render) + round58-checks-count (3). Full suite **138 files / 1467 PASS**; `tsc -p tsconfig.server.json` clean; `check-undefined-names.sh` PASS.

**Zip:** `RailBook-FULL-2026-09-29.zip` ab **33.2 MB** (pehle 60.3 MB) — builder ab sirf **latest APK + v1.4.9** (bridge recovery) pack karta hai, purane 6 APKs `RailBook/APKs` me waise hi hain. Proof screenshots: `previews/r58-blank-before.png` (blank) aur `previews/r58-blank-fixed.png` (same query, poora render).

**Deploy:** `9211dd4` → prod `/api/version` MATCH; playwright se live verify (@9211dd4, poora jawab + cards render, koi pageerror nahi).

## §9.51 — Round 59 (29 Sep 2026): Connecting plan ka apna PAGE (Leg 1 → Leg 2 + Book) — aur card kabhi khaali na jaaye

**User (screenshots 23:19):** *"Connecting trains are not showing leg 1 and leg 2 and don't change the logic jo humne set kara tha connecting trains ke liye and connecting trains next chat page pe open ho same chat page par nhi"*

**Do alag cheezein thin (dono fix hui):**

1. **Card hi nahi banta tha (data ki dikkat nahi, shart ki thi).** `Concierge` me journey card sirf tab banta tha jab `routeOptions.length` ya `directUnavailable` ho — **connecting-only plan** (routeOptions khaali, par `connections`/`legPlans` bhare) me card skip ho jaata tha aur user ke paas sirf lamba text bachta tha (17 ek line wale "Leg 1 – ASR → NDLS …" — screenshot 2 bilkul yahi). Ab `planIsShowable()`: routeOptions / connections / legPlans / directUnavailable — kisi ek me bhi data ho to card banta hai (wahi data, kuch invent nahi).
2. **Page chahiye tha, chat nahi.** Seat board ke `Connecting trains` / `Alternative trains` button ab **PlanPageSheet** kholte hain — full-screen page: header me route/date/pax + ↻, andar JourneyOptions embedded mode me (apna header nahi, double header nahi) seedha `connect`/`alt` page par. **Chat me koi naya message nahi jaata** — "← Wapas" dabao to chat bilkul waisi. Plan maangne ka text/logic **R57 wala hi** hai (`planPageAsk()`): *"ASR se LDH 2026-09-30 ka poora plan banao — connecting trains aur leg-wise seat bhi dikhao (1 passenger ke liye)"*. Loading par asli progress; plan na mile to saaf message + **Dobara try** (retry) + **Chat me poochho** — jhooth nahi.

**R59b (prod verification me mila):** model ne ek turn par plan ka **sirf TEXT** diya (markdown table!) aur koi payload nahi → page ne imaandaari se "Plan abhi nahi mila" dikhaya. Fix structural: `isPlanAsk()` (plan ka saaf ishaara — "poora plan banao"/"plan bana do") + AI-first branch me rescue — model payload na de to **wahi `planJourney` engine** chalta hai jo har jagah chalta hai (R45 ka usool: deterministic sirf rescue; logic bilkul same, sirf guarantee ki payload khaali na jaaye).

**Prod proof (@65d19d0, playwright headless Chrome):**
- ASR→LDH: page header *"Connecting trains · Leg 1 → Leg 2 · ASR → LDH · 2026-10-01 · 1 passenger"*; card me **Leg 1 = 14680 ASR DLI EXP (2S AVL 459 · ₹65, 06:15 ASR → 07:34 JRC)**, layover line *"Change @ Jalandhar Cantt (JRC) · layover 36m"*, **Leg 2 = 12550 MCTM DURG SF EXP (SL AVL 19 · ₹180, 08:10 JRC → 08:55 LDH)** — har leg par Bhasha me hint + **Book Leg 1 · 2S / Book Leg 2 · SL** (aur class chips par Book). → `previews/r59-plan-page-legs.png`
- LDH→ASR (jahan engine ko combo nahi mila): page phir bhi poora khulta hai — 25 direct/13 seat ka plan + honest note *"Is din is route par connecting combo nahi mila…"*. → `previews/r59-plan-page-nocombos.png`
- "← Wapas" ke baad: `planpage=false`, chat waisi (2 messages), koi pageerror nahi.

**Tests:** `tests/round59-plan-page.test.tsx` (7 — planIsShowable, phrasing wahi, leg 1/2 + Book, back, error+retry, honest note) + `tests/round59b-plan-payload-rescue.test.ts` (2 — isPlanAsk + control). Full suite **142 files / 1476 PASS**; `tsc -p tsconfig.server.json` clean; undefined-name gate PASS. Deploy `65d19d0` → prod `/api/version` MATCH.

## §9.52 — Round 60 (30 Sep 2026): station choice wapas · plan page scroll fix · leg classes ka layout

**User (screenshot 00:25):** *"ambiguous station pe ab choice nahi aati … multiple stations pe choice nahi aati; connecting trains page scroll nhi ho rha; screenshot mein jo classes hai uska layout sahi krdo; zip dedena, logic mat change Krna"*

**1. Ambiguous city par dropdown wapas (logic chheda nahi — sirf payload ki guarantee).**
Prod probe se asli wajah: `"Delhi jaana hai"` / `"Amritsar se Delhi ka poora plan banao"` me NLU city ko chup-chaap **NDLS** maan leta tha (aur model text me "kaunsa station (NDLS, DLI, NZM)?" poochh deta tha) — isliye koi `choice` payload nahi banta tha aur dropdown dikhta hi nahi tha. Sirf wahi phrasing choice deti thi jahan NLU city ko UNRESOLVED chhodta tha. Fix: **`cityStationAmbiguity()`** — slot city-level naam ho (station ka poora naam/code text me na ho) aur us city me 2+ station ho (asli provider search se) → wahi dropdown. Station ka exact naam/code likha ho to kuch nahi poochhte. Ye AI ke jawab ke saath jaata hai (text model ka, dropdown real data ka) — R45 ka usool: deterministic sirf rescue.
*Prod proof @a424d4a:* "Delhi jaana hai" → **"📍 Delhi — kaunsa station?"** + NDLS/DLI/NZM/DEC/ANVT/DEE tappable rows.

**2. Plan page ka scroll (asli bug, reproduce + proof ke saath).**
`.planpage-body` par scrollable content tha (scrollHeight 4902) par **touch swipe se kuch nahi hilta tha** — wajah: embedded JourneyOptions par `overflow:auto` + `overscroll-behavior: contain` the, jo scroll ko apne tak rok dete the. Fix: embed mode me dono reset (`overflow: visible; overscroll-behavior: auto`), `.planpage-body` par `min-height:0` + `touch-action: pan-y`.
*Proof (asli CSS + asli markup, touch events):* control box 588 · **naya CSS 805** · purana CSS wapas **0** (bug reproduce). *Prod @a424d4a:* plan page par touch swipe ke baad `scrollTop 0 → 746`.

**3. Leg classes ka layout (screenshot me overlap).**
Leg-list row ka area sirf **127px** chaura tha — train naam 2 line me tootta tha aur class chips container se bahar nikal kar seat-pill/chevron ke upar chadh jaate the. Fix: leg rows ka apna stack (`grid-template-areas: "a a" / "b c" / "d chev"`), aur dono jagah (connecting leg card + leg list) **ek hi `ClassGrid`**: leg ki seat pehle **"· Best"** ke saath, phir baaki classes same shakal me, har chip par **Book** (tap = usi class ka passenger form). Class code duplicate ("CC CC AVL") bhi hataya; Book separator saaf.

**Tests:** `tests/round60-station-choice.test.ts` (5) + `tests/round60-classgrid-layout.test.tsx` (3). Full suite **144 files / 1484 PASS**; server typecheck + undefined-name gate clean. Deploy **a424d4a** → prod MATCH.
Screenshots: `previews/r60-station-choice.png`, `previews/r60-prod-plan-legs.png`, `previews/r60-classes-layout.png`.
