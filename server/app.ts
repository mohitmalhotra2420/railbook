import express from "express";
import { installFetchMetrics, progress, runTurnScope, summarize, type ProgressEvent } from "./perf/turnScope.js";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { env } from "./env.js";
import { searchStations as searchLocalStations } from "./data/stations.js";
import { getProvider } from "./providers/index.js";
import {
  loadClassBoard,
  searchRailkitStations,
  stationBoard,
  trainHistory,
} from "./railway/railkit.js";
import {
  railcoreIsPrimary,
  routedCancelled,
  routedClassBoard,
  routedCoachPosition,
  routedLiveStatus,
  routedPnr,
  routedSchedule,
  routedRouteBoard,
  routedStationSearch,
  routedTrainFacts,
  routedTrainHistory,
} from "./railway/router.js";
import { BERTH_OPTIONS, isBookable, type ClassCode } from "./providers/types.js";
import { recommend } from "./recommend.js";
import { addMoney, credit, debit, getWallet } from "./wallet.js";
import { isPastDate } from "./util.js";
import { runUnderstand } from "./understand/index.js";
import { runAgent } from "./agent/run.js";
import { runAutonomousAgent } from "./agent/autonomous.js";
/* 24 Sep 2026 (user: "12029 ki seat availability CC … AI ne nahi btayi"): app /api/agent chalta hai
 * (agentic), jahan seat samajh nahi thi. Ye do import SIRF padhne + maujooda board filter karne ke liye
 * hain — AI ka search/tools/API/planner ko chhua nahi gaya. */
import { parseSeatIntent } from "./understand/seatIntent.js";
import { missingSeatLines, seatFilterFor, seatSummaryLine, type SeatFilterResult } from "./agent/seatFilter.js";
import { reconcileNextActions } from "./agent/agentic.js";
import { JOURNEY_CONFIG, findAlternativeTrains, findConnections, findPartialRouteSeats, findVacantSeats, planJourney } from "./journey/engine.js";
import { pickTrains } from "./journey/trainpicker.js";
import { publicCapabilityPayload } from "./providers/capabilities.js";
import { railcoreBlockState } from "./railway/railcore.js";
import { scrapeTrainFactsWeb } from "./railway/webscrape.js";
import { getNvidiaCatalog, publicNvidiaPayload, refreshNvidiaCatalog } from "./understand/nvidia.js";
import { answerFromEvidence, compactScheduleEvidence, shouldGroundFact } from "./understand/ground.js";
import { todayYmdFrom } from "./understand/legacy-dates.js";

const classCode = z.enum(["1A", "2A", "3A", "3E", "SL", "CC", "EC", "2S", "EA"]);

const passengerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Enter the full name")
    .regex(/^[A-Za-z][A-Za-z .']+$/, "Use letters only"),
  age: z.number().int().min(1, "Invalid age").max(120, "Invalid age"),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  berthPreference: z.string().min(1, "Select a berth preference"),
});

const SERVER_STARTED_AT = new Date().toISOString();

installFetchMetrics();

/* Single-process in-flight confirmation claim. Ek booking ID par ek waqt me sirf ek hi
 * confirm critical section chal sakta hai — check + set synchronous hain (beech me koi await
 * nahi), isliye overlapping requests me sirf pehla jeetta hai, baaki ko CONFIRM_IN_PROGRESS
 * (409) milta hai. Isse "sab DRAFT dekhe → sab ne debit kiya" race band hoti hai.
 * NOTE: single-process architecture ke liye kaafi hai; multi-instance me DB-level
 * conditional update / unique idempotency key chahiye. */
const confirmInFlight = new Map<string, true>();

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    cors({
      origin: env.clientOrigin === "*" ? true : env.clientOrigin.split(","),
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader("Permissions-Policy", "microphone=(self)");
    res.setHeader("Feature-Policy", "microphone 'self'");
    next();
  });
  app.use(express.json({ limit: "256kb" }));

  /* Round-13 (diagnostic): AI engine live-check — minimal NIM call, no tools.
   * ?model= (default primary), ?timeoutMs= (default 30000). Sirf status/latency
   * return karta hai — koi data/key expose nahi. */
  app.get("/api/ai-ping", async (req, res) => {
    const model = String(req.query.model ?? process.env.NVIDIA_MODEL ?? "").trim();
    const timeoutMs = Math.min(Math.max(Number(req.query.timeoutMs ?? 30000) || 30000, 2000), 60000);
    const base = String(process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
    const key = process.env.NVIDIA_API_KEY ?? "";
    if (!model || !key) {
      res.status(400).json({ ok: false, error: "model/key missing" });
      return;
    }
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with exactly: OK" }], max_tokens: 5, temperature: 0 }),
        signal: controller.signal,
      });
      const latencyMs = Date.now() - started;
      let snippet = "";
      let errText = "";
      try {
        const j = (await r.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
        snippet = String(j.choices?.[0]?.message?.content ?? "").slice(0, 40);
        errText = String(j.error?.message ?? "");
      } catch {
        /* body parse fail */
      }
      res.json({ ok: r.ok, status: r.status, latencyMs, model, snippet, error: errText || undefined });
    } catch (e) {
      res.json({ ok: false, status: 0, latencyMs: Date.now() - started, model, error: e instanceof Error && e.name === "AbortError" ? `timeout>${timeoutMs}ms` : "network" });
    } finally {
      clearTimeout(timer);
    }
  });

  /* Round-18k: which build is live (compare with the header tag in the UI). */
  app.get("/api/version", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      commit: (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "").slice(0, 7) || null,
      service: process.env.RENDER_SERVICE_NAME ?? null,
      startedAt: SERVER_STARTED_AT,
      primaryModel: process.env.NVIDIA_MODEL ?? null,
      fallbackModel: process.env.NVIDIA_FALLBACK_MODEL ?? null,
      node: process.version,
    });
  });

  app.get("/api/health", (_req, res) => {
    const p = getProvider();
    const block = railcoreBlockState();
    res.json({
      ok: true,
      provider: p.id,
      mock: p.mock,
      fallback: railcoreIsPrimary() ? "railkit" : null,
      railcore: block.blocked
        ? { blocked: true, reason: block.reason, until: new Date(block.until).toISOString() }
        : { blocked: false },
      agent: { auto: (process.env.AGENT_AUTO ?? "1").trim() !== "0", model: env.agentModel },
      /* Round-16o: optional extra fallback APIs — sirf configured flag (key kabhi nahi). */
      extraProviders: { railradar: Boolean(env.railradarApiKey), indianrailapi: Boolean(env.indianRailApiKey) },
    });
  });

  app.get("/api/meta", (_req, res) => {
    const p = getProvider();
    res.json({
      provider: { id: p.id, name: p.displayName, mock: p.mock, fallback: railcoreIsPrimary() ? "railkit" : null },
      serviceFee: env.serviceFee,
    });
  });

  app.post("/api/understand", async (req, res, next) => {
    try {
      const text = String(req.body?.text ?? "").trim();
      if (!text) {
        res.status(400).json({ error: "text is required." });
        return;
      }
      const lastFactTrain = typeof req.body?.lastFactTrain === "string" ? req.body.lastFactTrain : "";
      const groundWant = shouldGroundFact(text, lastFactTrain);
      const schedP =
        groundWant && !process.env.VITEST
          ? routedSchedule(groundWant.train).catch(() => ({ schedule: null, provider: "none" as const }))
          : null;
      const result = await runUnderstand({
        text,
        lastAsked: req.body?.lastAsked ?? null,
        known: req.body?.known ?? {},
        now: req.body?.now,
      });
      let groundedReply: string | null = null;
      let groundedTrain: string | null = null;
      let groundedMs = 0;
      if (schedP && groundWant && result.nlu.intent !== "OUT_OF_DOMAIN") {
        const routed = await schedP;
        const evidence = compactScheduleEvidence(routed.schedule);
        if (evidence) {
          const now = req.body?.now ? new Date(req.body.now) : new Date();
          const grounded = await answerFromEvidence({
            question: text,
            evidence,
            today: todayYmdFrom(now),
          });
          groundedMs = grounded.latencyMs;
          if (grounded.reply) {
            groundedReply = grounded.reply;
            groundedTrain = groundWant.train;
          }
        }
      }
      res.json({
        nlu: result.nlu,
        source: result.source,
        provider: result.provider,
        missingFields: result.missingFields,
        modelUsed: result.modelUsed,
        fallbackAttempt: result.fallbackAttempt,
        latencyMs: result.latencyMs + groundedMs,
        failureReason: result.failureReason,
        groundedReply,
        groundedTrain,
      });
    } catch (err) {
      next(err);
    }
  });

  /* Round-18m-29: shared runner — wraps runAgent in a per-turn perf scope (same-turn dedup +
   * limiter + metrics + real progress). Freshness: scope dies with the turn; nothing is reused
   * across enquiries. */
  const runAgentTurn = (body: Record<string, unknown>, onProgress?: (e: ProgressEvent) => void) =>
    runTurnScope(async (scope) => {
      progress("Understanding your request");
      const result = await runAgent({
        text: String(body?.text ?? "").trim(),
        lastAsked: (body?.lastAsked as never) ?? null,
        known: (body?.known as never) ?? {},
        context: body?.context as never,
        now: body?.now as never,
        bookingFlow: body?.bookingFlow as never,
        history: Array.isArray(body?.history)
          ? (body.history as { role?: unknown; content?: unknown }[])
              .filter(
                (h): h is { role: "user" | "assistant"; content: string } =>
                  (h?.role === "user" || h?.role === "assistant") &&
                  typeof h?.content === "string" &&
                  h.content.trim().length > 0,
              )
              .slice(-10)
          : undefined,
      });
      progress("Preparing results");
      /* ── 24 Sep 2026: seat intent (server-side) ─────────────────────────────────────────────
       * User: "12029 ki seat availability CC …" par AI ne seat nahi batayi, aur "AC trains dikhao"
       * par 2S/SL bhi aa gayi. Yahan sirf TEEN kaam hote hain:
       *   1) bhasha padhna (parseSeatIntent — koi LLM/tool call nahi),
       *   2) jo route-board abhi bana hai usi par filter (seatFilterFor — wahi routedRouteBoard),
       *   3) jawab ke saath ek honest line lagana / provider fail par deterministic seat jawab.
       * AI ka search karne ka way, tools calling, API calling, alternatives + connecting logic —
       * sab waisa hi hai. Flag: SEAT_FILTER_SERVER (default ON).
       */
      let seatFilter: SeatFilterResult | null = null;
      let seatClassCodes: string[] = [];
      /* Round-26: "sirf available" maanga gaya hai ya nahi — default false (saari trains, WL bhi). */
      let seatOnlyAvailable = false;
      if (env.seatFilterServer) {
        const slots = parseSeatIntent(String(body?.text ?? ""));
        seatClassCodes = slots.classCodes;
        seatOnlyAvailable = slots.onlyAvailable;
        const from = result.nlu?.from?.code ?? (body?.known as { from?: { code?: string } } | undefined)?.from?.code ?? null;
        const to = result.nlu?.to?.code ?? (body?.known as { to?: { code?: string } } | undefined)?.to?.code ?? null;
        const date = result.nlu?.date ?? (body?.known as { date?: string } | undefined)?.date ?? null;
        if (slots.seatIntent && from && to && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
          seatFilter = await seatFilterFor({ from, to, date, slots }).catch(() => null);
        }
        /* User ne train number boli ho ("12029 ki seat availability") → us train ki row pehle. */
        const askedTrain = result.nlu?.trainNumber ?? null;
        if (seatFilter && askedTrain) {
          const hit = seatFilter.rows.filter((r) => r.number === askedTrain);
          if (hit.length) seatFilter = { ...seatFilter, rows: [...hit, ...seatFilter.rows.filter((r) => r.number !== askedTrain)] };
        }
      }
      /* 24 Sep 2026: agar AI ne KHUD findSeats/FIND_SEATS call karke jawab likha hai to uske upar
       * duplicate deterministic line nahi lagate (warna do jawab dikhte hain). Tool fail hua ya
       * call hua hi nahi → purani line hi safety net rehti hai. */
      const aiUsedSeatTool = Boolean(
        (result.toolTrace ?? []).some((t) => String((t as { tool?: string }).tool ?? "").toUpperCase() === "FIND_SEATS") ||
          String(result.tool ?? "").toLowerCase() === "findseats",
      );
      /* Round-19 (user: "kal subha ki trains btao" par poori din ki list aa gayi): jab jawab ke saath
       * journey/plan CARD aata hai, AI ka lamba text card ke andar "AI note" me collapse ho jata hai —
       * isliye seat line (💺 …) hamesha upar dikhni chahiye. Warna AI ke tool-call wale jawab me
       * seat ka asli jawab chhup jaata hai. Bina card wale sawaal par purana rule hi (duplicate nahi). */
      const hasPlanCard = Boolean(result.journey || result.alternatives);
      const seatLine = aiUsedSeatTool && !hasPlanCard ? null : seatFilter?.line ?? null;
      /* ── Round-25 (26 Sep, user screenshot: "Yeh baki trains seat finder card mein kyu le jaata?
       * last line dekho") ─────────────────────────────────────────────────────────────────────
       * Chat me Seat Finder card Round-21c se dikhta hi nahi, par AI apne jawab me "+N aur … Seat
       * Finder card mein hain" likh deta tha (us line ka source seatFilter ke summary me tha) —
       * yaani pointer jhootha. Ab: jo seat-wali trains AI ke jawab me nahi aayi, unki asli lines
       * (wahi live board rows) usi jawab me jod di jaati hain — koi card, koi andaza nahi. */
      /* Sirf tab jab AI ka apna jawab hai — AI fail hone par wahi compact seat line (💺 …) dikhti hai,
       * usme saari trains pehle se hain, isliye rows dobara nahi jodte. */
      const aiReplyText = String(result.reply ?? "").trim();
      /* Sirf wahi rows jo query ne maangi thi (seatFilter.rows) — WL/N-A rows alag se nahi thopte,
       * warna "seat wali trains" ke jawab me 18 lines aa jaati hain (live check me dikha). Agar user
       * ne WL bhi poochha ho (only_available=false) to rows me WL pehle se hote hain. */
      const seatExtra =
        seatFilter && !hasPlanCard && aiReplyText
          ? missingSeatLines(
              aiReplyText,
              /* Round-26: jab user ne sirf-available nahi maanga, WL/N-A rows bhi usi jawab me aati hain. */
              seatOnlyAvailable ? seatFilter.rows : [...seatFilter.rows, ...seatFilter.wlRows],
            )
          : [];
      const replyWithSeats =
        seatExtra.length > 0
          ? `${String(result.reply ?? "").trim()}\n${seatExtra.join("\n")}`.trim()
          : result.reply;
      /* AI ne jawab nahi diya (ya generic "provider se nahi mil" line di) → seat line akele bhi kaafi hai. */
      const aiFailed =
        !result.reply ||
        /jawab nahi aa paya|jawaab nahi aa paya|gadh ke nahi bataunga|provider se nahi mil/i.test(String(result.reply ?? ""));
      return {
        nlu: result.nlu,
        source: result.source,
        context: result.context,
        tool: result.tool,
        toolOk: result.toolOk,
        /* Seat line AI ke jawab ke SAATH (ya AI fail ho to akele) — dono case me asli board data. */
        reply: seatLine
          ? replyWithSeats
            ? `${replyWithSeats}\n\n${seatLine}`
            : seatLine
          : replyWithSeats,
        seatFilter: seatFilter
          ? {
              classCodes: seatClassCodes,
              line: seatLine,
              rows: seatFilter.rows,
              wlRows: seatFilter.wlRows,
              trainsSeen: seatFilter.trainsSeen,
              source: seatFilter.source,
            }
          : null,
        seatFilterFallback: Boolean(seatLine && aiFailed),
        interrupt: result.interrupt,
        resumeAsk: result.resumeAsk,
        resumeText: result.resumeText,
        confirmBook: false,
        missingFields: result.missingFields,
        modelUsed: result.modelUsed,
        modelFallbacks: result.modelFallbacks ?? [],
        latencyMs: result.latencyMs,
        failureReason: result.failureReason,
        engine: result.engine ?? null,
        toolTrace: result.toolTrace ?? null,
        trains: result.trains ?? null,
        journey: result.journey ?? null,
        alternatives: result.alternatives ?? null,
        trainPicker: result.trainPicker ?? null,
        choice: result.choice ?? null,
        liveDates: result.liveDates ?? null,
        /* Round-32: model ka chuna hua agla kadam (client chips me dikhata hai).
         * Round-32b: board ke numbers se takraane wale numbers chip se hata diye jaate hain —
         * action model ka hi rehta hai, par ek screen par do alag number nahi dikhte. */
        nextActions: reconcileNextActions(result.nextActions ?? null, [
          ...(seatFilter?.rows ?? []),
          ...(seatFilter?.wlRows ?? []),
        ]),
        grounded: result.grounded ?? null,
        agenticFailureReason: (result as { agenticFailureReason?: string | null }).agenticFailureReason ?? null,
        perf: summarize(scope),
      };
    }, onProgress);

  app.post("/api/agent", async (req, res, next) => {
    try {
      const text = String(req.body?.text ?? "").trim();
      if (!text) {
        res.status(400).json({ error: "text is required." });
        return;
      }
      res.json(await runAgentTurn(req.body ?? {}));
    } catch (err) {
      next(err);
    }
  });

  /* Round-18m-29: same turn over SSE — `progress` events are REAL backend milestones
   * (phase names + completed/total provider checks), then one `result` event with the exact
   * payload /api/agent would have returned. */
  app.post("/api/agent/stream", async (req, res) => {
    const text = String(req.body?.text ?? "").trim();
    if (!text) {
      res.status(400).json({ error: "text is required." });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    const send = (event: string, data: unknown) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const keepAlive = setInterval(() => { if (!res.writableEnded) res.write(": ping\n\n"); }, 15000);
    try {
      const result = await runAgentTurn(req.body ?? {}, (e) => send("progress", e));
      send("result", result);
    } catch (err) {
      send("error", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      clearInterval(keepAlive);
      res.end();
    }
  });

  /**
   * Autonomous agent: NVIDIA model decides which railway tools to call, the server runs them
   * against RailCore/RailKit, and the reply is checked against tool evidence before it is sent.
   * Never books. Never charges. Falls back (fallback:true) when the model is unusable.
   */
  app.post("/api/agent/auto", async (req, res, next) => {
    try {
      const text = String(req.body?.text ?? "").trim();
      if (!text) {
        res.status(400).json({ error: "text is required." });
        return;
      }
      const result = await runAutonomousAgent({
        text,
        history: Array.isArray(req.body?.history) ? req.body.history : [],
        state: req.body?.state ?? null,
        now: typeof req.body?.now === "string" ? req.body.now : undefined,
        today: typeof req.body?.today === "string" ? req.body.today : undefined,
        model: typeof req.body?.model === "string" ? req.body.model : undefined,
      });
      res.json({ ...result, confirmBook: false });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/admin/models", async (req, res, next) => {
    try {
      const refresh = String(req.query.refresh ?? "") === "1";
      const catalog = refresh ? await refreshNvidiaCatalog() : await getNvidiaCatalog();
      res.json(publicNvidiaPayload(catalog));
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/admin/nvidia", async (req, res, next) => {
    try {
      const refresh = String(req.query.refresh ?? "") === "1";
      const catalog = refresh ? await refreshNvidiaCatalog() : await getNvidiaCatalog();
      res.json(publicNvidiaPayload(catalog));
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/admin/nvidia/refresh", async (_req, res, next) => {
    try {
      const catalog = await refreshNvidiaCatalog();
      res.json(publicNvidiaPayload(catalog));
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/admin/models/refresh", async (_req, res, next) => {
    try {
      const catalog = await refreshNvidiaCatalog();
      res.json(publicNvidiaPayload(catalog));
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/stations", async (req, res, next) => {
    try {
      const q = String(req.query.q ?? "");
      if (railcoreIsPrimary()) {
        const result = await routedStationSearch(q);
        res.json(result);
        return;
      }
      const p = getProvider();
      if (p.id === "railkit") {
        res.json({ stations: await searchRailkitStations(q), needChoice: false, provider: "railkit" });
        return;
      }
      res.json({ stations: searchLocalStations(q), needChoice: false, provider: "local" });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/trains", async (req, res, next) => {
    try {
      const from = String(req.query.from ?? "").toUpperCase();
      const to = String(req.query.to ?? "").toUpperCase();
      const date = String(req.query.date ?? "");
      if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ error: "from, to and date are required." });
        return;
      }
      if (from === to) {
        res.status(400).json({ error: "From and To must be different." });
        return;
      }
      if (isPastDate(date)) {
        res.status(400).json({ error: "Choose today or a future date." });
        return;
      }
      const trains = await getProvider().searchTrains({ from, to, date });
      res.json({
        trains,
        recommendations: recommend(trains),
        empty: trains.length === 0,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/live", async (req, res, next) => {
    try {
      const number = String(req.query.number ?? "");
      const date = String(req.query.date ?? "");
      if (!number) {
        res.status(400).json({ error: "number is required." });
        return;
      }
      const routed = await routedLiveStatus(number, /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined);
      if (!routed.live) {
        res.status(404).json({ error: "Live railway data is temporarily unavailable." });
        return;
      }
      res.json({ live: routed.live, provider: routed.provider });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/schedule", async (req, res, next) => {
    try {
      const number = String(req.query.number ?? "");
      if (!number) {
        res.status(400).json({ error: "number is required." });
        return;
      }
      const routed = await routedSchedule(number);
      if (!routed.schedule) {
        res.status(404).json({ error: "Timetable not available." });
        return;
      }
      res.json({
        schedule: {
          trainNumber: routed.schedule.trainNumber,
          trainName: routed.schedule.trainName,
          stops: routed.schedule.stops,
        },
        provider: routed.provider,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/history", async (req, res, next) => {
    try {
      const number = String(req.query.number ?? "");
      const date = String(req.query.date ?? "");
      if (!number || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ error: "number and date (YYYY-MM-DD) are required." });
        return;
      }
      /* Round-16p-2: RailKit → RailCore stations[] → RailRadar route[] */
      const history = await routedTrainHistory(number, date);
      if (!history) {
        res.status(404).json({ error: "Train history not available." });
        return;
      }
      res.json({ history });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/station-board", async (req, res, next) => {
    try {
      const code = String(req.query.code ?? "");
      const hours = Number(req.query.hours ?? 2);
      if (!code) {
        res.status(400).json({ error: "code is required." });
        return;
      }
      const board = await stationBoard(code, hours);
      if (!board) {
        res.status(404).json({ error: "Station board not available." });
        return;
      }
      res.json({ board });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/pnr-status", async (req, res, next) => {
    try {
      const pnr = String(req.query.pnr ?? "").trim();
      if (!pnr) {
        res.status(400).json({ error: "PNR is required." });
        return;
      }
      const remote = await routedPnr(pnr);
      if (remote) {
        res.json({ pnr: { pnr: remote.pnr, data: remote.data }, provider: "railkit" });
        return;
      }
      const local = await getProvider().getBooking(pnr);
      if (local) {
        res.json({ pnr: { pnr, booking: local }, provider: "local" });
        return;
      }
      res.status(404).json({ error: "PNR status is temporarily unavailable." });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/trains/:number/live", async (req, res, next) => {
    try {
      const date = String(req.query.date ?? "");
      const routed = await routedLiveStatus(String(req.params.number), /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined);
      if (!routed.live) {
        res.status(404).json({ error: "Live railway data is temporarily unavailable." });
        return;
      }
      res.json({ live: routed.live, provider: routed.provider });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/trains/:number/schedule", async (req, res, next) => {
    try {
      const routed = await routedSchedule(String(req.params.number));
      if (!routed.schedule) {
        res.status(404).json({ error: "Timetable not available." });
        return;
      }
      res.json({
        schedule: {
          trainNumber: routed.schedule.trainNumber,
          trainName: routed.schedule.trainName,
          stops: routed.schedule.stops,
        },
        provider: routed.provider,
      });
    } catch (err) {
      next(err);
    }
  });

  async function coachPositionReply(trainNumber: string, station: string, res: express.Response) {
    const routed = await routedCoachPosition(
      trainNumber,
      /^[A-Z]{2,6}$/.test(station.trim().toUpperCase()) ? station.trim().toUpperCase() : undefined,
    );
    if (!routed.coachPosition) {
      res.status(404).json({ error: "Coach position provider se nahi aayi. Main fake layout nahi dikhaunga." });
      return;
    }
    res.json({ coachPosition: routed.coachPosition, provider: routed.provider });
  }

  // Flat route: Vercel serverless routing sirf 1-segment /api/* paths function tak
  // pahunchata hai (isi liye /api/live, /api/schedule bhi flat hain).
  app.get("/api/coach-position", async (req, res, next) => {
    try {
      const number = String(req.query.number ?? "").trim();
      if (!/^[0-9]{4,6}$/.test(number)) {
        res.status(400).json({ error: "Valid train number is required." });
        return;
      }
      await coachPositionReply(number, String(req.query.station ?? ""), res);
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/trains/:number/coach-position", async (req, res, next) => {
    try {
      await coachPositionReply(String(req.params.number), String(req.query.station ?? ""), res);
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/stations/:code/live", async (req, res, next) => {
    try {
      const hours = Number(req.query.hours ?? 2);
      const board = await stationBoard(String(req.params.code), hours);
      if (!board) {
        res.status(404).json({ error: "Station board not available." });
        return;
      }
      res.json({ board });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/trains/:number/history", async (req, res, next) => {
    try {
      const date = String(req.query.date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ error: "date (YYYY-MM-DD) is required." });
        return;
      }
      const history = await routedTrainHistory(String(req.params.number), date);
      if (!history) {
        res.status(404).json({ error: "Train history not available." });
        return;
      }
      res.json({ history });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/cancelled", async (_req, res, next) => {
    try {
      const list = await routedCancelled();
      if (!list) {
        res.status(404).json({ error: "Cancellation information is temporarily unavailable." });
        return;
      }
      res.json({ cancelled: list, provider: "railkit" });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/pnr/:pnr", async (req, res, next) => {
    try {
      const pnr = String(req.params.pnr ?? "").trim();
      if (!pnr) {
        res.status(400).json({ error: "PNR is required." });
        return;
      }
      const remote = await routedPnr(pnr);
      if (remote) {
        res.json({ pnr: { pnr: remote.pnr, data: remote.data }, provider: "railkit" });
        return;
      }
      const local = await getProvider().getBooking(pnr);
      if (local) {
        res.json({ pnr: { pnr, booking: local }, provider: "local" });
        return;
      }
      res.status(404).json({ error: "PNR status is temporarily unavailable." });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/availability", async (req, res, next) => {
    try {
      const trainNumber = String(req.query.trainNumber ?? "");
      const date = String(req.query.date ?? "");
      const from = String(req.query.from ?? "");
      const to = String(req.query.to ?? "");
      const rawClass = String(req.query.classCode ?? "").trim();
      const quota = String(req.query.quota ?? "GN").trim() || "GN";
      /* 23 Sep 2026 (user: "chat/list me seats nahi aa rahi, cards me aa rahi"):
       * ROUTE-LEVEL board — trainNumber ke bina from+to+date do to ek hi call me
       * poore route ke saare trains × classes (ConfirmTkt board: AVL/WL/RAC/
       * Regret/Cancelled + fare + confirm%). App/list isse saari stuck rows
       * ek request me bhar sakti hai. */
      if (!trainNumber.trim() && from && to && date) {
        /* trains= (optional): client ke list rows — jo CT board me na hon unke
         * liye honest note (unreserved/MEMU) bhi isi call me aa jata hai. */
        const extraTrains = String(req.query.trains ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        const board = await routedRouteBoard(from, to, date, extraTrains);
        res.json(
          board
            ? { trains: board.trains, source: board.provider, at: new Date(board.at).toISOString() }
            : { trains: [], source: "none" },
        );
        return;
      }
      if (!rawClass) {
        const hintClasses = String(req.query.classes ?? "")
          .split(",")
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean);
        if (railcoreIsPrimary()) {
          const board = await routedClassBoard(trainNumber, date, from, to, quota, hintClasses).catch(() => ({
            classes: [] as never[],
            provider: "none" as const,
            note: undefined as string | undefined,
          }));
          /* Honest empty: 200 + khaali board (row retry karti rahe, error na dikhe).
           * note = unreserved (MEMU) jaise cases ka honest label. */
          res.json({ classes: board.classes, source: board.provider, ...(board.note ? { note: board.note } : {}) });
          return;
        }
        const p = getProvider();
        const classes = p.id === "railkit" ? await loadClassBoard(trainNumber, date, from, to, quota).catch(() => []) : [];
        res.json({ classes, source: p.id });
        return;
      }
      const klass = classCode.parse(rawClass);
      const row = await getProvider()
        .getAvailability(trainNumber, date, from, to, klass, quota)
        .catch(() => ({ code: klass, label: klass, status: "UNKNOWN" as const, fare: 0 }));
      res.json({ availability: row, bookable: isBookable(row.status) });
    } catch (err) {
      next(err);
    }
  });

  /* ---------- Round-17: Journey intelligence (deterministic engine, real data only) ---------- */
  const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const stnSchema = z.string().trim().regex(/^[A-Za-z0-9]{2,5}$/).transform((v) => v.toUpperCase());
  const clsSchema = z.string().trim().regex(/^[A-Za-z0-9]{1,3}$/).transform((v) => v.toUpperCase());
  const journeyPlanBody = z.object({
    from: stnSchema,
    to: stnSchema,
    date: ymdSchema,
    travelClass: clsSchema.nullish(),
    preference: z.enum(["best_overall", "fastest", "direct", "fewest_changes", "best_availability", "cheapest", "earliest"]).nullish(),
    includeConnections: z.boolean().nullish(),
    includeAlternativeDates: z.boolean().nullish(),
  });
  app.post("/api/journey/plan", async (req, res, next) => {
    try {
      const b = journeyPlanBody.parse(req.body ?? {});
      const plan = await planJourney({
        from: b.from,
        to: b.to,
        date: b.date,
        travelClass: b.travelClass ?? null,
        preference: b.preference ?? "best_overall",
        includeConnections: b.includeConnections ?? true,
        includeAlternativeDates: b.includeAlternativeDates ?? true,
      });
      res.json(plan);
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/journey/vacant", async (req, res, next) => {
    try {
      const b = z.object({ trainNumber: z.string().regex(/^\d{5}$/), from: stnSchema, to: stnSchema, date: ymdSchema, travelClass: clsSchema.nullish() }).parse(req.body ?? {});
      res.json(await findVacantSeats({ trainNumber: b.trainNumber, origin: b.from, destination: b.to, date: b.date, travelClass: b.travelClass ?? null }));
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/journey/partial", async (req, res, next) => {
    try {
      const b = z.object({ trainNumber: z.string().regex(/^\d{5}$/), from: stnSchema, to: stnSchema, date: ymdSchema, travelClass: clsSchema }).parse(req.body ?? {});
      res.json(await findPartialRouteSeats({ trainNumber: b.trainNumber, origin: b.from, destination: b.to, date: b.date, classCode: b.travelClass }));
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/journey/alternatives", async (req, res, next) => {
    try {
      const b = z
        .object({
          trainNumber: z.string().regex(/^\d{5}$/),
          from: stnSchema,
          to: stnSchema,
          date: ymdSchema,
          travelClass: clsSchema.nullish(),
          /* Round-18e: client already holds a provider-verified row for this train/class (TrainBoard cell) — reuse it, no second probe / drift. */
          knownRow: z
            .object({ status: z.string(), seats: z.number().nullish(), waitlist: z.number().nullish(), rac: z.number().nullish(), source: z.string().nullish() })
            .nullish(),
        })
        .parse(req.body ?? {});
      res.json(await findAlternativeTrains({ trainNumber: b.trainNumber, origin: b.from, destination: b.to, date: b.date, travelClass: b.travelClass ?? null, knownRow: b.knownRow ?? null }));
    } catch (err) {
      next(err);
    }
  });
  /* Round-18: smart train picker (number or name → real validated matches). */
  app.get("/api/trains/pick", async (req, res, next) => {
    try {
      const q = String(req.query.q ?? "").trim();
      if (q.length < 3) {
        res.json({ query: q, kind: "name", matches: [], single: false, source: "none", note: "Query too short." });
        return;
      }
      const from = String(req.query.from ?? "").trim().toUpperCase() || null;
      const to = String(req.query.to ?? "").trim().toUpperCase() || null;
      res.json(await pickTrains(q, { context: { from, to }, limit: 6 }));
    } catch (err) {
      next(err);
    }
  });
  /* Round-18: provider capability registry (public, no secrets). */
  app.get("/api/capabilities", (_req, res) => {
    res.json(publicCapabilityPayload());
  });
  app.post("/api/journey/connections", async (req, res, next) => {
    try {
      const b = z.object({ from: stnSchema, to: stnSchema, date: ymdSchema, via: stnSchema.nullish() }).parse(req.body ?? {});
      const c = await findConnections(b.from, b.to, b.date, { hubs: b.via ? [b.via] : undefined, maxHubs: b.via ? 1 : 3 });
      res.json({ connections: c.connections, hubsTried: c.hubsTried, sources: [...c.sources], minTransferMinutes: JOURNEY_CONFIG.minTransferMinutes, maxLayoverMinutes: JOURNEY_CONFIG.maxLayoverMinutes });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/fare", async (req, res, next) => {
    try {
      const fare = await getProvider().getFare(
        String(req.query.trainNumber ?? ""),
        String(req.query.date ?? ""),
        String(req.query.from ?? ""),
        String(req.query.to ?? ""),
        classCode.parse(String(req.query.classCode ?? "")),
        Number(req.query.passengers ?? 1),
      );
      res.json({ fare });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/berths", (req, res) => {
    const klass = classCode.parse(String(req.query.classCode ?? "SL"));
    res.json({ options: BERTH_OPTIONS[klass as ClassCode] });
  });

  /* Round-7 diagnostics: prod datacenter se kaunsi scrape-site reachable hai.
   * Fixed targets only (no params — SSRF nahi), read-only. */
  /* Round-16: booking-critical web fallbacks ka prod-side reachability probe.
   * Har source ko actual scraper function se hit karta hai (same headers,
   * same parser) taaki "Render ke IP se chalta hai ya nahi" ka pakka jawab mile. */
  /* 23 Sep 2026: train facts (Wikipedia) — provider chain ke baad last-resort
   * reference. Koi seat/fare ka dawa nahi, sirf verified page summary. */
  /* Round-20 (25 Sep, user: "jis train mein catering hai usmein catering rakho"): pantry/catering
   * info passenger form me dikhani hai. Ye ENDPOINT SIRF READ-ONLY hai — wahi maujooda function
   * (scrapeTrainFactsWeb: erail + confirmtkt) call karta hai jo AI ka TRAIN_FACTS tool pehle se
   * use karta hai. Koi naya source/logic nahi, kuch badla nahi. */
  app.get("/api/trains/:number/pantry", async (req, res, next) => {
    try {
      const number = String(req.params.number ?? "").replace(/\D/g, "").slice(0, 5);
      if (!number) {
        res.status(400).json({ error: "train number required" });
        return;
      }
      const facts = await scrapeTrainFactsWeb(number).catch(() => null);

      /* ── Round-21b (25 Sep, user: "jo real provider se aa raha hai wahi dikhao, kuch bhi fake nahi") ──
       * Pehle hum erail ka `pantry` hi seedha UI ko de dete the — aur 12716/12926 jaise trains par
       * RailBook ka "Food choice" dikh raha tha jabki IRCTC ke us booking page par wo option hi nahi hota.
       * Ab do cheezein alag-alag aur bina milaawat ke bheji jaati hain:
       *   sources.erail / sources.confirmtkt — dono ka apna jawaab (null = us source ne kuch nahi kaha)
       *   conflict — dono alag-alag keh rahe hain (guess nahi karenge, honest note denge)
       *   premiumCatering — Rajdhani/Shatabdi/Duronto/Vande Bharat/Tejas: in me catering fare me shamil
       *     hoti hai (erail ka "pantry car" field in par meaningless hai, isliye ye strong signal hai)
       *   foodChoiceExpected — sirf yahi par passenger form me Food choice dikhta hai (IRCTC jaisa),
       *     warna honest line. Koi naya source/logic nahi — wahi maujooda scrapeTrainFactsWeb. */
      const src = facts?.pantrySources ?? { erail: null, confirmtkt: null };
      const positives = [src.erail === true, src.confirmtkt === true].filter(Boolean).length;
      const negatives = [src.erail === false, src.confirmtkt === false].filter(Boolean).length;
      const conflict = positives > 0 && negatives > 0;
      const hay = `${facts?.trainType ?? ""} ${facts?.trainName ?? ""}`.replace(/jan\s*shatabdi/gi, " ");
      const premiumCatering = /rajdhani|shatabdi|duronto|vande\s*bharat|tejas/i.test(hay);
      /* Premium par catering fare me included hoti hai (erail ka pantry-car field uske against nahi);
       * baaki trains par dono sources ka ek hi jawaab chahiye — warna kuch nahi dikhate. */
      const foodChoiceExpected = premiumCatering || (positives > 0 && !conflict);

      const evidence: string[] = [];
      if (premiumCatering) evidence.push(`${facts?.trainType ?? facts?.trainName ?? "premium train"} — catering fare me included`);
      if (src.erail != null) evidence.push(`erail (IR timetable): pantry ${src.erail ? "available" : "not available"}`);
      if (src.confirmtkt != null) evidence.push(`confirmtkt: HasPantry ${src.confirmtkt ? "true" : "false"}`);

      const note = foodChoiceExpected
        ? null
        : conflict
          ? `catering data me sources alag-alag hain (${evidence.join(" · ")}) — isliye RailBook khud koi Food choice nahi dikhata; IRCTC booking page par jo dikhe wahi final`
          : negatives > 0
            ? `is train me pantry/catering nahi mili (${evidence.join(" · ")})`
            : "catering info provider se nahi aayi";

      res.json({
        trainNumber: number,
        trainName: facts?.trainName ?? null,
        trainType: facts?.trainType ?? null,
        pantry: facts?.pantry ?? null,
        sources: src,
        conflict,
        premiumCatering,
        foodChoiceExpected,
        evidence,
        providers: facts?.providers ?? [],
        note,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/trains/:number/facts", async (req, res, next) => {
    try {
      const number = String(req.params.number ?? "").trim();
      const facts = await routedTrainFacts(number);
      res.json({ trainNumber: number, facts: facts ?? null, source: facts ? "web_wikipedia" : "none" });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/debug/web-fallback-health", async (req, res) => {
    const ws = await import("./railway/webscrape.js");
    const train = String(req.query.train ?? "12014");
    const from = String(req.query.from ?? "ASR").toUpperCase();
    const to = String(req.query.to ?? "NDLS").toUpperCase();
    const cls = String(req.query.cls ?? "CC").toUpperCase();
    const date = String(req.query.date ?? new Date(Date.now() + 86400e3).toISOString().slice(0, 10));
    const timed = async <T,>(label: string, fn: () => Promise<T | null>, pick: (v: NonNullable<T>) => unknown) => {
      const t = Date.now();
      try {
        const v = await fn();
        return { label, ok: v != null && (!Array.isArray(v) || v.length > 0), latencyMs: Date.now() - t, sample: v == null ? null : pick(v as NonNullable<T>) };
      } catch (err) {
        return { label, ok: false, latencyMs: Date.now() - t, error: String(err).slice(0, 200) };
      }
    };
    const [availability, fareRoute, stationCode, stationName, liveRailEnquiry, liveRailYatri, schedule] = await Promise.all([
      timed("seat_availability (sa.railyatri.in)", () => ws.scrapeSeatAvailabilityWeb(train, date, from, to, cls), (v) => v),
      timed("fare_route (erail.in)", () => ws.scrapeTrainFareWeb(train), (v) => ({ classes: v.classes })),
      timed("station_code (railenquiry.in)", () => ws.scrapeStationLookupWeb("PGW"), (v) => v),
      timed("station_name (erail stations.js)", () => ws.scrapeStationSearchWeb("phagwara"), (v) => v.slice(0, 3)),
      timed("live_status (railenquiry.in)", () => ws.scrapeLiveStatusRailEnquiry(train), (v) => ({ status: v.status, currentStation: v.currentStation, lastUpdatedAt: v.lastUpdatedAt })),
      timed("live_status (railyatri.in)", () => ws.scrapeLiveStatusWeb(train, null), (v) => ({ status: v.status, currentStation: v.currentStation })),
      timed("schedule (ixigo/confirmtkt/trainspnrstatus)", () => ws.scrapeTrainScheduleWeb(train), (v) => ({ name: v.trainName, stops: v.stops?.length, provider: v.provider })),
    ]);
    const checks = [availability, fareRoute, stationCode, stationName, liveRailEnquiry, liveRailYatri, schedule];
    res.json({
      from: "render-prod",
      at: new Date().toISOString(),
      probe: { train, from, to, cls, date },
      okCount: checks.filter((c) => c.ok).length,
      total: checks.length,
      checks,
    });
  });

  app.get("/api/debug/scrape-health", async (_req, res) => {
    /* (a) REAL production path — scrapeTrainFareWeb (fetchHtml full fingerprint) */
    const t1 = Date.now();
    const { scrapeTrainFareWeb, parseErailFare } = await import("./railway/webscrape.js");
    const real = await scrapeTrainFareWeb("12054");
    const realResult = {
      latencyMs: Date.now() - t1,
      result: real ? { classes: real.classes } : null,
    };

    /* (b) same fetch, body captured + parseErailFare run inline — pinpoints
     * whether body differs ya parse fail. */
    const t2 = Date.now();
    let bodyProbe: Record<string, unknown>;
    try {
      const r = await fetch("https://erail.in/train-fare/12054", {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
          Referer: "https://erail.in/",
        },
        signal: AbortSignal.timeout(20000),
      });
      const body = await r.text();
      /* step-by-step parse diagnostics — kaunsa step fail ho raha hai */
      const marker = body.indexOf("Total fare for");
      const tblStart = marker >= 0 ? body.lastIndexOf("<table", marker) : -1;
      const tblEnd = tblStart >= 0 ? body.indexOf("</table>", tblStart) : -1;
      const tbl = tblStart >= 0 && tblEnd > tblStart ? body.slice(tblStart, tblEnd) : "";
      const rows = [...tbl.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((rm) =>
        [...rm[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cm) =>
          cm[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(),
        ),
      );
      bodyProbe = {
        httpStatus: r.status,
        latencyMs: Date.now() - t2,
        bodyLength: body.length,
        hasMarker: marker >= 0,
        markerIdx: marker,
        tblStart,
        tblEnd,
        rowCount: rows.length,
        rowCells: rows.slice(0, 10).map((c) => c.join(" | ").slice(0, 120)),
        parseResult: parseErailFare(body, "12054", "dbg"),
      };
    } catch (err) {
      bodyProbe = { error: String(err).slice(0, 300), latencyMs: Date.now() - t2 };
    }

    res.json({
      from: "render-prod",
      at: new Date().toISOString(),
      realScrapeTrainFareWeb: realResult,
      bodyProbe,
    });
  });

  app.get("/api/wallet", (_req, res) => {
    res.json({ wallet: getWallet() });
  });

  // User-authority only — never called from /api/agent or NVIDIA.
  app.post("/api/wallet/add", (req, res, next) => {
    try {
      const amount = Number(req.body?.amount);
      res.json({ wallet: addMoney(amount) });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/bookings", async (req, res, next) => {
    try {
      const body = z
        .object({
          trainNumber: z.string().min(3),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          from: z.string().min(2),
          to: z.string().min(2),
          classCode,
          seatPreference: z.string().min(1),
          passengers: z.array(passengerSchema).min(1).max(6),
        })
        .parse(req.body);
      const booking = await getProvider().createBooking(body);
      res.status(201).json({ booking });
    } catch (err) {
      next(err);
    }
  });

  // Deterministic money + booking authority. AI/orchestrator cannot reach this.
  app.post("/api/bookings/:id/confirm", async (req, res, next) => {
    try {
      const provider = getProvider();
      const existing = await provider.getBooking(req.params.id);
      if (!existing) {
        res.status(404).json({ error: "Booking not found." });
        return;
      }
      /* Idempotent duplicate-confirm guard: pehle se CONFIRMED booking par wallet debit aur
       * provider.confirmBooking() dobara NAHI — wahi record (same PNR) turant wapas. UI button
       * disable hone par bharosa nahi (direct API retry bhi safe). Terminal FAILED/CANCELLED
       * ka behaviour jaisa tha waisa hi hai. */
      if (existing.status === "CONFIRMED") {
        res.json({ booking: existing, wallet: getWallet() });
        return;
      }
      /* Atomic in-flight claim: has() aur set() ke beech koi await nahi — ek hi tick me decide
       * hota hai ki is booking ka confirmation kaun karega. Concurrent duplicate ko 409. */
      if (confirmInFlight.has(req.params.id)) {
        res.status(409).json({
          error: "Confirmation already in progress.",
          code: "CONFIRM_IN_PROGRESS",
        });
        return;
      }
      confirmInFlight.set(req.params.id, true);
      try {
        const wallet = getWallet();
        if (wallet.balance < existing.fare.total) {
          res.status(402).json({
            error: "Insufficient wallet balance.",
            code: "INSUFFICIENT_FUNDS",
            wallet,
            required: existing.fare.total,
          });
          return;
        }
        debit(existing.fare.total, `Booking ${existing.id}`);
        try {
          const booking = await provider.confirmBooking(req.params.id);
          if (booking.status !== "CONFIRMED") {
            credit(existing.fare.total, `Refund · ${existing.id} failed`);
          }
          res.json({ booking, wallet: getWallet() });
        } catch (err) {
          credit(existing.fare.total, `Refund · ${existing.id} error`);
          throw err;
        }
      } finally {
        confirmInFlight.delete(req.params.id);
      }
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/bookings", async (_req, res, next) => {
    try {
      res.json({ bookings: await getProvider().listBookings() });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/bookings/:id", async (req, res, next) => {
    try {
      const booking = await getProvider().getBooking(req.params.id);
      if (!booking) {
        res.status(404).json({ error: "Booking not found." });
        return;
      }
      res.json({ booking });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/bookings/:id/cancel", async (req, res, next) => {
    try {
      const result = await getProvider().cancelBooking(req.params.id);
      credit(result.refundAmount, `Refund · ${result.bookingId}`);
      res.json({ result, wallet: getWallet() });
    } catch (err) {
      next(err);
    }
  });

  if (env.nodeEnv === "production" && !process.env.VERCEL) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const dist = path.resolve(here, "../dist");
    /* Round-18k: hashed assets are immutable; index.html must NEVER be served
     * from a stale cache (user kept seeing an old UI after deploys). */
    app.use(
      express.static(dist, {
        index: false,
        setHeaders: (res, filePath) => {
          if (/[\\/]assets[\\/]/.test(filePath)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          else res.setHeader("Cache-Control", "no-cache");
        },
      }),
    );
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(path.join(dist, "index.html"));
    });
  }

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          error: err.issues[0]?.message ?? "Invalid request.",
          details: err.issues,
        });
        return;
      }
      const e = err as { status?: number; message?: string; code?: string };
      const status = e.status ?? 500;
      res.status(status).json({
        error: e.message ?? "Something went wrong.",
        code: e.code,
      });
    },
  );

  return app;
}
