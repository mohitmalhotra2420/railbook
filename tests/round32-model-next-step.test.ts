/* Round-32 (26 Sep 2026, user correction):

 *   "Isliye ab dimaag data ka lagta hai, model ka nahi — lekin maine to bola hai na ki har query pehle
 *    model ke pass jaani chahiye and wo decide kare kon sa tool use karna yan kya karna hai, user ka
 *    answer kahan se laana hai"
 *
 * Pehle: jawab ke baad ka "agla kadam" SIRF data se banta tha (UI). Ab: **model khud decide karta hai** —
 * apne reply ke aakhir me `[NEXT] label => utterance` line(s) likh kar (prompt rule 26). Server unhe
 * reply text se ALAG karta hai (user ko raw line nahi dikhti), tool-evidence se VALIDATE karta hai
 * (jo number/naam is turn me nahi aaya wo drop), aur client unhi ko chips me dikhata hai. Model ne na
 * diya ho to verified-data fallback chalta hai — kabhi khaali nahi, kabhi jhootha nahi.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { extractNextActions } from "../server/agent/agentic";

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
    expect(src).toContain("nextActions: nextActions.length ? nextActions : null,");
  });

  it("response contract me nextActions har layer par jaata hai (run → app → client)", () => {
    expect(read("server/agent/run.ts")).toContain("nextActions: turn.nextActions ?? null,");
    expect(read("server/agent/run.ts")).toContain("nextActions?: import(\"./agentic.js\").NextAction[] | null;");
    expect(read("server/app.ts")).toContain("nextActions: result.nextActions ?? null,");
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

  it("model ne na diya ho to verified-data fallback (Round-31) chalta hai (source: data)", () => {
    const c = src();
    expect(c).toContain("const ns = nextStepsFor({");
    expect(c).toContain('blocks.push({ type: "nextstep", source: "data", options: ns.options, hint: ns.hint });');
  });

  it("card par saaf likha hai ki agla kadam AI ne chuna ya data se bana (chhupa nahi)", () => {
    const c = src();
    expect(c).toContain('{block.source === "model" ? "AI ne chuna" : "verified data se"}');
    const css = read("src/styles.css");
    expect(css).toContain(".ns-tag.model");
  });

  it("block type me source field hai (orchestrate)", () => {
    expect(read("src/ai/orchestrate.ts")).toContain('source?: "model" | "data";');
  });
});
