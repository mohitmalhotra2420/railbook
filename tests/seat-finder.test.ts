/* 24 Sep 2026 — AI Seat Finder (client layer) tests.
 * User: "ludhiana se new delhi kal ke liye trains dikhao" → "2A mein seats hai?" → ConfirmTkt 2A
 * filter karke seat wali trains deta hai. Humare paas live board pehle se hai — ye layer usse
 * merge karke "seat upar / WL neeche" dikhati hai + chips (confirmed-only / class / time).
 * Sab client-side; AI logic, tools, API, architecture ko chhua nahi gaya. */
import { describe, expect, it } from "vitest";
import { afterMinuteFromText, buildAllClassRows, buildSeatRows, classFromText, detectSeatIntent, filterSeatRows, mergeClassBoards, mergeClassBoardsVerified, seatSummaryLine, trainsNeedingClasses, trainsUnverifiedForSeats, uniqueTrainCount } from "../src/seatfinder";

const search = (n: string, dep: string, arr: string, dur: string) => ({
  number: n,
  name: `TRAIN ${n}`,
  departure: dep,
  arrival: arr,
  durationLabel: dur,
  arrivalDayOffset: 0,
});
const board = (n: string, classes: { code: string; status: string; seats?: number; rac?: number; waitlist?: number; fare?: number }[]) => ({
  trainNumber: n,
  trainName: `TRAIN ${n}`,
  classes: classes.map((c) => ({ classCode: c.code, code: c.code, status: c.status, seats: c.seats ?? null, rac: c.rac ?? null, waitlist: c.waitlist ?? null, fare: c.fare ?? null, source: "web_railyatri" })),
});

describe("Seat Finder — bhasha (Hindi / English / Hinglish)", () => {
  it("class: teenon bhasha me 2A", () => {
    expect(classFromText("2A mein seats hai?")).toBe("2A");
    expect(classFromText("2nd AC seat available?")).toBe("2A");
    expect(classFromText("दूसरी एसी में सीट है क्या?")).toBe("2A");
    expect(classFromText("sleeper me jagah")).toBe("SL");
    expect(classFromText("तीसरी एसी")).toBe("3A");
  });

  it("seat intent: 'seat/सीट/khali/available' par true, warna false", () => {
    expect(detectSeatIntent("2A mein seats hai?").wants).toBe(true);
    expect(detectSeatIntent("दूसरी एसी में सीट है क्या?").wants).toBe(true);
    expect(detectSeatIntent("2A").classCode).toBe("2A");
    expect(detectSeatIntent("kal ki trains dikhao").wants).toBe(false);
    expect(detectSeatIntent("PNR 1234567890 status").wants).toBe(false);
  });

  it("time: '5 baje ke baad' / 'after 5' / 'शाम 5 के बाद' / '17:30 ke baad'", () => {
    expect(afterMinuteFromText("5 baje ke baad ki train")).toBe(17 * 60);
    expect(afterMinuteFromText("after 5 trains")).toBe(5 * 60); /* English "after 5" = 05:00 literal */
    expect(afterMinuteFromText("रात 9 ke baad")).toBe(21 * 60);
    expect(afterMinuteFromText("सुबह 6 के बाद")).toBe(6 * 60);
    expect(afterMinuteFromText("शाम 5 के बाद")).toBe(17 * 60);
    expect(afterMinuteFromText("17:30 ke baad")).toBe(17 * 60 + 30);
    expect(afterMinuteFromText("2A me seat hai")).toBe(null); /* time filter nahi */
  });

  it("confirmed-only + earliest words", () => {
    expect(detectSeatIntent("confirmed seat wali dikhao").confirmedOnly).toBe(true);
    expect(detectSeatIntent("कन्फर्म सीट वाली").confirmedOnly).toBe(true);
    expect(detectSeatIntent("sabse jaldi pahunchne wali seat").earliest).toBe(true);
  });
});

describe("Seat Finder — merge + split (seat upar, WL neeche)", () => {
  const rows = [search("11078", "04:30", "11:15", "6h 45m"), search("20986", "00:40", "05:55", "5h 15m"), search("12926", "09:40", "16:20", "6h 40m")];
  const boardRows = [
    board("11078", [{ code: "2A", status: "AVAILABLE", seats: 29, fare: 825 }]),
    board("20986", [{ code: "2A", status: "WAITLIST", waitlist: 1, fare: 890 }]),
    board("12926", [{ code: "2A", status: "RAC", rac: 4, fare: 980 }]),
  ];

  it("2A: seat wali (AVL/RAC) upar, WL wali alag — aur RAC ko bhi seat maana jaata hai", () => {
    const { seat, wl } = buildSeatRows(rows, boardRows, "2A");
    expect(seat.map((r) => r.number)).toEqual(["11078", "12926"]); /* AVL pehle, phir RAC */
    expect(wl.map((r) => r.number)).toEqual(["20986"]);
    expect(seat[0].seats).toBe(29);
    expect(seat[1].rac).toBe(4);
    expect(wl[0].waitlist).toBe(1);
  });

  it("class nahi batayi → sabse achhi class (seat wali) chuni jaati hai", () => {
    const b = [board("11078", [{ code: "3A", status: "AVAILABLE", seats: 98, fare: 585 }, { code: "2A", status: "WAITLIST", waitlist: 12, fare: 825 }])];
    const { seat, wl } = buildSeatRows([search("11078", "04:30", "11:15", "6h 45m")], b, null);
    expect(seat.length).toBe(1);
    expect(seat[0].classCode).toBe("3A");
    expect(wl.length).toBe(0);
  });

  it("board me hain par search list me nahi (jaise 14036) → times '—' ke saath aate hain", () => {
    const b = [...boardRows, board("14036", [{ code: "2A", status: "AVAILABLE", seats: 34, fare: 845 }])];
    const { seat } = buildSeatRows(rows, b, "2A");
    const only = seat.find((r) => r.number === "14036");
    expect(only).toBeTruthy();
    expect(only!.timesKnown).toBe(false);
    expect(only!.departure).toBe(null);
  });

  it("chips: confirmed-only + time filter + sabse jaldi", () => {
    const { seat, wl } = buildSeatRows(rows, boardRows, "2A");
    expect(filterSeatRows(wl, { confirmedOnly: true })).toEqual([]); /* WL hata do */
    expect(filterSeatRows(seat, { afterMin: 17 * 60 })).toEqual([]); /* 5 baje ke baad koi seat nahi */
    expect(filterSeatRows(seat, { afterMin: 6 * 60 }).map((r) => r.number)).toEqual(["12926"]); /* 11078 subah 04:30 — filter se pehle */
    const fast = filterSeatRows(seat, { earliest: true });
    expect(fast[0].number).toBe("12926"); /* 6h 40m < 6h 45m */
  });

  it("voice summary: seat wali train ki line banti hai (bolne ke liye)", () => {
    const { seat } = buildSeatRows(rows, boardRows, "2A");
    const line = seatSummaryLine(seat, "2A", "NDLS", "New Delhi");
    expect(line).toContain("2A");
    expect(line).toContain("TRAIN 11078");
    expect(line).toContain("29 seat");
    expect(seatSummaryLine([], "2A", "NDLS", "New Delhi")).toContain("nahi mili");
  });
});

describe("Seat Finder — GENERIC: 2A par hardcode nahi (user: 'do not specific to this')", () => {
  it("har class pakadta hai — 1A / 3A / SL / CC / 2S / EC + spoken", () => {
    expect(classFromText("1A me seat hai?")).toBe("1A");
    expect(classFromText("first ac me jagah")).toBe("1A");
    expect(classFromText("पहली एसी में सीट है क्या?")).toBe("1A");
    expect(classFromText("3A me seat batao")).toBe("3A");
    expect(classFromText("sleeper me seat hai?")).toBe("SL");
    expect(classFromText("स्लीपर में जगह है?")).toBe("SL");
    expect(classFromText("chair car me seat")).toBe("CC");
    expect(classFromText("2s me seat")).toBe("2S");
    /* "sab class / koi bhi class" = koi filter nahi */
    expect(classFromText("sab class me seat dikhao")).toBe(null);
    expect(classFromText("koi bhi class me seat hai?")).toBe(null);
  });

  it("'sabse fast' aur 'low fare' dono samajh me aate hain (alag-alag)", () => {
    const fast = detectSeatIntent("1A me sabse fast train batao");
    expect(fast.classCode).toBe("1A");
    expect(fast.earliest).toBe(true);
    expect(fast.cheapest).toBe(false);

    const cheap = detectSeatIntent("sleeper me low fare train dikhao");
    expect(cheap.classCode).toBe("SL");
    expect(cheap.cheapest).toBe(true);

    expect(detectSeatIntent("सबसे सस्ती सीट वाली ट्रेन").cheapest).toBe(true);
    expect(detectSeatIntent("cheapest seat available?").cheapest).toBe(true);
    expect(detectSeatIntent("sabse tez train me 2A seat").earliest).toBe(true);
  });

  it("'sirf confirmed seats dikhao' → confirmedOnly", () => {
    expect(detectSeatIntent("sirf confirmed seats dikhao").confirmedOnly).toBe(true);
    expect(detectSeatIntent("only confirmed seat wali trains").confirmedOnly).toBe(true);
    expect(detectSeatIntent("सिर्फ कन्फर्म सीट दिखाओ").confirmedOnly).toBe(true);
  });

  it("kisi bhi class me merge/split chalta hai (1A example) — Sirf 2A nahi", () => {
    const rows = [search("11078", "04:30", "11:15", "6h 45m"), search("20848", "06:15", "10:50", "4h 35m")];
    const b = [
      { trainNumber: "11078", trainName: "TRAIN 11078", classes: [{ classCode: "1A", code: "1A", status: "AVAILABLE", seats: 6, rac: null, waitlist: null, fare: 2450, source: "web_railyatri" }] },
      { trainNumber: "20848", trainName: "TRAIN 20848", classes: [{ classCode: "1A", code: "1A", status: "WAITLIST", seats: null, rac: null, waitlist: 3, fare: 2500, source: "web_railyatri" }] },
    ];
    const { seat, wl } = buildSeatRows(rows, b, "1A");
    expect(seat.map((r) => r.number)).toEqual(["11078"]);
    expect(wl.map((r) => r.number)).toEqual(["20848"]);
    expect(seat[0].classCode).toBe("1A");
  });

  it("chips: sabse sasta (fare ↑) aur sabse jaldi (time ↑) alag-alag kaam karte hain", () => {
    const rows = [search("A", "04:30", "11:15", "6h 45m"), search("B", "06:15", "10:50", "4h 35m"), search("C", "11:40", "20:25", "8h 45m")];
    const b = [
      { trainNumber: "A", trainName: "T A", classes: [{ classCode: "2A", code: "2A", status: "AVAILABLE", seats: 5, fare: 1290, source: "w" }] },
      { trainNumber: "B", trainName: "T B", classes: [{ classCode: "2A", code: "2A", status: "AVAILABLE", seats: 3, fare: 875, source: "w" }] },
      { trainNumber: "C", trainName: "T C", classes: [{ classCode: "2A", code: "2A", status: "RAC", rac: 4, fare: 915, source: "w" }] },
    ];
    const { seat } = buildSeatRows(rows, b, "2A");
    expect(filterSeatRows(seat, { cheapest: true }).map((r) => r.number)).toEqual(["B", "C", "A"]);
    expect(filterSeatRows(seat, { earliest: true })[0].number).toBe("B");
  });
});

describe("Seat Finder — Available / Sabhi trains (24 Sep user: 'all classes dikhao, kuch fake na ho')", () => {
  const rows = [search("11078", "04:30", "11:15", "6h 45m"), search("20986", "00:40", "05:55", "5h 15m"), search("14617", "14:01", "17:05", "3h 04m")];
  const b = [
    board("11078", [
      { code: "2A", status: "AVAILABLE", seats: 29, fare: 825 },
      { code: "3A", status: "WAITLIST", waitlist: 12, fare: 585 },
      { code: "SL", status: "NOT_AVAILABLE", fare: 285 },
    ]),
    board("20986", [{ code: "2A", status: "RAC", rac: 9, fare: 890 }]),
  ];

  it("'Sabhi trains': har train ki HAR class — AVL/RAC upar, WL/N-A neeche (real rows, koi banaya hua nahi)", () => {
    const all = buildAllClassRows(rows, b, null, "all");
    expect(all.seat.map((r) => `${r.number}-${r.classCode}`)).toEqual(["11078-2A", "20986-2A"]); /* AVL pehle, phir RAC */
    expect(all.wl.map((r) => `${r.number}-${r.classCode}`)).toEqual(["11078-3A", "11078-SL"]); /* WL pehle, phir N/A */
    expect(all.wl[0].waitlist).toBe(12);
    expect(all.wl[1].status).toBe("NOT_AVAILABLE");
  });

  it("'Available': sirf AVAILABLE + RAC (dono) — WL/N-A list bilkul khaali", () => {
    const av = buildAllClassRows(rows, b, null, "avail");
    expect(av.seat.map((r) => `${r.number}-${r.classCode}`)).toEqual(["11078-2A", "20986-2A"]);
    expect(av.wl).toEqual([]);
    expect(av.seat.every((r) => r.status === "AVAILABLE" || r.status === "RAC")).toBe(true);
  });

  it("class chip: sirf wahi class; jin trains me wo class hi nahi unki ginti alag", () => {
    const two = buildAllClassRows(rows, b, "2A", "all");
    expect(two.seat.map((r) => `${r.number}-${r.classCode}`)).toEqual(["11078-2A", "20986-2A"]);
    expect(two.missingClass).toBe(0);
    const three = buildAllClassRows(rows, b, "3A", "all");
    expect(three.seat).toEqual([]);
    expect(three.wl.map((r) => `${r.number}-${r.classCode}`)).toEqual(["11078-3A"]);
    expect(three.missingClass).toBe(1); /* 20986 me 3A class hi nahi */
  });

  it("jis train ka board data hi nahi aaya → 'seat nahi' nahi, alag 'data nahi aayi' list", () => {
    const all = buildAllClassRows(rows, b, null, "all");
    expect(all.noData.map((r) => r.number)).toEqual(["14617"]);
    expect(all.noData[0].status).toBe("NO_DATA");
    expect(all.noData[0].departure).toBe("14:01"); /* times search list se — real */
    expect(all.noData[0].timesKnown).toBe(true);
    const av = buildAllClassRows(rows, b, null, "avail");
    expect(av.noData).toEqual([]);
  });

  it("count trains ka hota hai, rows ka nahi (ek train ki kai class ho sakti hain)", () => {
    const all = buildAllClassRows(rows, b, null, "all");
    expect(all.seat.length + all.wl.length).toBe(4);
    expect(uniqueTrainCount([...all.seat, ...all.wl])).toBe(2);
  });
});

/* ── 24 Sep 2026 (user screenshots): AC group + per-train class enrichment ──────────────────── */
describe("AC group (user: 'AC trains dikhao' par 2S/SL bhi aa gaye the)", () => {
  it("'AC trains dikhao' → acOnly, koi ek class nahi", () => {
    const i = detectSeatIntent("AC trains dikhao");
    expect(i.wants).toBe(true);
    expect(i.acOnly).toBe(true);
    expect(i.classCode).toBeNull();
  });
  it("'AC class ki train' → acOnly; '2A AC' → specific class jeeti", () => {
    expect(detectSeatIntent("AC class wali train dikhao").acOnly).toBe(true);
    const i2 = detectSeatIntent("2A AC me seat hai?");
    expect(i2.acOnly).toBe(false);
    expect(i2.classCode).toBe("2A");
  });
  it("'sab class dikhao' → na AC group na class filter", () => {
    const i = detectSeatIntent("sab class dikhao");
    expect(i.acOnly).toBe(false);
    expect(i.classCode).toBeNull();
  });
  it("acOnly board se 2S/SL hata deta hai, CC/EC rehne deta hai", () => {
    const board = [
      { trainNumber: "12497", trainName: "SHANE PUNJAB", classes: [
        { classCode: "2S", status: "AVAILABLE", seats: 226, fare: 80 },
        { classCode: "CC", status: "WAITLIST", waitlist: 38, fare: 320 },
      ] },
      { trainNumber: "12029", trainName: "SWARN SHATABDI", classes: [
        { classCode: "CC", status: "AVAILABLE", seats: 86, fare: 415 },
        { classCode: "EC", status: "AVAILABLE", seats: 6, fare: 660 },
      ] },
    ];
    const out = buildAllClassRows([], board, null, "all", true);
    const codes = out.seat.concat(out.wl).map((r) => r.classCode);
    expect(codes).not.toContain("2S");
    expect(new Set(codes)).toEqual(new Set(["CC", "EC"]));
  });
  it("'EC' ab CC nahi banta (EC = Executive Chair Car)", () => {
    expect(classFromText("EC me seat hai?")).toBe("EC");
    expect(classFromText("CC me seat hai?")).toBe("CC");
  });
});

describe("per-train class board merge (user: 'card sirf single class dikha raha tha')", () => {
  it("UNKNOWN row ki jagah per-train ki ASLI row aati hai (Swarn Shatabdi EC case)", () => {
    const base = [{ classCode: "CC", status: "AVAILABLE", seats: 86 }, { classCode: "EC", status: "UNKNOWN" }];
    const extra = [{ classCode: "EC", status: "AVAILABLE", seats: 6, fare: 660 }];
    const out = mergeClassBoards(base, extra);
    const ec = out.find((c) => c.classCode === "EC");
    expect(ec?.status).toBe("AVAILABLE");
    expect(ec?.seats).toBe(6);
  });

  it("missing class jodta hai, maujooda row nahi chhedta", () => {
    const base = [{ classCode: "CC", status: "AVAILABLE", seats: 86 }];
    const extra = [
      { classCode: "CC", status: "WAITLIST", waitlist: 5 }, /* dup — ignore */
      { classCode: "EC", status: "AVAILABLE", seats: 6, fare: 660 },
    ];
    const out = mergeClassBoards(base, extra);
    expect(out.map((c) => c.classCode)).toEqual(["CC", "EC"]);
    expect(out[0].status).toBe("AVAILABLE"); /* route board wali asli row waisi hi (dup ignore) */
  });
  it("kaun si trains adhoori hain (missing class / UNKNOWN) — bounded list", () => {
    const board = [
      { trainNumber: "12029", classes: [{ classCode: "CC", status: "AVAILABLE" }, { classCode: "EC", status: "UNKNOWN" }] },
      { trainNumber: "12203", classes: [{ classCode: "3A", status: "AVAILABLE" }, { classCode: "1A", status: "RAC" }] },
      { trainNumber: "12497", classes: [{ classCode: "CC", status: "WAITLIST" }] },
    ];
    expect(trainsNeedingClasses(board, null, false)).toEqual(["12029", "12497"]);
    expect(trainsNeedingClasses(board, "EC", false)).toEqual(["12029", "12203", "12497"]); /* 12029 ki EC UNKNOWN, baaki me EC hi nahi */
    expect(trainsNeedingClasses(board, null, true)).toEqual(["12029"]); /* EC UNKNOWN hai — dekhna hai */
  });
});

/* ── Round-19c (24 Sep, user dobara): "direct mein bahut si trains available hai lekin neeche seat finder
 * mein avl mein sabhi show nhi kar rhi". Route board purana WL deta hai jabki per-train board par usi
 * train me seat hoti hai (aur ulta bhi). "Available" tab ke liye aise trains verify hote hain. ────── */
describe("route board purana ho sakta hai — 'Available' ke liye per-train verify (Round-19c)", () => {
  const board = [
    { trainNumber: "12926", classes: [{ classCode: "3A", status: "WAITLIST", waitlist: 14, fare: 915 }, { classCode: "2A", status: "WAITLIST", waitlist: 4, fare: 1270 }] },
    { trainNumber: "11058", classes: [{ classCode: "2A", status: "RAC", rac: 6, fare: 1210 }] },
    { trainNumber: "11078", classes: [{ classCode: "3A", status: "NOT_AVAILABLE" }] },
    { trainNumber: "12716", classes: [] },
  ];
  it("jin trains ki koi AVL/RAC row nahi (WL / N-A / khaali) wahi verify hote hain — bound ke saath", () => {
    expect(trainsUnverifiedForSeats(board, null, false)).toEqual(["12926", "11078"]);
    expect(trainsUnverifiedForSeats(board, null, false, 1)).toEqual(["12926"]); /* latency bound */
    expect(trainsUnverifiedForSeats(board, "2A", false)).toEqual(["12926"]); /* 11058 ki 2A RAC hai → wo bahar */
    expect(trainsUnverifiedForSeats(board, "3E", false)).toEqual([]); /* kisike paas is class ka row hi nahi */
  });

  it("fresh per-train probe WL/N-A ko asli AVAILABLE se badalta hai; UNKNOWN wapas aaya to base safe", () => {
    const base = [
      { classCode: "3A", status: "WAITLIST", waitlist: 14, fare: 915 },
      { classCode: "2A", status: "WAITLIST", waitlist: 4, fare: 1270 },
    ];
    const fresh = [
      { classCode: "3A", status: "AVAILABLE", seats: 23, fare: 915 },
      { classCode: "2A", status: "UNKNOWN" }, /* data nahi mila → purani row hi rahegi */
    ];
    const out = mergeClassBoardsVerified(base, fresh);
    const a3 = out.find((c) => c.classCode === "3A");
    const a2 = out.find((c) => c.classCode === "2A");
    expect(a3?.status).toBe("AVAILABLE");
    expect(a3?.seats).toBe(23);
    expect(a2?.status).toBe("WAITLIST");
    expect(a2?.waitlist).toBe(4);
    /* aur missing class add bhi hoti hai (jaise SL) */
    const withSl = mergeClassBoardsVerified(base, [{ classCode: "SL", status: "AVAILABLE", seats: 8 }]);
    expect(withSl.map((c) => c.classCode)).toEqual(["3A", "2A", "SL"]);
    /* purana mergeClassBoards (gaps bharna) waisa hi — maujooda row nahi chhedta */
    expect(mergeClassBoards(base, [{ classCode: "3A", status: "AVAILABLE", seats: 23 }]).find((c) => c.classCode === "3A")?.status).toBe("WAITLIST");
  });
});
