# RailBook — HANDOFF (naya workspace yahan se shuru kare)

## Yeh project kya hai
RailBook — Indian Railways ka chat-first assistant. User Hinglish/Hindi/English me sawaal poochta hai; AI
model (NVIDIA) khud tools chalata hai (trains, seat availability, live status, plan, fare, booking flow →
IRCTC handoff). Data live providers se: RailCore/RailKit API + web fallbacks (ConfirmTkt → RailYatri →
eRail). Web app: React + Vite + Express (`server/`), aur Android WebView wrapper (APK).

## Kahan kya hai (paths)
- **Repo:** `/home/user/work/railbook` (git; push `https://${GITHUB_TOKEN}@github.com/mohitmalhotra2420/railbook.git HEAD:main`)
- **Android app:** `/home/user/work/app/android-app` · **APKs:** `/home/user/RailBook/APKs`
  - **R53 v1.5.0:** nav bar (`btnBack`/`btnHome`/`btnReload` + `navWhere` label) · `goBackSmart()` (IRCTC → RailBook home; warna history; home par double-back exit) · `onResume()` par IRCTC page ho to RailBook home (reopen fix) · build: `bash /home/user/apk-build-v150.sh` → APK + SHA `APKs/`.

- **Previews (HTML):** `/home/user/RailBook/previews` · **Docs:** `/home/user/RailBook/docs` + repo `docs/`
- **Full-project zip:** `/home/user/RailBook/RailBook-FULL-<date>.zip` — `OUT=... bash tools/build-full-zip.sh`
- **Credentials:** repo `.env` — `GITHUB_TOKEN`, `RENDER_API_KEY`, `RAILCORE_API_KEY`, `RAILKIT_API_KEY`,
  `RAILRADAR_API_KEY`, `NVIDIA_API_KEY`/`NVIDIA_BASE_URL`/`NVIDIA_MODEL`, `HF_*`, `AI_*` timeouts.
  **`.env` kabhi commit nahi karna.**

## Fresh workspace bootstrap (workspace reset ho jaata hai — pehla kaam yahi)
1. `bash /home/user/recover.sh` → GitHub se latest code + `npm ci` (agar `node_modules` na ho) + APK bridge.
2. `cd /home/user/work/railbook && npm ci` (agar node_modules missing).
2b. **Android source reset ho jaata hai** (sandbox purane commit par chala jaata hai): `/home/user/work/app/android-app` ko
    `/home/user/RailBook/APKs/RailBook-Android-v1.5.0-Source.zip` se wapas laao (`app/src` + `app/build.gradle.kts`) —
    warna `tests/round53-app-nav-and-irctc-return.test.ts` fail karega (nav bar/back code chala jaata hai).
3. Server typecheck: `./node_modules/.bin/tsc -p tsconfig.server.json --noEmit` (client me ~130 purane
   errors hain — sirf apne files grep karo).
4. Tests: `npx vitest run` (134 files / 1421 tests, 2–4 min).
5. UI build: `./node_modules/.bin/vite build` (**`npx vite build` mat chalao** — vite@8.3.1 par UNRESOLVED_ENTRY; preview builders `dist/assets` ki CSS use karte hain — pehle build).
5b. Preview builder: `./node_modules/.bin/tsx tools/build-round53-preview.mts` → `/home/user/RailBook/previews/`.
6. Deploy: Render `POST https://api.render.com/v1/services/srv-dae34rqd0e5s73evgjsg/deploys` body
   `{"clearCache":"clear"}` (Bearer RENDER_API_KEY) → phir `https://railbook-gegs.onrender.com/api/version`
   poll karke commit match karo. (`railbook-api.onrender.com` dead hai.)
7. Live probe: `POST https://railbook-gegs.onrender.com/api/agent` body `{"text":"...","history":[]}`.

## Architecture pointers (kahan kya hota hai)
- `server/agent/run.ts` — orchestrator. **AI-first (R45):** `aiFirst = agenticConfigured() && AI_OWNS_FLOW!=="0" && !isBookingMutation`; deterministic sirf rescue. `atlasFallback` = travel ka deterministic path.
- `server/agent/seatFilter.ts` — live board → seat rows, `seatSummaryLine` (chat ki `💺 …` line), `missingSeatLines`.
- `server/agent/seatFinderTool.ts` — `FIND_SEATS` (AI ka tool; summary = data + instructions model ko).
- **R53:** FIND_SEATS ka result `SearchCapture.seat` me capture hota hai (`agentic.ts`) → `run.ts` `AgentResponse.seatCapture` → `app.ts` **cards usi se banata hai** (`seatFilterFor()` dobara nahi chalta). Card payload cap: `SEAT_PAYLOAD_MAX_TRAINS=60`; text line `SEAT_LINE_MAX=12` + honest tail. Confirm/available par payload ke `wlRows` sirf seat-wali trains ke.
- **R53b/R53c:** cards ka train-set = jawab me likhi trains ∩ payload (dono taraf ka mismatch khatam); confirm/available ka derivation `cap.onlyAvailable || slots.confirmedOnly`.
- **R53 — naya provider sirf env se:** `AI_LLM_BASE_URL` + `AI_LLM_API_KEY` + `AI_LLM_MODELS` (comma chain) set karte hi poora AI stack us provider par (NVIDIA/HF default path safe). Docs: `docs/MODEL-RECOMMENDATION.md`.
- `server/agent/routeSegment.ts` — destination-tak route verification, drop note, "🧭 … tak (aage ka safar khud)" section.
- `server/railway/router.ts` — provider chain + live probe (`enrichTrainsFreshness`, `secondOpinionRow`);
  `confirmtkt.ts` (route board, `ctCacheTimeMs`), `webscrape.ts` (RailYatri/eRail/ConfirmTkt scrape).
- `server/understand/` — `legacy-nlu.ts` (deterministic NLU), `legacy-stations.ts` (station matching),
  `index.ts` (AI extraction + NLU merge).
- `src/views/Concierge.tsx` — chat UI + seat cards; `src/components/ReplyText.tsx` — reply text → cards parser.
- `docs/RAILBOOK-ADDENDUM-v1.4.3.md` — har round ka § (naya § append karo); `START-HERE.md` — project brief.

## User ke standing rules (inka khayal rakho)
- **Sab data REAL** — kuch fake/invent nahi; jo provider se nahi mila wo saaf likho.
- **AI-first** — har sawaal pehle model ke paas; deterministic sirf fail/timeout/rescue par.
- **Seat answers** — koi class na chhupe (jo train jawab me, uski saari classes); WL/N-A ka sach bhi;
  "available-only" filter trains par lagta hai, train ke andar classes chhupane par nahi.
- **UI change = pehle preview** dikhao; **round end = zip + deploy + prod verify**.
- Raw/internal text ya model ke notes user ko na dikhein.
- Per-question rule patching nahi — general/tool-level verification (2026-09 ka explicit usool).

## Round history (latest → purane)
- R51 (29 Sep): "Yaar LDH…" wording parse + confirm/available par saari classes (yeh round).
- R50 `0db7048` + `b604eaf`: "JAT tak (aage ka safar khud)" section + dikhaayi wali seat rows LIVE
  (purani ConfirmTkt cache ka fix + IRCTC-sourced second opinion) → deploy `dep-datkn6qd0e5s73cgmvgg`,
  `dep-datkpp7avr4c73dusd50`; docs+zip `73fc1f5`.
- R49 `0ebce68` + `6531728`: board me sirf wahi trains jo maangi hui station TAK jaati hain.
- R48 `60c7401` + `e501ddc`: seat cards me saari classes + duplicate rows ek.
- R47 `69992d5`: chat UI (AnswerCard).
- R45 `4f404d7` + `2abdaf0`: full AI-first. R46 `2f9c008` + `a66a3af`: station-code verification.
- (Isse purane: repo `git log` dekho; `docs/RAILBOOK-ADDENDUM-v1.4.3.md` me har round ka record hai.)

## Round-52 (29 Sep 2026) — “har query AI ke paas” (live build ka aakhri round)
- **Root cause:** `run.ts` ka `isBookingMutation()` akela `confirm` shabd par match karta tha → “confirm seat find out karke do na”
  booking-hukm ban jaata tha → `aiFirst=false` → AI-first flow skip, jawab deterministic engine se (model ne tool chalaya hi nahi).
- **Fix:** (a) mutation = asli hukm (`book kar do`, `confirm karo`, `payment kar do`…) + “confirm” khud sirf tab jab seat/availability
  context na ho; (b) model-health ordering (`orderModelChain`) — recently-fail model chain ke aakhir me; (c) `matchStationStrict()`
  (tools) + NLU ka loose `matchStation()` waisa hi; (d) capability sawaal bhi model ka (`!aiFirst` gate); (e) `FIND_SEATS` jawab me
  `summary` (rows + wlRows) ki SAARI entries. Chain: `gpt-oss-20b` primary → `muse-glimmer-30b` fallback, budget 90s / call 45s.
- **Proof:** local probe `engine: agentic_tool_calling`, `FIND_SEATS ✓`, 7 trains × saari classes; suite 132 files / 1410 tests.
- Docs: `docs/RAILBOOK-ADDENDUM-v1.4.3.md` **§9.44**; preview `RailBook-round52-2026-09-29.html`.
- **Prod reality (29 Sep, probe):** Render ke egress IP se NVIDIA NIM ka `/chat/completions` **hang** hota hai (chhota
  "OK" request bhi 30–35s timeout; wahi host ka `GET /models` 494ms) — sandbox se wahi call 1–2.5s. Isliye prod par
  jawab AI se aata hai par **170–185s** lag sakta hai (retry-queue + muse fallback); HF fallback dead (credits khatam).
  Aage: provider/fixed-IP proxy ya naya key add karna = prod latency ka asli fix.
- Chain: `… → bbb7c84 (R51) → dca4fac → 7927f7c → 5877a20 (R52 LIVE)`. Prod env: `AI_AGENTIC_TURN_BUDGET_MS=180000`,
  `AI_AGENTIC_TIMEOUT_MS=45000`, `NVIDIA_MODEL=openai/gpt-oss-20b`, `NVIDIA_FALLBACK_MODEL=meta/muse-glimmer-30b`, `HF_MODEL=`.
