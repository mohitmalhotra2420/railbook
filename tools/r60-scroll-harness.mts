/* R60: plan page ka scroll test — real CSS + real markup (asli plan data se), bina server ke. */
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { PlanPageSheet } from "../src/views/Concierge";

const cssFile = fs.readdirSync("dist/assets").find((f) => f.endsWith(".css"));
const appCss = fs.readFileSync(path.join("dist/assets", cssFile!), "utf8");
/* Synthetic-but-shape-correct plan — sirf CSS/scroll naapne ke liye (koi user-facing data nahi). */
const leg = (n: string, name: string, from: string, to: string, cls: string, seats: number, fare: number, d: string, a: string) => ({
  trainNumber: n, trainName: name, from, to, fromName: from, toName: to, departure: d, arrival: a, arrivalDayOffset: 0,
  durationMinutes: 95, availability: { classCode: cls, status: "AVAILABLE", seats, rac: null, waitlist: null, fare, source: "confirmtkt" },
  classOptions: [
    { classCode: cls, status: "AVAILABLE", seats, rac: null, waitlist: null, fare, source: "confirmtkt" },
    { classCode: "2A", status: "AVAILABLE", seats: 12, rac: null, waitlist: null, fare: 1180, source: "confirmtkt" },
    { classCode: "SL", status: "WAITLIST", seats: null, rac: null, waitlist: 14, fare: 320, source: "confirmtkt" },
  ],
});
const plan = {
  provenance: { sources: ["web_confirmtkt"], freshness: "fresh", retrievedAt: new Date().toISOString(), requestDate: "2026-09-30", travelDate: "2026-09-30", sourceTypes: ["web"] },
  query: { from: "ASR", to: "LDH", date: "2026-09-30", travelClass: null, passengers: 1, preference: "best_overall" },
  best: null, routeOptions: [], alternativeDates: [], directUnavailable: false, sources: [],
  connections: [
    { legs: [leg("14680", "ASR DLI EXP", "ASR", "UMB", "2S", 372, 115, "06:15", "10:40"), leg("22478", "VANDE BHARAT EXP", "UMB", "LDH", "CC", 86, 835, "11:50", "14:00")], layoverMinutes: 70, totalDurationMinutes: 465, hub: "UMB" },
    { legs: [leg("12550", "MCTM DURG SF EXP", "ASR", "JRC", "SL", 19, 180, "06:40", "08:55"), leg("12716", "SACHKHAND EXP", "JRC", "LDH", "2A", 14, 1100, "09:30", "11:05")], layoverMinutes: 35, totalDurationMinutes: 265, hub: "JRC" },
  ],
  legPlans: [
    { hub: "UMB", hubName: "Ambala Cantt", leg1: [leg("14680", "ASR DLI EXP", "ASR", "UMB", "2S", 372, 115, "06:15", "10:40"), leg("22430", "PTK DLI EXP", "ASR", "UMB", "CC", 16, 370, "09:30", "12:10")], leg2: [leg("22478", "VANDE BHARAT EXP", "UMB", "LDH", "CC", 86, 835, "11:50", "14:00"), leg("12716", "SACHKHAND EXP", "UMB", "LDH", "2A", 14, 1100, "13:55", "15:40")], checkedLeg1: 9, checkedLeg2: 7, best: null },
    { hub: "JRC", hubName: "Jalandhar Cantt", leg1: [leg("12550", "MCTM DURG SF EXP", "ASR", "JRC", "SL", 19, 180, "06:40", "08:55")], leg2: [leg("12716", "SACHKHAND EXP", "JRC", "LDH", "2A", 14, 1100, "09:30", "11:05")], checkedLeg1: 6, checkedLeg2: 5, best: null },
  ],
  audit: { passengers: 1, directTrains: 21, directProbed: 20, bfeTrains: 12, bfeStopsChecked: 64, connHubs: ["UMB", "JRC"], connLeg1Checked: 12, connLeg2Checked: 10 },
} as unknown;

const noop = () => undefined;
const markup = renderToStaticMarkup(
  h(PlanPageSheet, {
    st: { page: "connect", from: "ASR", to: "LDH", date: "2026-09-30", loading: false, progress: null, plan, reply: null, error: null, tries: 1 },
    onClose: noop, onRetry: noop, onChatFallback: noop, onPickTrain: noop, onPickLeg: noop, onPickClass: noop,
    onPickDate: noop, onPickStations: noop, onBookLeg: noop, onOpenBoard: noop,
  } as never),
);
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${appCss}
html,body{margin:0;padding:0}
.app{max-width:480px;margin:0 auto;position:relative;min-height:100vh}
</style></head><body><div class="app">${markup}</div></body></html>`;
fs.writeFileSync("/tmp/r60-scroll.html", html);
console.log("harness bytes:", html.length);
