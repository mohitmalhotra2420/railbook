import { getProvider } from "../providers/index.js";
import {
  routedCancelled,
  routedCoachPosition,
  routedLiveStatus,
  routedPnr,
  routedSchedule,
  routedStationSearch,
  routedTrainInfo,
  getLastRailwayLog,
} from "../railway/router.js";
import { webSourceLabel } from "../railway/webscrape.js";
import { todayYmd } from "../util.js";
import { getWallet } from "../wallet.js";
import type { ClassCode } from "../providers/types.js";
import { isForbiddenMoneyTool, segmentOfStops } from "./context.js";

export type ToolName =
  | "searchStations"
  | "searchTrains"
  | "getTrainInfo"
  | "getTimetable"
  | "getLiveStatus"
  | "getCoachPosition"
  | "getAvailability"
  | "getFare"
  | "getCancelledTrains"
  | "checkPNR"
  | "getMyBookings"
  | "getWallet";

export type ToolResult = {
  ok: boolean;
  tool: ToolName;
  summary: string;
  data: unknown;
  provider: string | null;
};

function providerOf(): string | null {
  return getLastRailwayLog()?.railwayProvider ?? null;
}

export async function executeTool(
  tool: ToolName,
  args: {
    query?: string;
    origin?: string;
    destination?: string;
    date?: string;
    trainNumber?: string;
    /** Context ki selected train ka naam — live-status web-scrape fallback
     * (RailYatri) URL mein train ke saath naam chahiye hota hai. */
    trainName?: string;
    classCode?: string;
    passengers?: number;
    pnr?: string;
  },
): Promise<ToolResult> {
  if (isForbiddenMoneyTool(tool)) {
    return {
      ok: false,
      tool: tool as ToolName,
      summary: "Wallet/booking AI se nahi ho sakti. Confirm & Book button use karo.",
      data: null,
      provider: null,
    };
  }
  try {
    if (tool === "searchStations") {
      const q = (args.query ?? "").trim();
      if (!q) return { ok: false, tool, summary: "Station naam chahiye.", data: null, provider: null };
      const res = await routedStationSearch(q);
      return {
        ok: res.stations.length > 0,
        tool,
        summary: res.needChoice
          ? `${res.city ?? q} mein ${res.stations.length} stations.`
          : res.stations[0]
            ? `${res.stations[0].name} (${res.stations[0].code})`
            : "Station nahi mila.",
        data: res,
        provider: res.provider,
      };
    }
    if (tool === "searchTrains") {
      if (!args.origin || !args.destination || !args.date) {
        return { ok: false, tool, summary: "Origin, destination aur date chahiye.", data: null, provider: null };
      }
      const trains = await getProvider().searchTrains({
        from: args.origin,
        to: args.destination,
        date: args.date,
      });
      return {
        ok: trains.length > 0,
        tool,
        summary: trains.length ? `${trains.length} trains mili.` : "Is date pe trains nahi mili.",
        data: { trains: trains.slice(0, 12).map((t) => ({ number: t.number, name: t.name, departure: t.departure, arrival: t.arrival })) },
        provider: providerOf(),
      };
    }
    if (tool === "getLiveStatus") {
      if (!args.trainNumber) return { ok: false, tool, summary: "Train number chahiye.", data: null, provider: null };
      const routed = await routedLiveStatus(args.trainNumber, args.date, args.trainName);
      if (!routed.live) {
        return { ok: false, tool, summary: "Live status unavailable.", data: null, provider: routed.provider };
      }
      const live = routed.live as { trainNumber?: string; trainName?: string; status?: string; currentStation?: string | null; nextStation?: string | null; delayMinutes?: number | null };
      const delay = live.delayMinutes != null ? `, delay ${live.delayMinutes} min` : "";
      const nextBit = live.nextStation ? `, next ${live.nextStation}` : "";
      return {
        ok: true,
        tool,
        summary: `${live.trainNumber ?? args.trainNumber} ${live.trainName ?? ""} — ${live.status ?? "status nahi"}${live.currentStation ? `, last ${live.currentStation}` : ""}${nextBit}${delay}${webSourceLabel(routed.provider)}`.trim(),
        data: live,
        provider: routed.provider,
      };
    }
    if (tool === "getCoachPosition") {
      if (!args.trainNumber) return { ok: false, tool, summary: "Coach position ke liye 5-digit train number chahiye.", data: null, provider: null };
      const routed = await routedCoachPosition(args.trainNumber);
      if (!routed.coachPosition) {
        return { ok: false, tool, summary: "Coach position provider se nahi aayi — main fake layout nahi bataunga.", data: null, provider: routed.provider };
      }
      const coaches = routed.coachPosition.coaches;
      const byClass = new Map<string, number>();
      for (const c of coaches) byClass.set(c.classCode, (byClass.get(c.classCode) ?? 0) + 1);
      const counts = [...byClass.entries()].map(([k, v]) => `${k}×${v}`).join(", ");
      return {
        ok: true,
        tool,
        summary: `Train ${routed.coachPosition.trainNumber} mein ${coaches.length} coaches hain (engine se): ${coaches.map((c) => c.name).join(", ")}${counts ? ` — ${counts}` : ""}.${webSourceLabel(routed.provider)}`,
        data: routed.coachPosition,
        provider: routed.provider,
      };
    }
    if (tool === "getTimetable" || tool === "getTrainInfo") {
      if (!args.trainNumber) return { ok: false, tool, summary: "Train number chahiye.", data: null, provider: null };
      if (tool === "getTrainInfo") {
        const info = await routedTrainInfo(args.trainNumber);
        return {
          ok: Boolean(info.info),
          tool,
          summary: info.info ? `${info.info.trainNumber} ${info.info.trainName}${webSourceLabel(info.provider)}` : "Train info nahi mili.",
          data: info.info,
          provider: info.provider,
        };
      }
      const routed = await routedSchedule(args.trainNumber);
      const stops = routed.schedule && "stops" in routed.schedule ? routed.schedule.stops ?? [] : [];
      const name = routed.schedule && "trainName" in routed.schedule ? routed.schedule.trainName : "";
      // User feedback (2026-09-05): duration jawab user ke origin→destination
      // SEGMENT ka hona chahiye — poora route nahi (jab tak na maange).
      const seg = segmentOfStops(stops, args.origin ?? null, args.destination ?? null);
      const segLine = seg ? ` ${seg.from}→${seg.to}: ${seg.departure}→${seg.arrival} (${seg.durationLabel}).` : "";
      // User feedback (2026-09-06): "poora timetable / kon kon se stops / har
      // stop ka naam" par sirf COUNT nahi — poora stop-by-stop route list.
      // Segment question (origin→destination) par list nahi, sirf segment.
      const routeLine = !seg && stops.length
        ? ` Route: ${stops
            .slice(0, 25)
            .map((st, i) => {
              const first = i === 0;
              const last = i === stops.length - 1;
              /* Source par arrival 00:00 aur destination par departure 00:00
               * API placeholder hai — display mein hide karo. */
              const arr = st.arrival && !(first && st.arrival === "00:00") ? `arr ${st.arrival}` : null;
              const dep = st.departure && !(last && st.departure === "00:00") ? `dep ${st.departure}` : null;
              const timing = [arr, dep].filter(Boolean).join("/");
              return `${i + 1}. ${st.code} ${st.name}${timing ? ` (${timing})` : ""}`;
            })
            .join("; ")}${stops.length > 25 ? ` …(aur ${stops.length - 25})` : ""}.`
        : "";
      /* Web-scrape fallback (2026-09-06): API fail par verified site se aaya
       * data — source label reply mein saaf dikhe. */
      const webSource = webSourceLabel(routed.provider);
      return {
        ok: Boolean(routed.schedule),
        tool,
        summary: routed.schedule
          ? `${args.trainNumber} ${name} — ${stops.length} stops.${segLine}${routeLine}${webSource}`
          : "Timetable nahi mili.",
        data: routed.schedule,
        provider: routed.provider,
      };
    }
    if (tool === "getAvailability") {
      /* Screenshot fix (2026-09-06): user ne date nahi boli to aaj default —
       * "12054 ki seat availability?" par date ke liye reject karna galat UX
       * tha. (Route run.ts auto-route karta hai; class hi real ask hai.) */
      const date = args.date ?? todayYmd();
      if (!args.trainNumber || !date || !args.origin || !args.destination || !args.classCode) {
        return { ok: false, tool, summary: "Train, date, stations aur class chahiye.", data: null, provider: null };
      }
      const row = await getProvider().getAvailability(
        args.trainNumber,
        date,
        args.origin,
        args.destination,
        args.classCode as ClassCode,
      );
      if (row.status === "UNKNOWN") {
        return { ok: false, tool, summary: "Availability unavailable.", data: row, provider: providerOf() };
      }
      return {
        ok: true,
        tool,
        summary: `${args.trainNumber} ${args.classCode}: ${row.status}${row.seats != null ? ` · ${row.seats} seats` : ""}${row.fare > 0 ? ` · ₹${row.fare}` : ""}${row.segmentNote ? ` · (${args.origin}→${args.destination} segment ka direct data nahi — train ki ${row.segmentNote} availability)` : ""}`,
        data: row,
        provider: providerOf(),
      };
    }
    if (tool === "getFare") {
      /* Date aaj default (screenshot fix 2026-09-06) — availability jaisa hi. */
      const date = args.date ?? todayYmd();
      if (!args.trainNumber || !date || !args.origin || !args.destination || !args.classCode) {
        return { ok: false, tool, summary: "Train, date, stations aur class chahiye.", data: null, provider: null };
      }
      const fare = await getProvider().getFare(
        args.trainNumber,
        date,
        args.origin,
        args.destination,
        args.classCode as ClassCode,
        args.passengers ?? 1,
      );
      if (!fare.railwayAvailable && fare.baseFare <= 0) {
        return {
          ok: false,
          tool,
          summary: fare.unavailableReason
            ? `Fare abhi available nahi hai — ${fare.unavailableReason}. Approx figure invent nahi karunga.`
            : "Fare abhi available nahi hai. Approx figure invent nahi karunga.",
          data: fare,
          provider: providerOf(),
        };
      }
      return {
        ok: true,
        tool,
        summary: `${args.trainNumber} ${args.classCode}: ticket ₹${fare.baseFare}, service ₹${fare.serviceFee}, total ₹${fare.total}`,
        data: fare,
        provider: providerOf(),
      };
    }
    if (tool === "getCancelledTrains") {
      const list = await routedCancelled();
      if (!list) return { ok: false, tool, summary: "Cancelled list unavailable.", data: null, provider: "railkit" };
      const full = (list.fully ?? []).length;
      const part = (list.partial ?? []).length;
      return { ok: true, tool, summary: `Fully cancelled ${full}, partial ${part}.`, data: list, provider: "railkit" };
    }
    if (tool === "checkPNR") {
      if (!args.pnr) return { ok: false, tool, summary: "PNR number chahiye.", data: null, provider: null };
      const remote = await routedPnr(args.pnr);
      if (remote) {
        return { ok: true, tool, summary: `PNR ${remote.pnr} provider se mila.`, data: remote, provider: "railkit" };
      }
      const local = await getProvider().getBooking(args.pnr);
      if (local) {
        return { ok: true, tool, summary: `PNR ${args.pnr} local booking se mila.`, data: { booking: local }, provider: "local" };
      }
      return { ok: false, tool, summary: "PNR unavailable.", data: null, provider: "railkit" };
    }
    if (tool === "getMyBookings") {
      const bookings = await getProvider().listBookings();
      return {
        ok: true,
        tool,
        summary: bookings.length ? `${bookings.length} bookings.` : "Koi booking nahi.",
        data: { count: bookings.length, ids: bookings.slice(0, 8).map((b) => b.id) },
        provider: "local",
      };
    }
    if (tool === "getWallet") {
      const wallet = getWallet();
      return { ok: true, tool, summary: `Wallet ₹${wallet.balance}.`, data: { balance: wallet.balance }, provider: "local" };
    }
    return { ok: false, tool, summary: "Unknown tool.", data: null, provider: null };
  } catch {
    return { ok: false, tool, summary: "Tool failed.", data: null, provider: null };
  }
}
