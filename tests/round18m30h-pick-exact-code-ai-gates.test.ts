/* Round-18m-30h (prod screenshot 18:54): options "1. AY – Ayodhya …" → user "1" → reply "LDH → BZA" (Vijayawada!).
 * Wajah: local station search "AY" ko substring se vijAYawada de raha tha aur verifyStationCode ne single result
 * accept kar liya. Rule: user ne jo CODE chuna EXACT wahi — kabhi koi aur code nahi.
 * Saath mein (C): gate-questions ki wording AI se, par facts locked (validator). */
import { describe, expect, it, afterEach } from "vitest";
import { searchStations } from "../server/data/stations.js";
import { resolveStationPick } from "../server/agent/run";
import { emptyAgentContext } from "../server/agent/context.js";
import { aiPhraseGate, setAgenticNvidiaFetch } from "../server/agent/agentic";

describe("Round-18m-30h: station pick = exact code", () => {
  it("local search: 2–4 letter query never substring-matches inside a name (AY ≠ Vijayawada)", () => {
    expect(searchStations("AY").some((s) => s.code === "BZA")).toBe(false);
    expect(searchStations("ASR")[0]?.code).toBe("ASR");
    expect(searchStations("ldh")[0]?.code).toBe("LDH");
  });
  it("'1' on Ayodhya options resolves to AY (never another code), '3' → AYC", async () => {
    const ctx = { ...emptyAgentContext(), origin: { code: "LDH", name: "Ludhiana Jn" } };
    const hist = [{ role: "assistant" as const, content: "LDH se Ayodhya: Ayodhya mein kaunsa station chahiye? Options: 1. AY – Ayodhya, 2. APN – Ayodhyapattanam, 3. AYC – Ayodhya Cantt." }];
    const p1 = await resolveStationPick("1", hist, ctx);
    expect(p1?.code).toBe("AY");
    expect(p1?.name).toMatch(/Ayodhya/i);
    const p3 = await resolveStationPick("3", hist, ctx);
    expect(p3?.code).toBe("AYC");
    const pay = await resolveStationPick("AY", hist, ctx);
    expect(pay?.code).toBe("AY");
  });
});

describe("Round-18m-30h (C): AI-phrased gate questions keep facts locked", () => {
  afterEach(() => { setAgenticNvidiaFetch(null); delete process.env.VITEST_ALLOW_GATE_AI; });
  it("under VITEST without AI → deterministic fallback text", async () => {
    const r = await aiPhraseGate("passengers", { fallback: "LDH → AY 2026-09-14 ko — kitne passengers hain? (1–6)", mustContain: ["LDH", "AY"], context: "x" });
    expect(r.text).toContain("kitne passengers");
    expect(r.model).toBeNull();
  });
});

describe("Round-18m-30j: date-format hint in a clarifying question is not a hallucinated station code", () => {
  afterEach(() => { setAgenticNvidiaFetch(null); process.env.NVIDIA_API_KEY = ""; });
  it("'Kis date ko jaana hai? (YYYY-MM-DD)' after a station pick → grounded, no 'provider se nahi mil' reply", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-test";
    const { runAgenticTurn } = await import("../server/agent/agentic");
    setAgenticNvidiaFetch(async () => new Response(JSON.stringify({ choices: [{ message: { content: "Theek hai — LDH → LKO. Kis date ko jaana hai? (jaise 2026-09-15 ya YYYY-MM-DD, DD/MM bhi chalega)" } }] }), { status: 200, headers: { "content-type": "application/json" } }));
    const turn = await runAgenticTurn({ text: "1", now: "2026-09-13T14:05:00.000Z", history: [{ role: "assistant", content: "LDH se Lucknow: 1. LKO – Lucknow NR, 2. LJN – Lucknow Junction NER." }], known: { origin: "LDH", destination: "LKO", stationPicked: "destination", dateProvided: false } } as never);
    expect(turn.grounded).toBe(true);
    expect(turn.reply).toMatch(/Kis date/);
    expect(turn.reply).not.toMatch(/provider se nahi mil/);
  }, 30000);
});

describe("Round-18m-30l: AI-written station options are parsed; 0 trains at chosen sibling → same-city fallback with a clear note", () => {
  it("'2' on '1. LKO — Lucknow NR\\n2. LJN — Lucknow Junction NER' → LJN", async () => {
    const ctx = { ...emptyAgentContext(), origin: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" }, pendingDestinationChoice: "Lucknow" };
    const p = await resolveStationPick("2", [{ role: "assistant", content: "Lucknow mein 2 stations hain — kaunsa chahiye? 1. LKO — Lucknow NR\n2. LJN — Lucknow Junction NER" }], ctx);
    expect(p?.code).toBe("LJN");
  });
});

describe("Round-18m-30m: bare 'N. CODE' options (model's own wording) map correctly", () => {
  it("'2' on '… 1. LKO 2. LJN (Please reply with 1 or 2.)' → LJN with its name from the same text", async () => {
    const ctx = { ...emptyAgentContext(), origin: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" }, pendingDestinationChoice: "Lucknow" };
    const c = "Lucknow mein 2 stations hain – LKO (Lucknow NR) aur LJN (Lucknow Junction NER). Kaunsa station chahte hain? 1. LKO 2. LJN (Please reply with 1 or 2.)";
    const p = await resolveStationPick("2", [{ role: "assistant", content: c }], ctx);
    expect(p?.code).toBe("LJN");
    expect(p?.name).toMatch(/Lucknow Junction/);
    expect((await resolveStationPick("1", [{ role: "assistant", content: c }], ctx))?.code).toBe("LKO");
  });
});

describe("Round-18m-30n: stale client known.date/passengerCount never overrides a server context that reset them", () => {
  it("station pick with server ctx dateProvided=false + client known.date (old journey) → still asks the date, no plan", async () => {
    process.env.RAILWAY_PROVIDER = "mock";
    const { runAgent } = await import("../server/agent/run");
    const ctx = { ...emptyAgentContext(), origin: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" }, pendingDestinationChoice: "Lucknow", date: null, dateProvided: false, passengers: null, paxProvided: false };
    const res = await runAgent({ text: "1", now: "2026-09-13T15:50:00.000Z", context: ctx, lastAsked: "destination", known: { date: "2026-09-14", passengerCount: 2 }, history: [{ role: "assistant", content: "Lucknow ke liye 2 stations hain:\n1. LKO – Lucknow NR\n2. LJN – Lucknow Junction NER Number ya code batao." }] } as never);
    expect(res.context.destination?.code).toBe("LKO");
    expect(res.context.dateProvided).toBe(false);
    expect(res.context.date ?? null).toBeNull();
    expect(res.context.passengers ?? null).toBeNull();
    expect(res.journey ?? null).toBeNull();
    expect(res.reply).toMatch(/date/i);
    expect(res.reply).not.toMatch(/2026-09-14|trains mili/);
  }, 30000);
  it("fresh session (no server ctx) still seeds client known slots", async () => {
    const { runAgent } = await import("../server/agent/run");
    const res = await runAgent({ text: "12238 ka live status", now: "2026-09-13T15:50:00.000Z", known: { date: "2026-09-14", passengerCount: 2 } } as never);
    expect(res.context.dateProvided).toBe(true);
  }, 30000);
});

describe("Round-18m-30n(b): first turn of a NEW route ignores stale client date/pax", () => {
  it("'ludhiana se lucknow jaana hai' + known.date/pax from old journey → context has no date/pax", async () => {
    process.env.RAILWAY_PROVIDER = "mock";
    const { runAgent } = await import("../server/agent/run");
    const res = await runAgent({ text: "Mujhe ludhiana se lucknow jaana hai", now: "2026-09-13T16:05:00.000Z", known: { date: "2026-09-14", passengerCount: 2 } } as never);
    expect(res.context.dateProvided).toBe(false);
    expect(res.context.paxProvided).toBe(false);
  }, 30000);
  it("same-route follow-up with date in ctx keeps it ('ASR se BSB fastest?')", async () => {
    const { runAgent } = await import("../server/agent/run");
    const prev = { ...emptyAgentContext(), origin: { code: "ASR", name: "Amritsar Jn" }, destination: { code: "BSB", name: "Varanasi Jn" }, date: "2026-09-14", dateProvided: true, passengers: 3, paxProvided: true };
    const res = await runAgent({ text: "ASR se BSB fastest train konsi hai", now: "2026-09-13T16:05:00.000Z", context: prev, known: { date: "2026-09-14", passengerCount: 3 } } as never);
    expect(res.context.date).toBe("2026-09-14");
    expect(res.context.passengers).toBe(3);
  }, 30000);
});

describe("Round-18m-30s: deterministic station-pick path (AI reply rejected) also never plans without passengers", () => {
  it("station pick + date known + pax unknown → asks passengers, no search/plan", async () => {
    process.env.RAILWAY_PROVIDER = "mock"; process.env.NVIDIA_API_KEY = "nvapi-test";
    const { runAgent } = await import("../server/agent/run");
    setAgenticNvidiaFetch(async () => new Response(JSON.stringify({ choices: [{ message: { content: "Mathura mein kaunsa station? 1. MTJ 2. MRT" } }] }), { status: 200, headers: { "content-type": "application/json" } })); // model re-asks → rejected → deterministic path
    const ctx = { ...emptyAgentContext(), origin: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" }, pendingDestinationChoice: "Mathura", date: "2026-09-14", dateProvided: true, passengers: null, paxProvided: false };
    const res = await runAgent({ text: "1", now: "2026-09-13T17:30:00.000Z", context: ctx, lastAsked: "destination", history: [{ role: "assistant", content: "Mathura ke liye ye stations mile: 1. MTJ – Mathura Jn\n2. MRT – Mathura Cant\nNumber ya code batao." }] } as never);
    expect(res.context.destination?.code).toBe("MTJ");
    expect(res.journey ?? null).toBeNull();
    expect(res.trains ?? null).toBeNull();
    expect(res.reply).toMatch(/passengers/i);
    expect(res.context.paxProvided).toBe(false);
    process.env.NVIDIA_API_KEY = "";
  }, 30000);
});

/* Round-33 (26 Sep 2026, user: "'Kal,1' ke baad AI ne trains list nahi di — passengers dobara poochh liye"):
 * SEARCH_TRAINS ek LIST tool hai, usme passengers ka koi role nahi — isliye wahi test ab naye rule ke
 * hisaab se likha gaya hai. Pax-precondition un tools par ab bhi hai jo sach me party-size par depend
 * karte hain (seat/plan), aur wahan model ka "invented" number bhi reject hota hai. */
describe("Round-33: SEARCH_TRAINS (list tool) bina passengers chalta hai", () => {
  it("SEARCH_TRAINS bina pax unknown → list chal jaati hai (reject nahi)", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-test"; process.env.RAILWAY_PROVIDER = "mock";
    const { runAgenticTurn } = await import("../server/agent/agentic");
    let n = 0;
    setAgenticNvidiaFetch(async () => { n++; return new Response(JSON.stringify({ choices: [{ message: n === 1 ? { content: null, tool_calls: [{ id: "a", type: "function", function: { name: "SEARCH_TRAINS", arguments: JSON.stringify({ origin: "LDH", destination: "MTJ", date: "2026-09-14", passengers: 1 }) } }] } : { content: "Kitne passengers?" } }] }), { status: 200, headers: { "content-type": "application/json" } }); });
    const turn = await runAgenticTurn({ text: "1", now: "2026-09-13T18:00:00.000Z", known: { origin: "LDH", destination: "MTJ", date: "2026-09-14", dateProvided: true, stationPicked: "destination" } } as never);
    const st = turn.steps.find((s) => s.tool === "SEARCH_TRAINS");
    expect(st?.ok).toBe(true);
    expect(st?.summary ?? "").not.toMatch(/PASSENGERS MISSING/);
    process.env.NVIDIA_API_KEY = "";
  }, 30000);
});

describe("Round-18m-30w: fresh screen never inherits the previous journey's agent context", () => {
  it("Concierge restores agentCtx only for the same page session (source-level guard)", () => {
    const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/views/Concierge.tsx"), "utf8");
    const i = src.indexOf("const agentCtxRef = useRef");
    const block = src.slice(i, i + 500);
    expect(block).toMatch(/pageSession === currentPageSession\(\)/);
    expect(block).not.toMatch(/useRef<[^>]*>\(persistedMemory\(\)\?\.agentCtx/);
  });
});
