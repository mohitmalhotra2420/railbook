/* Round-21c (25 Sep 2026) — user:
 *   "agar seat finder aur direct trains ab same hi show kar rahe hain to seat finder ka UI sirf chat
 *    section se hata do. Uska code, backend se code, SeatFinder.ts, filters, AI using seat finder —
 *    yeh sab delete nahi karna. Sirf chat section se seat finder UI hatao."
 *
 * Ye guard batata hai ki hataya SIRF chat ke render se hai:
 *   • Concierge.tsx me ab <SeatFinder> mount nahi aur uska import nahi.
 *   • Component (SeatFinder.tsx), helper (src/seatfinder.ts), server ka seat finder tool +
 *     seat filter + AI ka seat intent — sab waise hi maujood hain (delete nahi hua).
 *   • Plan card ka time-window filter (jo Seat Intent se aata hai) aur class chips waisa hi chalta hai.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.join(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("Round-21c · chat se Seat Finder UI hataya (code/AI/backend intact)", () => {
  it("Concierge chat me Seat Finder card mount nahi hota + import bhi nahi", () => {
    const c = read("src/views/Concierge.tsx");
    expect(c).not.toContain("<SeatFinder");
    expect(c).not.toContain('components/SeatFinder');
    /* Chat me wahi train render hota hai jo pehle tha (table + plan card). */
    expect(c).toContain("<TrainTableView table={block.table} />");
    expect(c).toContain("<JourneyOptions");
  });

  it("component aur client-side seat finder (intent/filters) delete nahi hue", () => {
    expect(existsSync(path.join(root, "src/components/SeatFinder.tsx"))).toBe(true);
    expect(existsSync(path.join(root, "src/seatfinder.ts"))).toBe(true);
    expect(read("src/components/SeatFinder.tsx")).toMatch(/export function SeatFinder/);
    const sf = read("src/seatfinder.ts");
    expect(sf).toMatch(/export function detectSeatIntent/);
    expect(sf).toMatch(/export function departureInWindow/);
  });

  it("server/AI ka seat finder tool + filter waise hi hain (backend ko chhua nahi)", () => {
    expect(existsSync(path.join(root, "server/agent/seatFinderTool.ts"))).toBe(true);
    expect(existsSync(path.join(root, "server/agent/seatFilter.ts"))).toBe(true);
    expect(read("server/agent/seatFinderTool.ts")).toMatch(/runFindSeatsTool/);
  });

  it("plan card ka time-window filter (seat intent se) aur chips abhi bhi chalte hain", () => {
    const c = read("src/views/Concierge.tsx");
    expect(c).toMatch(/window=\{\s*seatFinder && \(seatFinder\.intent\.afterMin != null \|\| seatFinder\.intent\.beforeMin != null\)/);
    const jo = read("src/components/JourneyOptions.tsx");
    expect(jo).toContain("TrainClassBlock");
  });
});
