import express from "express";
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
  routedStationSearch,
} from "./railway/router.js";
import { BERTH_OPTIONS, isBookable, type ClassCode } from "./providers/types.js";
import { recommend } from "./recommend.js";
import { addMoney, credit, debit, getWallet } from "./wallet.js";
import { isPastDate } from "./util.js";
import { runUnderstand } from "./understand/index.js";
import { runAgent } from "./agent/run.js";
import { runAutonomousAgent } from "./agent/autonomous.js";
import { railcoreBlockState } from "./railway/railcore.js";
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

  app.post("/api/agent", async (req, res, next) => {
    try {
      const text = String(req.body?.text ?? "").trim();
      if (!text) {
        res.status(400).json({ error: "text is required." });
        return;
      }
      const result = await runAgent({
        text,
        lastAsked: req.body?.lastAsked ?? null,
        known: req.body?.known ?? {},
        context: req.body?.context,
        now: req.body?.now,
        bookingFlow: req.body?.bookingFlow,
        history: Array.isArray(req.body?.history)
          ? (req.body.history as { role?: unknown; content?: unknown }[])
              .filter(
                (h): h is { role: "user" | "assistant"; content: string } =>
                  (h?.role === "user" || h?.role === "assistant") &&
                  typeof h?.content === "string" &&
                  h.content.trim().length > 0,
              )
              .slice(-10)
          : undefined,
      });
      res.json({
        nlu: result.nlu,
        source: result.source,
        context: result.context,
        tool: result.tool,
        toolOk: result.toolOk,
        reply: result.reply,
        interrupt: result.interrupt,
        resumeAsk: result.resumeAsk,
        resumeText: result.resumeText,
        confirmBook: false,
        missingFields: result.missingFields,
        modelUsed: result.modelUsed,
        latencyMs: result.latencyMs,
        failureReason: result.failureReason,
        engine: result.engine ?? null,
        toolTrace: result.toolTrace ?? null,
        trains: result.trains ?? null,
        grounded: result.grounded ?? null,
        agenticFailureReason: (result as { agenticFailureReason?: string | null }).agenticFailureReason ?? null,
      });
    } catch (err) {
      next(err);
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
      const history = await trainHistory(number, date);
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
      const history = await trainHistory(String(req.params.number), date);
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
      if (!rawClass) {
        const hintClasses = String(req.query.classes ?? "")
          .split(",")
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean);
        if (railcoreIsPrimary()) {
          const board = await routedClassBoard(trainNumber, date, from, to, quota, hintClasses);
          res.json({ classes: board.classes, source: board.provider });
          return;
        }
        const p = getProvider();
        const classes = p.id === "railkit" ? await loadClassBoard(trainNumber, date, from, to, quota) : [];
        res.json({ classes, source: p.id });
        return;
      }
      const klass = classCode.parse(rawClass);
      const row = await getProvider().getAvailability(
        trainNumber,
        date,
        from,
        to,
        klass,
        quota,
      );
      res.json({ availability: row, bookable: isBookable(row.status) });
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
    app.use(express.static(dist));
    app.get("*", (_req, res) => {
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
