/* Round-18m-28 (user screenshot 2026-09-13 02:09): pichhli chat mein 12426 select thi; user ne
 * "Muje jammu se ndls jaana hai aaj seats dikhao" bola → app ne SIRF 12426 ka CHECK_AVAILABILITY chalaya
 * (3A/2A/1A WL) — SL, baaki trains, har class, leg-1/leg-2, book-from-earlier, book-upto kuch nahi, pax bhi
 * nahi poochha. Rule: ROUTE (from+to) bola aur train number/naam nahi → journey-level sawaal; stale selected
 * train hatao taaki pax gate → poora planner chale. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyAgentContext, mergeAgentContext } from "../server/agent/context.js";
import { mergeAgentContext as mergeClient, emptyAgentContext as emptyClient } from "../src/ai/agent";
import { runAgent } from "../server/agent/run";
import { setProvider } from "../server/providers/index";
import { setAgenticNvidiaFetch } from "../server/agent/agentic";

const JAT = { code: "JAT", name: "Jammu Tawi" };
const NDLS = { code: "NDLS", name: "New Delhi" };

describe("Round-18m-28: route-level seat ask must not stick to the previously selected train", () => {
  it("server mergeAgentContext: from+to spoken, no train → selectedTrainNumber cleared", () => {
    const prev = { ...emptyAgentContext(), origin: JAT, destination: NDLS, selectedTrainNumber: "12426", selectedTrainName: "JAMMU RAJDHANI", intent: "CHECK_AVAILABILITY" as const, lastToolOk: true, lastTrains: [{ number: "12426", name: "JAMMU RAJDHANI" }] };
    const next = mergeAgentContext(prev, { intent: "SEARCH_TRAIN", from: JAT, to: NDLS, date: "2026-09-13" }, "Muje jammu se ndls jaana hai aaj seats dikhao");
    expect(next.selectedTrainNumber).toBeNull();
    expect(next.origin?.code).toBe("JAT");
    expect(next.destination?.code).toBe("NDLS");
  });
  it("server: explicit train number / train name in text keeps the train", () => {
    const prev = { ...emptyAgentContext(), origin: JAT, destination: NDLS, selectedTrainNumber: "12426", lastTrains: [{ number: "12426", name: "JAMMU RAJDHANI" }] };
    expect(mergeAgentContext(prev, { intent: "CHECK_AVAILABILITY", from: JAT, to: NDLS, trainNumber: "12426" }, "12426 jammu se ndls seats").selectedTrainNumber).toBe("12426");
    expect(mergeAgentContext(prev, { intent: "CHECK_AVAILABILITY", from: JAT, to: NDLS }, "rajdhani jammu se ndls seats").selectedTrainNumber).toBe("12426");
  });
  it("server: slot-resume for a train question (12426 seats? → route+date answer) keeps the train", () => {
    const prev = { ...emptyAgentContext(), selectedTrainNumber: "12426", intent: "CHECK_AVAILABILITY" as const, lastTool: "getAvailability" as const, lastToolOk: false };
    const next = mergeAgentContext(prev, { intent: "SEARCH_TRAIN", from: JAT, to: NDLS, date: "2026-09-13" }, "jammu se ndls aaj");
    expect(next.selectedTrainNumber).toBe("12426");
  });
  it("client mergeAgentContext mirrors the rule", () => {
    const prev = { ...emptyClient(), origin: JAT, destination: NDLS, selectedTrainNumber: "12426", lastTrains: [{ number: "12426", name: "JAMMU RAJDHANI" }] };
    const next = mergeClient(prev, { intent: "SEARCH_TRAIN", from: JAT, to: NDLS, date: "2026-09-13" }, "jammu se ndls aaj seats dikhao");
    expect(next.selectedTrainNumber).toBeNull();
  });
});

describe("Round-18m-28: runAgent — screenshot turn now asks passengers (planner path), not 12426-only availability", () => {
  /* pax gate agentic path (agenticConfigured) mein hai — key set, model fetch mocked (gate fetch se PEHLE return karta hai). */
  beforeEach(() => { process.env.RAILWAY_PROVIDER = "mock"; process.env.NVIDIA_API_KEY = "nvapi-test"; setProvider(null); setAgenticNvidiaFetch(async () => new Response(JSON.stringify({ choices: [{ message: { content: "model should not be reached" } }] }), { status: 200 })); });
  afterEach(() => { setProvider(null); setAgenticNvidiaFetch(null); process.env.NVIDIA_API_KEY = ""; });
  it("pax gate fires with JAT → NDLS, no getAvailability tool on the stale train", async () => {
    const prevCtx = { ...emptyAgentContext(), origin: JAT, destination: NDLS, date: "2026-09-13", dateProvided: true, selectedTrainNumber: "12426", selectedTrainName: "JAMMU RAJDHANI", intent: "CHECK_AVAILABILITY" as const, lastTool: "getAvailability" as const, lastToolOk: true, passengers: 1, paxProvided: false, bookingStage: "collecting" as const, lastTrains: [{ number: "12426", name: "JAMMU RAJDHANI" }] };
    const res = await runAgent({ text: "Muje jammu se ndls jaana hai aaj seats dikhao", now: "2026-09-12T20:39:00.000Z", context: prevCtx });
    expect(res.tool).not.toBe("getAvailability");
    expect(res.context.selectedTrainNumber ?? null).toBeNull();
    expect(res.resumeAsk).toBe("passengers");
    expect(res.reply).toMatch(/kitne passengers/i);
    expect(res.reply).toContain("JAT → NDLS");
  }, 30000);
});
