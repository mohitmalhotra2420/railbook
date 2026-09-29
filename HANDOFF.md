# RailBook — HANDOFF (naya workspace yahan se shuru kare)

## Yeh project kya hai
RailBook — Indian Railways ka chat-first assistant. User Hinglish/Hindi/English me sawaal poochta hai; AI
model (NVIDIA) khud tools chalata hai (trains, seat availability, live status, plan, fare, booking flow →
IRCTC handoff). Data live providers se: RailCore/RailKit API + web fallbacks (ConfirmTkt → RailYatri →
eRail). Web app: React + Vite + Express (`server/`), aur Android WebView wrapper (APK).

## Kahan kya hai (paths)
- **Repo:** `/home/user/work/railbook` (git; push `https://${GITHUB_TOKEN}@github.com/mohitmalhotra2420/railbook.git HEAD:main`)
- **Android app:** `/home/user/work/app/android-app` · **APKs:** `/home/user/RailBook/APKs`
- **Previews (HTML):** `/home/user/RailBook/previews` · **Docs:** `/home/user/RailBook/docs` + repo `docs/`
- **Full-project zip:** `/home/user/RailBook/RailBook-FULL-<date>.zip` — `OUT=... bash tools/build-full-zip.sh`
- **Credentials:** repo `.env` — `GITHUB_TOKEN`, `RENDER_API_KEY`, `RAILCORE_API_KEY`, `RAILKIT_API_KEY`,
  `RAILRADAR_API_KEY`, `NVIDIA_API_KEY`/`NVIDIA_BASE_URL`/`NVIDIA_MODEL`, `HF_*`, `AI_*` timeouts.
  **`.env` kabhi commit nahi karna.**

## Fresh workspace bootstrap (workspace reset ho jaata hai — pehla kaam yahi)
1. `bash /home/user/recover.sh` → GitHub se latest code + `npm ci` (agar `node_modules` na ho) + APK bridge.
2. `cd /home/user/work/railbook && npm ci` (agar node_modules missing).
3. Server typecheck: `./node_modules/.bin/tsc -p tsconfig.server.json --noEmit` (client me ~130 purane
   errors hain — sirf apne files grep karo).
4. Tests: `npx vitest run` (~130 files / ~1400 tests, 2–3 min).
5. UI build: `npx vite build` (preview builders `dist/assets` ki CSS use karte hain — pehle build).
6. Deploy: Render `POST https://api.render.com/v1/services/srv-dae34rqd0e5s73evgjsg/deploys` body
   `{"clearCache":"clear"}` (Bearer RENDER_API_KEY) → phir `https://railbook-gegs.onrender.com/api/version`
   poll karke commit match karo. (`railbook-api.onrender.com` dead hai.)
7. Live probe: `POST https://railbook-gegs.onrender.com/api/agent` body `{"text":"...","history":[]}`.

## Architecture pointers (kahan kya hota hai)
- `server/agent/run.ts` — orchestrator. **AI-first (R45):** `aiFirst = agenticConfigured() && AI_OWNS_FLOW!=="0" && !isBookingMutation`; deterministic sirf rescue. `atlasFallback` = travel ka deterministic path.
- `server/agent/seatFilter.ts` — live board → seat rows, `seatSummaryLine` (chat ki `💺 …` line), `missingSeatLines`.
- `server/agent/seatFinderTool.ts` — `FIND_SEATS` (AI ka tool; summary = data + instructions model ko).
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
