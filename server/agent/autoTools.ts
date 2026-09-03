/**
 * Tool executor for the autonomous agent.
 * Every function here calls an EXISTING railway adapter (RailCore → RailKit fallback).
 * Nothing is synthesised: when a provider fails the result says so explicitly.
 */
import { getProvider } from "../providers/index.js";
import {
  getLastRailwayLog,
  routedCancelled,
  routedLiveStatus,
  routedPnr,
  routedSchedule,
  routedStationSearch,
  routedTrainInfo,
} from "../railway/router.js";
import { getWallet } from "../wallet.js";
import { isPastDate } from "../util.js";
import type { ClassCode, Station, TrainResult } from "../providers/types.js";
import { isForbiddenMoneyTool } from "./context.js";
import { isAutoTool, type AutoToolName } from "./toolSpecs.js";

const CLASS_CODES: ClassCode[] = ["1A", "2A", "3A", "3E", "SL", "CC", "EC", "2S", "EA"];

export type AutoToolResult = {
  name: string;
  ok: boolean;
  /** Compact JSON given back to the model. */
  payload: Record<string, unknown>;
  provider: string | null;
  latencyMs: number;
  /** Structured data kept for the UI (not necessarily shown to the model in full). */
  ui?: {
    trains?: TrainResult[];
    stations?: Station[];
    stationChoice?: { slot?: "from" | "to"; city: string; stations: Station[] };
    from?: Station;
    to?: Station;
    date?: string;
  };
};

function providerOf(fallback: string | null = null): string | null {
  return getLastRailwayLog()?.railwayProvider ?? fallback;
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

function code(v: unknown): string | undefined {
  const s = str(v);
  return s ? s.toUpperCase() : undefined;
}

function ymd(v: unknown): string | undefined {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

function trainNo(v: unknown): string | undefined {
  const s = str(v);
  const m = s?.match(/\d{5}/);
  return m ? m[0] : undefined;
}

function classCode(v: unknown): ClassCode | undefined {
  const s = code(v);
  return s && (CLASS_CODES as string[]).includes(s) ? (s as ClassCode) : undefined;
}

function fail(name: string, reason: string, started: number, extra: Record<string, unknown> = {}): AutoToolResult {
  return {
    name,
    ok: false,
    payload: { ok: false, error: reason, ...extra },
    provider: providerOf(),
    latencyMs: Date.now() - started,
  };
}

export async function runAutoTool(name: string, rawArgs: unknown): Promise<AutoToolResult> {
  const started = Date.now();
  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;

  if (isForbiddenMoneyTool(name)) {
    return fail(name, "forbidden: booking and wallet money moves happen only through the Confirm & Book UI", started);
  }
  if (!isAutoTool(name)) {
    return fail(name, "unknown_tool", started);
  }
  const tool: AutoToolName = name;

  try {
    switch (tool) {
      case "searchStations": {
        const q = str(args.query ?? args.q ?? args.city ?? args.name);
        if (!q) return fail(tool, "query required", started);
        const res = await routedStationSearch(q);
        const stations = res.stations.slice(0, 8);
        if (!stations.length) {
          return {
            name: tool,
            ok: false,
            payload: { ok: false, query: q, stations: [], error: "no station found for this name — ask the user to rephrase or give the station code" },
            provider: res.provider,
            latencyMs: Date.now() - started,
          };
        }
        return {
          name: tool,
          ok: true,
          payload: {
            ok: true,
            query: q,
            needChoice: res.needChoice,
            city: res.city ?? null,
            stations: stations.map((s) => ({ code: s.code, name: s.name, city: s.city })),
          },
          provider: res.provider,
          latencyMs: Date.now() - started,
          ui: res.needChoice ? { stationChoice: { city: res.city ?? q, stations } } : { stations },
        };
      }

      case "searchTrains": {
        const from = code(args.from ?? args.origin);
        const to = code(args.to ?? args.destination);
        const date = ymd(args.date);
        if (!from || !to) return fail(tool, "from and to station codes required (use searchStations first)", started);
        if (from === to) return fail(tool, "from and to must differ", started);
        if (!date) return fail(tool, "date required in YYYY-MM-DD — ask the user, never assume today", started);
        if (isPastDate(date)) return fail(tool, `date ${date} is in the past — ask the user for today or a future date`, started, { date });
        const trains = await getProvider().searchTrains({ from, to, date });
        const provider = providerOf();
        const fromSt = trains[0]?.from ?? { code: from, name: from, city: from };
        const toSt = trains[0]?.to ?? { code: to, name: to, city: to };
        return {
          name: tool,
          ok: true,
          payload: {
            ok: true,
            from,
            to,
            date,
            count: trains.length,
            provider,
            note:
              trains.length === 0
                ? "provider returned zero trains for this pair/date — say so; do not invent any train"
                : "these are the only trains you may mention; class list is from the provider (may be empty)",
            trains: trains.slice(0, 15).map((t) => ({
              number: t.number,
              name: t.name,
              dep: t.departure,
              arr: t.arrival,
              duration: t.durationLabel,
              classes: t.classes.map((c) => c.code),
            })),
          },
          provider,
          latencyMs: Date.now() - started,
          ui: { trains, from: fromSt, to: toSt, date },
        };
      }

      case "getTrainInfo": {
        const n = trainNo(args.trainNumber ?? args.train);
        if (!n) return fail(tool, "5-digit trainNumber required", started);
        const res = await routedTrainInfo(n);
        if (!res.info) return fail(tool, `train info for ${n} unavailable from providers`, started);
        return {
          name: tool,
          ok: true,
          payload: { ok: true, ...res.info, provider: res.provider },
          provider: res.provider,
          latencyMs: Date.now() - started,
        };
      }

      case "getTimetable": {
        const n = trainNo(args.trainNumber ?? args.train);
        if (!n) return fail(tool, "5-digit trainNumber required", started);
        const res = await routedSchedule(n);
        if (!res.schedule) return fail(tool, `timetable for ${n} unavailable from providers`, started);
        const s = res.schedule as {
          trainNumber?: string;
          trainName?: string;
          stops?: { code: string; name: string; arrival?: string | null; departure?: string | null; day?: number | string }[];
          runningDays?: string[];
          classes?: string[];
          durationMinutes?: number | null;
        };
        const stops = (s.stops ?? []).map((x) => ({
          code: x.code,
          name: x.name,
          arr: x.arrival ?? null,
          dep: x.departure ?? null,
          day: x.day ?? undefined,
        }));
        return {
          name: tool,
          ok: true,
          payload: {
            ok: true,
            trainNumber: s.trainNumber ?? n,
            trainName: s.trainName ?? "",
            runningDays: s.runningDays ?? undefined,
            classes: s.classes ?? undefined,
            durationMinutes: s.durationMinutes ?? undefined,
            stopCount: stops.length,
            stops: stops.slice(0, 60),
            provider: res.provider,
          },
          provider: res.provider,
          latencyMs: Date.now() - started,
        };
      }

      case "getLiveStatus": {
        const n = trainNo(args.trainNumber ?? args.train);
        if (!n) return fail(tool, "5-digit trainNumber required", started);
        const date = ymd(args.date);
        const res = await routedLiveStatus(n, date);
        if (!res.live) return fail(tool, `live status for ${n} unavailable right now from providers`, started);
        const live = res.live as Record<string, unknown>;
        return {
          name: tool,
          ok: true,
          payload: {
            ok: true,
            trainNumber: live.trainNumber ?? n,
            trainName: live.trainName ?? "",
            status: live.status ?? null,
            currentStation: live.currentStation ?? null,
            nextStation: live.nextStation ?? null,
            delayMinutes: live.delayMinutes ?? null,
            lastUpdatedAt: live.lastUpdatedAt ?? null,
            journeyDate: live.journeyDate ?? date ?? null,
            provider: res.provider,
          },
          provider: res.provider,
          latencyMs: Date.now() - started,
        };
      }

      case "getAvailability": {
        const n = trainNo(args.trainNumber ?? args.train);
        const from = code(args.from ?? args.origin);
        const to = code(args.to ?? args.destination);
        const date = ymd(args.date);
        const cls = classCode(args.classCode ?? args.class);
        const quota = code(args.quota) ?? "GN";
        if (!n || !from || !to || !date || !cls) {
          return fail(tool, "trainNumber, from, to, date (YYYY-MM-DD) and classCode are all required", started);
        }
        const row = await getProvider().getAvailability(n, date, from, to, cls, quota);
        const provider = providerOf();
        if (row.status === "UNKNOWN") {
          return fail(tool, `availability for ${n} ${cls} not returned by providers — do not guess seats`, started, {
            trainNumber: n,
            classCode: cls,
          });
        }
        return {
          name: tool,
          ok: true,
          payload: {
            ok: true,
            trainNumber: n,
            from,
            to,
            date: row.date ?? date,
            classCode: cls,
            quota: row.quota ?? quota,
            status: row.status,
            seats: row.seats ?? null,
            rac: row.rac ?? null,
            waitlist: row.waitlist ?? null,
            railwayFare: row.fare > 0 ? row.fare : null,
            provider,
            note: "snapshot from railway provider, not a live IRCTC counter",
          },
          provider,
          latencyMs: Date.now() - started,
        };
      }

      case "getFare": {
        const n = trainNo(args.trainNumber ?? args.train);
        const from = code(args.from ?? args.origin);
        const to = code(args.to ?? args.destination);
        const date = ymd(args.date);
        const cls = classCode(args.classCode ?? args.class);
        const pax = Math.min(6, Math.max(1, Number(args.passengers ?? 1) || 1));
        if (!n || !from || !to || !date || !cls) {
          return fail(tool, "trainNumber, from, to, date (YYYY-MM-DD) and classCode are all required", started);
        }
        const fare = await getProvider().getFare(n, date, from, to, cls, pax);
        const provider = providerOf();
        if (!fare.railwayAvailable || fare.baseFare <= 0) {
          return fail(tool, `railway fare for ${n} ${cls} not returned by providers — do not estimate`, started);
        }
        return {
          name: tool,
          ok: true,
          payload: {
            ok: true,
            trainNumber: n,
            classCode: cls,
            passengers: pax,
            railwayFarePerPassenger: fare.baseFare / pax,
            railwayFareTotal: fare.baseFare,
            serviceFee: fare.serviceFee,
            grandTotal: fare.total,
            currency: "INR",
            provider,
          },
          provider,
          latencyMs: Date.now() - started,
        };
      }

      case "getCancelledTrains": {
        const list = await routedCancelled();
        if (!list) return fail(tool, "cancelled-train list unavailable from provider", started);
        const pick = (rows: unknown[]) =>
          rows.slice(0, 25).map((r) => {
            const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
            return {
              number: o.trainNo ?? o.train_number ?? o.trainNumber ?? null,
              name: o.trainName ?? o.train_name ?? null,
              from: o.source ?? o.from ?? null,
              to: o.destination ?? o.to ?? null,
            };
          });
        return {
          name: tool,
          ok: true,
          payload: {
            ok: true,
            fullyCancelledCount: list.fully.length,
            partiallyCancelledCount: list.partial.length,
            fully: pick(list.fully),
            partial: pick(list.partial),
            provider: "railkit",
          },
          provider: "railkit",
          latencyMs: Date.now() - started,
        };
      }

      case "checkPNR": {
        const pnr = str(args.pnr)?.replace(/\D/g, "");
        if (!pnr || pnr.length !== 10) return fail(tool, "10-digit pnr required", started);
        const remote = await routedPnr(pnr);
        if (remote) {
          return {
            name: tool,
            ok: true,
            payload: { ok: true, pnr, data: remote.data, provider: "railkit" },
            provider: "railkit",
            latencyMs: Date.now() - started,
          };
        }
        const local = await getProvider().getBooking(pnr);
        if (local) {
          return {
            name: tool,
            ok: true,
            payload: {
              ok: true,
              pnr,
              source: "railbook_demo_booking",
              booking: {
                status: local.status,
                mock: local.mock,
                train: `${local.trainNumber} ${local.trainName}`,
                date: local.date,
                from: local.from.code,
                to: local.to.code,
                classCode: local.classCode,
                passengers: local.passengers.length,
                total: local.fare.total,
              },
            },
            provider: "local",
            latencyMs: Date.now() - started,
          };
        }
        return fail(tool, `PNR ${pnr} not found / provider unavailable — do not invent a status`, started);
      }

      case "getMyBookings": {
        const rows = await getProvider().listBookings();
        return {
          name: tool,
          ok: true,
          payload: {
            ok: true,
            count: rows.length,
            bookings: rows.slice(0, 10).map((b) => ({
              id: b.id,
              pnr: b.pnr,
              status: b.status,
              mock: b.mock,
              train: `${b.trainNumber} ${b.trainName}`.trim(),
              date: b.date,
              from: b.from.code,
              to: b.to.code,
              classCode: b.classCode,
              passengers: b.passengers.length,
              total: b.fare.total,
            })),
          },
          provider: "local",
          latencyMs: Date.now() - started,
        };
      }

      case "getWallet": {
        const w = getWallet();
        return {
          name: tool,
          ok: true,
          payload: { ok: true, balance: w.balance, currency: "INR", note: "read-only; money can only be added from the Wallet screen" },
          provider: "local",
          latencyMs: Date.now() - started,
        };
      }
    }
  } catch (err) {
    return fail(tool, `tool_error: ${err instanceof Error ? err.message.slice(0, 120) : "unknown"}`, started);
  }
  return fail(name, "unhandled", started);
}
