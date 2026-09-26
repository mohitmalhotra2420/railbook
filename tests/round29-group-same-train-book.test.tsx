/* Round-29 (26 Sep 2026, user ke 2 screenshots @20be5c2) — chaar cheezein:

 *   1) "same train ki classes alag alag cards me kyun" (screenshot me 22432 do baar, 19804 do baar) →
 *      chat ke train-list ka card ab TRAIN-wise hai: ek train = ek card, header me number+naam EK baar,
 *      andar har class ki apni row (`3A | AVL 122 | ₹635`, `SL | AVL 94 | ₹250`). Pure display-level
 *      derived view-model — server ka text/rows waisa hi, order waisa hi, har class ka apna
 *      status/count/fare (koi merge/average/sum nahi), aur ek jaise duplicate record dobara nahi.
 *   2) "class chips tap nahi ho rahi" → chat card ki class row ab tappable: tap = usi train+class ka
 *      passenger form (wahi booking flow jo Seat Finder/direct card ke chips par chalta hai).
 *   3) "22432 mein 3A book krdo" → AI khud passenger form kholta hai, train+class+timings/fare pehle se
 *      bhare hue; "Check hui?" jaisa loop aur "check kar raha hoon" ki repeat nahi. Status pata na ho to
 *      bhi form khulta hai (live availability + fare "Review journey" par provider se).
 *   4) "vaishno devi" (chhota naam) → SVDK parse (poora "Shri Mata Vaishno Devi Katra" likhne ki zaroorat
 *      nahi).
 */
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

import { ReplyText, groupReplyRowsByTrain, type Row } from "../src/components/ReplyText";
import { buildAutoBookSeat, isBookingIntent, isOpenableStatus, pickRowForBooking } from "../src/booking/autobook";
import { findStationsInText, matchStation } from "../server/understand/legacy-stations";
import { matchStation as matchStationClient } from "../src/ai/stations";
import { bookingReducer, initialBooking } from "../src/booking/state";
import type { ClassAvailability, TrainResult } from "../src/types";

const row = (train: string, name: string, cls: string, status: string, extra: Partial<Row> = {}): Row => ({
  train,
  name,
  cls,
  status,
  count: null,
  fare: null,
  dep: null,
  scale: null,
  ...extra,
});

/* Screenshot 1 ka asli jawab-jaisa text: same train do baar, do alag cards me. */
const SCREENSHOT_TEXT = [
  "27 Sep 2026, SVDK → LDH, 1 passenger:",
  "* 22432 SFG MCTM SF EXP — 1A AVL 1 ₹1,270",
  "* 22432 SFG MCTM SF EXP — 3A AVL 1 ₹565",
  "* 19804 KOTA EXPRESS — 1A AVL 3 ₹1,455",
  "* 19804 KOTA EXPRESS — 2A RAC 6 ₹880",
].join("\n");

describe("Round-29 · ek train = ek card (display-only grouping)", () => {
  it("same train ki saari classes ek hi card me — number/naam sirf ek baar", () => {
    const { container } = render(<ReplyText text={SCREENSHOT_TEXT} />);
    const cards = [...container.querySelectorAll(".rp-row")];
    /* Do trains, do cards — chaar nahi. */
    expect(cards.length).toBe(2);
    const heads = cards.map((c) => c.querySelector(".rp-no")?.textContent ?? "");
    expect(heads).toEqual(["22432", "19804"]);
    expect(cards[0].textContent).toContain("SFG MCTM SF EXP");
    /* Naam card me ek hi baar likha hai (dohraya nahi). */
    expect((cards[0].textContent?.match(/SFG MCTM SF EXP/g) ?? []).length).toBe(1);
    /* Har card me us train ki classes ki rows. */
    expect([...cards[0].querySelectorAll(".rp-crow")].length).toBe(2);
    expect([...cards[1].querySelectorAll(".rp-crow")].length).toBe(2);
    expect(cards[0].textContent).toContain("1A");
    expect(cards[0].textContent).toContain("3A");
  });

  it("har class ka apna AVL/fare — merge/average/sum nahi (acceptance: 12752 3A 122 ₹635 + SL 94 ₹250)", () => {
    const text = "* 12752 NED HUMSAFAR — 3A AVL 122 ₹635\n* 12752 NED HUMSAFAR — SL AVL 94 ₹250";
    const { container } = render(<ReplyText text={text} />);
    const cards = [...container.querySelectorAll(".rp-row")];
    expect(cards.length).toBe(1);
    const rows = [...cards[0].querySelectorAll(".rp-crow")].map((c) => c.textContent ?? "");
    expect(rows.length).toBe(2);
    expect(rows[0]).toContain("3A");
    expect(rows[0]).toContain("AVL 122");
    expect(rows[0]).toContain("₹635");
    expect(rows[1]).toContain("SL");
    expect(rows[1]).toContain("AVL 94");
    expect(rows[1]).toContain("₹250");
    /* Koi joda hua/fake number nahi (122+94=216 ya average 108 kabhi nahi). */
    expect(cards[0].textContent).not.toContain("216");
    expect(cards[0].textContent).not.toContain("108");
  });

  it("12356 ARCHANA EXP (SL/3A/3E) — ek card, teen class options, order wahi", () => {
    const text =
      "* 12356 ARCHANA EXP — SL AVL 45 ₹225\n* 12356 ARCHANA EXP — 3A AVL 33 ₹565\n* 12356 ARCHANA EXP — 3E AVL 10 ₹565";
    const { container } = render(<ReplyText text={text} />);
    const cards = [...container.querySelectorAll(".rp-row")];
    expect(cards.length).toBe(1);
    const classes = [...cards[0].querySelectorAll(".rp-crow .rp-cls")].map((c) => c.textContent);
    expect(classes).toEqual(["SL", "3A", "3E"]);
  });

  it("train ka order change nahi hota (jo pehle aaya wahi pehle) aur input mutate nahi hoti", () => {
    const rows = [
      row("19804", "KOTA EXPRESS", "2A", "RAC", { count: 6, fare: "₹880" }),
      row("22432", "SFG MCTM SF EXP", "1A", "AVAILABLE", { count: 1, fare: "₹1,270" }),
      row("19804", "KOTA EXPRESS", "1A", "AVAILABLE", { count: 3, fare: "₹1,455" }),
    ];
    const before = JSON.stringify(rows);
    const groups = groupReplyRowsByTrain(rows);
    expect(groups.map((g) => g.number)).toEqual(["19804", "22432"]);
    expect(groups[0].rows.map((r) => r.cls)).toEqual(["2A", "1A"]);
    /* classes ki apni values waisi hi (koi overwrite nahi) */
    expect(groups[0].rows[0].status).toBe("RAC");
    expect(groups[0].rows[0].count).toBe(6);
    expect(groups[0].rows[1].count).toBe(3);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("same train+same class ka bilkul same record dobara na aaye — par alag status/fare chhupta nahi", () => {
    const rows = [
      row("12356", "ARCHANA EXP", "SL", "AVAILABLE", { count: 45, fare: "₹225" }),
      row("12356", "ARCHANA EXP", "SL", "AVAILABLE", { count: 45, fare: "₹225" }), // exact duplicate
      row("12356", "ARCHANA EXP", "SL", "WAITLIST", { count: 12, fare: "₹225" }), // alag record — rahega
    ];
    const groups = groupReplyRowsByTrain(rows);
    expect(groups.length).toBe(1);
    expect(groups[0].rows.length).toBe(2);
    expect(groups[0].rows.map((r) => r.status)).toEqual(["AVAILABLE", "WAITLIST"]);
  });

  it("row parse na ho to poora text waisa hi (kuch adhoora/naya nahi banta)", () => {
    const text = "Is train mein 3A AVL 4 hai lekin fare nahi mila. Kal subah confirm karein.";
    const { container } = render(<ReplyText text={text} />);
    expect(container.querySelectorAll(".rp-row").length).toBe(0);
    expect(container.textContent).toBe(text);
  });

  it("adhoora match safety: aadhe shabd par ruk kar text nahi kaatta (screenshot 2 wala 'ability check…')", () => {
    const text =
      "22432 SFG MCTM SF EXP, SVDK → LDH ke liye 3A ki availability check karne ke liye journey date chahiye. Kis date ka availability chahiye?";
    const { container } = render(<ReplyText text={text} />);
    expect(container.querySelectorAll(".rp-row").length).toBe(0);
    /* Poora jumla waisa hi — beech se kata hua "ability check…" jaisa kuch nahi. */
    expect(container.textContent).toContain("ki availability check karne ke liye journey date chahiye");
  });
});

describe("Round-29 · class tap → seedha passenger form", () => {
  it("tappable class row tap karne par wahi row + us train ka group milta hai", () => {
    const onBook = vi.fn();
    const text = "* 22432 SFG MCTM SF EXP — 1A AVL 1 ₹1,270\n* 22432 SFG MCTM SF EXP — 3A AVL 1 ₹565";
    const { container } = render(<ReplyText text={text} onBook={onBook} />);
    const buttons = [...container.querySelectorAll("button.rp-crow")];
    expect(buttons.length).toBe(2);
    fireEvent.click(buttons[1]);
    expect(onBook).toHaveBeenCalledTimes(1);
    const [clicked, group] = onBook.mock.calls[0];
    expect(clicked.cls).toBe("3A");
    expect(clicked.train).toBe("22432");
    expect(clicked.status).toBe("AVAILABLE");
    expect(group.number).toBe("22432");
  });

  it("WL/WL-less status (UNKNOWN) bhi tappable hai — N/A par jhootha button nahi", () => {
    const onBook = vi.fn();
    const text = "* 12926 PASCHIM EXPRESS — SL WL 60 ₹285\n* 12926 PASCHIM EXPRESS — 3A N/A";
    const { container } = render(<ReplyText text={text} onBook={onBook} />);
    const buttons = [...container.querySelectorAll("button.rp-crow")];
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toContain("WL 60");
    expect(container.querySelectorAll(".rp-crow").length).toBe(2);
  });

  it("onBook na diya jaye to rows plain rehte hain (component kahin bhi safe)", () => {
    const { container } = render(<ReplyText text={SCREENSHOT_TEXT} />);
    expect(container.querySelectorAll("button.rp-crow").length).toBe(0);
    expect(container.querySelectorAll(".rp-crow").length).toBe(4);
  });

  it("Concierge wiring: chat card ke onBook → usi train+class ka booking flow", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/views/Concierge.tsx"), "utf8");
    expect(src).toMatch(/<ReplyText text=\{rest\} onBook=\{\(r, g\) => openBookingFromReplyRow\(r, g\)\}/);
    expect(src).toContain("function openBookingFromReplyRow");
    expect(src).toContain("selectTrainAndClassGo(train, klass)");
  });
});

describe("Round-29 · booking intent → khud passenger form (loop khatam)", () => {
  const liveRows = [
    { number: "22432", name: "SFG MCTM SF EXP", classCode: "3E", status: "AVAILABLE", seats: 31, fare: 565, departure: null },
    { number: "22432", name: "SFG MCTM SF EXP", classCode: "3A", status: "AVAILABLE", seats: 1, fare: 565, departure: null },
    { number: "22432", name: "SFG MCTM SF EXP", classCode: "SL", status: "WAITLIST", waitlist: 35, fare: 225, departure: null },
    { number: "19804", name: "KOTA EXPRESS", classCode: "2A", status: "RAC", rac: 6, fare: 880, departure: null },
  ];

  it('"22432 mein 3A book krdo" booking intent hai; sawaal ("kya book kar sakta hoon?") nahi', () => {
    expect(isBookingIntent("22432 mein 3A book krdo")).toBe(true);
    expect(isBookingIntent("22432 3A booking kardo")).toBe(true);
    expect(isBookingIntent("22432 ka 3A ticket chahiye")).toBe(true);
    expect(isBookingIntent("22432 mein 3A book krdo?")).toBe(true); // hukm saaf hai
    expect(isBookingIntent("kya main 22432 book kar sakta hoon?")).toBe(false);
    expect(isBookingIntent("22432 ki seat batao")).toBe(false);
    expect(isBookingIntent("SVDK se LDH trains batao")).toBe(false);
    /* Server ka NLU intent aaye to wo bhi kaafi hai */
    expect(isBookingIntent("kuch bhi", "BOOK_TRAIN")).toBe(true);
  });

  it("maangi hui class ki row chuni jaati hai (usi train ki, apne status/fare ke saath)", () => {
    const picked = pickRowForBooking(liveRows, "22432", "3A");
    expect(picked?.classCode).toBe("3A");
    expect(picked?.status).toBe("AVAILABLE");
    const seat = buildAutoBookSeat({ trainNumber: "22432", classWanted: "3A", row: picked, source: "confirmtkt" });
    expect(seat.number).toBe("22432");
    expect(seat.classCode).toBe("3A");
    expect(seat.status).toBe("AVAILABLE");
    expect(seat.seats).toBe(1);
    expect(seat.fare).toBe(565);
    expect(seat.rac).toBeNull();
  });

  it("class boli hi na ho to us train ki pehli openable row (order preserve)", () => {
    const picked = pickRowForBooking(liveRows, "22432", null);
    expect(picked?.classCode).toBe("3E");
  });

  it("maangi hui class N/A ho to chupke se doosri class nahi kholte (row null)", () => {
    const rows = [{ number: "12926", name: "PASCHIM EXPRESS", classCode: "3A", status: "NOT_AVAILABLE", fare: null }];
    expect(pickRowForBooking(rows, "12926", "3A")).toBeNull();
    expect(isOpenableStatus("NOT_AVAILABLE")).toBe(false);
    expect(isOpenableStatus("UNKNOWN")).toBe(true);
    expect(isOpenableStatus("WAITLIST")).toBe(true);
  });

  it("row ka data na ho to bhi form ke liye seat banti hai — UNKNOWN status, timings list se", () => {
    const seat = buildAutoBookSeat({
      trainNumber: "22432",
      classWanted: "3A",
      row: null,
      trainRow: { number: "22432", name: "SFG MCTM SF EXP", departure: "16:05", arrival: "12:55", durationLabel: "20h 50m", classes: ["1A", "3A"] },
    });
    expect(seat.number).toBe("22432");
    expect(seat.classCode).toBe("3A");
    expect(seat.status).toBe("UNKNOWN");
    expect(seat.name).toBe("SFG MCTM SF EXP");
    expect(seat.departure).toBe("16:05");
    expect(seat.durationLabel).toBe("20h 50m");
    /* Andaza nahi: fare/seat count khaali khaali (form me "—"), aur koi fake seat claim nahi. */
    expect(seat.fare).toBeNull();
    expect(seat.seats).toBeNull();
    expect(seat.seat).toBe(false);
  });

  it("UNKNOWN status par booking form khulta hai — fresh AI query ka loop nahi", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/views/Concierge.tsx"), "utf8");
    /* openBookingFromSeatRow / openBookingFromChip dono UNKNOWN ko openable maante hain */
    expect(src).toMatch(/r\.status === "AVAILABLE" \|\| r\.status === "RAC" \|\| r\.status === "WAITLIST" \|\| r\.status === "UNKNOWN"/);
    expect(src).toMatch(/status !== "AVAILABLE" && status !== "RAC" && status !== "WAITLIST" && status !== "UNKNOWN"/);
    /* booking intent par auto-advance ka gate */
    expect(src).toContain("if (isBookingIntent(trimmed, c?.intent))");
    expect(src).toContain("const pickRow = clsWanted");
    expect(src).toContain(": pickRowForBooking(live, tno, null);" );
    expect(src).toContain("buildAutoBookSeat({");
    expect(src).toContain('openBookingFromSeatRow(seat, { from: routeFrom.code, to: routeTo.code');
    /* Date sirf jo user/server ne di — form ka default (aaj) guess nahi. */
    /* Round-37: route/date ab resolver se (train/class/route/date har verified source se — picker tap,
     * seat rows, trains list, ctx, booking state) — wahi purana intent, naya shape. */
    expect(src).toContain("const target = resolveBookingTarget({");
    expect(src).toContain("const routeDate = target.date;");
  });

  it("reducer: UNKNOWN class par bhi passenger screen khulti hai (N/A par nahi)", () => {
    const train: TrainResult = {
      number: "22432",
      name: "SFG MCTM SF EXP",
      type: "",
      from: { code: "SVDK", name: "SMVD Katra", city: "Katra" },
      to: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" },
      date: "2026-09-27",
      departure: "16:05",
      arrival: "12:55",
      arrivalDayOffset: 0,
      durationMinutes: 1250,
      durationLabel: "20h 50m",
      runsOn: [],
      classes: [],
    };
    const base = initialBooking("2026-09-27");
    const unknown: ClassAvailability = { code: "3A", label: "AC 3 Tier", status: "UNKNOWN", fare: 0 };
    const afterUnknown = bookingReducer(base, { type: "SELECT_TRAIN_AND_CLASS", train, klass: unknown, toPassengers: true });
    expect(afterUnknown.screen).toBe("passengers");
    expect(afterUnknown.selectedTrain?.number).toBe("22432");
    /* N/A par wahi purana guard — screen nahi badalti, honest notice. */
    const na: ClassAvailability = { code: "3A", label: "AC 3 Tier", status: "NOT_AVAILABLE", fare: 0 };
    const afterNa = bookingReducer(base, { type: "SELECT_TRAIN_AND_CLASS", train, klass: na, toPassengers: true });
    expect(afterNa.screen).toBe(base.screen);
    expect(afterNa.notice).toBeTruthy();
  });
});

describe("Round-29 · 'vaishno devi' (chhota naam) → SVDK", () => {
  it("server: partial/alternate naam sab SVDK par (pooora naam likhna zaroori nahi)", () => {
    expect(matchStation("vaishno devi")?.code).toBe("SVDK");
    expect(matchStation("Vaishno Devi")?.code).toBe("SVDK");
    expect(matchStation("vaishnodevi")?.code).toBe("SVDK");
    expect(matchStation("vaishno devi katra")?.code).toBe("SVDK");
    expect(matchStation("mata vaishno devi")?.code).toBe("SVDK");
    expect(matchStation("shri mata vaishno devi katra")?.code).toBe("SVDK");
    expect(matchStation("katra")?.code).toBe("SVDK");
    expect(matchStation("वैष्णो देवी")?.code).toBe("SVDK");
    expect(matchStation("माता वैष्णो देवी")?.code).toBe("SVDK");
  });

  it("server: text me se dono stations nikalte hain (kram bhi wahi)", () => {
    const hits = findStationsInText("vaishno devi se LDH jaana hai");
    expect(hits.map((s) => s.code)).toEqual(["SVDK", "LDH"]);
    const deva = findStationsInText("वैष्णो देवी से लुधियाना");
    expect(deva.map((s) => s.code)).toContain("SVDK");
  });

  it("client: wahi alias client ke resolver me bhi", () => {
    expect(matchStationClient("vaishno devi")?.code).toBe("SVDK");
    expect(matchStationClient("vaishnodevi")?.code).toBe("SVDK");
    expect(matchStationClient("वैष्णो देवी")?.code).toBe("SVDK");
    /* naam/code invent nahi hua — wahi SVDK station. */
    expect(matchStationClient("vaishno devi")?.name).toBe("SMVD Katra");
  });

  it("koi galat match nahi: doosre shehar 'vaishno' se SVDK nahi ban jaate", () => {
    expect(matchStation("ludhiana")?.code).toBe("LDH");
    expect(matchStation("jammu")?.code).toBe("JAT");
    expect(matchStation("delhi")?.code).toBeUndefined();
  });
});
