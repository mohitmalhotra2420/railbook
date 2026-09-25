/* IRCTC handoff (ADDITIVE) — focused integration test.
 *
 * Covers, on the real component + real module:
 *  - the payload built from the review state: exact frozen contract, allowlisted keys only;
 *  - refusals: nothing is handed off (and no tab is opened) when the payload cannot be built;
 *  - the local bridge: the frozen autofill storage key + a same-origin window message;
 *  - user-gesture-only new tab to the official IRCTC page, and the safety invariants
 *    (no submit, no credential/OTP/CAPTCHA/payment inputs anywhere in the card).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import React from "react";
import { IrctcHandoff } from "../src/components/IrctcHandoff";
import {
  HANDOFF_KIND,
  HANDOFF_STORAGE_KEY,
  HANDOFF_STORAGE_KEY_V2,
  formatHandoffSummary,
  IRCTC_HANDOFF_URL,
  buildHandoffPayload,
  clearStoredHandoff,
  readStoredHandoff,
  storeHandoff,
} from "../src/irctc/handoff";
import type { HandoffInput } from "../src/irctc/handoff";
import type { ClassCode, Passenger, Station, TrainResult } from "../src/types";

const station = (code: string, name: string): Station => ({ code, name, city: name });

const train: TrainResult = {
  number: "12014",
  name: "ASR NDLS SHTBDI",
  type: "SHATABDI",
  from: station("ASR", "Amritsar Jn"),
  to: station("NDLS", "New Delhi"),
  date: "2026-10-05",
  departure: "05:10",
  arrival: "11:25",
  arrivalDayOffset: 0,
  durationMinutes: 375,
  durationLabel: "6h 15m",
  runsOn: [1, 2, 3, 4, 5, 6, 7],
  classes: [],
};

const pax = (over: Partial<Passenger> = {}): Passenger => ({
  id: `p${Math.random().toString(36).slice(2, 8)}`,
  name: "Asha Kaur",
  age: "28",
  gender: "FEMALE",
  berthPreference: "Lower",
  ...over,
});

const input = (over: Partial<HandoffInput> = {}): HandoffInput => ({
  train,
  date: "2026-10-05",
  classCode: "CC" as ClassCode,
  passengers: [pax(), pax({ name: "Ravi Sharma", age: "35", gender: "MALE", berthPreference: "" })],
  ...over,
});

/* Independent re-check of the frozen validator's allowlists (no import from src, so a widening of
   the payload shape on either side fails this test). */
const ALLOWED_TOP = ["kind", "version", "test", "createdAt", "journey", "passengers", "contact"];
const ALLOWED_JOURNEY = ["from", "fromCode", "to", "toCode", "date", "trainNumber", "classCode"];
const ALLOWED_PAX = ["name", "age", "gender", "berth", "food", "bookOnlyIfConfirm", "autoUpgrade"];
/* Round-21: purana (V1) shape bilkul waise hi rehta hai — sirf legacy key/postMessage isi me jaate hain. */
const ALLOWED_PAX_LEGACY = ["name", "age", "gender", "berth", "food"];

beforeEach(() => {
  clearStoredHandoff();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("IRCTC handoff — payload contract", () => {
  it("builds the exact frozen payload from the review state (and nothing else)", () => {
    const res = buildHandoffPayload(input(), new Date("2026-09-19T06:00:00.000Z"));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    /* V2 (naya autofill — app v1.4.4+): sirf 3 cheezein zyada ho sakti hain (contact + 2 flags),
     * aur wo bhi tabhi jab user ne di ho. Yahan kuch nahi diya gaya → shape V1 jaisa, version 2. */
    expect(res.payload).toEqual({
      kind: "railbook-autofill-test",
      version: 2,
      test: true,
      createdAt: "2026-09-19T06:00:00.000Z",
      journey: {
        from: "Amritsar Jn",
        fromCode: "ASR",
        to: "New Delhi",
        toCode: "NDLS",
        date: "2026-10-05",
        trainNumber: "12014",
        classCode: "CC",
      },
      passengers: [
        { name: "Asha Kaur", age: 28, gender: "female", berth: "Lower", food: "" },
        { name: "Ravi Sharma", age: 35, gender: "male", berth: "No Preference", food: "" },
      ],
    });
    /* LEGACY (purana key + postMessage) — bilkul purana frozen shape. */
    expect(res.payloadLegacy).toEqual({ ...res.payload, version: 1 });
    expect(Object.keys(res.payloadLegacy).sort()).toEqual(["createdAt", "journey", "kind", "passengers", "test", "version"]);
    for (const p of res.payloadLegacy.passengers) expect(Object.keys(p).sort()).toEqual([...ALLOWED_PAX_LEGACY].sort());

    // key allowlists — koi extra key kahin bhi nahi (contacts/flags optional hain, isliye subset check)
    expect(Object.keys(res.payload).every((k) => ALLOWED_TOP.includes(k))).toBe(true);
    expect(ALLOWED_TOP.every((k) => k === "contact" || (res.payload as unknown as Record<string, unknown>)[k] !== undefined)).toBe(true);
    expect(Object.keys(res.payload.journey).sort()).toEqual([...ALLOWED_JOURNEY].sort());
    /* flags optional hain (tick na ho to key hi nahi) — isliye subset check */
    for (const p of res.payload.passengers) expect(Object.keys(p).every((k) => ALLOWED_PAX.includes(k))).toBe(true);
    expect(res.payload.kind).toBe(HANDOFF_KIND);
  });

  it("never carries sensitive/forbidden values, and has no field to put them in", () => {
    const res = buildHandoffPayload(input());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const json = JSON.stringify(res.payload);
    expect(json).not.toMatch(/password|passwd|\bpin\b|otp|cvv|cvc|\bcard\b|upi|vpa|login|username|token|secret|session|cookie|captcha|netbanking|aadhaar|\bpan\b/i);
  });

  it("refuses (with reasons, and no payload) instead of inventing or substituting data", () => {
    const bad: Array<[string, HandoffInput]> = [
      ["no passengers", input({ passengers: [] })],
      ["too many passengers", input({ passengers: Array.from({ length: 7 }, () => pax()) })],
      ["missing gender", input({ passengers: [pax({ gender: "" })] })],
      ["bad age", input({ passengers: [pax({ age: "0" })] })],
      ["unclear train number", input({ train: { ...train, number: "12" } })],
      ["unsupported class", input({ classCode: "GN" as ClassCode })],
      ["bogus calendar date", input({ date: "2026-02-30", train: { ...train, date: "2026-02-30" } })],
      ["missing passenger name", input({ passengers: [pax({ name: "   " })] })],
    ];
    for (const [label, value] of bad) {
      const res = buildHandoffPayload(value);
      expect(res.ok, label).toBe(false);
      expect(res.payload, label).toBeNull();
      expect(res.errors.length, label).toBeGreaterThan(0);
    }
  });

  it("keeps the user's own berth choice (only a blank becomes IRCTC's own default)", () => {
    const res = buildHandoffPayload(
      input({ passengers: [pax({ berthPreference: "Window" }), pax({ berthPreference: "Any" }), pax({ berthPreference: "Side Upper" })] }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.passengers.map((p) => p.berth)).toEqual(["Window", "Any", "Side Upper"]);
  });
});

describe("IRCTC handoff — local bridge", () => {
  it("stores the payload under the frozen autofill key and posts it same-origin (no network)", () => {
    const postSpy = vi.spyOn(window, "postMessage");
    const res = buildHandoffPayload(input());
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const bridge = storeHandoff(res.payload, res.payloadLegacy);
    expect(bridge).toEqual({ stored: true, posted: true });
    /* purani key = purana shape (v1.4.3 app/extension waisa hi chalta rahe) */
    expect(JSON.parse(window.localStorage.getItem(HANDOFF_STORAGE_KEY) as string)).toEqual(res.payloadLegacy);
    /* nayi key = extended shape (app v1.4.4+) */
    expect(JSON.parse(window.localStorage.getItem(HANDOFF_STORAGE_KEY_V2) as string)).toEqual(res.payload);
    expect(readStoredHandoff()).toEqual(res.payload);
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0][0]).toEqual(res.payloadLegacy);
    expect(postSpy.mock.calls[0][1]).toBe(window.location.origin);
  });

  it("does not throw (and never blocks the user) when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    const res = buildHandoffPayload(input());
    if (!res.ok) throw new Error("payload should build");
    expect(() => storeHandoff(res.payload, res.payloadLegacy)).not.toThrow();
    expect(storeHandoff(res.payload, res.payloadLegacy).stored).toBe(false);
  });
});


describe("IRCTC handoff — Round-21 (food + checkboxes + contact ka autofill)", () => {
  it("khaana IRCTC ke apne labels me jaata hai; khaali chhoda ho to site ka default", () => {
    const res = buildHandoffPayload(
      input({
        passengers: [
          pax({ foodChoice: "VEG" }),
          pax({ foodChoice: "NON_VEG" }),
          pax({ foodChoice: "NO_FOOD" }),
          pax({ foodChoice: "" }),
        ],
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.passengers.map((p) => p.food)).toEqual(["Veg", "Non Veg", "No Food", ""]);
  });

  it("IRCTC ke dono checkbox sirf tab jaate hain jab user ne tick kiya ho", () => {
    const res = buildHandoffPayload(
      input({ passengers: [pax({ bookOnlyIfConfirm: true, autoUpgrade: true }), pax()] }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.passengers[0].bookOnlyIfConfirm).toBe(true);
    expect(res.payload.passengers[0].autoUpgrade).toBe(true);
    /* jisne tick nahi kiya uske object me key hi nahi — site ka default waisa hi rehta hai */
    expect("bookOnlyIfConfirm" in res.payload.passengers[1]).toBe(false);
    expect("autoUpgrade" in res.payload.passengers[1]).toBe(false);
    /* legacy (purane app) payload me ye flags kabhi nahi jaate */
    expect("bookOnlyIfConfirm" in res.payloadLegacy.passengers[0]).toBe(false);
  });

  it("mobile/email sirf user ke entered + valid hone par jaate hain", () => {
    const ok = buildHandoffPayload(input({ contact: { mobile: "98765 43210", email: "asha@example.com" } }));
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.payload.contact).toEqual({ mobile: "9876543210", email: "asha@example.com" });

    /* khaali → contact key hi nahi */
    const none = buildHandoffPayload(input({ contact: { mobile: "", email: "" } }));
    if (!none.ok) return;
    expect(none.payload.contact).toBeUndefined();

    /* galat mobile/email → saaf error (jhoothi value kabhi nahi bhejte) */
    const bad = buildHandoffPayload(input({ contact: { mobile: "12345", email: "not-an-email" } }));
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.join(" | ")).toMatch(/mobile/i);

    /* legacy payload me contact kabhi nahi (purana app unknown key par poora payload reject karta hai) */
    expect("contact" in ok.payloadLegacy).toBe(false);
  });

  it("copy-ready summary me bhi food / checkbox / contact dikhte hain", () => {
    const res = buildHandoffPayload(
      input({
        passengers: [pax({ foodChoice: "VEG", bookOnlyIfConfirm: true, autoUpgrade: true })],
        contact: { mobile: "9876543210", email: "asha@example.com" },
      }),
    );
    if (!res.ok) return;
    const text = formatHandoffSummary(res.payload);
    expect(text).toContain("food Veg");
    expect(text).toContain("book only if confirm berths");
    expect(text).toContain("consider for auto up-gradation");
    expect(text).toContain("9876543210");
    expect(text).toContain("asha@example.com");
  });
});

describe("IRCTC handoff — review-screen card", () => {
  it("opens the official IRCTC page in a NEW tab only on the user's click", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as unknown as Window);
    const { container, getByText } = render(<IrctcHandoff {...input()} />);

    // nothing happens before the click
    expect(openSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(HANDOFF_STORAGE_KEY)).toBeNull();

    // preview shows exactly what would be handed over
    const preview = container.querySelector("#irctc-payload-preview");
    expect(preview).toBeTruthy();
    const shown = JSON.parse(preview!.textContent as string);
    expect(shown.kind).toBe(HANDOFF_KIND);
    expect(shown.passengers).toHaveLength(2);
    expect(shown.journey.trainNumber).toBe("12014");

    fireEvent.click(getByText("Continue to IRCTC"));

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0][0]).toBe(IRCTC_HANDOFF_URL);
    expect(openSpy.mock.calls[0][1]).toBe("_blank");
    expect(String(openSpy.mock.calls[0][2])).toContain("noopener");
    expect(readStoredHandoff()?.journey.classCode).toBe("CC");
    expect(container.querySelector("#irctc-handoff-status")?.textContent).toMatch(/login/i);
  });

  it("has no submit path and no field that could take credentials/OTP/CAPTCHA/payment data", () => {
    const { container } = render(<IrctcHandoff {...input()} />);
    expect(container.querySelectorAll("form, input, textarea, select")).toHaveLength(0);
    expect([...container.querySelectorAll("button")].every((b) => b.getAttribute("type") === "button")).toBe(true);
    expect(container.textContent).toMatch(/auto-submit nahi/i);
  });

  it("blocks the handoff (tab stays shut) when the payload cannot be built", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as unknown as Window);
    const { container, getByText } = render(<IrctcHandoff {...input({ passengers: [] })} />);

    const button = getByText("Continue to IRCTC") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);

    expect(openSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(HANDOFF_STORAGE_KEY)).toBeNull();
    expect(container.querySelector(".banner.err")?.textContent).toMatch(/at least 1 passenger/i);
  });
});
