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
├── host-scripts/              ← apk-build-v145.sh (APK banane ka script)
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

## 4. Current state (25 Sep 2026)

- **Live:** commit `99a0c9d`, deploy `dep-dar1ucc9v7es7396tt80` (2026-09-25T07:14:55Z), `/api/version` = `99a0c9d`.
- **Round-20:** direct-trains card = Seat Finder jaisa shared `TrainClassBlock`; kisi bhi class chip par tap → seedha IRCTC-jaisa passenger form (train no/date/from→to auto, catering real, insurance/payment nahi); chat ka lamba jawab `ReplyText` rows me.
- **Round-21:** IRCTC autofill me food + "Book only if confirm berths are allotted" + "Consider for auto up-gradation" + mobile/email. Naya **V2 payload** (`railbookAutofillPayloadV2`); purani key + `postMessage` me exact **V1 shape** (purane app/extension safe).
- **Round-21b (latest):** catering ka **per-source sach** — `sources{erail,confirmtkt}`, `conflict`, `premiumCatering` (Rajdhani/Shatabda/Duronto/Vande Bharat/Tejas), `foodChoiceExpected`, `evidence[]`. Passenger form me **Food choice sirf saaf data par**; conflict par honest line, guess kabhi nahi. App panel batata hai jab IRCTC page par food option hi na ho.
- **Round-21c (latest):** chat section se **Seat Finder card hata** diya (component `SeatFinder.tsx`, `seatfinder.ts` filters, `server/agent/seatFinderTool.ts` + `seatFilter.ts`, AI seat intent — **sab intact**, sirf chat render se gaya).

### Standing rules (inhe todna nahi)

1. **Kuch bhi fake nahi** — jo real provider/AI se aata hai wahi dikhta hai; data na aaye to honest line ("nahi aayi"), guess/placeholder nahi.
2. **Architecture touch nahi** — AI logic, tools/API calling, alternatives/connecting logic jaisa hai waisa rehta hai; UI changes UI tak.
3. **UI change = preview pehle** — preview hamesha **single source** (asli components + built CSS + real payload; `/home/user/RailBook/previews/`).
4. Seat Finder ke rules: har train ki **saari** classes ek saath (WL/N-A halki), count header se match, WL neeche / Available upar, Hindi/English/Hinglish.
5. Handoff/autofill contract: IRCTC ka login/OTP/CAPTCHA/payment **kabhi auto nahi**.

### Baselines (naye round me compare karne ke liye)

| cheez | value |
|---|---|
| vitest | **99 files / 1006 tests PASS** (~115 s) |
| server tsc | clean |
| client tsc | 68 errors (purane, baseline — koi naya nahi) |
| live commit | `99a0c9d` |
| APK | v1.4.5 `RailBook-v1.4.5-release.apk` (versionCode 28) |

### Chhote gotchas

- Bash tool: `command` aur `cwd` **alag fields** me do (ek me poora nahi).
- Patch karne se pehle `grep -n` se current text lo; patch ke baad turant syntax check (`node -e "new vm.Script(...)"` JS ke liye).
- vitest background me `cwd=/home/user` se mat chalao — repo root se chalao.
- Preview me external CSS/JS load nahi hota (sandboxed iframe) — sab inline rakho.
