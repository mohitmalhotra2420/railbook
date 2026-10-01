/* ══ ROUND-56 (29 Sep 2026) — "ChatGPT samajh gaya, mera AI kyu nahi?" ═══════════════════════════════
 * User ke screenshots: (1) "ASR/LDH 3A seat batao" me pehli baar Sachkhand dikhi, agli baar nahi;
 * (2) "esmein se best train batao" par poori list dobara dump. ChatGPT ne wahi sawaal (screenshot 3)
 * ek jhaTke me samajh liya — kyunki uske paas poora thread hota hai aur wo usi list par reasoning
 * karta hai, naya data nahi maangta.
 *
 * Is round me humne wahi structural cheez ki (koi naya per-question rule nahi):
 *   (a) pichhla assistant jawab poora model ke paas jaata hai (pehle 1500 chars par kat jaata tha —
 *       12-trains wali list 900–1200 chars ki hoti hai),
 *   (b) jab pichhli list maujood ho to ek system block "PICHHLA JAWAB (…)" jaata hai jisme wahi list
 *       POORI hoti hai + ek general usool: list-reference sawaal → usi list se jawab, naya board nahi;
 *       fresh board sirf naya route/date/train/class ya "abhi/live status" par.
 *
 * Ye test outgoing model request (koi bhi provider) capture kar ke naapta hai — ki model ko sach me
 * pichhli list dikh rahi hai ya nahi (yahi to ChatGPT ke paas hota hai aur hamare paas nahi tha).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const routeBoard = vi.fn();
const classBoard = vi.fn();
vi.mock("../server/railway/router.js", () => ({
  routedRouteBoard: (...a: unknown[]) => routeBoard(...a),
  routedClassBoard: (...a: unknown[]) => classBoard(...a),
  routedStationSearch: async () => ({ stations: [], needChoice: false }),
  routedLiveStatus: async () => null,
  routedSchedule: async () => ({ schedule: null, provider: "none" }),
  routedTrainInfo: async () => ({ info: null, provider: "none" }),
  routedLiveDates: async () => ({}),
  enrichTrainsFreshness: async () => 0,
}));
vi.mock("../server/providers/index.js", () => ({
  getProvider: () => ({ searchTrains: async () => [], name: "mock" }),
}));

import { setAgenticNvidiaFetch, runAgenticTurn } from "../server/agent/agentic";

/** Lambi list wala pichhla jawab — 12 trains, poora 1000+ chars (jaise asli seat answer hota hai). */
const LONG_LIST_REPLY = `💺 3A me 12 trains — 9 me seat (AVL/RAC), 3 me WL/N-A: ${[
  "18104 3A AVL 69 ₹520",
  "12926 3A AVL 63 ₹565",
  "14624 3A AVL 37 ₹520",
  "18238 3A AVL 36 ₹520",
  "20808 3A AVL 17 ₹565",
  "13006 3A AVL 13 ₹520",
  "15708 3A AVL 12 ₹520",
  "12904 3A AVL 8 ₹565",
  "14632 3A AVL 6 ₹520",
  "18102 3A WL 17 ₹520",
  "14542 3A N/A ₹520",
  "12715 3A AVL 2 ₹565",
].join(" | ")}. (ASR → LDH · live board)`;

const HISTORY = [
  { role: "user", content: "ASR se LDH kal 3A me seat batao" },
  { role: "assistant", content: LONG_LIST_REPLY },
];

type Captured = { messages: { role: string; content: string }[] };
let seen: Captured[] = [];

function mockModel(reply: string): void {
  seen = [];
  setAgenticNvidiaFetch(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Captured;
    seen.push({ messages: body.messages ?? [] });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: reply } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
}

const allText = (c: Captured): string => c.messages.map((m) => m.content).join("\n");

beforeEach(() => {
  process.env.NVIDIA_API_KEY = "test-key";
  process.env.NVIDIA_BASE_URL = "https://example.invalid/v1";
  process.env.NVIDIA_MODEL = "test-model";
  process.env.AI_OWNS_FLOW = "";
  routeBoard.mockReset().mockResolvedValue({ trains: [], provider: "mock", at: Date.now() });
  classBoard.mockReset().mockResolvedValue({ classes: [], provider: "none" });
});
afterEach(() => {
  setAgenticNvidiaFetch(null);
  routeBoard.mockReset();
  classBoard.mockReset();
});

describe("Round-56 · model ko pichhli list POORI dikhni chahiye (ChatGPT jaisa context)", () => {
  it("12-trains wali list model ke paas poori jaati hai (1500/700 char par nahi katti)", async () => {
    mockModel("Best: 18104 ASR TATA EXP — 3A AVL 69 ₹520. Kyun: sabse zyada confirmed seats. Runner-up: 12926.");
    await runAgenticTurn({
      text: "esmein se best train batao",
      history: HISTORY,
      known: { origin: "ASR", destination: "LDH", date: "2026-09-30" },
      now: "2026-09-29T10:00:00+05:30",
      capture: { seat: null, table: null } as never,
    } as never);
    expect(seen.length).toBeGreaterThan(0);
    const txt = allText(seen[0]);
    /* poori list ke dono sire ke numbers model ke paas hone chahiye */
    expect(txt).toContain("18104");
    expect(txt).toContain("12715"); /* aakhri number — pehle 1500-char cap me yahi kat jaata tha */
    expect(txt).toContain("14542");
    expect(txt).not.toMatch(/…\s*$/);
  });

  it("pichhli list ka system block + general usool jaata hai (naya board maangne ki koi hidayat nahi)", async () => {
    mockModel("Theek hai.");
    await runAgenticTurn({
      text: "esmein se best train batao",
      history: HISTORY,
      known: { origin: "ASR", destination: "LDH", date: "2026-09-30" },
      now: "2026-09-29T10:00:00+05:30",
      capture: { seat: null, table: null } as never,
    } as never);
    const txt = allText(seen[0]);
    expect(txt).toMatch(/PICHHLA JAWAB/);
    expect(txt).toMatch(/jawab ISI list se do/);
    expect(txt).toMatch(/Fresh board sirf tab/);
  });

  it("control — pichhli list hi na ho to koi 'PICHHLA JAWAB' block nahi (khaali dimaag bhar na dein)", async () => {
    mockModel("Kaunse route se jaana hai?");
    await runAgenticTurn({
      text: "seat batao",
      history: [],
      known: {},
      now: "2026-09-29T10:00:00+05:30",
      capture: { seat: null, table: null } as never,
    } as never);
    const txt = allText(seen[0]);
    expect(txt).not.toMatch(/PICHHLA JAWAB/);
  });
});
