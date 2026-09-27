

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
