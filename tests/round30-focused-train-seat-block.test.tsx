/* Round-30 (26 Sep 2026, user ke 2 screenshots @686a88f) — ek hi complaint:

 *   "12013 ki seat availability btana kal ke liye ludhiana se amritsar ke liye" maanga tha, par chat me
 *   poori live board (21 trains × saari classes) khul gayi. User: "yeh question pe board kyu le aata
 *   although esne answer baad mein sahi diya … maine to maanga hi nahi".
 *
 * Fix (display-level): message me train number ho to seat ka block SIRF usi train ka — generic sawaal
 * ("seat wali trains batao") par pehle jaisa poora board. Server ka payload/rows waisa hi rehta hai;
 * kuch invent/filter karke data nahi badla jaata — sirf dikhaya kam hota hai.
 */
import { describe, expect, it } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

import { focusSeatRows, seatListGroups, trainNumbersInText } from "../src/chatText";
import { SeatListBlock } from "../src/views/Concierge";

const rows = [
  { number: "12013", name: "AMRITSAR SHTABDI", classCode: "CC", status: "AVAILABLE", seats: 357, rac: null, waitlist: null, fare: 675, departure: null, durationMinutes: null },
  { number: "12013", name: "AMRITSAR SHTABDI", classCode: "EC", status: "AVAILABLE", seats: 23, rac: null, waitlist: null, fare: 1015, departure: null, durationMinutes: null },
  { number: "22487", name: "VANDE BHARAT EXP", classCode: "CC", status: "AVAILABLE", seats: 139, rac: null, waitlist: null, fare: 790, departure: null, durationMinutes: null },
  { number: "14631", name: "DDN ASR EXPRESS", classCode: "SL", status: "AVAILABLE", seats: 101, rac: null, waitlist: null, fare: 150, departure: null, durationMinutes: null },
  { number: "11057", name: "CSMT ASR EXPRESS", classCode: "3E", status: "AVAILABLE", seats: 38, rac: null, waitlist: null, fare: 520, departure: null, durationMinutes: null },
  { number: "11057", name: "CSMT ASR EXPRESS", classCode: "SL", status: "WAITLIST", seats: null, rac: null, waitlist: 1, fare: 150, departure: null, durationMinutes: null },
  { number: "15707", name: "KIR ASR EXPRESS", classCode: "2A", status: "AVAILABLE", seats: 37, rac: null, waitlist: null, fare: 725, departure: null, durationMinutes: null },
  { number: "15707", name: "KIR ASR EXPRESS", classCode: "3A", status: "NOT_AVAILABLE", seats: null, rac: null, waitlist: null, fare: 520, departure: null, durationMinutes: null },
];

describe("Round-30 · message me se maangi hui train number", () => {
  it("screenshot ka asli sawaal — 12013 nikalta hai (route/date/time use nahi)", () => {
    expect(trainNumbersInText("12013 ki seat availability btana kal ke liye ludhiana se amritsar ke liye")).toEqual(["12013"]);
  });

  it("tareekh aur saal train nahi samjhe jaate", () => {
    expect(trainNumbersInText("12013 ki seat availability 2026-09-27 ko")).toEqual(["12013"]);
    expect(trainNumbersInText("kal 27/09/2026 ko 12013 ki seat")).toEqual(["12013"]);
    expect(trainNumbersInText("2026-09-27 ko seat batao")).toEqual([]);
    expect(trainNumbersInText("18:01 par 22487 ki availability")).toEqual(["22487"]);
    expect(trainNumbersInText("sham 7 baje ki train")).toEqual([]);
  });

  it("ek se zyada train, aur duplicate ek hi baar (order wahi)", () => {
    expect(trainNumbersInText("12013 aur 22487 dono ki seat")).toEqual(["12013", "22487"]);
    expect(trainNumbersInText("12013 ki seat 12013 kal")).toEqual(["12013"]);
  });

  it("generic sawaal (koi train number nahi) — poori list waisi hi rehti hai", () => {
    const text = "kal ke liye seat wali trains batao ludhiana se amritsar";
    expect(trainNumbersInText(text)).toEqual([]);
    expect(focusSeatRows(rows, [])).toHaveLength(rows.length);
    expect(focusSeatRows(rows, [])).toBe(rows);
  });

  it("focus rows sirf maangi hui train ki; list me na ho to kuch nahi (unrelated board nahi)", () => {
    const only = focusSeatRows(rows, ["12013"]);
    expect(only.map((r) => r.number)).toEqual(["12013", "12013"]);
    expect(only.map((r) => r.classCode)).toEqual(["CC", "EC"]);
    /* values waisi hi — koi merge/sum nahi */
    expect(only[0].seats).toBe(357);
    expect(only[1].seats).toBe(23);
    expect(focusSeatRows(rows, ["99999"])).toEqual([]);
    /* do trains maange gaye ho to dono, apne apne data ke saath */
    expect(focusSeatRows(rows, ["12013", "15707"]).map((r) => r.number)).toEqual(["12013", "12013", "15707", "15707"]);
    /* input mutate nahi hoti */
    expect(rows).toHaveLength(8);
  });
});

describe("Round-30 · chat block sirf maangi hui train ka", () => {
  const block = {
    type: "seatlist" as const,
    from: "LDH",
    to: "ASR",
    toName: "Amritsar Junction",
    date: "2026-09-27",
    source: "confirmtkt",
    focus: ["12013"],
    rows: focusSeatRows(rows, ["12013"]),
  };

  it("header saaf bolta hai ki ye aapki maangi train hai — 1 card, 2 class chips", () => {
    const { container } = render(<SeatListBlock block={block} onPick={() => undefined} />);
    const head = container.querySelector(".sf-head")?.textContent ?? "";
    expect(head).toContain("Aapki maangi train (live board)");
    expect(head).toContain("12013");
    expect(head).toContain("1 train");
    /* "me seat" = kitni TRAINS me seat hai (12013 ki dono classes me hai → 1 train) */
    expect(head).toContain("1 me seat");
    /* sirf ek group — 21 nahi */
    expect(container.querySelectorAll(".sf-group").length).toBe(1);
    const text = container.textContent ?? "";
    expect(text).toContain("AMRITSAR SHTABDI");
    expect(text).toContain("357");
    expect(text).toContain("1,015");
    /* doosri trains ka koi zikr nahi */
    expect(text).not.toContain("VANDE BHARAT");
    expect(text).not.toContain("KIR ASR");
    expect(text).not.toContain("DDN ASR");
  });

  it("chips tappable hain — tap → usi train/class ka row (passenger form ka rasta)", () => {
    let picked: { number?: string; classCode?: string; status?: string } | null = null;
    const { container } = render(
      <SeatListBlock
        block={block}
        onPick={(r) => {
          picked = r as unknown as { number?: string; classCode?: string; status?: string };
        }}
      />,
    );
    const chips = [...container.querySelectorAll(".sf-cchip")];
    expect(chips.length).toBe(2);
    fireEvent.click(chips[1]);
    expect(picked).not.toBeNull();
    expect((picked as unknown as { number: string }).number).toBe("12013");
    expect((picked as unknown as { classCode: string; status: string }).classCode).toBe("EC");
    expect((picked as unknown as { classCode: string; status: string }).status).toBe("AVAILABLE");
  });

  it("generic sawaal (focus nahi) par pehle jaisa header — poori board", () => {
    const generic = { ...block, focus: undefined, rows };
    const { container } = render(<SeatListBlock block={generic} onPick={() => undefined} />);
    expect(container.querySelector(".sf-head")?.textContent).toContain("Seat wali trains (live board)");
    expect(container.querySelectorAll(".sf-group").length).toBe(seatListGroups(rows).length);
    expect(container.querySelector(".sf-card")?.className).not.toContain("sf-focused");
  });

  it("focus wale block ka apna halka pehchaan (sf-focused)", () => {
    const { container } = render(<SeatListBlock block={block} onPick={() => undefined} />);
    expect(container.querySelector("#chat-seatlist")?.className).toContain("sf-focused");
  });

  it("Concierge wiring: message ke train number se block scope hota hai", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/views/Concierge.tsx"), "utf8");
    /* Round-31 me number extraction ek hi jagah: askedTrains (dikhane aur agle kadam, dono ke liye). */
    expect(src).toContain("const askedTrains = trainNumbersInText(trimmed);");
    expect(src).toContain("const focus = askedTrains;");
    expect(src).toContain("const rows = focusSeatRows(all, focus);");
    expect(src).toContain("focus: focus.length ? focus : undefined,");
    /* block sirf tab banta hai jab rows bachi hon (maangi train list me na ho → koi board nahi) */
    expect(src).toMatch(/if \(sf && rows\.length\) \{/);
    /* Round-29 ka booking auto-advance bhi wahi helper use kare (saal "2026" train na bane) */
    expect(src).toContain("trainNumber: (trainNumbersInText(trimmed)[0] ??");
    /* data server payload se hi — koi naya/invent kiya row nahi */
    expect(src).toContain("const all = [...(sf?.rows ?? []), ...(sf?.wlRows ?? [])];");
  });

  it("CSS: focused block ka halka pehchaan maujood hai", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toContain(".sf-card.sf-focused");
  });
});
