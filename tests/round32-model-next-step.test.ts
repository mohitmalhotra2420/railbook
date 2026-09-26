/* Round-32 (26 Sep 2026, user correction):

 *   "Isliye ab dimaag data ka lagta hai, model ka nahi — lekin maine to bola hai na ki har query pehle
 *    model ke pass jaani chahiye and wo decide kare kon sa tool use karna yan kya karna hai, user ka
 *    answer kahan se laana hai"
 *
 * Pehle: jawab ke baad ka "agla kadam" SIRF data se banta tha (UI). Ab: **model khud decide karta hai** —
 * apne reply ke aakhir me `[NEXT] label => utterance` line(s) likh kar (prompt rule 26). Server unhe
 * reply text se ALAG karta hai (user ko raw line nahi dikhti), tool-evidence se VALIDATE karta hai
 * (jo number/naam is turn me nahi aaya wo drop), aur client unhi ko chips me dikhata hai. Model ne na
 * diya ho to Round-36 se koi data-fallback nahi — card dikhta hi nahi (user: "fallback pe verified data
 * se na aaye, AI har baar apna brain use kare").
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { extractNextActions, reconcileNextActions } from "../server/agent/agentic";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

describe("Round-32 · model ka [NEXT] parsing (reply text se alag)", () => {
  it("aakhir ki [NEXT] line alag hoti hai — reply me raw line nahi rehti", () => {
    const content = [
      "12013 AMRITSAR SHTABDI — CC AVL 354 (₹675) · EC AVL 23 (₹1,015). Source: confirmtkt.com",
      "[NEXT] Book 12013 · CC (AVL 354 ₹675) => 12013 mein CC book krdo",
    ].join("\n");
    const { text, actions } = extractNextActions(content);
    expect(actions).toHaveLength(1);
    expect(actions[0].label).toBe("Book 12013 · CC (AVL 354 ₹675)");
    expect(actions[0].utterance).toBe("12013 mein CC book krdo");
    expect(actions[0].primary).toBe(true);
    expect(text).not.toContain("[NEXT]");
    expect(text).toContain("12013 AMRITSAR SHTABDI");
  });

  it("do se zyada [NEXT] lines ignore (chip ki bharmaar nahi) aur primary pehla", () => {
    const content = [
      "1",
      "[NEXT] A => a",
      "[NEXT] B => b",
      "[NEXT] C => c",
    ].join("\n");
    const { actions } = extractNextActions(content);
    expect(actions.map((a) => a.label)).toEqual(["A", "B"]);
    expect(actions[0].primary).toBe(true);
    expect(actions[1].primary).toBe(false);
  });

  it("format tolerant: arrow/colon, spaces, markdown bold", () => {
    const { actions } = extractNextActions("[NEXT] **Kis train me seat hai?** : saari trains ki seat batao");
    expect(actions[0].label).toBe("Kis train me seat hai?");
    expect(actions[0].utterance).toBe("saari trains ki seat batao");
  });

  it("[NEXT] na ho to kuch nahi chhua jaata (normal jawab waisa hi)", () => {
    const plain = "LDH → ASR kal 27 trains hain. Sabse fast: 22487 VANDE BHARAT EXP (1h 50m).";
    const { text, actions } = extractNextActions(plain);
    expect(actions).toEqual([]);
    expect(text).toBe(plain);
  });

  it("adhoori/khaali [NEXT] line kabhi chip nahi banti par line bhi nahi chhupti? — drop (khaali suggestion nahi)", () => {
    const { text, actions } = extractNextActions("Jawab.\n[NEXT]  =>  ");
    expect(actions).toEqual([]);
    /* line drop ki gayi kyunki wo hamara protocol token hai, user ko dikhane layak nahi */
    expect(text).toBe("Jawab.");
  });
});

describe("Round-32 · prompt: model ko agle kadam ka hukm milta hai (rule 13 + 26)", () => {
  it("rule 26 [NEXT] protocol ke saath maujood hai (sirf is turn ke data se)", () => {
    const src = read("server/agent/agentic.ts");
    expect(src).toContain("26. AGLA KADAM");
    expect(src).toContain("[NEXT] <chhota label> => <wahi baat jo user bhej sakta hai>");
    expect(src).toMatch(/sirf ISI turn ke tool data se banao/);
    expect(src).toContain("max 2 lines");
  });

  it("rule 13 update: chit-chat offer mana, par asli agla kadam HAMESHA", () => {
    const src = read("server/agent/agentic.ts");
    expect(src).toMatch(/Par user ka ASLI agla kadam HAMESHA aage badhao/);
    expect(src).toMatch(/generic chit-chat offer\/continuation KABHI mat likho/);
  });

  it("server actions ko evidence se validate karta hai (jhootha chip UI par nahi)", () => {
    const src = read("server/agent/agentic.ts");
    expect(src).toContain("const nextActions = extracted.actions.filter((a) => groundingCheck(");
    /* Round-36b: dedicated NEXT call ke baad final list — model ne kuch na diya to null (koi data fallback nahi). */
    expect(src).toContain("nextActions: nextActionsFinal.length ? nextActionsFinal : null,");
  });

  it("response contract me nextActions har layer par jaata hai (run → app → client)", () => {
    expect(read("server/agent/run.ts")).toContain("nextActions: turn.nextActions ?? null,");
    expect(read("server/agent/run.ts")).toContain("nextActions?: import(\"./agentic.js\").NextAction[] | null;");
    expect(read("server/app.ts")).toContain("nextActions: reconcileNextActions(result.nextActions ?? null, [");
    expect(read("src/api.ts")).toContain("nextActions?: { label: string; utterance: string; primary?: boolean }[] | null;");
  });

  it("har query pehle model ke paas — client ka flow wahi hai (agentStream pehle, local shortcut sirf 3 case)", () => {
    const src = read("src/views/Concierge.tsx");
    expect(src).toContain("await api.agentStream({");
    expect(src).toMatch(/if \(!criticalBookingFlow && !classPickWhileSelected && !localUiQuery\) \{/);
    /* sirf booking-flow, short class pick, aur local UI query local rehte hain — baaki sab model ke paas */
    expect(src).toContain("const localUiQuery =");
  });
});

describe("Round-32 · client: model ka decision pehle, data fallback doosra", () => {
  const src = () => read("src/views/Concierge.tsx");

  it("model ke actions hone par wahi chips banti hain (source: model)", () => {
    const c = src();
    expect(c).toContain("const modelActions = agentRes.nextActions ?? [];");
    expect(c).toMatch(/if \(modelActions\.length\) \{/);
    expect(c).toContain('source: "model"');
    expect(c).toContain("options: modelActions.map((a, i) => ({ id: `m${i}`, label: a.label, utterance: a.utterance, primary: a.primary ?? i === 0 }))");
  });

  it("Round-36: model ne na diya ho to koi data-fallback chip NAHI (card dikhta hi nahi)", () => {
    const c = src();
    expect(c).not.toContain("const ns = nextStepsFor({");
    expect(c).not.toContain('source: "data"');
    expect(c).toMatch(/if \(modelActions\.length\) \{/);
  });

  it("card par saaf likha hai ki agla kadam AI ne chuna (data tag ab kabhi nahi)", () => {
    const c = src();
    expect(c).toContain('{block.source === "model" ? "AI ne chuna" : "verified data se"}');
    /* Round-36: "verified data se" label dono jagah dikhta hai lekin source kabhi "data" set nahi hota
     * (client sirf model ka block banata hai) — isliye practically sirf "AI ne chuna" hi rehta hai. */
    expect(c).not.toContain('source: "data"');
    const css = read("src/styles.css");
    expect(css).toContain(".ns-tag.model");
  });

  it("block type me source field hai (orchestrate)", () => {
    expect(read("src/ai/orchestrate.ts")).toContain('source?: "model" | "data";');
  });
});

/* ── Round-32b (26 Sep 2026, LIVE par pakda gaya) ──────────────────────────────────────────────
 * Live: model ke tool ne ek provider se CC AVL 334 ₹490 liya, screen ka board doosre provider se
 * CC AVL 341 ₹675 — dono asli, par ek hi screen par do alag number. Rule: action model ka hi
 * rahega, sirf takraane wale numbers chip se hatenge (board card upar se hi numbers dikhata hai). */
describe("Round-32b: model chip vs board rows (conflict par numbers strip)", () => {
  const board = [
    { number: "12013", classCode: "CC", seats: 341, fare: 675, rac: null, waitlist: null },
    { number: "12013", classCode: "EC", seats: 23, fare: 1015, rac: null, waitlist: null },
  ];
  it("board ke numbers se takraane par sirf numbers hatte hain, action model ka hi rehta hai", () => {
    const out = reconcileNextActions(
      [{ label: "Book 12013 · CC (AVL 334 ₹490)", utterance: "12013 mein CC book krdo", primary: true }],
      board,
    );
    expect(out).toHaveLength(1);
    expect(out?.[0].label).toBe("Book 12013 · CC");
    expect(out?.[0].label).toContain("12013"); // train number user ko dikhna chahiye
    expect(out?.[0].utterance).toBe("12013 mein CC book krdo");
    expect(out?.[0].primary).toBe(true);
  });
  it("numbers match karein to label bilkul waisa hi", () => {
    const out = reconcileNextActions([{ label: "Book 12013 · CC (AVL 341 ₹675)", utterance: "12013 mein CC book krdo", primary: true }], board);
    expect(out?.[0].label).toBe("Book 12013 · CC (AVL 341 ₹675)");
  });
  it("board me na ho (model ke apne tool ka data) → kuch nahi chhedte", () => {
    const out = reconcileNextActions([{ label: "Book 14631 · SL (AVL 100 ₹150)", utterance: "14631 mein SL book krdo", primary: true }], board);
    expect(out?.[0].label).toBe("Book 14631 · SL (AVL 100 ₹150)");
  });
  it("doosri class ka number galat class par nahi lagta (EC ka 23 CC par conflict nahi karta)", () => {
    const out = reconcileNextActions([{ label: "Book 12013 · CC (AVL 23)", utterance: "12013 CC book krdo", primary: true }], board);
    expect(out?.[0].label).toBe("Book 12013 · CC"); // CC ke liye 23 board me nahi (EC ka hai) → strip
  });
  it("chip me sirf numbers the → chip hi drop (jhoothi suggestion nahi)", () => {
    const out = reconcileNextActions([{ label: "AVL 334 ₹490", utterance: "334 ₹490", primary: true }], board);
    expect(out).toBeNull();
  });
  it("koi board row nahi (non-seat turn) → model ke chips waise hi", () => {
    const acts = [{ label: "Kis train me seat hai?", utterance: "kis train me seat hai", primary: true }];
    expect(reconcileNextActions(acts, [])).toEqual(acts);
    expect(reconcileNextActions(null, board)).toBeNull();
  });
  it("utterance me bhi takraane wala seat number ho to wahan se bhi hat jaata hai", () => {
    const out = reconcileNextActions([{ label: "Book 12013 · CC", utterance: "12013 CC AVL 334 wali book krdo", primary: true }], board);
    expect(out?.[0].utterance).not.toContain("334");
    expect(out?.[0].utterance).toContain("12013");
  });
  it("generic count (Baaki trains bhi (24)) ko conflict nahi samajhta", () => {
    const out = reconcileNextActions([{ label: "Baaki trains bhi (24)", utterance: "baaki trains bhi dikhao", primary: false }], board);
    expect(out?.[0].label).toBe("Baaki trains bhi (24)");
  });
});
