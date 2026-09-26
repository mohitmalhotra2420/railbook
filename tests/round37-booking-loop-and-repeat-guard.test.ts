/* Round-37 (27 Sep 2026) — user screenshot: "12054 mein 2S book krdo" TEEN baar bheja, AI ne teen baar
 * WAHI jawab dohraya aur passenger form khula hi nahi. User: "yeh AI ko samjhna chahiye tha aur sahi
 * answer karna chahiye tha … AI khud kyu nhi samjhke sahi se outcome deta? jaise chatgpt/gemini/claude/
 * manus … ek dum se accurate answer dete hai but mera AI kyu nhi krta, waise esko bhi waisa banao."
 *
 * Yahan teen fixes verify hote hain:
 *   1) client booking-target resolver (route/date har verified source se — picker tap, seat rows, trains
 *      list, ctx, booking state) → form khulta hai, ulta sawaal nahi;
 *   2) server picker-capture (picker message se origin/destination/train context lock);
 *   3) server repeat-guard (wahi jawab dobara → ek corrective call, phir naya jawab).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { extractRouteDateFromChat, resolveBookingTarget, type BookingTargetSources } from "../src/booking/autobook";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

const base: BookingTargetSources = {
  trainNumber: "12054",
  classWanted: "2S",
  state: { from: null, to: null, date: "", dateProvided: false, selectedTrain: null },
  ctx: null,
  picked: null,
  seat: null,
  remembered: null,
  trains: null,
};

describe("Round-37 · booking target resolver — screenshot wala case", () => {
  it("picker tap se route milta hai (ASR → HW), date ctx se → poora target", () => {
    const t = resolveBookingTarget({
      ...base,
      picked: { number: "12054", from: "ASR", to: "HW" },
      ctx: { origin: null, destination: null, date: "2026-09-28", dateProvided: true },
    });
    expect(t.from).toBe("ASR");
    expect(t.to).toBe("HW");
    expect(t.date).toBe("2026-09-28");
    expect(t.missing).toEqual([]);
  });

  it("picker route + yaad rakhi seat rows ka date → poora target", () => {
    const t = resolveBookingTarget({
      ...base,
      picked: { number: "12054", from: "ASR", to: "HW" },
      remembered: { from: "ASR", to: "HW", date: "2026-09-28", rows: [{ number: "12054" }] },
    });
    expect(t.date).toBe("2026-09-28");
    expect(t.missing).toEqual([]);
  });

  it("route hi na mile to route missing batao (jhootha form nahi)", () => {
    const t = resolveBookingTarget({ ...base, ctx: { date: "2026-09-28", dateProvided: true } });
    expect(t.missing).toContain("route");
  });

  it("sirf date missing ho to sirf date maango (class dobara nahi)", () => {
    const t = resolveBookingTarget({
      ...base,
      classWanted: null,
      picked: { number: "12054", from: "ASR", to: "HW" },
      ctx: null,
    });
    expect(t.missing).toEqual(["date"]);
    expect(t.classCode).toBeNull();
  });

  it("ctx ke route se bhi kaam chalta hai (state khaali ho)", () => {
    const t = resolveBookingTarget({
      ...base,
      classWanted: null,
      ctx: { origin: { code: "LDH" }, destination: { code: "NDLS" }, date: "2026-09-28", dateProvided: true },
    });
    expect(t.from).toBe("LDH");
    expect(t.to).toBe("NDLS");
    expect(t.missing).toEqual([]);
  });

  it("booking state ka selectedTrain route/date se bhi (sabse authoritative pehle)", () => {
    const t = resolveBookingTarget({
      ...base,
      state: {
        from: null,
        to: null,
        date: "",
        dateProvided: false,
        selectedTrain: { number: "12054", from: { code: "ASR" }, to: { code: "HW" }, date: "2026-09-28" },
      },
      picked: { number: "99999", from: "XXX", to: "YYY" }, // koi aur train — ignore hona chahiye
    });
    expect(t.from).toBe("ASR");
    expect(t.date).toBe("2026-09-28");
  });

  it("yaad rakhi rows kisi AUR train ki hon to unka route use nahi (galat form nahi)", () => {
    const t = resolveBookingTarget({
      ...base,
      trainNumber: "22126",
      remembered: { from: "ASR", to: "HW", date: "2026-09-28", rows: [{ number: "12054" }] },
      ctx: { date: "2026-09-28", dateProvided: true },
    });
    expect(t.missing).toContain("route");
  });

  it("train number hi na ho to train missing (client model ko jaane de)", () => {
    const t = resolveBookingTarget({ ...base, trainNumber: null });
    expect(t.missing).toContain("train");
  });
});

describe("Round-37 · client booking branch", () => {
  const src = read("src/views/Concierge.tsx");

  it("resolver use hota hai aur poora target milne par seedha form khulta hai", () => {
    expect(src).toContain("const target = resolveBookingTarget({");
    expect(src).toContain("if (target.trainNumber && target.from && target.to && target.date) {");
    expect(src).toContain("openBookingFromSeatRow(seat, { from: routeFrom.code, to: routeTo.code, toName: routeTo.name ?? null, date: routeDate });");
  });

  it("sirf date missing ho to saaf date maangta hai (loop band)", () => {
    expect(src).toContain('target.missing.every((m) => m === "date")');
    expect(src).toContain("kis date ko jaana hai? (jaise: kal, aaj, ya 28-09-2026). Date milte hi passenger form khul jayega.");
  });

  it("picker tap par route yaad rakha jaata hai (module-scope, BlockView → Concierge)", () => {
    expect(src).toContain("const lastPickedTrainRef: { current: { number: string; from: string; to: string; date?: string | null } | null } = { current: null };");
    expect(src).toContain("if (t.from && t.to) lastPickedTrainRef.current = { number: String(t.number), from: t.from, to: t.to, date: null };");
  });

  it("class boli ho (2S) to class-choice gate skip — seedha usi class ka form", () => {
    expect(src).toContain("if (clsWanted || uniqClasses.length < 2) {");
    expect(src).toContain("const pickedClass = clsWanted ? withSeat.find((r) => classKey(r) === clsWanted) ?? null : null;");
  });
});

describe("Round-37 · wahi hukm dobara par saaf jawab (form pehle se khula)", () => {
  it("'already' case me model ke 'booking nahi kar sakta' ki jagah saaf line", () => {
    const src = read("src/views/Concierge.tsx");
    expect(src).toContain("ka passenger form pehle se khula hai — usme details bhar do.");
    expect(src).toContain("main passenger details nahi bharta.");
  });
});

describe("Round-37 · server: picker capture + repeat guard + rule 29", () => {
  const run = read("server/agent/run.ts");
  const agentic = read("server/agent/agentic.ts");

  it("picker message se origin/destination/train context lock hota hai", () => {
    expect(run).toContain("Round-37 (user screenshot: train picker se");
    expect(run).toContain("if (!ctx.selectedTrainNumber) ctx.selectedTrainNumber = num;");
    expect(run).toMatch(/ctx\.origin = \{ code: from, name: from, city: from \};/);
  });

  it("repeat-guard: wahi jawab dobara likha jaaye to corrective call", () => {
    expect(agentic).toContain("const isRepeat = prevReply.length > 40");
    expect(agentic).toContain("tumne apne PICHHLE jawab ki wahi baat dobara likhi hai (loop)");
    expect(agentic).toContain("Jo cheez user ne is baar bata di (class/date/passengers/train/route) use FINAL maano");
    expect(agentic).toContain("let repeatRepaired = false;");
  });

  it("rule 29: jawab ek damm seedha, purani cheez dobara nahi, confident knowledge answer", () => {
    expect(agentic).toContain("29. JAWAB EK DAMM SEEDHA");
    expect(agentic).toContain("wahi cheez dobara MAT poochho");
    expect(agentic).toContain("apna pichhla sawaal dobara mat likho (loop mat banao)");
    expect(agentic).toContain("duniya ka sabse acha assistant ki tarah confident, sahi aur poora jawab do");
  });

  it("repeat-guard sirf tab chalta hai jab budget aur steps bache hon", () => {
    const i = agentic.indexOf("const isRepeat = prevReply.length > 40");
    const blk = agentic.slice(i, i + 700);
    expect(blk).toContain("!repeatRepaired");
    expect(blk).toContain("timeLeft() > 8000");
    expect(blk).toContain("step < MAX_STEPS");
  });
});

describe("Round-37b · user ke apne chat se route/date nikaalna (server ctx reset ho jaata hai)", () => {
  const today = "2026-09-27";
  const add = (ymd: string, d: number) => {
    const [y, m, dd] = ymd.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, dd + d));
    return t.toISOString().slice(0, 10);
  };

  it("codes wala route + 'kal' → dono milte hain (ASR se HW kal ke liye)", () => {
    const r = extractRouteDateFromChat(
      [{ role: "user", text: "12054 ki seat availability batao ASR se HW kal ke liye" }],
      { todayYmd: today, addDays: add },
    );
    expect(r.from).toBe("ASR");
    expect(r.to).toBe("HW");
    expect(r.date).toBe("2026-09-28");
  });

  it("station ke naam se bhi (ludhiana se amritsar kal)", () => {
    const r = extractRouteDateFromChat(
      [{ role: "user", text: "ludhiana se amritsar kal ki trains batao" }],
      { todayYmd: today, addDays: add, matchStationFuzzy: (raw) => ({ code: /ludhiana/i.test(raw) ? "LDH" : "ASR" }) },
    );
    expect(r.from).toBe("LDH");
    expect(r.to).toBe("ASR");
    expect(r.date).toBe("2026-09-28");
  });

  it("date formats bhi (28-09-2026)", () => {
    const r = extractRouteDateFromChat(
      [{ role: "user", text: "LDH → NDLS 28-09-2026 ko seat" }],
      { todayYmd: today, addDays: add },
    );
    expect(r.date).toBe("2026-09-28");
  });

  it("kuch na mile to khaali (koi andaza nahi)", () => {
    const r = extractRouteDateFromChat([{ role: "user", text: "12054 mein 2S book krdo" }], { todayYmd: today, addDays: add });
    expect(r).toEqual({ from: undefined, to: undefined, date: undefined });
  });

  it("aakhri (sabse taaza) message jeetta hai", () => {
    const r = extractRouteDateFromChat(
      [
        { role: "user", text: "LDH se NDLS kal" },
        { role: "assistant", text: "theek hai" },
        { role: "user", text: "ASR se HW aaj" },
      ],
      { todayYmd: today, addDays: add },
    );
    expect(r.from).toBe("ASR");
    expect(r.to).toBe("HW");
    expect(r.date).toBe("2026-09-27");
  });

  it("resolver 'said' source ko fallback ke roop me use karta hai (ctx khaali ho)", () => {
    const t = resolveBookingTarget({
      ...base,
      ctx: { origin: null, destination: null, date: null, dateProvided: false },
      said: { from: "ASR", to: "HW", date: "2026-09-28" },
    });
    expect(t.from).toBe("ASR");
    expect(t.to).toBe("HW");
    expect(t.date).toBe("2026-09-28");
    expect(t.missing).toEqual([]);
  });

  it("client extractor ko wire karta hai (messages se)", () => {
    const c = read("src/views/Concierge.tsx");
    expect(c).toContain("said: extractRouteDateFromChat(");
    expect(c).toContain("matchStationFuzzy: (r) => matchStationFuzzy(r),");
  });
});

describe("Round-37d · web/general sawaal par ChatGPT-jaisa COMPOSED jawab (raw dump nahi)", () => {
  const agentic = read("server/agent/agentic.ts");

  it("shared chhota-model helper (provider-aware) maujood hai", () => {
    expect(agentic).toContain("async function smallModelCall(system: string, user: string");
    expect(agentic).toContain("if (candidates.length > 1) candidates.unshift(candidates.splice(1, 1)[0]); // fast (fallback) model pehle");
  });

  it("web-answer composition: sirf diye gaye facts se, comparison ho to points, jawab na mile to saaf bolna", () => {
    expect(agentic).toContain("async function composeWebAnswer(");
    expect(agentic).toContain("Agar sawaal COMPARISON ka hai (fark/better/kaunsa)");
    expect(agentic).toContain("kuch bana kar mat likho");
  });

  it("WEB_SEARCH ka topic-answer ab composed hota hai (raw extract dump nahi)", () => {
    expect(agentic).toContain("const composed = await composeWebAnswer(userText || q, ans.text, ans.title);");
    expect(agentic).toContain("${composed ?? ans.text}");
  });

  it("deterministic web-rescue bhi composed jawab deta hai (Fallback bhi dump nahi)", () => {
    expect(agentic).toContain("const composed = await composeWebAnswer(userText, `${best.title}\\n${best.snippet}`, best.title);");
    expect(agentic).toContain("Web se mila${best.title ? ` (${best.title})` : \"\"}: ${composed ?? best.snippet}");
  });

  it("NEXT-step call bhi isi shared helper par chalta hai (duplicate logic nahi)", () => {
    expect(agentic).toContain("export async function nextStepFromModelOnly(");
    const i = agentic.indexOf("export async function nextStepFromModelOnly(");
    const blk = agentic.slice(i, i + 2000);
    expect(blk).toContain("await smallModelCall(");
    expect(blk).toContain("extractNextActions(content).actions");
  });
});

describe("Round-37e · form khula ho to dobara hukm par turant saaf jawab (server chakkar nahi)", () => {
  const c = read("src/views/Concierge.tsx");

  it("early already-open branch maujood hai (booking intent + selectedTrain)", () => {
    expect(c).toContain("if (isBookingIntent(trimmed, null) && state.selectedTrain) {");
    expect(c).toContain("const sameTrain = tno0 && String(state.selectedTrain.number ?? \"\") === tno0;");
    expect(c).toContain("if (sameTrain && sameClass) {");
  });

  it("criticalBookingFlow booking-hukm wale message ko nahi khaata (pehle atak jaata tha)", () => {
    const i = c.indexOf("const criticalBookingFlow =");
    const blk = c.slice(i, i + 400);
    expect(blk).toContain("!isBookingIntent(trimmed, null) &&");
  });

  it("jawab me saaf likha hai ki form khula hai + passenger details AI nahi bharta", () => {
    expect(c).toContain("ka passenger form pehle se khula hai — usme passenger details bhar do.");
    expect(c).toContain('main aapke liye passenger details nahi bharta.');
  });
});

describe("Round-37f · general sawaal par ChatGPT-jaisa saaf jawab (raw dump / uljhane wali lines nahi)", () => {
  const kb = read("server/agent/railkb.ts");
  const agentic = read("server/agent/agentic.ts");

  it("KB ab alag shabdon wali query bhi pakadta hai (60%+ token overlap)", () => {
    expect(kb).toContain("const hit = kt.filter((w) => qtok.has(w)).length / kt.length;");
    expect(kb).toContain("if (hit >= 0.6) score += 3;");
  });

  it("composer inkaar kare to short excerpt (raw dump nahi) aur 'SAAF' jaisa token user ko na dikhe", () => {
    expect(agentic).toContain("if (!text || /^saf+\\b/i.test(text)");
    expect(agentic).toContain("slice(0, 2)");
  });

  it("'providers ke data se match nahi hua' line web/KB jawab par nahi lagti", () => {
    expect(agentic).toContain("const hasWebAnswer = steps.some((s) => s.ok && (s.tool === \"WEB_SEARCH\" || s.source === \"web\" || s.source === \"kb\"));");
    expect(agentic).toContain("reply: hasWebAnswer");
  });
});
