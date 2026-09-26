# RailBook — poora project (continue karne ke liye) · 25 Sep 2026

Ye zip aapke **poore project** ka snapshot hai — web app + server + Android app + tests + previews + APKs.
Naye workspace me bas extract karke `npm ci` chalao aur wahin se aage badho (git history bhi andar hai).

```
railbook-full/
├── START-HERE.md              ← yahi file
├── railbook/                  ← asli repo (Vite + React + TS client + Express/TS server + tests)
│   ├── src/                   ← client (views/, components/, booking/, ai/, irctc/, seatfinder.ts…)
│   ├── server/                ← server (app.ts, agent/, railway/ scrapers…)
│   ├── tests/                 ← 99 files (vitest) — source-of-truth behaviour
│   ├── docs/                  ← RAILBOOK-ADDENDUM (round-by-round history, §9.13 = latest)
│   ├── provas/                ← real payload samples (live se liye gaye)
│   ├── tools/                 ← preview/verification tools (Round-21/21b/21c)
│   ├── .env                   ← GITHUB_TOKEN + RENDER_API_KEY (deploy ke liye — isko commit NAHI karna)
│   └── .git/                  ← poori history (HEAD: 99a0c9d)
├── android-app/               ← Android WebView app (Kotlin + autofill assets, keystore ke saath)
├── host-scripts/              ← apk-build-v146.sh (APK banane ka script)
├── previews/                  ← har round ke real-render previews (HTML)
└── apks/                      ← latest release APKs (v1.4.4, v1.4.5)
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

- **Round-24 (latest, 26 Sep 2026):**
  1. **"Review fare" → "Review journey"** — `Passengers.tsx` ka CTA label + voice prompt line, aur `speakGuide.ts` ki bolne wali line.
  2. **Review page = journey summary + uske neeche sirf Continue to IRCTC** — `FareReview` me receipt wapas: **Train · Date · From → To · Class · Seat · Passengers · Base fare · Service fee · Total**, aur neeche har passenger ki detail (naam · umar · gender · berth · khaana · ID · checkbox) + **Mobile / Email / WhatsApp**. DOM order: summary pehle, button neeche. Uske elawa kuch nahi (wallet, Confirm Booking, copy summary, extra note — sab nahi). `IrctcHandoff` card ab sirf button hai (honest baat button ke `title` par, jaise "auto-submit nahi hota · login/OTP/CAPTCHA/payment RailBook ke paas nahi aate").
  3. **Passenger page khaali dikhne wala bug** — `passengers` list khaali mile to ab **apne aap ek blank card** ban jaata hai (pehle sirf background dikhta tha par "SAB READY" + enabled CTA the). Screen khulte hi scroller **top** par + `resize`/`visualViewport` (keyboard/IME) ke baad scroll **clamp** — isliye keyboard band hone ke baad blank hissa nahi dikhta. Purane WebView ke liye CSS fallback: `100vh` pehle phir `100dvh`, aur `inset:0` se pehle explicit `top/right/bottom/left:0`.
  4. **Tools:** `tools/probe-device-scroll.mjs` (live site ko phone-size Chromium me khol kar layout/scroll naapta hai; `playwright` dev-dependency) · `tools/probe-live-review.mjs` (deploy ke baad asli screenshots) · `tools/build-round24-preview.mjs` → `RailBook-round24-2026-09-26.html`.
  5. **Naya APK zaroori nahi** — is round me Android code change nahi (app WebView me live site load karta hai, wahi naya UI dikhega). App v1.4.7 hi current hai.

### Standing rules (inhe todna nahi)

1. **Kuch bhi fake nahi** — jo real provider/AI se aata hai wahi dikhta hai; data na aaye to honest line ("nahi aayi"), guess/placeholder nahi.
2. **Architecture touch nahi** — AI logic, tools/API calling, alternatives/connecting logic jaisa hai waisa rehta hai; UI changes UI tak.
3. **UI change = preview pehle** — preview hamesha **single source** (asli components + built CSS + real payload; `/home/user/RailBook/previews/`).
4. Seat Finder ke rules: har train ki **saari** classes ek saath (WL/N-A halki), count header se match, WL neeche / Available upar, Hindi/English/Hinglish.
5. Handoff/autofill contract: IRCTC ka login/OTP/CAPTCHA/payment **kabhi auto nahi**.

### Baselines (naye round me compare karne ke liye)

| cheez | value |
|---|---|
| vitest | **103 files / 1029 tests PASS** (~120-175 s) |
| server tsc | clean |
| client tsc | 67 errors (purane, baseline — koi naya nahi) |
| live commit | `34d3315` (Round-24) |
| preview | `RailBook-round24-2026-09-26.html` (+ live phone screenshots `round24-live-*.png`) |
| APK | v1.4.7 `RailBook-v1.4.7-release.apk` (versionCode 30) sha256 `bd347c5e…c43d37` (Round-24 me Android change nahi) |

### Chhote gotchas

- Bash tool: `command` aur `cwd` **alag fields** me do (ek me poora nahi).
- Patch karne se pehle `grep -n` se current text lo; patch ke baad turant syntax check (`node -e "new vm.Script(...)"` JS ke liye).
- vitest background me `cwd=/home/user` se mat chalao — repo root se chalao.
- **UI change verify karna ho to:** `node tools/probe-live-review.mjs /home/user/RailBook/previews` (live site ko phone-size Chromium me khol kar screenshots + text deta hai).
- **App header = install proof:** "Redirecting to IRCTC…" ke saath **45s** + koi step line nahi dikhe to build current hai; 30s ya steps dikhe to purana APK — naya install karo (v1.4.7).
- Preview me external CSS/JS load nahi hota (sandboxed iframe) — sab inline rakho.
