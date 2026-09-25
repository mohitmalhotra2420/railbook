/* Round-20 (25 Sep, user: "direct trains card ka UI bhi bilkul Seat Finder wala same to same chip wala
 * ho" — screenshot 1 vs screenshot 2).
 *
 * Ye EK hi presentational block hai jo dono jagah use hota hai:
 *   • Seat Finder card (src/components/SeatFinder.tsx → TrainGroup)
 *   • Journey plan ka DIRECT TRAINS card (src/components/JourneyOptions.tsx)
 * Isliye dono ki shakal ek hi hai — train-wise block (left accent), header me number/name/time/
 * "N classes (M me seat)", aur chips: class code + coloured badge (AVL/RAC/WL/N-A) + fare.
 * Sirf rendering hai: data pehle se jo hai wahi aata hai, koi naya source/API nahi.
 */
import type { JSX } from "react";
import { inr } from "../format";

export type ClassChipData = {
  /** Class code, jaise "3A" (ya "—" jab class pata na ho). */
  code: string;
  /** Provider status: AVAILABLE | RAC | WAITLIST | NOT_AVAILABLE | UNKNOWN | NO_DATA … */
  status: string;
  seats?: number | null;
  rac?: number | null;
  waitlist?: number | null;
  fare?: number | null;
  /** true = rangdar chip (AVL/RAC) — WL/N-A halki (dimmed). */
  seat: boolean;
  stale?: boolean;
  asOf?: string | null;
  /** Chhota extra tag chip par (jaise "· 2h" purane data ka ya "· Cancelled"). */
  tag?: string | null;
  /** Original row (caller ke liye) — sirf pass-through, UI ise nahi padhta. */
  raw?: unknown;
};

export type GroupTone = "seat" | "wl" | "nodata";

/** Wahi badge jo Seat Finder chip par hota hai — dono jagah same text. */
export function ClassChipBadge({ c }: { c: ClassChipData }): JSX.Element {
  const note = c.tag && /cancel/i.test(c.tag) ? "Cancelled" : c.tag && /depart/i.test(c.tag) ? "Departed" : null;
  if (note) return <span className="sf-badge na">{note}</span>;
  if (c.status === "AVAILABLE") return <span className="sf-badge avl">AVL {c.seats ?? "—"}</span>;
  if (c.status === "RAC") return <span className="sf-badge rac">RAC {c.rac ?? "—"}</span>;
  if (c.status === "WAITLIST") return <span className="sf-badge wl">WL {c.waitlist ?? "—"}</span>;
  if (c.status === "UNKNOWN") return <span className="sf-badge na">status nahi mila</span>;
  if (c.status === "NO_DATA") return <span className="sf-badge na">data nahi aayi</span>;
  return <span className="sf-badge na">N/A (Regret)</span>;
}

export function TrainClassBlock({
  number,
  name,
  timeText,
  countText,
  rows,
  tone,
  fromText,
  onChip,
  onHead,
  chipTitle,
}: {
  number: string;
  name?: string | null;
  /** "18:05 → 23:30" ya "18:05 → 23:30 · 2h 05m" — jo caller de. */
  timeText?: string | null;
  /** "· 4 classes (2 me seat)" jaise chhota meta. */
  countText?: string | null;
  rows: ClassChipData[];
  tone?: GroupTone;
  /** "from ₹600" — optional. */
  fromText?: string | null;
  onChip?: (c: ClassChipData) => void;
  /** Header (train number/naam) tappable — journey card par poora train kholne ke liye. */
  onHead?: () => void;
  chipTitle?: (c: ClassChipData) => string;
}): JSX.Element {
  const seats = rows.filter((r) => r.seat).length;
  const grp: GroupTone =
    tone ?? (seats ? "seat" : rows.some((r) => r.status === "NO_DATA" || r.status === "UNKNOWN") ? "nodata" : "wl");
  const head = (
    <>
      <span className="sf-group-t">
        <strong className="jx-no">{number}</strong> <span className="sf-tname">{name ?? ""}</span>
      </span>
      <span className="sf-group-meta">
        {timeText || "time list me nahi"}
        {countText != null ? <span className="sf-group-n"> · {countText}</span> : null}
      </span>
    </>
  );
  return (
    <div className={`sf-group ${grp}`}>
      {onHead ? (
        <button type="button" className="sf-group-h sf-group-hbtn" onClick={onHead}>
          {head}
        </button>
      ) : (
        <div className="sf-group-h">{head}</div>
      )}
      <div className="sf-group-c">
        {rows.map((c) => (
          <button
            key={`${number}-${c.code}-${c.status}`}
            type="button"
            className={`sf-cchip${c.seat ? "" : " off"}${c.stale ? " stale" : ""}`}
            onClick={onChip ? () => onChip(c) : undefined}
            title={chipTitle ? chipTitle(c) : c.seat ? `${c.code}${c.fare ? ` · ${inr(c.fare)}` : ""}` : `${c.code} abhi bookable nahi`}
          >
            <span className="sf-cls">{c.code}</span>{" "}
            <ClassChipBadge c={c} />
            {c.fare ? <> <span className="sf-cfare">{inr(c.fare)}</span></> : null}
            {c.tag && !/cancel|depart/i.test(c.tag) ? <span className="sf-ctag">{c.tag}</span> : null}
          </button>
        ))}
        {fromText ? <span className="sf-cfrom">{fromText}</span> : null}
      </div>
    </div>
  );
}
