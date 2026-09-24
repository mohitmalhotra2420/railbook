/* 24 Sep 2026 — Seat Finder CARD ka render test (jsdom, koi browser nahi).
 * Verify: card dikhta hai, SEAT upar + WAITLIST neeche, "Available" / "Sabhi trains" chips
 * sach me list badalte hain, "data nahi aayi" wali trains alag list me aati hain (seat nahi maani jaati).
 * Sab client-side — AI/server/API touch nahi. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../src/voice/speakGuide", () => ({ speakGuide: vi.fn(), cancelGuide: vi.fn() }));

import { SeatFinder } from "../src/components/SeatFinder";
import type { SeatIntent } from "../src/seatfinder";

const intent = (over: Partial<SeatIntent> = {}): SeatIntent => ({
  wants: false,
  classCode: null,
  acOnly: false,
  confirmedOnly: false,
  afterMin: null,
  beforeMin: null,
  windowLabel: null,
  earliest: false,
  cheapest: false,
  ...over,
});

const search = [
  { number: "11078", name: "JHELUM EXPRESS", departure: "04:30", arrival: "11:15", durationLabel: "6h 45m", arrivalDayOffset: 0 },
  { number: "20986", name: "SWARAJ EXPRESS", departure: "00:40", arrival: "05:55", durationLabel: "5h 15m", arrivalDayOffset: 0 },
  { number: "14617", name: "PRNC-ASR JANSEWA EXP", departure: "14:01", arrival: "17:05", durationLabel: "3h 04m", arrivalDayOffset: 0 },
];

const boardRows = [
  {
    trainNumber: "11078",
    trainName: "JHELUM EXPRESS",
    classes: [
      { classCode: "2A", code: "2A", status: "AVAILABLE", seats: 29, rac: null, waitlist: null, fare: 825, source: "web_confirmtkt" },
      { classCode: "3A", code: "3A", status: "WAITLIST", seats: null, rac: null, waitlist: 12, fare: 585, source: "web_confirmtkt" },
    ],
  },
  {
    trainNumber: "20986",
    trainName: "SWARAJ EXPRESS",
    classes: [{ classCode: "2A", code: "2A", status: "RAC", seats: null, rac: 9, waitlist: null, fare: 890, source: "web_confirmtkt" }],
  },
];

function stubFetch(rows: unknown) {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({ ok: true, json: async () => ({ trains: rows }) }));
}

beforeEach(() => stubFetch(boardRows));

describe("Seat Finder card (jsdom)", () => {
  it("card render hota hai: SEAT upar, WAITLIST neeche, aur 'data nahi aayi' alag list", async () => {
    render(<SeatFinder from="AAAB" to="BBBB" date="2026-09-25" rows={search} intent={intent()} onChip={() => {}} />);
    expect(await screen.findByText("Seat Finder")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/JHELUM EXPRESS/).length).toBeGreaterThan(0));

    /* Seat wali (AVL/RAC) upar */
    expect(screen.getByText(/Seat mil jayegi/)).toBeTruthy();
    expect(screen.getByText("AVL 29")).toBeTruthy();
    expect(screen.getByText("RAC 9")).toBeTruthy();
    /* WL neeche */
    expect(screen.getByText(/Seat pakki nahi/)).toBeTruthy();
    expect(screen.getByText("WL 12")).toBeTruthy();
    /* 14617 ka board data nahi aaya → "seat nahi" nahi, alag list */
    expect(screen.getByText(/Seat data provider se nahi aayi/)).toBeTruthy();
    expect(screen.getByText(/data nahi aayi/)).toBeTruthy();
  });

  it("'✅ Available' chip = sirf AVL + RAC (WL section hat jata hai); '🚆 Sabhi trains' = sab wapas", async () => {
    render(<SeatFinder from="AAAC" to="BBBC" date="2026-09-25" rows={search} intent={intent()} onChip={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Seat pakki nahi/)).toBeTruthy());

    fireEvent.click(screen.getByText("✅ Available"));
    await waitFor(() => expect(screen.queryByText(/Seat pakki nahi/)).toBeNull());
    expect(screen.getByText("AVL 29")).toBeTruthy(); /* AVL */
    expect(screen.getByText("RAC 9")).toBeTruthy(); /* RAC bhi — user ne kaha dono */
    expect(screen.queryByText("WL 12")).toBeNull(); /* WL nahi */

    fireEvent.click(screen.getByText("🚆 Sabhi trains"));
    await waitFor(() => expect(screen.getByText(/Seat pakki nahi/)).toBeTruthy());
    expect(screen.getByText("WL 12")).toBeTruthy();
  });

  it("class chip (2A) sirf us class ki rows dikhata hai — 3A WL row hat jati hai", async () => {
    render(<SeatFinder from="AAAD" to="BBBD" date="2026-09-25" rows={search} intent={intent()} onChip={() => {}} />);
    await waitFor(() => expect(screen.getByText("WL 12")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: "2A" })[0]);
    await waitFor(() => expect(screen.queryByText("WL 12")).toBeNull());
    expect(screen.getByText("AVL 29")).toBeTruthy();
    expect(screen.getByText("RAC 9")).toBeTruthy();
  });

  it("user ne 'sirf confirmed' bola ho → card seedha Available mode me khulta hai", async () => {
    render(<SeatFinder from="AAAE" to="BBBE" date="2026-09-25" rows={search} intent={intent({ confirmedOnly: true })} onChip={() => {}} />);
    await waitFor(() => expect(screen.queryByText(/Seat pakki nahi/)).toBeNull());
    expect(screen.getByText("AVL 29")).toBeTruthy();
  });

  it("row tap karne par wahi purana utterance jata hai (train + class + date + route)", async () => {
    const onChip = vi.fn();
    render(<SeatFinder from="AAAF" to="BBBF" date="2026-09-25" rows={search} intent={intent()} onChip={onChip} />);
    await waitFor(() => expect(screen.getByText("AVL 29")).toBeTruthy());
    fireEvent.click(screen.getByText("AVL 29"));
    expect(onChip).toHaveBeenCalledWith("11078 ki seat availability 2A 2026-09-25 ko AAAF se BBBF");
  });

  it("WL ka 'confirm %' kahin nahi dikhaya jata (hamare paas wo data hai hi nahi)", async () => {
    const { container } = render(<SeatFinder from="AAAG" to="BBBG" date="2026-09-25" rows={search} intent={intent()} onChip={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Seat pakki nahi/)).toBeTruthy());
    expect(container.textContent).not.toMatch(/\d+\s*%/); /* koi "83% confirm" jaisa andaza nahi */
    expect(container.textContent).toMatch(/confirm % hum nahi dete/i);
  });
});

/* ── 24 Sep 2026 (user: "card sirf single class hi dikha raha tha — jabki available hai") ────────
 * Per-train class board se missing/UNKNOWN class aa jaati hai (wahi endpoint jo TrainBoard
 * "Refresh seats" use karta hai). Yahan: 12029 ka route-board row sirf CC deta hai; per-train
 * fetch EC (real, available) laata hai → dono dikhni chahiye. */
const routeBoardPartial = [
  { trainNumber: "12029", trainName: "SWARN SHATABDI", classes: [
    { classCode: "CC", code: "CC", status: "AVAILABLE", seats: 86, rac: null, waitlist: null, fare: 415, source: "web_railyatri" },
    { classCode: "EC", code: "EC", status: "UNKNOWN", seats: null, rac: null, waitlist: null, fare: null, source: "web_railyatri" },
  ] },
];
const perTrainEC = {
  classes: [{ code: "EC", status: "AVAILABLE", seats: 6, rac: null, waitlist: null, fare: 660, source: "web_railyatri" }],
};

function stubFetchSplit() {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
    if (String(url).includes("trainNumber=")) return { ok: true, json: async () => perTrainEC };
    return { ok: true, json: async () => ({ trains: routeBoardPartial }) };
  });
}

describe("Seat Finder card — per-train class enrichment", () => {
  it("route board me UNKNOWN class ko per-train board se real bana kar dikhata hai", async () => {
    stubFetchSplit();
    const rows = [{ number: "12029", name: "SWARN SHATABDI", departure: "11:11", arrival: "12:38", durationLabel: "1h 27m", arrivalDayOffset: 0 }];
    render(<SeatFinder from="LDH" to="BEAS" date="2026-09-25" rows={rows} intent={intent()} onChip={() => {}} />);
    expect(await screen.findByText("Seat Finder")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/12029/).length).toBeGreaterThan(0));
    /* EC asli row (available 6) — "status nahi mila" nahi */
    await waitFor(() => expect(screen.getByText("AVL 6")).toBeTruthy());
    expect(screen.queryByText("status nahi mila")).toBeNull();
  });

  it("'AC' chip 2S/SL hata deta hai", async () => {
    stubFetch(boardRows);
    render(<SeatFinder from="AAAB" to="BBBB" date="2026-09-25" rows={search} intent={intent({ wants: true, acOnly: true })} onChip={() => {}} />);
    expect(await screen.findByText("Seat Finder")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/SWARAJ EXPRESS/).length).toBeGreaterThan(0));
    /* card AC mode me hai */
    expect(screen.getByText(/AC classes/)).toBeTruthy();
  });
});

/* ── 24 Sep 2026 (user screenshot: card me SAARI 28 trains "data nahi aayi" — board call khaali
 * aayi thi, provider busy). Ab: honest banner + ↻ dobara try, aur 28-row confusion nahi. ─────── */
describe("Seat Finder card — board fail hone par", () => {
  it("khaali board → banner + '↻ Dobara try karo', poori list 'data nahi aayi' nahi dikhati", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({ ok: true, json: async () => ({ trains: [] }) }));
    const rows = [{ number: "12029", name: "SWARN SHATABDI", departure: "11:11", arrival: "12:38", durationLabel: "1h 27m", arrivalDayOffset: 0 }];
    render(<SeatFinder from="ZZZZ" to="YYYY" date="2027-01-01" rows={rows} intent={intent()} onChip={() => {}} />);
    expect(await screen.findByText(/Live board abhi nahi aa payi/, {}, { timeout: 6000 })).toBeTruthy();
    expect(screen.getByText("↻ Dobara try karo")).toBeTruthy();
    expect(screen.queryByText(/DATA NAHI/)).toBeNull();
  });

  it("↻ dabane par board dobara maangta hai aur data aane par rows dikh jaati hain", async () => {
    let calls = 0;
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
      if (String(url).includes("trainNumber=")) return { ok: true, json: async () => ({ classes: [] }) };
      calls += 1;
      if (calls <= 2) return { ok: true, json: async () => ({ trains: [] }) };
      return { ok: true, json: async () => ({ trains: boardRows }) };
    });
    const rows = [{ number: "11078", name: "JHELUM EXPRESS", departure: "04:30", arrival: "11:15", durationLabel: "6h 45m", arrivalDayOffset: 0 }];
    render(<SeatFinder from="AAAA" to="BBBB" date="2026-09-26" rows={rows} intent={intent()} onChip={() => {}} />);
    fireEvent.click(await screen.findByText("↻ Dobara try karo", {}, { timeout: 5000 }));
    await waitFor(() => expect(screen.getByText("AVL 29")).toBeTruthy());
  });
});

/* ── Round-19 (24 Sep 2026, user screenshots) ───────────────────────────────────────────────────
 * 1) "direct mein bahut si trains available hai lekin neeche seat finder mein avl mein sabhi show
 *     nhi kar rhi and sabhi available classes bhi nhi aa rhi" — Seat Finder sirf route board dekhta
 *     tha (jo 12926 ko WL bata deta hai) jabki upar wala card per-train board se AVL dikhata hai.
 *     Ab card ke apne per-train rows (classOptions) base hain → numbers wahi, saari classes dikhti hain.
 * 2) "kal subha ki trains btao" → poori din ki list — ab window ("subah") ka filter chalta hai.  */
const cardRows = [
  { trainNumber: "11078", trainName: "JHELUM EXPRESS", classes: [
    { classCode: "3A", status: "AVAILABLE", seats: 8, rac: null, waitlist: null, fare: 760, source: "web_railyatri" },
    { classCode: "2A", status: "AVAILABLE", seats: 8, rac: null, waitlist: null, fare: 1070, source: "web_railyatri" },
    { classCode: "SL", status: "NOT_AVAILABLE", seats: null, rac: null, waitlist: null, fare: 290, source: "web_railyatri" },
  ] },
  { trainNumber: "12926", trainName: "PASCHIM EXPRESS", classes: [
    { classCode: "2A", status: "AVAILABLE", seats: 5, rac: null, waitlist: null, fare: 1270, source: "web_railyatri" },
    { classCode: "3A", status: "AVAILABLE", seats: 23, rac: null, waitlist: null, fare: 915, source: "web_railyatri" },
    { classCode: "SL", status: "AVAILABLE", seats: 8, rac: null, waitlist: null, fare: 360, source: "web_railyatri" },
  ] },
];
/* Route board purani/adhoori baat karta hai: 12926 "WL" — par card me AVL hai (asli per-train data). */
const staleRouteBoard = [
  { trainNumber: "11078", trainName: "JHELUM EXPRESS", classes: [
    { classCode: "3A", status: "AVAILABLE", seats: 18, rac: null, waitlist: null, fare: 760, source: "web_confirmtkt" },
  ] },
  { trainNumber: "12926", trainName: "PASCHIM EXPRESS", classes: [
    { classCode: "2A", status: "WAITLIST", seats: null, rac: null, waitlist: 4, fare: 1270, source: "web_confirmtkt" },
  ] },
];
const cardSearch = [
  { number: "11078", name: "JHELUM EXPRESS", departure: "04:30", arrival: "13:15", durationLabel: "8h 45m", arrivalDayOffset: 0 },
  { number: "12926", name: "PASCHIM EXPRESS", departure: "09:40", arrival: "19:10", durationLabel: "9h 30m", arrivalDayOffset: 0 },
];

describe("Seat Finder card — card ka data base (Round-19)", () => {
  it("card ke per-train rows Available me saari classes dikhate hain (12926 bhi, jo route board me WL thi)", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({ ok: true, json: async () => ({ trains: staleRouteBoard }) }));
    render(
      <SeatFinder from="LDH" to="MTJ" date="2026-09-27" rows={cardSearch} cardBoard={cardRows} intent={intent({ confirmedOnly: true })} onChip={() => {}} />,
    );
    expect(await screen.findByText("Seat Finder")).toBeTruthy();
    /* card ke numbers hi dikhein (route board ka 18 nahi) */
    await waitFor(() => expect(screen.getAllByText("AVL 8").length).toBeGreaterThan(0));
    expect(screen.queryByText("AVL 18")).toBeNull(); /* route board ka purana number nahi */
    /* 12926 ki 2A/3A/SL — teeno AVL rows */
    expect(screen.getAllByText(/AVL 5/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AVL 23/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AVL 8/).length).toBeGreaterThan(0);
    /* footer batata hai ki data card ka hi hai */
    expect(screen.getByText(/upar wale card ka hi per-train board/)).toBeTruthy();
  });

  it("'subah' window → sirf subah ki trains (16:50 wali nahi), label bhi dikhta hai", async () => {
    const rows = [
      { number: "12014", name: "AMRITSAR SHTABDI", departure: "04:55", arrival: "06:57", durationLabel: "2h 02m", arrivalDayOffset: 0 },
      { number: "12030", name: "SWARN SHATABDI", departure: "16:50", arrival: "18:50", durationLabel: "2h", arrivalDayOffset: 0 },
    ];
    const board = [
      { trainNumber: "12014", trainName: "AMRITSAR SHTABDI", classes: [{ classCode: "CC", status: "AVAILABLE", seats: 410, rac: null, waitlist: null, fare: 490, source: "web_railyatri" }] },
      { trainNumber: "12030", trainName: "SWARN SHATABDI", classes: [{ classCode: "CC", status: "AVAILABLE", seats: 100, rac: null, waitlist: null, fare: 490, source: "web_railyatri" }] },
    ];
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({ ok: true, json: async () => ({ trains: board }) }));
    render(
      <SeatFinder
        from="ASR"
        to="LDH"
        date="2026-09-25"
        rows={rows}
        intent={intent({ wants: true, afterMin: 240, beforeMin: 720, windowLabel: "Subah (04:00–12:00)" })}
        onChip={() => {}}
      />,
    );
    expect(await screen.findByText("Seat Finder")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("AVL 410")).toBeTruthy());
    expect(screen.getAllByText(/Subah \(04:00–12:00\)/).length).toBeGreaterThan(0);
    expect(screen.queryByText("AVL 100")).toBeNull(); /* 16:50 subah nahi */
  });
});

/* ── Round-19c (24 Sep, user dobara screenshot): "direct mein bahut si trains available hai lekin neeche
 * seat finder mein avl mein sabhi show nhi kar rhi". Route board 12926 ko sab WL batata hai, par usi
 * train ka per-train board (wahi endpoint jo TrainBoard "Refresh seats" chalata hai) 3A/2A/SL
 * AVAILABLE deta hai → "Available" tab par wahi asli rows dikhni chahiye. ───────────────────────── */
const staleBoard = [
  {
    trainNumber: "12926",
    trainName: "PASCHIM EXPRESS",
    classes: [
      { classCode: "3A", code: "3A", status: "WAITLIST", seats: null, rac: null, waitlist: 14, fare: 915, source: "web_confirmtkt" },
      { classCode: "2A", code: "2A", status: "WAITLIST", seats: null, rac: null, waitlist: 4, fare: 1270, source: "web_confirmtkt" },
    ],
  },
];
const perTrain12926 = {
  classes: [
    { code: "3A", status: "AVAILABLE", seats: 23, rac: null, waitlist: null, fare: 915, source: "web_railyatri" },
    { code: "2A", status: "AVAILABLE", seats: 5, rac: null, waitlist: null, fare: 1270, source: "web_railyatri" },
    { code: "SL", status: "AVAILABLE", seats: 8, rac: null, waitlist: null, fare: 360, source: "web_railyatri" },
  ],
};

describe("Seat Finder — purana route board vs fresh per-train board (Round-19c)", () => {
  it("'Available' tab par WL dikhne wali train per-train verify hoke asli AVL rows dikhati hai", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
      if (String(url).includes("trainNumber=")) return { ok: true, json: async () => perTrain12926 };
      return { ok: true, json: async () => ({ trains: staleBoard }) };
    });
    render(
      <SeatFinder
        from="AAAQ"
        to="BBBQ"
        date="2026-09-25"
        rows={[{ number: "12926", name: "PASCHIM EXPRESS", departure: "09:40", arrival: "19:10", durationLabel: "9h 30m", arrivalDayOffset: 0 }]}
        intent={intent()}
        onChip={() => {}}
      />,
    );
    expect(await screen.findByText("Seat Finder")).toBeTruthy();
    /* pehle (Sabhi trains): route board ki purani baat — WL */
    await waitFor(() => expect(screen.getByText("WL 14")).toBeTruthy());

    fireEvent.click(screen.getByText("✅ Available"));
    /* fresh per-train probe ke baad: asli AVAILABLE rows (aur wo train list me chhupi nahi) */
    await waitFor(() => expect(screen.getByText("AVL 23")).toBeTruthy(), { timeout: 8000 });
    expect(screen.getByText("AVL 5")).toBeTruthy();
    expect(screen.getByText("AVL 8")).toBeTruthy();
    expect(screen.queryByText("WL 14")).toBeNull();
  });
});
