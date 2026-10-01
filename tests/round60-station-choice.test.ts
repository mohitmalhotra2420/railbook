/* ══ ROUND-60 (30 Sep 2026, user screenshots) ════════════════════════════════════════════════════════
 * User: *"ambiguous station pe ab choice nahi aati… ab multiple stations pe choice nahi aati"*.
 *
 * Prod probes se asli wajah: "Delhi jaana hai" / "Amritsar se Delhi ka poora plan banao" me NLU city ko
 * chup-chaap NDLS maan leta tha (aur model text me "kaunsa station (NDLS, DLI, NZM)?" poochh deta tha) —
 * koi `choice` payload nahi banta tha, isliye dropdown dikhta hi nahi tha. Sirf wahi phrasing dropdown
 * deti thi jahan NLU city ko UNRESOLVED chhodta tha.
 *
 * Fix: `cityStationAmbiguity()` — slot city-level naam ho (station ka poora naam/code text me na ho) aur
 * us city me 2+ station ho (asli provider search se) → wahi dropdown. Station ka exact naam/code likha ho
 * to kuch nahi poochhte. Ye check AI ke jawab ke SAATH jaata hai (text model ka, dropdown real data ka).
 */
import { describe, expect, it, vi } from "vitest";
import { cityStationAmbiguity } from "../server/agent/run";
import type { Station } from "../server/providers/types";

const st = (code: string, name: string, city: string): Station => ({ code, name, city }) as Station;
const NDLS = st("NDLS", "New Delhi", "Delhi");
const fakeSearch = async (city: string) => ({
  stations:
    city.toLowerCase() === "delhi"
      ? [NDLS, st("DLI", "Delhi Junction", "Delhi"), st("NZM", "Hazrat Nizamuddin", "Delhi")]
      : [st("LDH", "Ludhiana Junction", "Ludhiana")],
});

describe("Round-60 · ambiguous city par station choice (dropdown)", () => {
  it("city-level naam + 2+ station → dropdown (yahi bug tha: choice hi nahi aati thi)", async () => {
    const c = await cityStationAmbiguity({ to: NDLS }, "Delhi jaana hai", fakeSearch);
    expect(c).toBeTruthy();
    expect(c!.kind).toBe("station");
    expect(c!.title).toContain("Delhi");
    expect(c!.options.map((o) => o.value)).toEqual(["NDLS", "DLI", "NZM"]);
    expect(c!.sendTemplate).toBe("{value}");
  });

  it("plan/poore jumle me bhi wahi (ASR se Delhi ka poora plan banao)", async () => {
    const c = await cityStationAmbiguity({ from: st("ASR", "Amritsar Junction", "Amritsar"), to: NDLS }, "Amritsar se Delhi ka poora plan banao", fakeSearch);
    expect(c?.options.length).toBe(3);
  });

  it("station ka exact naam/code likha ho to kuch nahi poochhte (control)", async () => {
    expect(await cityStationAmbiguity({ to: NDLS }, "New Delhi jaana hai", fakeSearch)).toBeNull();
    expect(await cityStationAmbiguity({ to: NDLS }, "NDLS jaana hai", fakeSearch)).toBeNull();
    expect(await cityStationAmbiguity({ to: NDLS }, "New Delhi se Delhi ka plan", fakeSearch)).toBeNull(); /* name text me hai */
  });

  it("ek hi station wali city par sawaal nahi (Ludhiana → LDH)", async () => {
    expect(await cityStationAmbiguity({ to: st("LDH", "Ludhiana Junction", "Ludhiana") }, "Ludhiana jaana hai", fakeSearch)).toBeNull();
  });

  it("slot hi na ho to kuch nahi (aur search fail ho to bhi crash nahi)", async () => {
    expect(await cityStationAmbiguity({}, "kuch bhi", fakeSearch)).toBeNull();
    const boom = vi.fn(async () => { throw new Error("provider down"); });
    expect(await cityStationAmbiguity({ to: NDLS }, "Delhi jaana hai", boom)).toBeNull();
  });
});
