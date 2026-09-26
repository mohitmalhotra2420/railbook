# RailBook — poora project (continue karne ke liye) · 25 Sep 2026

Ye zip aapke **poore project** ka snapshot hai — web app + server + Android app + tests + previews + APKs.
Naye workspace me bas extract karke `npm ci` chalao aur wahin se aage badho (git history bhi andar hai).

```
railbook-full/
├── START-HERE.md              ← yahi file
├── railbook/                  ← asli repo (Vite + React + TS client + Express/TS server + tests)
│   ├── src/                   ← client (views/, components/, booking/, ai/, irctc/, seatfinder.ts…)
│   ├── server/                ← server (app.ts, agent/, railway/ scrapers…)
│   ├── tests/                 ← 110 files (vitest) — source-of-truth behaviour
│   ├── docs/                  ← RAILBOOK-ADDENDUM (round-by-round history, §9.21 = latest)
│   ├── provas/                ← real payload samples (live se liye gaye)
│   ├── tools/                 ← preview/verification tools (Round-29: build-round29-preview.mjs, probe-live-r29*.mjs)
│   ├── .env                   ← GITHUB_TOKEN + RENDER_API_KEY (deploy ke liye — isko commit NAHI karna)
│   └── .git/                  ← poori history (HEAD: de97b12)
├── android-app/               ← Android WebView app (Kotlin + autofill assets, keystore ke saath)
├── host-scripts/              ← apk-build-v149.sh (APK banane ka script, latest = v149)
├── previews/                  ← har round ke real-render previews (HTML)
└── apks/                      ← latest release APKs (v1.4.8, v1.4.9 — r29 me naya APK nahi)
```

## 1. Turant shuru karne ke liye

```bash
cd railbook
npm ci --include=dev            # node_modules (~130 MB)
npx vitest run                  # poora suite: 99 files / 1006 tests (≈2 min)
./node_modules/.bin/tsc -p tsconfig.server.json   # server TS clean hona chahiye
./node_modules/.bin/tsc --noEmit -p tsconfig.json  # client: 68 puraane errors baseline (koi naya nahi hona chahiye)
npm run build                   # client bundle (dist/)
```

Dev server: `npm run dev` (client) · server: `npm run server` (ya jo scripts package.json me hain).

## 2. Deploy (Render)

`.env` me `RENDER_API_KEY` (aur `GITHUB_TOKEN`) hai. Flow jo har round me chalta hai:

```bash
cd railbook && source .env
git push "https://${GITHUB_TOKEN}@github.com/mohitmalhotra2420/railbook.git" HEAD:main
curl -s -X POST -H "Authorization: Bearer $RENDER_API_KEY" -H "content-type: application/json" \
  -d '{"clearCache":"clear"}' https://api.render.com/v1/services/srv-dae34rqd0e5s73evgjsg/deploys
# poll: GET /v1/services/srv-dae34rqd0e5s73evgjsg/deploys/<id>  → "live"
curl -s https://railbook-gegs.onrender.com/api/version   # commit sha verify
```

Service: `srv-dae34rqd0e5s73evgjsg` · live: https://railbook-gegs.onrender.com

## 3. Android APK

`host-scripts/apk-build-v145.sh` chalane se: JDK17 + Gradle 8.7 + Android SDK (34) set hota hai,
`android-app/` ka copy banta hai, versionCode/Name bump hota hai, `assembleRelease` chalta hai aur
APK `~/RailBook/APKs/` me save hota hai. **Keystore `android-app/railbook-release.keystore` zip me hai**
(update install ke liye wahi key chahiye). Autofill assets yeh hain:

```
android-app/app/src/main/assets/autofill/
  ├── fieldmap.js              (payload validate + generic fill + flags/food/contact rules)
  ├── irctc-passenger.js       (IRCTC page par asli autofill: anchors, food, checkbox, contact)
  ├── railbook-webview-bridge.js (banner/panel + native status line)
  └── railbook-seatboard-live.js
```
`MainActivity.kt` (`injectRailbookCapture`) V2 key `railbookAutofillPayloadV2` pehle padhta hai, phir purani key.

## 4. Current state (26 Sep 2026)

- **Live:** commit `75c474b`, deploy `dep-darcj0h7lnhs73cs4gsg` (2026-09-25T19:21Z), `/api/version` = `75c474b`.
- **Round-20:** direct-trains card = Seat Finder jaisa shared `TrainClassBlock`; kisi bhi class chip par tap → seedha IRCTC-jaisa passenger form (train no/date/from→to auto, catering real, insurance/payment nahi); chat ka lamba jawab `ReplyText` rows me.
- **Round-21:** IRCTC autofill me food + "Book only if confirm berths are allotted" + "Consider for auto up-gradation" + mobile/email. Naya **V2 payload** (`railbookAutofillPayloadV2`); purani key + `postMessage` me exact **V1 shape** (purane app/extension safe).
- **Round-21b (latest):** catering ka **per-source sach** — `sources{erail,confirmtkt}`, `conflict`, `premiumCatering` (Rajdhani/Shatabda/Duronto/Vande Bharat/Tejas), `foodChoiceExpected`, `evidence[]`. Passenger form me **Food choice sirf saaf data par**; conflict par honest line, guess kabhi nahi. App panel batata hai jab IRCTC page par food option hi na ho.
- **Round-21c:** chat section se **Seat Finder card hata** diya (component `SeatFinder.tsx`, `seatfinder.ts` filters, `server/agent/seatFinderTool.ts` + `seatFilter.ts`, AI seat intent — **sab intact**, sirf chat render se gaya).
- **Round-22 (26 Sep):**
  1. **Seat-answer padhne layak** — `ReplyText.tsx` ab **em-dash (—)** aur "… departure" wale text ko rows me todta hai + upar ek honest summary line (`💺 2 me seat (102, 42) · fare ₹150–₹180`) — sirf usi text ke numbers se.
  2. **Filters direct card ke shuru me** — naya shared `src/components/SeatFilterBar.tsx` (✅ Available · 🚆 Sabhi trains · Sab class · class chips · ❄️ AC · Time · ⚡ Sabse jaldi · 💰 Sabse sasta); SeatFinder card + JourneyOptions dono wahi ek component use karte hain. Filter **sirf direct list** par (connecting/alternatives untouched); class filter par block me sirf wahi class chip; "Sabse sasta" filtered class ke fare par.
  3. **IRCTC overlay simple** — Android app me sirf **"Redirecting to IRCTC…" + 45s countdown** (pehle 30s + extra 30s phase tha — ab ek hi 45s, uske baad seedha continue).

- **Round-23 (26 Sep 2026):**
  1. **Available me sirf AVL/RAC** — `JourneyOptions.tsx` me ✅ Available mode par rows ab sirf AVL/RAC class chips dikhate hain; WL/N-A chips hidden, aur jis train me ek bhi AVL/RAC nahi wo list se hat jaati hai (jaise 11058 jaise trains WL-only gap wale). 🚆 Sabhi trains par sab kuch waise hi (saari classes, WL/N-A halki) — koi fake row nahi.
  2. **Review page ab sirf "Continue to IRCTC"** — `src/views/ReviewStatus.tsx` ke `FareReview` se booking summary, wallet box, "Nothing is confirmed…" note aur neeche ka sticky **Confirm Booking** hataye. `IrctcHandoff.tsx` se **Copy journey + passenger summary** button, copy-ready summary block aur payload preview hate. Continue click par journey+passenger summary **clipboard me best-effort copy** hoti hai (UI me nahi dikhti); honest note rehti hai — "Kuch bhi auto-submit nahi hota · login / OTP / CAPTCHA / payment RailBook ke paas nahi aate". RailBook ka apna booking flow (Passengers → IRCTC handoff jaisa) untouched.
  3. **App header ab asli version** — `MainActivity.appVersionLabel()` `versionName (versionCode)` dikhata hai (pehle `strings.xml` me hardcoded `v1.2.8` tha, isliye device par purana build chalne ka confusion hota tha). New debug ke liye: header padho → `v1.4.7 (30)` = latest.
  4. Tests: naya `tests/round23-avail-chips-and-review.test.tsx` (3) + `tests/irctc-handoff.test.tsx` update; full suite **102 files / 1021 PASS**.

- **Round-24 (26 Sep 2026):**
  1. **"Review fare" → "Review journey"** — `Passengers.tsx` ka CTA label + voice prompt line, aur `speakGuide.ts` ki bolne wali line.
  2. **Review page = journey summary + uske neeche sirf Continue to IRCTC** — `FareReview` me receipt wapas: **Train · Date · From → To · Class · Seat · Passengers · Base fare · Service fee · Total**, aur neeche har passenger ki detail (naam · umar · gender · berth · khaana · ID · checkbox) + **Mobile / Email / WhatsApp**. DOM order: summary pehle, button neeche. Uske elawa kuch nahi (wallet, Confirm Booking, copy summary, extra note — sab nahi). `IrctcHandoff` card ab sirf button hai (honest baat button ke `title` par, jaise "auto-submit nahi hota · login/OTP/CAPTCHA/payment RailBook ke paas nahi aate").
  3. **Passenger page khaali dikhne wala bug** — `passengers` list khaali mile to ab **apne aap ek blank card** ban jaata hai (pehle sirf background dikhta tha par "SAB READY" + enabled CTA the). Screen khulte hi scroller **top** par + `resize`/`visualViewport` (keyboard/IME) ke baad scroll **clamp** — isliye keyboard band hone ke baad blank hissa nahi dikhta. Purane WebView ke liye CSS fallback: `100vh` pehle phir `100dvh`, aur `inset:0` se pehle explicit `top/right/bottom/left:0`.
  4. **Tools:** `tools/probe-device-scroll.mjs` (live site ko phone-size Chromium me khol kar layout/scroll naapta hai; `playwright` dev-dependency) · `tools/probe-live-review.mjs` (deploy ke baad asli screenshots) · `tools/build-round24-preview.mjs` → `RailBook-round24-2026-09-26.html`.
  5. **Naya APK zaroori nahi** — is round me Android code change nahi (app WebView me live site load karta hai, wahi naya UI dikhega). App v1.4.7 hi current hai.

- **Round-25 (26 Sep 2026):** "baki trains Seat Finder card mein kyu le jaata?" →
  1. `seatFilter.seatSummaryLine()` ab saari seat rows likhti hai (12 tak; aage honest "+N aur bhi hain") — purana `(Seat Finder card me)` pointer hataya (wo card Round-21c me chat se hata tha, isliye jhootha tha).
  2. Naya `missingSeatLines()` + `server/app.ts` turn assembly: jo trains AI ke jawab me chhoot gayi, unki asli lines usi jawab me jud jaati hain (chat me rows ban kar dikhti hain). AI fail → wahi compact 💺 line (usme saari trains).
  3. Prompt + tool summary me saaf rule: saari trains likho, koi "card" pointer nahi. Client par `src/chatText.ts` `stripSeatCardPointer()` safety net (Concierge render se pehle).
  4. Tests: `tests/round25-seat-answer-all-trains.test.tsx` (7, turn-level sahit) · preview `RailBook-round25-2026-09-26.html` · builder `tools/build-round25-preview.mjs`. APK change nahi (WebView live).

- **Round-26 (26 Sep 2026):** "WL trains bhi dikhao" + "10 trains par 9 kyu" →
  1. **Count fix:** `ReplyText` label-match 40 → **140 akshar** — AI ne pehli train intro line me likhi ho to bhi wo row banti hai (10 trains = 10 rows). Summary line ab **total + seat/WL farq** batati hai (`💺 14 trains: 10 me seat (…) · 4 WL/N-A`).
  2. **Default me WL/N-A bhi:** `parseSeatIntent` me naya `EXPLICIT_AVAILABLE_WORDS` — `onlyAvailable` true sirf jab user khud *available / khali / vacant / confirmed* bole; warna saari trains (AVL/RAC + WL/N-A) status ke saath.
  3. `seatSummaryLine` all-mode branch (ek line me saari trains + "10 me seat (AVL/RAC), 8 me WL/N-A"), `seatFinderTool`/`autoTools`/`toolSpecs` me `only_available` default false, dono prompts me rule. `server/app.ts` me chhoot gayi rows AVL+WL dono se.
  4. Tests: `tests/round26-seat-all-classes.test.tsx` (7) + round-25 test update → **105 files / 1043 PASS** · preview `RailBook-round26-2026-09-26.html` · builder `tools/build-round26-preview.mjs`. APK change nahi.

- **Round-27 (26 Sep 2026):** "ek hi class dikha raha" + "baki trains live board par hai" + "class pe tap → sidha passenger form" + "mic working nahi hai" →
  1. **Per-train classes (server):** `seatFilter.ts` me `groupRowsByTrain()` / `trainClassesText()` — jawab/line me har train ki **saari** classes (`12013 AMRITSAR SHTABDI — CC AVL 444 ₹675 · 3A AVL 71 ₹520 · EC AVL 23 ₹1,015`), trains ke beech ` | `. `missingSeatLines()` bhi per-train. Cap ab **`capRowsByTrain()`** se **trains** par (pehle rows par tha — isi se same train ki EC/3E/2A block se kat rahi thi).
  2. **Chat ka tappable block (client):** naya `seatlist` block (`src/ai/orchestrate.ts` + `src/api.ts` + `Concierge.tsx` ka `SeatListBlock`) — train-wise `TrainClassBlock` groups, header `Seat wali trains (live board) · N trains · M me seat`, har class chip **tap → passenger form** (`openBookingFromSeatRow`). `chatText.seatListGroups()` + `stripDuplicatedSeatRows()` (text se duplicate row-lines hatati hain, prose bachi rehti hai); `ReplyText` me `AVL/AVAIL` rows + ek line ki saari classes alag-alag rows.
  3. **Native mic:** Android WebView me Web Speech API **nahi hota** — naya `VoiceBridge.kt` (SpeechRecognizer, hi-IN, `window.__railbookVoice.dispatch`) + `MainActivity` me `addJavascriptInterface(…, "RailBookVoice")` + manifest `<queries>`; client `src/voice/nativeSpeech.ts` + `speech.ts`/`useVoiceInput.ts` native-aware (native par `getUserMedia` call nahi).
  4. Tests: `tests/round27-seat-classes-and-mic.test.tsx` (12) + round-25 test format update → **106 files / 1055 PASS** · preview `RailBook-round27-2026-09-26.html` · builders `tools/build-round27-preview.mjs`, probe `tools/probe-live-r27.mjs`. **APK v1.4.8 (vc 31)** — native mic ke liye zaroori.

- **Round-31 (latest, 26 Sep 2026):** "answer ke baad AI ko next step pe leke jaana chahiye… AI khud dimaag kyu nahi lagata?" →
  1. **"➡️ Agla kadam" card:** `src/ai/nextstep.ts` (naya pure helper `nextStepsFor`) + Concierge me har jawab ke neeche 1–2 tappable chips, **sirf usi turn ke verified data se** (seat rows/train list/journey plan) — Book (→ Round-29 auto passenger form), doosri classes, baaki trains, seat availability, ya doosri date. Kuch verified na ho → **koi chip nahi**.
  2. Model ke paas booking tool nahi (confirmBook false) — isliye agla kadam data se banta hai, andaze se nahi (fake screen/number ka risk zero).
  3. Tests: `tests/round31-next-step.test.tsx` (18) → **110 files / 1121** (1120 pass; 3 RailCore flaky alag pass) · preview `RailBook-round31-2026-09-26.html` · probes `tools/probe-live-r31*.mjs` · **APK nahi**.
  4. Live proof (`de97b12`): seat answer → `Book 12013 · CC (AVL 354 ₹675)` + `doosri classes (EC)`; tap → passenger form (12013 · CC · LDH → ASR · 2026-09-27).

- **Round-30 (26 Sep 2026):** "12013 ki seat availability btana … yeh question pe board kyu le aata, maine to maanga hi nahi" →
  1. **Focus scope:** `src/chatText.ts` ke naye pure helpers `trainNumbersInText()` (saal/tareekh/time ko train nahi samajhta) + `focusSeatRows()`; `Concierge.tsx` ka `seatlist` block ab message ke train number(s) par scoped — block sirf maangi hui train ka, header "Aapki maangi train (live board)". Generic sawaal par poora board pehle jaisa; maangi train list me na ho → block hi nahi.
  2. **Round-29 auto-advance** bhi wahi helper use karta hai (number extraction ek jagah).
  3. Tests: `tests/round30-focused-train-seat-block.test.tsx` (11) → **109 files / 1103 PASS** · preview `RailBook-round30-2026-09-26.html` · builder `tools/build-round30-preview.mjs` · probes `tools/probe-live-r30.mjs` (local) + `tools/probe-live-r30-live.mjs` (live) · **APK nahi** (koi Android change nahi).
  4. Live proof (`0b36c52`): 12013 → 1 card (focused, 2 chips) · generic → 20 trains/59 chips.

- **Round-29 (26 Sep 2026):** "same train ki classes alag alag cards me kyun" + "class pe tap" + "22432 mein 3A book krdo" + "vaishno devi" →
  1. **Ek train = ek card (chat):** `ReplyText.tsx` me `groupReplyRowsByTrain()` — trainNumber par grouping, header me number+naam ek baar, andar har class ki apni row (apna AVL/RAC/WL + fare), **order preserve**, exact duplicate record ek hi baar, input rows mutate nahi (sirf display view-model).
  2. **Class row tap → seedha passenger form:** `openBookingFromReplyRow()` → wahi `selectTrainAndClassGo()` (N/A/REGRET par button nahi).
  3. **"book krdo" → khud passenger form:** naya `src/booking/autobook.ts` (`isBookingIntent` · `pickRowForBooking` · `buildAutoBookSeat`) + Concierge gate; UNKNOWN status par bhi form (live check "Review journey" par), `booking/state.ts` UNKNOWN allow; `Passengers.tsx` honest fare/timings lines ("₹0" nahi).
  4. **Chhota station naam:** "vaishno devi" (+ 10 aur variants, Hindi bhi) → SVDK dono station maps me.
  5. Tests: `tests/round29-group-same-train-book.test.tsx` (22) + round-20/27 update → **108 files / 1091 PASS** · preview `RailBook-round29-2026-09-26.html` · builder `tools/build-round29-preview.mjs` · probes `tools/probe-live-r29.mjs` (local) + `tools/probe-live-r29-live.mjs` (live) · **APK nahi** (r29 me koi Android change nahi — v1.4.9 hi).

- **Round-28 (26 Sep 2026):** black handoff panel + blue header user ko nahi (backend me) · passenger dock fix · 45s → 30s + "details khud bhar jaayengi" →
  1. **Bridge panel hataya:** `railbook-webview-bridge.js` me `banner()` badal kar `postNotice()/pill()` — page par sirf **one-line pill** (6s me khud hide; STOP wale 12s), poori detail `fill-result` + `ui-notice` se native (status + log + Toast). Kuch chhupta nahi.
  2. **Android header chhupa:** `activity_main.xml` me `topBar` `visibility="gone"` — version/BHASHA/status/RAILBOOK-IRCTC-CLEAR screen par nahi, **code + listeners zinda**; user updates chhote Toast (`setStatus`) se.
  3. **Passenger dock fix:** `.overlay-screen` ab `fixed` + `100vh/100dvh` (pehle `.app` ke andar absolute — chat lambi hone par dock screen ke neeche chala jaata tha). Probe: CTA top 1336px → **836px (bina scroll)**. CTA label: details adhoori → "Review journey (pehle details bharo)".
  4. **30s + assurance:** `PREWARM_COUNTDOWN_MS = 30_000L`; prewarm overlay + passenger dock + Continue-to-IRCTC ke neeche line — "Aapki details IRCTC par khud bhar jaayengi, dobara daalne ki zaroorat nahi (login/OTP/payment aap karenge)". Browser me honest alag wording (`autoFillNotice`).
  5. Tests: `tests/round28-pax-dock-and-autofill-note.test.tsx` (15) → **107 files / 1070 PASS** · preview `RailBook-round28-2026-09-26.html` · builder `tools/build-round28-preview.mjs`, probes `tools/probe-live-r28.mjs` + `tools/probe-pax-dock.mjs`. **APK v1.4.9** (vc 32).

### Standing rules (inhe todna nahi)

1. **Kuch bhi fake nahi** — jo real provider/AI se aata hai wahi dikhta hai; data na aaye to honest line ("nahi aayi"), guess/placeholder nahi.
2. **Architecture touch nahi** — AI logic, tools/API calling, alternatives/connecting logic jaisa hai waisa rehta hai; UI changes UI tak.
3. **UI change = preview pehle** — preview hamesha **single source** (asli components + built CSS + real payload; `/home/user/RailBook/previews/`).
4. Seat Finder ke rules: har train ki **saari** classes ek saath (WL/N-A halki), count header se match, WL neeche / Available upar, Hindi/English/Hinglish.
5. Handoff/autofill contract: IRCTC ka login/OTP/CAPTCHA/payment **kabhi auto nahi**.

### Baselines (naye round me compare karne ke liye)

| cheez | value |
|---|---|
| vitest | **110 files / 1121 tests** (1120 pass; 3 RailCore network-flaky alag chalane par pass) |
| server tsc | clean |
| client tsc | 67 errors (purane, baseline — koi naya nahi) |
| live commit | `de97b12` (Round-31) |
| preview | `RailBook-round31-2026-09-26.html` (Round-30/29/28/26/25 ke bhi previews/ me hain) |
| APK | v1.4.9 `RailBook-v1.4.9-release.apk` (versionCode 32) sha256 `4ea684c3…8e1ce` — Round-29 me koi Android change nahi (web fix; app live URL load karta hai) |

### Chhote gotchas

- Bash tool: `command` aur `cwd` **alag fields** me do (ek me poora nahi).
- Patch karne se pehle `grep -n` se current text lo; patch ke baad turant syntax check (`node -e "new vm.Script(...)"` JS ke liye).
- vitest background me `cwd=/home/user` se mat chalao — repo root se chalao.
- **UI change verify karna ho to:** `node tools/probe-live-review.mjs /home/user/RailBook/previews` (live site ko phone-size Chromium me khol kar screenshots + text deta hai).
- **App header = install proof:** "Redirecting to IRCTC…" ke saath **45s** + koi step line nahi dikhe to build current hai; 30s ya steps dikhe to purana APK — naya install karo (v1.4.7).
- Preview me external CSS/JS load nahi hota (sandboxed iframe) — sab inline rakho.
