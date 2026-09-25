/* Round-22 (26 Sep 2026, user screenshot: Seat Finder ke filter chips) — "yeh filter direct train ke
 * card mein starting mein add kro".
 *
 * Ek hi component do jagah: Seat Finder card aur Journey card ka direct-trains block — dono me chips
 * bilkul same (user ka standing rule). Filtering hamesha client-side hai aur SIRF direct trains par —
 * connecting/alternatives/planner ka data waisa hi rehta hai.
 */
import type { ClassCode } from "../types";
import type { SeatMode } from "../seatfinder";

export const CLASS_CHIPS: (ClassCode | "ALL")[] = ["ALL", "1A", "2A", "3A", "3E", "SL", "CC", "2S", "EC"];

/** AC group (1A/2A/3A/3E/CC/EC) — 2S/SL nahi (user: "AC trains" par SL nahi dikhni chahiye). */
export const AC_CLASS_SET = new Set<string>(["1A", "2A", "3A", "3E", "CC", "EC"]);

/* Round-19: shabd wale WINDOW chips bhi (subah/dopahar/shaam/raat) — pehle sirf "X ke baad" the,
 * isliye "kal subha ki trains" par poori din ki list dikhti thi. */
export const TIME_OPTIONS: { after: number | null; before: number | null; label: string }[] = [
  { after: null, before: null, label: "Sab" },
  { after: 240, before: 720, label: "🌅 Subah (04:00–12:00)" },
  { after: 720, before: 1020, label: "☀️ Dopahar (12:00–17:00)" },
  { after: 1020, before: 1260, label: "🌆 Shaam (17:00–21:00)" },
  { after: 1260, before: 240, label: "🌙 Raat (21:00 ke baad)" },
  { after: 360, before: null, label: "Subah 6 ke baad" },
  { after: 720, before: null, label: "12 baje ke baad" },
  { after: 1020, before: null, label: "5 baje ke baad" },
  { after: 1260, before: null, label: "9 baje ke baad" },
  { after: null, before: 720, label: "12 baje se pehle" },
];

export const timeKey = (after: number | null, before: number | null) => `${after ?? ""}-${before ?? ""}`;

export type SeatFilterBarProps = {
  mode: SeatMode;
  setMode: (m: SeatMode) => void;
  cls: ClassCode | null;
  setCls: (c: ClassCode | null) => void;
  acOnly: boolean;
  setAcOnly: (v: boolean) => void;
  afterMin: number | null;
  beforeMin: number | null;
  setTime: (after: number | null, before: number | null) => void;
  earliest: boolean;
  setEarliest: (v: boolean) => void;
  cheapest: boolean;
  setCheapest: (v: boolean) => void;
  /** Screen-reader prefix — do jagah lagne se pehchanne me aasani (optional). */
  label?: string;
};

export function SeatFilterBar({
  mode,
  setMode,
  cls,
  setCls,
  acOnly,
  setAcOnly,
  afterMin,
  beforeMin,
  setTime,
  earliest,
  setEarliest,
  cheapest,
  setCheapest,
  label,
}: SeatFilterBarProps) {
  return (
    <div className="sf-chips" role="group" aria-label={label ?? "Seat filters"}>
      <button
        className={`sf-chip ${mode === "avail" ? "on" : ""}`}
        onClick={() => setMode(mode === "avail" ? "all" : "avail")}
        title="Sirf AVAILABLE aur RAC wali trains"
        type="button"
      >
        ✅ Available
      </button>
      <button
        className={`sf-chip ${mode === "all" ? "on" : ""}`}
        onClick={() => setMode("all")}
        title="Sabhi trains + unki saari classes (real status ke saath)"
        type="button"
      >
        🚆 Sabhi trains
      </button>
      {CLASS_CHIPS.map((c) => (
        <button
          key={c}
          className={`sf-chip ${(c === "ALL" ? cls === null && !acOnly : cls === c) ? "sel" : ""}`}
          onClick={() => {
            setAcOnly(false);
            setCls(c === "ALL" ? null : (c as ClassCode));
          }}
          type="button"
        >
          {c === "ALL" ? "Sab class" : c}
        </button>
      ))}
      {/* 24 Sep 2026 user: "AC trains dikhao" par 2S/SL bhi dikh rahe the — ab poora AC group. */}
      <button
        className={`sf-chip ${acOnly ? "sel" : ""}`}
        title="Sirf AC classes: 1A, 2A, 3A, 3E, CC, EC (2S/SL nahi)"
        onClick={() => {
          setAcOnly(!acOnly);
          setCls(null);
        }}
        type="button"
      >
        ❄️ AC
      </button>
      <select
        className={`sf-chip sf-select ${afterMin != null || beforeMin != null ? "on-time" : ""}`}
        value={timeKey(afterMin, beforeMin)}
        onChange={(e) => {
          const [a, b] = e.target.value.split("-");
          setTime(a === "" ? null : Number(a), b === "" ? null : Number(b));
        }}
        aria-label="Time filter"
      >
        {TIME_OPTIONS.map((o) => (
          <option key={timeKey(o.after, o.before)} value={timeKey(o.after, o.before)}>
            Time: {o.label}
          </option>
        ))}
      </select>
      <button
        className={`sf-chip ${earliest ? "sel" : ""}`}
        onClick={() => {
          setEarliest(!earliest);
          setCheapest(false);
        }}
        type="button"
      >
        ⚡ Sabse jaldi
      </button>
      <button
        className={`sf-chip ${cheapest ? "sel" : ""}`}
        onClick={() => {
          setCheapest(!cheapest);
          setEarliest(false);
        }}
        type="button"
      >
        💰 Sabse sasta
      </button>
    </div>
  );
}
