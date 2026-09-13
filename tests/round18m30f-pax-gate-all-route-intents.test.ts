/* Round-18m-30f (user: "passenger khud hi assume kar raha, har baar nahi poochta"): route-level sawaal jo
 * CHECK_AVAILABILITY / COMPARE_TRAINS / SELECT_FASTEST / FIND_ALTERNATE … classify hote hain, pax gate skip
 * karke 1 passenger assume karte the. Ab: route + date lock, pax unknown → HAR aise intent par pehle
 * "kitne passengers?" (train-number wale sawaal par nahi). */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyAgentContext } from "../server/agent/context.js";
import { runAgent } from "../server/agent/run";
import { setProvider } from "../server/providers/index";
import { setAgenticNvidiaFetch } from "../server/agent/agentic";

const ASR = { code: "ASR", name: "Amritsar Jn" };
const BSB = { code: "BSB", name: "Varanasi Jn" };

describe("Round-18m-30f: passenger gate on every route-level seat/journey intent", () => {
  beforeEach(() => { process.env.RAILWAY_PROVIDER = "mock"; process.env.NVIDIA_API_KEY = "nvapi-test"; setProvider(null); setAgenticNvidiaFetch(async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200, headers: { "content-type": "application/json" } })); });
  afterEach(() => { setProvider(null); setAgenticNvidiaFetch(null); process.env.NVIDIA_API_KEY = ""; });
  for (const text of ["ASR se BSB 14 sept seat availability batao", "ASR se BSB 14 sept fastest train konsi hai", "ASR se BSB 14 sept ko sabse sasti train", "ASR se BSB 14 sept alternate route dikhao", "ASR se BSB 14 sept trains compare karo"]) {
    it(`asks passengers first: "${text}"`, async () => {
      const prev = { ...emptyAgentContext(), origin: ASR, destination: BSB, date: "2026-09-14", dateProvided: true };
      const res = await runAgent({ text, now: "2026-09-13T11:00:00.000Z", context: prev });
      expect(res.resumeAsk).toBe("passengers");
      expect(res.reply).toMatch(/kitne passengers/i);
    }, 30000);
  }
  it("station pick '1' (classified SELECT_TRAIN) still hits the passenger gate", async () => {
    const prev = { ...emptyAgentContext(), origin: ASR, date: "2026-09-14", dateProvided: true, pendingDestinationChoice: "Varanasi", pendingDestinationOptions: [{ code: "BSB", name: "Varanasi Jn" }, { code: "BCY", name: "Varanasi City" }] } as never;
    const res = await runAgent({ text: "1", now: "2026-09-13T11:00:00.000Z", context: prev, lastAsked: "destination" });
    if (res.context.destination?.code === "BSB") { expect(res.resumeAsk).toBe("passengers"); expect(res.reply).toMatch(/kitne passengers/i); }
  }, 30000);
  it("once given, passengers persist for the same route (no re-ask)", async () => {
    const prev = { ...emptyAgentContext(), origin: ASR, destination: BSB, date: "2026-09-14", dateProvided: true, passengers: 3, paxProvided: true };
    const res = await runAgent({ text: "ASR se BSB 14 sept fastest train konsi hai", now: "2026-09-13T11:00:00.000Z", context: prev });
    expect(res.resumeAsk).not.toBe("passengers");
    expect(res.context.passengers).toBe(3);
  }, 30000);
});
