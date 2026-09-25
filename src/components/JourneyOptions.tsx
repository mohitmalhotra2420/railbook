/**
 * Round-17 — RailBook Atlas journey options card.
 *
 * Server ke deterministic `RANK_JOURNEY_OPTIONS` plan ko render karta hai:
 *   BEST OPTION (⚡ Fastest · 🚆 Direct/changes · 💺 Availability · ₹ Fare · ⏱ Duration)
 *   OTHER OPTIONS (chips: Fastest / Fewest changes / Best availability / Connecting / Alternative date)
 *   Direct seat na mile → "Direct seat nahi mili. Ye alternatives mile:" + sirf provider-verified alternatives.
 *
 * Koi client-side ranking/guess nahi — jo plan mein nahi hai wo dikhta nahi.
 */
import { TrainClassBlock, type ClassChipData } from "./TrainClassBlock";
import { useEffect, useState } from "react";
import type { AgentConnection, AgentJourneyPlan, AgentRouteLeg, AgentRouteOption } from "../ai/agent";
import type { JSX, ReactNode } from "react";
import { addDays, formatShortDate, inr } from "../format";
import { departureInWindow } from "../seatfinder";

function dayTag(n: number): string {
  return n > 0 ? ` +${n}d` : "";
}
/* Round-18m-3 (user: "+1d ki jagah proper date likho"): journey date + offset → "12 Sep". */
function dateTag(baseYmd: string | null | undefined, n: number): string {
  if (!baseYmd) return dayTag(n);
  return n > 0 ? ` · ${formatShortDate(addDays(baseYmd, n))}` : "";
}
function legDateLabel(baseYmd: string | null | undefined, n: number): string {
  return baseYmd ? formatShortDate(addDays(baseYmd, n || 0)) : n > 0 ? `+${n}d` : "";
}

type AvailLike = NonNullable<AgentRouteLeg["availability"]>;
/* Round-18m-26 (user): EK colour scheme har jagah — green = available (AVL/RAC), tan = purana/stale data
 * ("X din pehle ka"), blue = WL, red = Not available / Regret, grey = data nahi. Legend card ke upar. */
type Tone = "ok" | "stale" | "wl" | "bad" | "muted";
/* 23 Sep 2026 (user: "undefined AVL 9 aa raha hai"): server ke board rows me class
 * field `code` hota hai (ClassAvailability), jabki UI rows `classCode` maangti hai.
 * Pehle is wajah se live-filled rows "undefined AVL 9" dikhati thin aur un par tap
 * karne se IRCTC handoff me class bhi undefined jati thi. Ab dono shapes ek jagah
 * normalize hoti hain — 'undefined' text kabhi nahi. */
function classCodeOf(a: AvailLike | null | undefined): string {
  if (!a) return "";
  const raw = (a as { classCode?: string | null; code?: string | null });
  return String(raw.classCode || raw.code || "").trim();
}
function asAvailLike(c: unknown): AvailLike {
  const o = (c ?? {}) as Record<string, unknown>;
  const code = String(o.classCode ?? o.code ?? "").trim();
  return {
    classCode: code,
    label: (o.label as string) ?? code,
    status: (o.status as string) ?? "UNKNOWN",
    seats: (o.seats as number | null) ?? null,
    rac: (o.rac as number | null) ?? null,
    waitlist: (o.waitlist as number | null) ?? null,
    fare: (o.fare as number | null) ?? null,
    source: (o.source as string) ?? "web",
    stale: Boolean(o.stale),
    asOf: (o.asOf as string | null) ?? (o.updatedAt as string | null) ?? null,
    note: (o.note as string | null) ?? null,
  } as unknown as AvailLike;
}

function availTextOf(a: AvailLike | null | undefined): { text: string; tone: Tone } {
  if (!a) return { text: "Seat data nahi", tone: "muted" };
  const st = a.stale ? " ⚠ stale" : "";
  const cls = classCodeOf(a);
  const tone = (fresh: Tone): Tone => (a.stale ? "stale" : fresh);
  /* 23 Sep 2026: ConfirmTkt board ka honest note — "Train Cancelled" / "Train Departed".
   * Pehle ye rows sirf "Not available" dikhati thin (list me "seat data nahi aayi"). */
  const note = (a as { note?: string | null }).note;
  if (note && /cancel/i.test(note)) return { text: cls ? `${cls} Train Cancelled` : "Train Cancelled", tone: tone("bad") };
  if (note && /departed/i.test(note)) return { text: cls ? `${cls} Departed` : "Train Departed", tone: tone("bad") };
  if (a.status === "AVAILABLE") return { text: `${cls} AVL${a.seats != null ? ` ${a.seats}` : ""}${st}`, tone: tone("ok") };
  /* Round-18m-22 (user): RAC = available ki tarah (chart ke baad confirm) → green; label RAC N hi rehta hai. */
  if (a.status === "RAC") return { text: `${cls} RAC${a.rac != null ? ` ${a.rac}` : ""}${st}`, tone: tone("ok") };
  /* Round-18m-42: "better WL" (longer ticket segment, much shorter waitlist than direct) — blue, clearly WL, not a seat. */
  if (a.status === "WAITLIST" && (a as { betterWl?: boolean }).betterWl) return { text: `${cls} WL ${a.waitlist ?? "?"} (direct WL ${(a as { directWaitlist?: number | null }).directWaitlist ?? "?"}) — better chance${st}`, tone: tone("wl") };
  if (a.status === "WAITLIST") return { text: `${cls} WL${a.waitlist != null ? ` ${a.waitlist}` : ""}${st}`, tone: tone("wl") };
  if (a.status === "NOT_AVAILABLE") return { text: `${cls} Not available`, tone: tone("bad") };
  if (/REGRET/i.test(String(a.status))) return { text: `${cls} Regret`, tone: tone("bad") };
  return { text: cls ? `${cls} ${a.status}` : String(a.status), tone: "muted" };
}
/** Round-20: AvailLike row → shared chip data (Seat Finder wali shakal) — kuch naya nahi banate. */
function chipDataOf(r: AvailLike): ClassChipData {
  const code = classCodeOf(r) || "—";
  const stale = Boolean(r.stale);
  const note = (r as { note?: string | null }).note ?? null;
  return {
    code,
    status: String(r.status ?? "UNKNOWN"),
    seats: r.seats ?? null,
    rac: r.rac ?? null,
    waitlist: r.waitlist ?? null,
    fare: r.fare ?? null,
    /* WL/N-A halki; AVL/RAC rangdar — Seat Finder ka hi rule. */
    seat: r.status === "AVAILABLE" || r.status === "RAC",
    stale,
    asOf: r.asOf ?? null,
    tag: note && /cancel/i.test(note) ? "Cancelled" : note && /depart/i.test(note) ? "Departed" : stale ? `↻ ${ageLabel(r.asOf)}` : null,
    raw: r,
  };
}

/** "4 classes (2 me seat)" — Seat Finder ke header jaisa hi meta. */
function countTextOf(rows: AvailLike[]): string | null {
  const codes = rows.map(classCodeOf).filter(Boolean);
  if (codes.length <= 1) return null;
  const seats = rows.filter((r) => r.status === "AVAILABLE" || r.status === "RAC").length;
  return `${codes.length} classes${seats ? ` (${seats} me seat)` : ""}`;
}

/** "2 ghante pehle" / "12 din pehle" — provider timestamp se; na ho to "purana data". */
function ageLabel(asOf?: string | null): string {
  const ms = asOf ? Date.parse(asOf) : NaN;
  if (!Number.isFinite(ms)) return "purana data";
  /* 23 Sep 2026: kuch sources (ConfirmTkt cacheTime) future timestamp bhi dete hain
   * (IST ko UTC label karke) — warna "1 min pehle ka data" jaisa jhootha label aata. */
  if (ms > Date.now() + 5 * 60000) return "abhi ka data";
  const mins = Math.max(1, Math.round((Date.now() - ms) / 60000));
  if (mins < 60) return `${mins} min pehle ka data`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} ghante pehle ka data`;
  return `${Math.round(hrs / 24)} din pehle ka data`;
}
/** Colour legend — card ke upar, har jagah yahi matching. */
function ToneLegend() {
  return (
    <div className="jx-legend" aria-label="Colour legend">
      <span className="jx-legend-item"><i className="jx-legend-dot jx-cchip-ok" /> Available (AVL/RAC)</span>
      <span className="jx-legend-item"><i className="jx-legend-dot jx-cchip-stale" /> Purana data (time likha hai)</span>
      <span className="jx-legend-item"><i className="jx-legend-dot jx-cchip-wl" /> Waitlist</span>
      <span className="jx-legend-item"><i className="jx-legend-dot jx-cchip-bad" /> Not available / Regret</span>
    </div>
  );
}

/* Round-18m-7: leg / book-from-earlier par SAB seat-wali classes (user kisi bhi class mein book kar sake). */
function layoverLabel(m: number): string {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}h${r ? ` ${r}m` : ""}` : `${r}m`;
}

/* Round-18m-3: connecting option ke har leg ki apni row — train NAAM, boarding
 * station (naam+code), date, aur US SEGMENT ki seat. Tap → usi leg ki seat query
 * (JAT→BDTS jaisi galat poori-route query kabhi nahi). */
type Tab = "fastest" | "fewest_changes" | "best_availability" | "cheapest" | "connecting" | "alt_date";
type Bfe = NonNullable<NonNullable<AgentJourneyPlan["recovery"]>["boardFromEarlier"]>[number];

const IC = {
  clock: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  arrow: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  rupee: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h12M6 9h12M6 4c6 0 8 2 8 5s-2 5-8 5l8 6" /></svg>,
  cal: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></svg>,
  users: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-5-6.3" /></svg>,
  star: <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z" /></svg>,
  ban: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M5.5 5.5l13 13" /></svg>,
  link: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>,
  check: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 7" /></svg>,
  spark: <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" /></svg>,
  refresh: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" /></svg>,
  pin: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></svg>,
  train: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="3" width="14" height="14" rx="3" /><path d="M5 10h14M9 21l1.5-3M15 21l-1.5-3M8 14h.01M16 14h.01" /></svg>,
  compass: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></svg>,
  warn: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 17.5h.01" /></svg>,
  shield: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" /><path d="M9 12l2 2 4-4" /></svg>,
  back: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 19 8 12l7-7" /></svg>,
  page: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg>,
  chev: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>,
  bolt: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>,
  swap: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h14l-3-3M20 16H6l3 3" /></svg>,
  ticket: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6Z" /><path d="M13 5v14" /></svg>,
};

function durLabel(m?: number | null): string | null {
  return m != null && m > 0 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : null;
}
function timeLabel(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return null;
  }
}
/** Seat pill: "2A AVL 36" + fresh/stale tag (never shows stale as current). */
function SeatPill({ a, size }: { a?: AvailLike | null; size?: "lg" }) {
  const av = availTextOf(a);
  /* Round-18m-25 (user: "side chip mein sirf AVL aata hai, fare nahi"): fare bhi — jaise class chips mein. */
  const text = av.text.replace(" ⚠ stale", "") + (a?.fare != null && a.fare > 0 ? ` · ${inr(a.fare)}` : "");
  return (
    <span className={`jx-seat jx-seat-${av.tone}${size === "lg" ? " jx-seat-lg" : ""}`}>
      <span className="jx-seat-main">{text}</span>
      {a?.stale && <span className="jx-seat-sub">({ageLabel(a.asOf)})</span>}
    </span>
  );
}
/* Round-18m-14 (user: "AVL/RAC chip tap nahi hota — purana data reload ho sake"):
 * har class chip tappable → us class ki FRESH seat check (chat mein message
 * auto-type + scroll). Stale chip par "↻ Refresh" hint. */
function ClassRow({ label, rows, onPick }: { label: string; rows: AvailLike[]; onPick?: (r: AvailLike) => void }) {
  if (!rows.length) return null;
  return (
    <div className="jx-classes">
      {label ? <div className="jx-classes-label">{label}</div> : null}
      <div className="jx-classes-chips">
        {rows.map((r) => {
          const av = availTextOf(r);
          /* Round-18m-30v (user: "ConfirmTkt par seat nahi dikh rahi"): IRCTC maintenance window (23:45–00:20) mein data
           * RailYatri CACHED se aata hai (24h ke andar = stale nahi) — par user ko pata ho ki ye "X min pehle" ka hai. */
          const ageMs = r.asOf ? Date.now() - Date.parse(r.asOf) : NaN;
          const recentButNotLive = !r.stale && Number.isFinite(ageMs) && ageMs > 10 * 60 * 1000;
          const inner = <>{av.text.replace(" ⚠ stale", "")}{r.fare != null ? ` · ${inr(r.fare)}` : ""}{r.stale || recentButNotLive ? <span className="jx-cchip-tag">· {ageLabel(r.asOf)}{onPick ? " ↻" : ""}</span> : null}</>;
          return onPick ? (
            <button key={classCodeOf(r) || r.status} type="button" className={`jx-cchip jx-cchip-btn jx-cchip-${av.tone}`} onClick={(e) => { e.stopPropagation(); onPick(r); }} title={`${classCodeOf(r)} ki fresh seat check`}>{inner}</button>
          ) : (
            <span key={classCodeOf(r) || r.status} className={`jx-cchip jx-cchip-${av.tone}`}>{inner}</span>
          );
        })}
      </div>
    </div>
  );
}
/** 3-column station strip (Book from / Boarding / Deboarding) — ConfirmTkt-style. */
function StationStrip({ cols }: { cols: { name: string; sub: string }[] }) {
  return (
    <div className="jx-strip" style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
      {cols.map((c, i) => (
        <div key={i} className="jx-strip-col">
          <div className="jx-strip-name">{c.name}</div>
          <div className="jx-strip-sub">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
function StatRow({ items }: { items: { ic: JSX.Element; text: string }[] }) {
  return (
    <div className="jx-stats">
      {items.map((it, i) => (
        <span key={i} className="jx-stat">
          <span className="jx-stat-ic">{it.ic}</span>
          {it.text}
        </span>
      ))}
    </div>
  );
}
function Section({ ic, title, badge, children, foot }: { ic: JSX.Element; title: string; badge?: string; children: ReactNode; foot?: string }) {
  return (
    <section className="jx-sec">
      <div className="jx-sec-head">
        <span className="jx-sec-ic">{ic}</span>
        <span className="jx-sec-title">{title}</span>
        {badge && <span className="jx-sec-badge">{badge}</span>}
      </div>
      {children}
      {foot && <div className="jx-sec-foot">{foot}</div>}
    </section>
  );
}
/** Compact list row: train · route · time · seat · chevron. */
function ListRow({ no, name, mid, midSub, dur, durSub, seat, chips, onClick }: { no: string; name: string; mid: string; midSub?: string; dur?: string | null; durSub?: string; seat?: AvailLike | null; chips?: AvailLike[]; onClick?: () => void }) {
  return (
    <button type="button" className="jx-lrow" onClick={onClick}>
      <div className="jx-lrow-a">
        <div className="jx-lrow-train"><span className="jx-no">{no}</span> <span className="jx-name">{name}</span></div>
        {chips && chips.length > 0 && (
          <div className="jx-classes-chips jx-lrow-chips">
            {chips.slice(0, 3).map((r) => { const av = availTextOf(r); return <span key={r.classCode} className={`jx-cchip jx-cchip-${av.tone}`}>{av.text.replace(" ⚠ stale", "")}{r.fare != null ? ` · ${inr(r.fare)}` : ""}{r.stale ? <span className="jx-cchip-tag"> · {ageLabel(r.asOf)}</span> : null}</span>; })}
          </div>
        )}
      </div>
      <div className="jx-lrow-b"><span className="jx-lrow-ic">{IC.pin}</span><div><div>{mid}</div>{midSub && <div className="jx-sub">{midSub}</div>}</div></div>
      <div className="jx-lrow-c"><span className="jx-lrow-ic">{IC.clock}</span><div><div>{dur ?? "—"}</div>{durSub && <div className="jx-sub">{durSub}</div>}</div></div>
      <div className="jx-lrow-d"><SeatPill a={seat} /></div>
      <span className="jx-lrow-chev">{IC.chev}</span>
    </button>
  );
}
function ConnCard({ c, baseDate, onPickLeg }: { c: AgentConnection; baseDate?: string | null; onPickLeg?: (leg: AgentRouteLeg) => void }) {
  let cursor = 0;
  return (
    <div className="jx-conn">
      {c.legs.map((l, i) => {
        const depDay = l.departureDayOffset ?? cursor;
        const arrDay = depDay + (l.arrivalDayOffset || 0);
        cursor = arrDay;
        return (
          <div key={`${l.trainNumber}-${i}`}>
            <button type="button" className="jx-leg" onClick={onPickLeg ? () => onPickLeg({ ...l, departureDayOffset: depDay }) : undefined}>
              <span className="jx-leg-n">{i + 1}</span>
              <div className="jx-leg-body">
                <div className="jx-lrow-train"><span className="jx-no">{l.trainNumber}</span> <span className="jx-name">{l.trainName}</span><SeatPill a={l.availability} /></div>
                <div className="jx-leg-line"><strong>{l.departure}</strong> {l.fromName ?? l.from} ({l.from}){baseDate ? ` · ${legDateLabel(baseDate, depDay)}` : ""} <span className="jx-leg-arr">→</span> <strong>{l.arrival}</strong> {l.toName ?? l.to} ({l.to}){baseDate ? ` · ${legDateLabel(baseDate, arrDay)}` : ""}</div>
                {(l.classOptions ?? []).filter((r) => r.classCode !== l.availability?.classCode).length > 0 && (
                  <div className="jx-classes-chips">{(l.classOptions ?? []).filter((r) => r.classCode !== l.availability?.classCode).slice(0, 4).map((r) => { const av = availTextOf(r); return <span key={r.classCode} className={`jx-cchip jx-cchip-${av.tone}`}>{av.text.replace(" ⚠ stale", "")}{r.fare != null ? ` · ${inr(r.fare)}` : ""}{r.stale ? <span className="jx-cchip-tag"> · {ageLabel(r.asOf)}</span> : null}</span>; })}</div>
                )}
              </div>
            </button>
            {i < c.legs.length - 1 && <div className="jx-leg-change">{IC.swap} Change @ {l.toName ?? l.to} ({l.to}) · layover {layoverLabel(c.layoverMinutes)}</div>}
          </div>
        );
      })}
      {c.totalDurationMinutes != null && <div className="jx-conn-foot">Total {layoverLabel(c.totalDurationMinutes)} · dono trains ki ticket alag-alag</div>}
    </div>
  );
}

/* Round-18m-10: per-hub joint plan — leg-1 (origin→hub) aur leg-2 (hub→destination)
 * ke SAB seat-wale trains alag-alag lists mein, upar AI ka chosen combo. */
function LegList({ title, legs, checked, baseDate, dayOffset, onPickLeg, all }: { title: string; legs: AgentRouteLeg[]; checked: number; baseDate?: string | null; dayOffset?: number; onPickLeg?: (leg: AgentRouteLeg) => void; all?: AgentRouteLeg[] }) {
  const [open, setOpen] = useState(false);
  const [showChecked, setShowChecked] = useState(false);
  const shown = open ? legs : legs.slice(0, 3);
  /* Round-18m-18: jo trains check hui par seat nahi (WL/N-A) — user ko dikhe ki HAR train × HAR class dekhi gayi. */
  const seatSet = new Set(legs.map((l) => l.trainNumber));
  const noSeat = (all ?? []).filter((l) => !seatSet.has(l.trainNumber));
  return (
    <div className="jx-leglist">
      <div className="jx-leglist-head"><span>{title}</span><span className="jx-sec-badge">{legs.length} of {checked} with seats</span></div>
      {shown.map((l) => {
        const depDay = l.departureDayOffset ?? dayOffset ?? 0;
        return (
          <button key={l.trainNumber} type="button" className="jx-lrow jx-lrow-leg" onClick={onPickLeg ? () => onPickLeg({ ...l, departureDayOffset: depDay }) : undefined}>
            <div className="jx-lrow-a">
              <div className="jx-lrow-train"><span className="jx-no">{l.trainNumber}</span> <span className="jx-name">{l.trainName}</span></div>
              {(l.classOptions ?? []).filter((r) => r.classCode !== l.availability?.classCode && !r.stale).length > 0 && (
                <div className="jx-classes-chips jx-lrow-chips">{(l.classOptions ?? []).filter((r) => r.classCode !== l.availability?.classCode && !r.stale).slice(0, 3).map((r) => { const av = availTextOf(r); return <span key={r.classCode} className={`jx-cchip jx-cchip-${av.tone}`}>{av.text}{r.fare != null ? ` · ${inr(r.fare)}` : ""}</span>; })}</div>
              )}
            </div>
            <div className="jx-lrow-b"><span className="jx-lrow-ic">{IC.pin}</span><span>{l.from}→{l.to}{(l.ticketFrom || l.ticketUpto) && <span className="jx-ticket-tag"> · ticket {l.ticketFrom ?? l.from}→{l.ticketUpto ?? l.to}</span>}<br /><span className="jx-sub">{l.departure} · {l.arrival}{baseDate ? ` · ${legDateLabel(baseDate, depDay)}` : ""}</span></span></div>
            <div className="jx-lrow-c"><span className="jx-lrow-ic">{IC.clock}</span><span>{l.durationMinutes != null ? layoverLabel(l.durationMinutes) : "—"}</span></div>
            <div className="jx-lrow-d"><SeatPill a={l.availability} /></div>
            <span className="jx-lrow-chev">{IC.chev}</span>
          </button>
        );
      })}
      {legs.length > 3 && <button type="button" className="jx-more" onClick={() => setOpen(!open)}>{open ? "Kam dikhao" : `+${legs.length - 3} aur trains (seat ke saath)`}</button>}
      {legs.length === 0 && <div className="jx-sub">Is leg par kisi train mein seat nahi mili — {checked} train{checked === 1 ? "" : "s"} × har class check ki (train ke origin se aur 1–2 stop aage tak bhi).</div>}
      {noSeat.length > 0 && (
        <>
          <button type="button" className="jx-more" onClick={() => setShowChecked(!showChecked)}>{showChecked ? "Checked list chhupao" : `${noSeat.length} aur train${noSeat.length > 1 ? "s" : ""} check ki — seat nahi (dekho)`}</button>
          {showChecked && noSeat.map((l) => (
            <div key={`ns-${l.trainNumber}`} className="jx-lrow jx-lrow-leg jx-lrow-noseat">
              <div className="jx-lrow-a"><div className="jx-lrow-train"><span className="jx-no">{l.trainNumber}</span> <span className="jx-name">{l.trainName}</span></div></div>
              <div className="jx-lrow-b"><span className="jx-lrow-ic">{IC.pin}</span><span>{l.from}→{l.to}<br /><span className="jx-sub">{l.departure} · {l.arrival}</span></span></div>
              <div className="jx-lrow-d" style={{ gridColumn: "span 2" }}>
                <span className="jx-classes-chips">{(l.classOptions ?? []).slice(0, 6).map((r) => { const av = availTextOf(r); return <button key={r.classCode} type="button" className={`jx-cchip jx-cchip-btn jx-cchip-${av.tone}`} onClick={onPickLeg ? () => onPickLeg({ ...l, availability: r }) : undefined}>{av.text}</button>; })}{(l.classOptions ?? []).length === 0 && <span className="jx-sub">data nahi mila</span>}</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function LegPlanCard({ lp, baseDate, pax, onPickLeg, heroKey }: { heroKey?: string | null; lp: NonNullable<AgentJourneyPlan["legPlans"]>[number]; baseDate?: string | null; pax?: number | null; onPickLeg?: (leg: AgentRouteLeg) => void }) {
  const bestA = lp.best?.legs[0];
  const from = lp.leg1[0]?.from ?? lp.leg1All?.[0]?.from ?? "";
  const to = lp.leg2[0]?.to ?? lp.leg2All?.[0]?.to ?? "";
  /* Round-18m-21 (user): agar kisi EK leg par bhi seat nahi → poora hub plan bekaar. Doosre leg ki
   * seat-wali trains dikhane ka matlab nahi (user LDH→UMB pahunch kar aage nahi ja sakta). Sirf
   * failing leg ka verdict + uski checked list (transparency) dikhao. */
  const deadLeg = lp.leg1.length === 0 ? 1 : lp.leg2.length === 0 ? 2 : 0;
  if (deadLeg) {
    const legTitle = deadLeg === 1 ? `Leg 1 · ${from} → ${lp.hub}` : `Leg 2 · ${lp.hub} → ${to}`;
    const otherTitle = deadLeg === 1 ? `Leg 2 · ${lp.hub} → ${to}` : `Leg 1 · ${from} → ${lp.hub}`;
    const otherSeated = deadLeg === 1 ? lp.leg2.length : lp.leg1.length;
    return (
      <div className="jx-legplan jx-legplan-dead">
        <div className="jx-legplan-head">{IC.link} <strong>Via {lp.hubName ?? lp.hub}</strong> <span className="jx-sub">({lp.hub}) · ye route kaam nahi karega</span></div>
        <div className="jx-legplan-verdict">{IC.warn} <strong>{legTitle}</strong> mein kisi train mein seat nahi{pax ? ` (${pax} pax)` : ""} — isliye ye connecting route possible nahi hai.{otherSeated > 0 ? ` ${otherTitle} ki ${otherSeated} seat-wali train${otherSeated > 1 ? "s" : ""} dikhane ka matlab nahi, kyunki aage nikal hi nahi paoge.` : ""}</div>
        <LegList title={legTitle} legs={[]} checked={deadLeg === 1 ? lp.checkedLeg1 : lp.checkedLeg2} baseDate={baseDate} dayOffset={deadLeg === 1 ? 0 : lp.leg2All?.[0]?.departureDayOffset ?? 0} onPickLeg={onPickLeg} all={deadLeg === 1 ? lp.leg1All : lp.leg2All} />
      </div>
    );
  }
  return (
    <div className="jx-legplan">
      <div className="jx-legplan-head">{IC.link} <strong>Via {lp.hubName ?? lp.hub}</strong> <span className="jx-sub">({lp.hub}) · {lp.leg1.length + lp.leg2.length} trains with seats{pax ? ` for ${pax} pax` : ""}</span></div>
      {/* Round-18m-30f (user: "layout confusing"): jo combo upar hero mein already dikh raha hai, use yahan
          dobara mat dikhao — sirf ek line. */}
      {lp.best && heroKey && lp.best.legs.map((l) => l.trainNumber).join("+") === heroKey && (
        <div className="jx-sub jx-legplan-same">{IC.check} Upar wala AI-recommended combo ({heroKey.replace("+", " + ")}) isi hub se hai — neeche Leg 1 / Leg 2 ki baaki seat-wali trains, apna combo bhi bana sakte ho.</div>
      )}
      {lp.best && !(heroKey && lp.best.legs.map((l) => l.trainNumber).join("+") === heroKey) && (
        <>
          <div className="jx-legplan-best">{IC.star} AI ka joint best combo{lp.best.totalDurationMinutes != null ? ` · ${layoverLabel(lp.best.totalDurationMinutes)} total` : ""} · layover {layoverLabel(lp.best.layoverMinutes)}</div>
          <ConnCard c={lp.best} baseDate={baseDate} onPickLeg={onPickLeg} />
        </>
      )}
      <LegList title={`Leg 1 · ${from} → ${lp.hub}`} legs={lp.leg1} checked={lp.checkedLeg1} baseDate={baseDate} dayOffset={0} onPickLeg={onPickLeg} all={lp.leg1All} />
      <LegList title={`Leg 2 · ${lp.hub} → ${to}`} legs={lp.leg2} checked={lp.checkedLeg2} baseDate={baseDate} dayOffset={bestA?.arrivalDayOffset ?? lp.leg2All?.[0]?.departureDayOffset ?? 0} onPickLeg={onPickLeg} all={lp.leg2All} />
      <div className="jx-sub jx-legplan-foot">Leg 1 aur Leg 2 ki koi bhi seat-wali train mila kar apna combo bana sakte ho — bas Leg 2 ka departure Leg 1 ke arrival ke baad ho.</div>
    </div>
  );
}

export function JourneyOptions({
  plan,
  onPickTrain,
  onPickClass, onPickLeg,
  onPickBoardEarlier,
  onPickDate,
  onPickStations,
  onOpenBoard,
  initialPage = null,
  window: win = null,
}: {
  plan: AgentJourneyPlan;
  onPickTrain?: (trainNumber: string) => void;
  /** Round-18m-14: class chip tap → fresh seat check for that train/class/segment. */
  /* Round-20: chip tap par caller ko poora row + option bhi milta hai — usse seedha passenger form
   * (train no / date / from → to pehle se bhare) khul sakta hai. Purane callers bina row ke bhi chalte hain. */
  onPickClass?: (q: {
    trainNumber: string;
    classCode: string;
    from: string;
    to: string;
    date?: string | null;
    boardAt?: string | null;
    row?: AvailLike | null;
    option?: AgentRouteOption | null;
    /* Round-20: passenger form ke header ke liye — jo card me dikh raha hai wahi. */
    trainName?: string | null;
    departure?: string | null;
    arrival?: string | null;
    arrivalDayOffset?: number | null;
    durationLabel?: string | null;
    fromName?: string | null;
    toName?: string | null;
  }) => void;
  /** Round-18m-3: connecting leg tap → us leg ke segment+date ki seat query. */
  onPickLeg?: (leg: { trainNumber: string; from: string; to: string; date: string; classCode?: string | null; ticketFrom?: string | null; ticketUpto?: string | null }) => void;
  /** Round-18m-6: book-from-earlier tap → seat check for bookFrom→destination. */
  onPickBoardEarlier?: (o: { trainNumber: string; bookFrom: string; boardAt: string; destination: string; classCode: string }) => void;
  onPickDate?: (ymd: string) => void;
  /** Round-18 §8: user explicitly confirms a different boarding/destination station. */
  onPickStations?: (from: string, to: string) => void;
  /** Round-18e: open the bookable TrainBoard (explicit user action, never auto). */
  onOpenBoard?: () => void;  /** 24 Sep 2026 (user): "alternative trains ka alag page ho, leg 1/leg 2 ka alag page" —
   *  ye prop sirf preview/demo ke liye page khula hua dikhata hai (app flow wahi rehta hai). */
  initialPage?: "direct" | "alt" | "connect" | null;
  /** Round-19d (24 Sep, user: "Card filter karo lekin connecting/alternatives mein change na aayein"):
   *  user ne "subah/dopahar/shaam/raat" ya "X se pehle" bola ho to DIRECT trains ki list (aur hero,
   *  agar wahi direct hai) sirf usi window ki dikhe. Connecting/alternatives/dates ka poora logic aur
   *  data waisa hi rehta hai — sirf dikhane par filter, plan/engine ko chhua nahi. */
  window?: { afterMin: number | null; beforeMin: number | null; label: string | null } | null;
}) {
  const [tab, setTab] = useState<Tab | null>(null);
  const [whyOpen, setWhyOpen] = useState(true);
  /* ── 23 Sep 2026 (user: "chat screen me seats fetch nahi ho rahi, card me ho rahi") ──
   * Seat-board ki jo rows plan-time probe me reh gayi (""Seat data provider se nahi aayi""),
   * unke liye ek hi ROUTE-LEVEL call (from+to+date → ConfirmTkt board: saare trains ×
   * classes). Cards (TrainBoard) apna fresh probe karte hain; ab list bhi wahi data
   * dikhati hai — per-train probe ki kismat par nirbhar nahi. Jo row pehle se probed
   * hai usko ye kabhi overwrite nahi karta. */
  const [liveRows, setLiveRows] = useState<Record<string, AvailLike[]>>({});
  /* 23 Sep 2026 (user: "kuch data stale aa raha, live nahi"): jo rows plan-time par hi
   * purani (stale) ya UNKNOWN class ke saath aayi thi, unko bhi live route-board se
   * refresh karte hain — sirf "khaali" rows ko nahi. Server un trains ke liye live
   * probe (RailYatri IRCTC pull) chalata hai aur fresh row bhejta hai. */
  const rowNeedsLive = (rows: AvailLike[]): boolean =>
    rows.length > 0 && rows.some((r) => r.stale || String(r.status) === "UNKNOWN");
  /* 23 Sep 2026: un rows ke liye honest note jo board me hi nahi hain (MEMU/unreserved) —
   * warna wo row hamesha "seat data provider se nahi aayi · check karo" par atki rehti hai. */
  const [liveNotes, setLiveNotes] = useState<Record<string, string>>({});
  const needKey = (plan.routeOptions ?? [])
    .filter((o) => !liveRows[o.trainNumbers[0]] && (!(o.classOptions && o.classOptions.length) || rowNeedsLive(o.classOptions ?? [])))
    .map((o) => o.trainNumbers[0])
    .join(",");
  useEffect(() => {
    let alive = true;
    const rows = plan.routeOptions ?? [];
    const need = rows
      .filter((o) => !liveRows[o.trainNumbers[0]] && (!(o.classOptions && o.classOptions.length) || rowNeedsLive(o.classOptions ?? [])))
      .map((o) => o.trainNumbers[0]);
    if (!need.length || !plan.query.date) return () => { alive = false; };
    (async () => {
      try {
        const res = await fetch(
          `/api/availability?from=${encodeURIComponent(plan.query.from)}&to=${encodeURIComponent(plan.query.to)}&date=${encodeURIComponent(plan.query.date)}&trains=${encodeURIComponent(need.join(","))}`,
          { headers: { accept: "application/json" } },
        );
        if (!res.ok) return;
        const j = (await res.json()) as { trains?: { trainNumber?: string; classes?: AvailLike[]; note?: string }[] };
        const trains = Array.isArray(j?.trains) ? j.trains : [];
        const next: Record<string, AvailLike[]> = {};
        const notes: Record<string, string> = {};
        for (const t of trains) {
          const no = String(t?.trainNumber ?? "");
          if (!no || !need.includes(no)) continue;
          const cls = Array.isArray(t?.classes) ? (t!.classes as unknown[]).map(asAvailLike) : [];
          if (cls.length) next[no] = cls;
          else if (t?.note) notes[no] = String(t.note);
        }
        if (!alive) return;
        if (Object.keys(next).length) setLiveRows((prev) => ({ ...prev, ...next }));
        if (Object.keys(notes).length) setLiveNotes((prev) => ({ ...prev, ...notes }));
      } catch {
        /* honest: fill na ho to row jaisi thi waisi (koi guess nahi) */
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needKey, plan.query.from, plan.query.to, plan.query.date]);
  const best = plan.best;
  const direct = plan.routeOptions.filter((o) => o.changes === 0);
  /* Round-19d: window filter SIRF direct trains par (0 change). Connecting/alternatives untouched. */
  const winOn = Boolean(win && (win.afterMin != null || win.beforeMin != null));
  const [showAllDirect, setShowAllDirect] = useState(false);
  const directInWindow = winOn ? direct.filter((o) => departureInWindow(o.departure, win!.afterMin, win!.beforeMin)) : direct;
  /* Window me koi direct hi na mile to list khaali karne ka matlab nahi — poori list + saaf note. */
  const directShown = winOn && !showAllDirect && directInWindow.length > 0 ? directInWindow : direct;
  const connections = plan.connections.length ? plan.connections : plan.recovery?.connecting ?? [];
  const altDates = plan.alternativeDates.filter((d) => d.count > 0);
  const rec = plan.recovery;
  const baseDate = plan.query.date;
  const pax = plan.query.passengers ?? null;
  const pick = onPickTrain ? (o: AgentRouteOption) => onPickTrain(o.trainNumbers[0]) : undefined;
  const pickLeg = onPickLeg ? (l: AgentRouteLeg) => onPickLeg({ trainNumber: l.trainNumber, from: l.from, to: l.to, date: addDays(baseDate, l.departureDayOffset ?? 0), classCode: l.availability?.classCode ?? null, ticketFrom: l.ticketFrom ?? null, ticketUpto: l.ticketUpto ?? null }) : undefined;
  const altStations = (rec?.alternateStations ?? []).filter((o) => o.count > 0);
  const partial = rec?.partialRoute;
  const partialPlans = partial?.plans.filter((p) => p.fullyAvailable) ?? [];
  const bfeAll = rec?.boardFromEarlier ?? [];
  const isOk = (a?: AvailLike | null) => !!a && !a.stale && (a.status === "AVAILABLE" || a.status === "RAC");
  /* Round-18m-12: hero rule == engine recommendedOf/journeySummary — fresh same-train
   * book-from-earlier beats a stale (not fresh) or slower-connecting best. */
  const bfeFresh = bfeAll.find((b) => !b.availability.stale) ?? null;
  const bfeBeatsBest = !!bfeFresh && !!best && (!isOk(best.availability) || (best.changes > 0 && (bfeFresh.durationMinutes ?? 9e9) <= (best.durationMinutes ?? 9e9)));
  /* Round-18m-13: AI decision wins — hero = jo AI ne chuna (direct / same-train / connecting). */
  const aiRec = plan.decision?.source === "ai" ? plan.decision.recommended : null;
  const bfeHero: Bfe | null = aiRec
    ? aiRec.kind === "bfe" ? bfeAll.find((b) => b.trainNumber === aiRec.trainNumbers[0] && b.bookFrom === aiRec.bookFrom) ?? null : null
    : plan.directUnavailable ? bfeFresh ?? bfeAll[0] ?? null : bfeBeatsBest ? bfeFresh : null;
  const bfeRest = bfeAll.filter((b) => b !== bfeHero);
  /* Round-18m-16: ticket segment = bookFrom → (bookUpto ?? destination); fresh check usi par. */
  const pickBfe = onPickBoardEarlier ? (b: Bfe) => onPickBoardEarlier({ trainNumber: b.trainNumber, bookFrom: b.bookFrom, boardAt: b.boardAt, destination: b.bookUpto ?? b.destination, classCode: b.availability.classCode }) : undefined;
  /* Round-18m-30e: hero SIRF tab jab `best` wahi option ho jo AI ne chuna (same trains) — warna AI verdict
   * "via NDLS" aur hero "DIRECT WL 74" jaisa mismatch ho jaata hai. Connecting pick → hero = wahi connecting option. */
  const sameTrains = (a: string[] | undefined, b: string[] | undefined) => !!a && !!b && a.join("+") === b.join("+");
  const heroDirectRaw = aiRec
    ? ((aiRec.kind === "direct" || aiRec.kind === "connecting") && best && sameTrains(best.trainNumbers, aiRec.trainNumbers) ? best : null)
    : !plan.directUnavailable && !bfeHero ? best : null;
  /* Round-19d: window laga ho aur hero (direct) us window ke bahar ho → window ka best direct hero banega.
   * Window me koi direct na mile to purana hero jaisa hai (kuch chhupana nahi). */
  const heroSwapped = Boolean(winOn && !showAllDirect && heroDirectRaw && heroDirectRaw.changes === 0 &&
    !departureInWindow(heroDirectRaw.departure, win!.afterMin, win!.beforeMin) && directInWindow.length > 0);
  const heroDirect = heroSwapped ? directInWindow[0] : heroDirectRaw;
  const decidedBy = plan.decision?.source === "ai" ? "AI" : null;
  const asOf = timeLabel(plan.provenance?.retrievedAt);
  const why = plan.whyPoints && plan.whyPoints.length ? plan.whyPoints : plan.summary ? [plan.summary] : [];

  const allTabs: { id: Tab; label: string; ic: JSX.Element; count: number }[] = [
    { id: "fastest", label: "Fastest", ic: IC.bolt, count: direct.length ? Math.min(direct.length, 5) : 0 },
    { id: "cheapest", label: "Lowest fare", ic: IC.rupee, count: plan.routeOptions.filter((o) => o.availability?.fare != null).length },
    { id: "fewest_changes", label: "Fewest changes", ic: IC.swap, count: plan.routeOptions.length ? Math.min(plan.routeOptions.length, 5) : 0 },
    { id: "best_availability", label: "Best availability", ic: IC.check, count: plan.routeOptions.filter((o) => o.availability?.status === "AVAILABLE").length },
    { id: "connecting", label: "Connecting", ic: IC.link, count: plan.directUnavailable ? Math.max(0, connections.length - 2) : connections.length },
    { id: "alt_date", label: "Other date", ic: IC.cal, count: altDates.length },
  ];
  const tabs = allTabs.filter((t) => t.count > 0);
  const sortedFor = (t: Tab): AgentRouteOption[] => {
    const all = [...plan.routeOptions];
    if (t === "fastest") return all.filter((o) => o.durationMinutes != null).sort((x, y) => x.durationMinutes! - y.durationMinutes! || x.trainNumbers[0].localeCompare(y.trainNumbers[0])).slice(0, 5);
    if (t === "fewest_changes") return all.sort((x, y) => x.changes - y.changes || (x.durationMinutes ?? 1e9) - (y.durationMinutes ?? 1e9)).slice(0, 5);
    if (t === "best_availability") return all.filter((o) => o.availability?.status === "AVAILABLE").sort((x, y) => (y.availability?.seats ?? 0) - (x.availability?.seats ?? 0) || x.trainNumbers[0].localeCompare(y.trainNumbers[0])).slice(0, 5);
    if (t === "cheapest") return all.filter((o) => o.availability?.fare != null).sort((x, y) => x.availability!.fare! - y.availability!.fare! || x.trainNumbers[0].localeCompare(y.trainNumbers[0])).slice(0, 5);
    return [];
  };
  /* Round-23 (user: "list me seats nahi aa rahi, card me aa rahi"): ListRow/hero bhi
   * wahi rows dikhayein jo seat-board me hain — plan-time empty ho to live route board. */
  const seatOf = (o: AgentRouteOption): AvailLike | null => {
    /* Live route-board se jo row aayi hai wo plan-time row se upar hai (fresh IRCTC data).
     * Live data na ho to purana behaviour: jo plan ne verify kiya wahi pill. */
    const live = liveRows[o.trainNumbers[0]];
    if (live && live.length) {
      const fresh = live.find((r) => !r.stale && String(r.status) !== "UNKNOWN");
      return fresh ?? live[0] ?? null;
    }
    return o.availability ?? (o.classOptions ?? [])[0] ?? null;
  };
  const chipsOf = (o: AgentRouteOption): AvailLike[] => {
    const seat = seatOf(o);
    return (rowsFor(o).length ? rowsFor(o) : o.classOptions ?? []).filter((r) => r.classCode !== seat?.classCode);
  };
  /* "kitni trains me seat hai" — sirf wahi count jo user ko turant kaam aata hai. */
  const seatTrainCount = direct.filter((o) => {
    const a = seatOf(o);
    return a?.status === "AVAILABLE" || a?.status === "RAC";
  }).length;
  const optRow = (o: AgentRouteOption) =>
    o.changes > 0 && o.legs.length > 1 ? (
      <ConnCard key={o.trainNumbers.join("+")} c={{ station: o.legs[0].to, stationName: o.legs[0].toName ?? null, legs: o.legs, layoverMinutes: o.layoverMinutes ?? 0, totalDurationMinutes: o.durationMinutes, valid: true } as unknown as AgentConnection} baseDate={baseDate} onPickLeg={pickLeg} />
    ) : (
      <ListRow key={o.trainNumbers.join("+")} no={o.trainNumbers[0]} name={o.trainNames[0]} mid={`${o.origin}→${o.destination}`} midSub={`${o.departure} · ${o.arrival}${dateTag(baseDate, o.arrivalDayOffset)}`} dur={o.durationLabel} durSub="Direct" seat={seatOf(o)} chips={chipsOf(o)} onClick={pick ? () => pick(o) : undefined} />
    );
  /* Round-18m-12 (user: "har train × har class check ho, RAC bhi dikhe"): seat-check
   * audit list — HAR direct train ka poora class board (AVL/RAC/WL/N-A, stale ⚠), aur
   * jo train probe nahi hui usko saaf "seat data nahi aayi" — "seat nahi" nahi. */
  const rowsFor = (o: AgentRouteOption): AvailLike[] => liveRows[o.trainNumbers[0]] ?? (o.classOptions ?? []);
  const probedDirect = directShown.filter((o) => (rowsFor(o).length > 0 ? true : o.probed));
  const unprobedDirect = directShown.filter((o) => rowsFor(o).length === 0 && !o.probed && !liveNotes[o.trainNumbers[0]]);
  /* Round-18m-30f: AI ne direct nahi chuna (sab WL) → board default collapsed, ek-line summary; tap = poora board. */
  const recKind = plan.decision?.recommended?.kind ?? (bfeHero ? "bfe" : best && best.changes > 0 ? "connecting" : "direct");
  const [boardOpen, setBoardOpen] = useState<boolean>(() => recKind === "direct" && !plan.directUnavailable);
  /* 24 Sep 2026 (user: "chat UI confusing hai — har cheez easily samajh aaye"): 18 trains ×
   * 5 chips ek saath = deewar. Pehle 5 dikhao, baaki ek tap par. */
  const [showAllTrains, setShowAllTrains] = useState(false);
  const [openTricks, setOpenTricks] = useState<Record<string, boolean>>({});
  /* 24 Sep 2026 (user: "alternative trains ka alag page, leg 1/leg 2 ka alag page banao,
   * front chat me sirf header rahe"): poora detail ab alag page par. */
  const [page, setPage] = useState<"direct" | "alt" | "connect" | null>(initialPage ?? null);
  /* Naya sawaal / naya window → purana "sabhi dikhao" reset (warna filter chup-chaap off reh jata). */
  useEffect(() => {
    setShowAllDirect(false);
  }, [winOn, win?.afterMin ?? null, win?.beforeMin ?? null]);
  const windowBar = winOn && direct.length > 0 && (
    <div className="jx-windowbar">
      <span className="jx-windowbar-ic">{IC.clock}</span>
      <span className="jx-windowbar-txt">
        <strong>{win?.label ?? "Time window"}</strong> — {directInWindow.length
          ? `direct trains sirf isi window ki (${directInWindow.length} mili)`
          : "is window me koi seedha train nahi mila — neeche poori direct list"}
        {directInWindow.length > 0 && !showAllDirect && heroSwapped ? " · AI ke pick ke bajaye window ka best upar" : ""}
      </span>
      {directInWindow.length > 0 && (
        <button type="button" className="jx-windowbar-btn" onClick={() => setShowAllDirect((v) => !v)}>
          {showAllDirect ? `Sirf ${win?.label ?? "window"} dikhao` : `Sabhi ${direct.length} direct dikhao`}
        </button>
      )}
    </div>
  );
  const seatBoard = direct.length > 0 && (
    <Section ic={IC.train} title={`Direct trains ${plan.query.from}→${plan.query.to}`} badge={`${probedDirect.length}/${directShown.length} seat-checked`} foot={unprobedDirect.length ? `${unprobedDirect.map((o) => o.trainNumbers[0]).join(", ")}: seat data provider se nahi aayi — inhe "seat nahi" nahi maana; Refresh seats se dobara check karo.` : "Har direct train ki har class ka status upar hai — RAC bhi booking option hai (berth chart ke baad)."}>
      <div className="jx-sb-rowhead">
        <button type="button" className="jx-why-head jx-sb-toggle" onClick={() => setBoardOpen((v) => !v)}>{boardOpen ? "Hide" : "Show"} {directShown.length} trains · har class ka seat status{!boardOpen && plan.directUnavailable ? " · sab WL/N-A" : ""} <span className={`jx-caret${boardOpen ? " open" : ""}`} /></button>
        {/* Direct trains ka apna page — entry yahi (neeche duplicate card nahi). */}
        <button type="button" className="jx-sb-pagechip" onClick={() => setPage("direct")}>Poora page {IC.chev}</button>
      </div>
      {windowBar}
      {boardOpen && (showAllTrains ? [...directShown] : [...directShown].slice(0, 5)).sort((a, b) => (a.departure ?? "").localeCompare(b.departure ?? "")).map((o) => (
        <div key={o.trainNumbers[0]} className="jx-sb-row">
          <button type="button" className="jx-sb-head" onClick={pick ? () => pick(o) : undefined}><span className="jx-no">{o.trainNumbers[0]}</span> <span className="jx-name">{o.trainNames[0]}</span> <span className="jx-sub">{o.departure}→{o.arrival}{dateTag(baseDate, o.arrivalDayOffset)} · {o.durationLabel ?? ""}</span>{aiRec?.kind === "direct" && aiRec.trainNumbers[0] === o.trainNumbers[0] && <span className="jx-sb-pick">{IC.star} AI pick</span>}</button>
          {rowsFor(o).length ? (
            /* Round-20 (user: "direct trains card bhi Seat Finder jaisa same to same chip wala"):
             * chips ab shared TrainClassBlock se — bilkul Seat Finder card jaisa block + chips. */
            <TrainClassBlock
              number={o.trainNumbers[0]}
              name={o.trainNames[0]}
              timeText={`${o.departure} → ${o.arrival}${dateTag(baseDate, o.arrivalDayOffset)} · ${o.durationLabel ?? ""}`}
              countText={countTextOf(rowsFor(o))}
              rows={rowsFor(o).map(chipDataOf)}
              onChip={
                onPickClass
                  ? (c) =>
                      onPickClass({
                        trainNumber: o.trainNumbers[0],
                        classCode: c.code,
                        from: o.origin,
                        to: o.destination,
                        row: (c.raw as AvailLike) ?? null,
                        option: o,
                        trainName: o.trainNames[0] ?? null,
                        departure: o.departure ?? null,
                        arrival: o.arrival ?? null,
                        arrivalDayOffset: o.arrivalDayOffset ?? null,
                        durationLabel: o.durationLabel ?? null,
                        fromName: o.legs?.[0]?.fromName ?? null,
                        toName: o.legs?.[0]?.toName ?? null,
                      })
                  : undefined
              }
              chipTitle={(c) => `${c.code} — tap karke booking (passenger form)`}
            />
          ) : liveNotes[o.trainNumbers[0]] ? <span className="jx-sub">{liveNotes[o.trainNumbers[0]]}</span> : <button type="button" className="jx-sub jx-linkbtn" onClick={onPickClass ? () => onPickClass({ trainNumber: o.trainNumbers[0], classCode: "", from: o.origin, to: o.destination }) : undefined}>{o.probed ? "Koi class data nahi" : "Seat data provider se nahi aayi"} · ↻ check karo</button>}
          {/* Round-18m-30 (user rule): jo class boarding se WL/N-A thi, usi train mein train-origin se / destination
              ke aage tak ticket par seat — har row = book-from → book-upto, passenger apne hi stations par.
              24 Sep 2026: ye blocks default COLLAPSED (ek line summary) — pehle har train ke neeche 5-6 extra
              chips dikhte the aur list bahut lambi/confusing ho jati thi. */}
          {(o.earlierStopOptions ?? []).length > 0 && (
            <button
              type="button"
              className="jx-trick-head"
              onClick={() => setOpenTricks((v) => ({ ...v, [o.trainNumbers[0]]: !v[o.trainNumbers[0]] }))}
            >
              <span className="jx-trick-ic">{IC.ticket ?? IC.check}</span>
              <span>Ticket trick: {[...new Set((o.earlierStopOptions ?? []).map((b) => `${b.bookFrom}→${b.bookUpto ?? b.destination}`))].slice(0, 3).join(", ")}</span>
              <span className="jx-sub"> · board {o.origin}</span>
              <span className={`jx-caret${openTricks[o.trainNumbers[0]] ? " open" : ""}`} />
            </button>
          )}
          {openTricks[o.trainNumbers[0]] && (o.earlierStopOptions ?? []).map((b) => (
            <div key={`${b.trainNumber}-${b.bookFrom}-${b.bookUpto ?? ""}`} className="jx-sb-alt">
              <span className="jx-sb-alt-label">Ticket {b.bookFromName ?? b.bookFrom} ({b.bookFrom}){b.bookUpto ? ` → ${b.bookUptoName ?? b.bookUpto} (${b.bookUpto})` : ` → ${b.destination}`} · board {b.boardAt}, utro {b.destination}:</span>
              <ClassRow label="" rows={b.classOptions ?? [b.availability]} onPick={onPickClass ? (r) => onPickClass({ trainNumber: b.trainNumber, classCode: r.classCode, from: b.bookFrom, to: b.bookUpto ?? b.destination, boardAt: b.boardAt, row: r }) : undefined} />
            </div>
          ))}
        </div>
      ))}
      {/* 24 Sep 2026 (user: "har direct train ke neeche mat likho — sirf last train ke baad likhna hai"):
       * pehle ye button map ke ANDAR tha, to har train ke neeche repeat ho raha tha. Ab list ke
       * ekdum aant me, sirf ek baar. */}
      {boardOpen && directShown.length > 5 && (
        <button type="button" className="jx-more-trains" onClick={() => setShowAllTrains((v) => !v)}>
          {showAllTrains ? "Sirf pehli 5 trains dikhao" : `Sabhi ${directShown.length} trains dikhao`} <span className={`jx-caret${showAllTrains ? " open" : ""}`} />
        </button>
      )}
    </Section>
  );

  /* status pills */
  const pills: { tone: "bad" | "ok" | "warn" | "muted"; ic: JSX.Element; strong: string; rest?: string }[] = [];
  if (plan.directUnavailable) {
    pills.push({ tone: "bad", ic: IC.ban, strong: "Direct", rest: pax ? `· ${pax} pax ke liye seat nahi` : "· no confirmed seat" });
    if (bfeHero) pills.push({ tone: "ok", ic: IC.star, strong: "Recommended", rest: `· board ${bfeHero.boardAt}` });
    else if (rec?.differentTrain.length) pills.push({ tone: "ok", ic: IC.star, strong: "Doosri train", rest: "· seat hai" });
    if (connections.length) pills.push({ tone: "ok", ic: IC.link, strong: "Connecting", rest: "· dono legs seat" });
    else pills.push({ tone: "warn", ic: IC.link, strong: "Connecting", rest: "· no confirmed seat" });
  } else if (best) {
    if (plan.directStaleAvailable) pills.push({ tone: "warn", ic: IC.warn, strong: "Direct", rest: "· AVL dikh rahi (not fresh) — verify" });
    pills.push(bfeHero ? { tone: "ok", ic: IC.star, strong: "Recommended", rest: `· ${bfeHero.trainNumber} board ${bfeHero.boardAt}` } : { tone: isOk(best.availability) ? "ok" : "warn", ic: IC.star, strong: "Recommended", rest: best.changes ? `· via ${best.legs[0]?.to}` : `· direct ${best.trainNumbers[0]}` });
    if (pax) pills.push({ tone: "muted", ic: IC.users, strong: `${pax} passenger${pax > 1 ? "s" : ""}` });
  }

  /* ── 24 Sep 2026 (user): "alternative trains ka alag page, leg 1/leg 2 ka alag page banao;
   *    front chat me sirf header rahe jisse pata chale ki option hai" ──────────────────────
   * Sirf UI: wahi plan data, wahi handlers — bas detail alag page par. */
  const altBestOffer = (rec?.differentTrain ?? []).find((o) => isOk(seatOf(o))) ?? rec?.differentTrain?.[0] ?? null;
  const altCount = (rec?.differentTrain?.length ?? 0) + bfeRest.length + (partialPlans.length ? 1 : 0) + altStations.length + altDates.length;
  const hubs = plan.legPlans ?? [];
  const legsWithSeat = hubs.filter((lp) => lp.leg1.length > 0 && lp.leg2.length > 0);
  const hasAltPage = altCount > 0;
  const hasConnectPage = hubs.length > 0 || connections.length > 0;
  const hubSummary = hubs
    .map((lp) => `${lp.hubName ?? lp.hub} (Leg 1 ${lp.leg1.length} + Leg 2 ${lp.leg2.length})`)
    .join(" · ");

  /* "fresh chat page" jaisa feel: har page ka apna intro line (user: "fresh chat page pe khule"). */
  const pageIntro: Record<"direct" | "alt" | "connect", string> = {
    direct: `Saari ${direct.length} direct trains × har class ka status — koi bhi class chip tap karo to seedha passenger form khulega (train number, date, from→to pehle se bhare honge). WL/N-A chip par tap karne se fresh seat check hoti hai.`,
    alt: "Jo direct list me nahi mila: same train me pehle station se ticket, doosri trains jisme seat hai, doosre station, aur doosri dates.",
    connect: "Do tickets (har leg ka apna) — dono legs me seat verify hui hai. Leg 1 aur Leg 2 me se jis train par tap karo, uski fresh seat check khul jaayegi.",
  };
  const directPageBody = (
    <>
      <div className="jx-page-note">{IC.check} {pageIntro.direct}</div>
      {seatBoard}
    </>
  );

  const altPageBody = (
    <>
      {bfeRest.length > 0 && (
        <Section ic={IC.refresh} title="Same-train alternatives" badge={`+${bfeRest.length} option${bfeRest.length > 1 ? "s" : ""}`}>
          {bfeRest.slice(0, 7).map((b) => (
            <div key={`${b.trainNumber}-${b.bookFrom}`} role="button" tabIndex={0} className="jx-bfe-row" onClick={pickBfe ? () => pickBfe(b) : undefined} onKeyDown={pickBfe ? (e) => { if (e.key === "Enter") pickBfe(b); } : undefined}>
              <div className="jx-bfe-top">
                <div className="jx-lrow-train"><span className="jx-no">{b.trainNumber}</span> <span className="jx-name">{b.trainName}</span></div>
                <SeatPill a={b.availability} />
                <span className="jx-lrow-chev">{IC.chev}</span>
              </div>
              {/* Round-18m-11 (user: "proper do — kahan se book, kahan board, kahan tak") */}
              <div className="jx-strip jx-strip-sm" style={{ gridTemplateColumns: `repeat(${b.bookUpto ? 4 : 3}, 1fr)` }}>
                <div className="jx-strip-col"><div className="jx-strip-name">{b.bookFromName ?? b.bookFrom}</div><div className="jx-strip-sub">{b.bookFrom}, {b.bookFromDeparture ?? "—"}</div></div>
                <div className="jx-strip-col"><div className="jx-strip-name">{b.boardAtName ?? b.boardAt}</div><div className="jx-strip-sub">{b.boardAt}, {b.boardAtDeparture ?? "—"}</div></div>
                <div className="jx-strip-col"><div className="jx-strip-name">{b.destinationName ?? b.destination}</div><div className="jx-strip-sub">{b.destination}, {b.arrival ?? "—"}{b.arrivalDayOffset ? ` (+${b.arrivalDayOffset}d)` : ""}</div></div>
                {b.bookUpto && <div className="jx-strip-col"><div className="jx-strip-name">{b.bookUptoName ?? b.bookUpto}</div><div className="jx-strip-sub">{b.bookUpto}, {b.bookUptoArrival ?? "—"}</div></div>}
              </div>
              <div className="jx-strip-labels" style={b.bookUpto ? { gridTemplateColumns: "repeat(4, 1fr)" } : undefined}><span>Book from</span><span>Boarding</span><span>Deboarding</span>{b.bookUpto && <span>Book upto</span>}</div>
              {/* Round-18m-14: alternative row ki classes bhi tappable (stale → refresh). */}
              <ClassRow label="" rows={(b.classOptions ?? [b.availability]).filter((r) => r.classCode !== b.availability.classCode || r.stale)} onPick={onPickClass ? (r) => onPickClass({ trainNumber: b.trainNumber, classCode: r.classCode, from: b.bookFrom, to: b.bookUpto ?? b.destination, boardAt: b.boardAt }) : undefined} />
              <div className="jx-bfe-foot">
                <span className="jx-stat"><span className="jx-stat-ic">{IC.clock}</span>{durLabel(b.durationMinutes) ?? "—"} · Direct · board {b.boardAt}</span>
                {(b.classOptions ?? []).filter((r) => r.classCode !== b.availability.classCode).length > 0 && (
                  <span className="jx-classes-chips">{(b.classOptions ?? []).filter((r) => r.classCode !== b.availability.classCode).slice(0, 3).map((r) => { const av = availTextOf(r); return <span key={r.classCode} className={`jx-cchip jx-cchip-${av.tone}`}>{av.text.replace(" ⚠ stale", "")}{r.fare != null ? ` · ${inr(r.fare)}` : ""}{r.stale ? <span className="jx-cchip-tag"> · {ageLabel(r.asOf)}</span> : null}</span>; })}</span>
                )}
              </div>
            </div>
          ))}
        </Section>
      )}
      {plan.directUnavailable && rec && rec.differentTrain.length > 0 && (
        <Section ic={IC.train} title="Doosri train · seat available" badge={`${rec.differentTrain.length}`}>
          {rec.differentTrain.slice(0, 4).map(optRow)}
        </Section>
      )}
      {plan.directUnavailable && partial && (partialPlans.length > 0 || partial.sameTrainSwitch) && (
        <Section ic={IC.swap} title={`Split booking · ${partial.trainNumber} ${partial.classCode}`}>
          {partialPlans.slice(0, 2).map((p) => (
            <div key={p.switchStation} className="jx-split">
              {p.segments.map((s) => (
                <div key={`${s.from}-${s.to}`} className="jx-split-seg"><span>{s.from} → {s.to}</span><SeatPill a={{ classCode: s.classCode, status: "AVAILABLE", seats: s.seats ?? null, rac: null, waitlist: null, fare: null, source: "" }} /></div>
              ))}
              <div className="jx-sub">Seat change @ {p.switchStationName ?? p.switchStation} · berth no. chart ke baad</div>
            </div>
          ))}
          {partial.sameTrainSwitch && !partialPlans.length && (
            <div className="jx-split">
              <div className="jx-split-seg"><span>{partial.sameTrainSwitch.segment.from} → {partial.sameTrainSwitch.segment.to}</span><SeatPill a={{ classCode: partial.sameTrainSwitch.segment.classCode, status: "AVAILABLE", seats: partial.sameTrainSwitch.segment.seats ?? null, rac: null, waitlist: null, fare: null, source: "" }} /></div>
              <div className="jx-sub">Seat {partial.sameTrainSwitch.afterStationName ?? partial.sameTrainSwitch.afterStation} ke baad available</div>
            </div>
          )}
        </Section>
      )}
      {plan.directUnavailable && altStations.length > 0 && (
        <Section ic={IC.pin} title="Doosra station · same city" badge={`${altStations.length}`} foot="Aapka route badla nahi — tap karke confirm karein.">
          {altStations.slice(0, 3).map((o) => (
            <ListRow key={`${o.from}-${o.to}`} no={o.best?.trainNumbers[0] ?? "—"} name={o.changed === "origin" ? "Alternate boarding" : "Alternate destination"} mid={`${o.from}→${o.to}`} midSub={o.best ? `${o.best.departure} · ${o.best.arrival}` : `${o.count} trains`} dur={o.best?.durationLabel ?? null} durSub={`${o.count} trains`} seat={o.best?.availability ?? null} onClick={onPickStations ? () => onPickStations(o.from, o.to) : undefined} />
          ))}
        </Section>
      )}
      {plan.directUnavailable && altDates.length > 0 && (
        <Section ic={IC.cal} title="Other dates" badge={`${altDates.length} alternative${altDates.length > 1 ? "s" : ""}`} foot="Aapki date badli nahi — tap karke us date ka plan dekho. Jahan seat likhi hai wahi verify hui hai.">
          {altDates.map((d) => (
            <button key={d.date} type="button" className="jx-drow" onClick={onPickDate ? () => onPickDate(d.date) : undefined}>
              <span className="jx-drow-date">{formatShortDate(d.date)} · {d.count} train{d.count > 1 ? "s" : ""}</span>
              <span className="jx-drow-proof">{d.seatProof ?? "seat status unverified"}</span>
              <span className="jx-lrow-chev">{IC.chev}</span>
            </button>
          ))}
        </Section>
      )}

    </>
  );
  const connectPageBody = (
    <>
      {(plan.legPlans?.length ?? 0) > 0 && (
        <Section ic={IC.link} title={plan.legPlans!.some((lp) => lp.leg1.length > 0 && lp.leg2.length > 0) ? (plan.directUnavailable ? "Connecting · leg-wise seat options" : "Connecting · leg-wise (comparison — direct mein seat hai)") : "Connecting · koi route possible nahi"} badge={`${plan.legPlans!.length} hub${plan.legPlans!.length > 1 ? "s" : ""}`} foot={plan.legPlans!.some((lp) => lp.leg1.length > 0 && lp.leg2.length > 0) ? (pax ? `Har train par ${pax} passengers ke liye seat verify hui hai — dono tickets alag book hongi.` : "Har train provider-verified — tickets alag-alag book hongi.") : "Har hub par dono legs × saari trains × har class check hui — ek leg par bhi seat na ho to route nahi banta."}>
          {plan.legPlans!.map((lp) => <LegPlanCard key={lp.hub} lp={lp} baseDate={baseDate} pax={pax} onPickLeg={pickLeg} heroKey={heroDirect && heroDirect.changes > 0 ? heroDirect.trainNumbers.join("+") : null} />)}
        </Section>
      )}
      {!(plan.legPlans?.length) && connections.length > 0 && (
        <Section ic={IC.link} title="Connecting · dono trains mein seat" badge={`${connections.length}`} foot={pax ? `Har leg par ${pax} passengers ke liye seat verify hui hai — dono tickets alag book hongi.` : "Dono legs provider-verified — tickets alag-alag book hongi."}>
          {connections.slice(0, 2).map((c, i) => <ConnCard key={i} c={c} baseDate={baseDate} onPickLeg={pickLeg} />)}
        </Section>
      )}
    </>
  );

  return (
    <div className="jx-wrap">
      {/* ── Header ── */}
      <header className="jx-head">
        <div className="jx-kicker">RailBook Atlas · Journey plan</div>
        <div className="jx-route"><span>{plan.query.from}</span><span className="jx-route-arrow">{IC.arrow}</span><span>{plan.query.to}</span></div>
        <div className="jx-meta">
          <span className="jx-pill">{IC.cal} {formatShortDate(plan.query.date)}</span>
          {pax ? <span className="jx-pill">{IC.users} {pax} passenger{pax > 1 ? "s" : ""}</span> : <span className="jx-pill jx-pill-warn">{IC.users} passengers? — batao, seats usi hisaab se</span>}
          {plan.query.travelClass && <span className="jx-pill">{plan.query.travelClass}</span>}
          <span className="jx-pill">{IC.train} {directShown.length} direct{winOn && !showAllDirect && directInWindow.length !== direct.length ? ` (${win?.label ?? "window"})` : ""}</span>
          {direct.length > 0 && (
            <span className={`jx-pill ${seatTrainCount > 0 ? "jx-pill-ok" : "jx-pill-warn"}`}>
              {IC.check} {seatTrainCount > 0 ? `${seatTrainCount} me seat` : "seat kisi me nahi"}
            </span>
          )}
        </div>
        <ToneLegend />
      </header>

      {pills.length > 0 && (
        <div className="jx-status">
          {pills.map((p, i) => (
            <span key={i} className={`jx-spill jx-spill-${p.tone}`}>{p.ic} <strong>{p.strong}</strong>{p.rest ? ` ${p.rest}` : ""}</span>
          ))}
        </div>
      )}
      {plan.conflicts && plan.conflicts.length > 0 && <div className="jx-alert">{plan.conflicts[0].message}</div>}
      {/* 24 Sep 2026 (user screenshot 02:02 — wo "Checked: 10/10 direct trains · Leg-1 … every class"
          line chat me deewar jaisi lag rahi thi): ab ye DETAILS me chhupi hai — ek chhoti line
          "Kaise check kiya?" tap karne par poori transparency khulti hai. */}
      {plan.audit && (plan.audit.directProbed > 0 || plan.audit.bfeStopsChecked > 0 || plan.audit.connLeg1Checked > 0) && (
        <details className="jx-audit-wrap">
          <summary className="jx-audit-sum">
            {IC.check} Kaise check kiya? · {plan.audit.directProbed}/{plan.audit.directTrains} direct trains
            {plan.audit.connLeg1Checked > 0 ? `, ${plan.audit.connLeg1Checked + plan.audit.connLeg2Checked} connecting` : ""}
            {plan.audit.bfeStopsChecked > 0 ? `, ${plan.audit.bfeStopsChecked} earlier-stop segments` : ""} — poora detail
            <span className="jx-caret" />
          </summary>
        <div className="jx-audit">
          <span className="jx-audit-k">{IC.check} Checked{plan.audit.passengers ? ` for ${plan.audit.passengers} pax` : ""}:</span>
          <span>{plan.audit.directProbed}/{plan.audit.directTrains} direct trains</span>
          <span>· {direct.reduce((n, o) => n + (o.classOptions?.length ?? 0), 0)} class rows</span>
          {plan.audit.bfeStopsChecked > 0 && <span>· Leg-1 (train origin → {plan.query.from}): {plan.audit.bfeTrains} trains × {plan.audit.bfeStopsChecked} earlier-stop segments, every class</span>}
          {plan.audit.connLeg1Checked > 0 && <span>· via {plan.audit.connHubs.join("/")}: leg-1 {plan.audit.connLeg1Checked} trains + leg-2 {plan.audit.connLeg2Checked} trains, every class (specials incl.)</span>}
          {/* 24 Sep 2026 (user screenshot: "AI unavailable kyu aa rha?"): pehle yahan raw engine
              reason chipak jata tha ("route-derived junctions (AI unavailable)") — user ko laga
              kuch toot gaya. Ab saaf Hinglish: kya hua + kya asar padta hai (koi asar nahi). */}
          {plan.audit.hubDecision && (() => {
            const hd = plan.audit.hubDecision!;
            const list = hd.hubs.length ? hd.hubs.join(", ") : "koi nahi (direct hi sahi)";
            return hd.source === "ai"
              ? <span>· Change-over hubs (AI ne chune): {list}{hd.reason ? ` — ${hd.reason}` : ""}</span>
              : <span>· Change-over hubs (RailBook ne khud route ke junctions nikaale): {list} — AI se poochha tha par jawab time par nahi aaya (model provider aaj slow hai), isliye route ke real junctions use kiye; trains aur seats isse badalte nahi.</span>;
          })()}
        </div>
        </details>
      )}

      {plan.decision?.verdict && (() => {
        /* 24 Sep 2026 (user screenshot): "Best plan: 20986 …" ka 6-line paragraph box chat me
         * bhaari lag raha tha. Ab pehli 2 line dikhti hai, poori detail tap par (kx-verdict-more). */
        const text = plan.decision!.verdict;
        const words = text.split(/\s+/);
        const long = words.length > 38;
        const lead = long ? `${words.slice(0, 34).join(" ")}…` : text;
        return (
          <div className="jx-verdict">
            <span className="jx-why-ic">{IC.spark}</span>
            <div>
              <strong>{plan.decision!.source === "ai" ? "AI ka faisla" : "RailBook ka faisla"}</strong>
              {long ? (
                <details className="jx-verdict-more">
                  <summary>{lead} <span className="jx-readmore">Poora padho</span><span className="jx-caret" /></summary>
                  <div className="jx-verdict-full">{text}</div>
                </details>
              ) : (
                <div>{text}</div>
              )}
              <div className="jx-basis">Basis: pehle {plan.query.from} se poori party ke liye FRESH seat (AVL &gt; RAC), phir travel time, phir fare/class — same-train earlier-stop ticket bhi isi mein compare.</div>
            </div>
          </div>
        );
      })()}
      {plan.decision?.verifyFirst && (() => {
        const v = plan.decision!.verifyFirst!;
        const o = direct.find((x) => x.trainNumbers[0] === v.trainNumber);
        return (
          <div className="jx-verify">
            <span className="jx-hero-note-ic">{IC.warn}</span>
            <div>
              <strong>Pehle ye check karo · {v.trainNumber} {v.label}</strong>
              <div className="jx-sub">Fastest seat-wali direct train ho sakti hai ({o?.durationLabel ?? ""}) — {v.availability ? availTextOf(v.availability).text.replace(" ⚠ stale", "") : "AVL"} dikh rahi hai lekin data 24h+ purana hai. Fresh AVL nikle to isi ko book karo.</div>
              {o && pick && <button type="button" className="jx-btn jx-btn-primary jx-btn-sm" onClick={() => pick(o)}>Seat check {v.availability?.classCode ?? ""} {IC.arrow}</button>}
            </div>
          </div>
        );
      })()}

      {/* ── Hero: book-from-earlier ── */}
      {bfeHero && (
        <section className="jx-hero">
          <div className="jx-hero-head">
            <span className="jx-hero-star">{IC.star}</span>
            <span className="jx-hero-title">{decidedBy ? "AI Recommended" : "Recommended"} · Same train</span>
            <button type="button" className="jx-why-btn" onClick={() => setWhyOpen((v) => !v)}>Why this? <span className={`jx-caret${whyOpen ? " open" : ""}`} /></button>
          </div>
          <div className="jx-hero-train">
            <span className="jx-no jx-no-lg">{bfeHero.trainNumber}</span>
            <span className="jx-name jx-name-lg">{bfeHero.trainName}</span>
            <SeatPill a={bfeHero.availability} size="lg" />
          </div>
          <StationStrip cols={[
            { name: bfeHero.bookFromName ?? bfeHero.bookFrom, sub: `${bfeHero.bookFrom}, ${bfeHero.bookFromDeparture ?? "—"}` },
            { name: bfeHero.boardAtName ?? bfeHero.boardAt, sub: `${bfeHero.boardAt}, ${bfeHero.boardAtDeparture ?? "—"}` },
            { name: bfeHero.destinationName ?? bfeHero.destination, sub: `${bfeHero.destination}, ${bfeHero.arrival ?? "—"}${bfeHero.arrivalDayOffset ? ` · ${formatShortDate(addDays(baseDate, bfeHero.arrivalDayOffset))}` : ""}` },
            /* Round-18m-16: ConfirmTkt "Book Upto" — ticket destination ke aage tak. */
            ...(bfeHero.bookUpto ? [{ name: bfeHero.bookUptoName ?? bfeHero.bookUpto, sub: `${bfeHero.bookUpto}, ${bfeHero.bookUptoArrival ?? "—"}` }] : []),
          ]} />
          <div className="jx-strip-labels" style={bfeHero.bookUpto ? { gridTemplateColumns: "repeat(4, 1fr)" } : undefined}><span>Book from</span><span>Boarding</span><span>Deboarding</span>{bfeHero.bookUpto && <span>Book upto</span>}</div>
          {bfeHero.bookUpto && (
            <div className="jx-sub jx-upto-note">{IC.check} Ticket {bfeHero.bookFrom}→{bfeHero.bookUpto} tak book hogi, aap {bfeHero.destination} par utar jaayenge — {bfeHero.bookUpto} tak ka fare lagega, seat confirm.</div>
          )}
          <StatRow items={[
            { ic: IC.clock, text: durLabel(bfeHero.durationMinutes) ?? "—" },
            { ic: IC.arrow, text: `Direct · board ${bfeHero.boardAt}` },
            { ic: IC.rupee, text: bfeHero.availability.fare != null ? inr(bfeHero.availability.fare) : "Fare on select" },
          ]} />
          <ClassRow label="Available classes · tap = fresh check" rows={bfeHero.classOptions ?? [bfeHero.availability]} onPick={onPickClass ? (r) => onPickClass({ trainNumber: bfeHero.trainNumber, classCode: r.classCode, from: bfeHero.bookFrom, to: bfeHero.bookUpto ?? bfeHero.destination, boardAt: bfeHero.boardAt }) : undefined} />
          <ClassRow label="Other classes (not fresh)" rows={(bfeHero.classOptions ?? []).filter((r) => r.stale)} />
          <div className="jx-hero-cta">
            <div className="jx-hero-note">
              <span className="jx-hero-note-ic">{IC.warn}</span>
              <div><strong>Availability may have changed</strong><div className="jx-sub">{asOf ? `Last checked: ${asOf}` : "Seat check se confirm karein"} · {bfeHero.boardAt}→{bfeHero.destination}: {bfeHero.directStatus === "WAITLIST" ? "WL" : bfeHero.directStatus ?? "seat nahi"}</div></div>
            </div>
            {pickBfe && <button type="button" className="jx-btn jx-btn-primary" onClick={() => pickBfe(bfeHero)}>Seat check {bfeHero.availability.classCode} {IC.arrow}</button>}
            {onOpenBoard && <button type="button" className="jx-btn jx-btn-dark" onClick={onOpenBoard}>Sabhi trains · Book {IC.arrow}</button>}
          </div>
          {why.length > 0 && (
            <div className={`jx-why${whyOpen ? " open" : ""}`}>
              <button type="button" className="jx-why-head" onClick={() => setWhyOpen((v) => !v)}><span className="jx-why-ic">{IC.spark}</span> AI ne ye plan kyun chuna{plan.whySource === "ai" && <span className="jx-why-tag">AI-written</span>} <span className={`jx-caret${whyOpen ? " open" : ""}`} /></button>
              {whyOpen && <ul className="jx-why-list">{why.map((w, i) => <li key={i}><span className="jx-why-check">{IC.check}</span>{w}</li>)}</ul>}
            </div>
          )}
        </section>
      )}

      {/* ── Hero: direct/connecting best ── */}
      {heroDirect && (
        <section className="jx-hero">
          <div className="jx-hero-head">
            <span className="jx-hero-star">{IC.star}</span>
            <span className="jx-hero-title">{heroSwapped ? "Window ke hisaab se" : decidedBy ? "AI Recommended" : "Recommended"} · {heroDirect.changes ? `${heroDirect.changes} change` : "Direct"}{heroSwapped ? ` · ${win?.label ?? ""}` : ""}</span>
            <button type="button" className="jx-why-btn" onClick={() => setWhyOpen((v) => !v)}>Why this? <span className={`jx-caret${whyOpen ? " open" : ""}`} /></button>
          </div>
          <div className="jx-hero-train">
            <span className="jx-no jx-no-lg">{heroDirect.trainNumbers.join(" + ")}</span>
            <span className="jx-name jx-name-lg">{heroDirect.changes > 0 ? `via ${heroDirect.legs[0]?.toName ?? heroDirect.legs[0]?.to ?? ""}` : heroDirect.trainNames[0]}</span>
            {heroDirect.changes > 0 ? <span className="jx-cchip jx-cchip-ok jx-cchip-lg">Dono legs seat ✓</span> : <SeatPill a={heroDirect.availability ?? rowsFor(heroDirect)[0] ?? null} size="lg" />}
          </div>
          {heroDirect.changes > 0 && heroDirect.legs.length > 1 ? (
            <ConnCard c={{ station: heroDirect.legs[0].to, stationName: heroDirect.legs[0].toName ?? null, legs: heroDirect.legs, layoverMinutes: heroDirect.layoverMinutes ?? 0, totalDurationMinutes: heroDirect.durationMinutes, valid: true } as unknown as AgentConnection} baseDate={baseDate} onPickLeg={pickLeg} />
          ) : (
            <>
              <StationStrip cols={[
                { name: heroDirect.legs[0]?.fromName ?? heroDirect.origin, sub: `${heroDirect.origin}, ${heroDirect.departure}` },
                { name: heroDirect.legs[0]?.toName ?? heroDirect.destination, sub: `${heroDirect.destination}, ${heroDirect.arrival}${dateTag(baseDate, heroDirect.arrivalDayOffset)}` },
              ]} />
              <div className="jx-strip-labels jx-strip-labels-2"><span>Boarding</span><span>Deboarding</span></div>
            </>
          )}
          <StatRow items={[
            { ic: IC.clock, text: heroDirect.durationLabel ?? "—" },
            { ic: IC.arrow, text: heroDirect.changes ? `${heroDirect.changes} change · ${heroDirect.layoverMinutes != null ? layoverLabel(heroDirect.layoverMinutes) : ""}` : "Direct" },
            { ic: IC.rupee, text: heroDirect.availability?.fare != null ? inr(heroDirect.availability.fare) : "Fare on select" },
          ]} />
          {/* Round-18m-12: is train ka POORA class board — AVL/RAC/WL sab (RAC bhi option hai). */}
          {heroDirect.changes === 0 && <ClassRow label="All classes (this train) · tap = fresh check" rows={heroDirect.classOptions ?? (heroDirect.availability ? [heroDirect.availability] : [])} onPick={onPickClass ? (r) => onPickClass({ trainNumber: heroDirect.trainNumbers[0], classCode: r.classCode, from: heroDirect.origin, to: heroDirect.destination }) : undefined} />}
          <div className="jx-hero-cta">
            <div className="jx-hero-note">
              <span className="jx-hero-note-ic">{isOk(heroDirect.availability) ? IC.shield : IC.warn}</span>
              <div><strong>{isOk(heroDirect.availability) ? `Seat verified · IRCTC data ${timeLabel(heroDirect.availability?.asOf ?? plan.provenance?.retrievedAt) ?? ""}` : heroDirect.availability?.stale && (heroDirect.availability.status === "AVAILABLE" || heroDirect.availability.status === "RAC") ? "Available (not fresh) — verify" : "Availability may have changed"}</strong><div className="jx-sub">{heroDirect.availability?.stale ? "Data 24h+ purana (web cache) — Refresh se live check karo." : `${heroDirect.availability?.asOf ? ageLabel(heroDirect.availability.asOf) : asOf ? `Last checked ${asOf}` : ""}${heroDirect.availability?.asOf && Date.now() - Date.parse(heroDirect.availability.asOf) > 10 * 60 * 1000 ? " — IRCTC ka live pull us waqt band tha (23:45–00:20 maintenance)" : ""}. Seats har minute badalti hain — booking se pehle Refresh.`}</div></div>
            </div>
            {onPickClass && heroDirect.availability && <button type="button" className="jx-btn jx-btn-ghost" onClick={() => onPickClass({ trainNumber: heroDirect.trainNumbers[0], classCode: heroDirect.availability!.classCode, from: heroDirect.origin, to: heroDirect.destination, date: plan.query.date })}>↻ Refresh live seats</button>}
            {pick && <button type="button" className="jx-btn jx-btn-primary" onClick={() => pick(heroDirect)}>Is train ko dekho {IC.arrow}</button>}
            {onOpenBoard && <button type="button" className="jx-btn jx-btn-dark" onClick={onOpenBoard}>Sabhi trains · Book {IC.arrow}</button>}
          </div>
          {why.length > 0 && (
            <div className={`jx-why${whyOpen ? " open" : ""}`}>
              <button type="button" className="jx-why-head" onClick={() => setWhyOpen((v) => !v)}><span className="jx-why-ic">{IC.spark}</span> AI ne ye plan kyun chuna{plan.whySource === "ai" && <span className="jx-why-tag">AI-written</span>} <span className={`jx-caret${whyOpen ? " open" : ""}`} /></button>
              {whyOpen && <ul className="jx-why-list">{why.map((w, i) => <li key={i}><span className="jx-why-check">{IC.check}</span>{w}</li>)}</ul>}
            </div>
          )}
        </section>
      )}

      {/* Round-18m-30f (user: "layout confusing"): pehle AI ka faisla + recommended plan (jawab), uske baad
          direct board (AI ne direct nahi chuna to collapsed), phir connecting leg-wise, phir dates. */}
      {seatBoard}
      {plan.directUnavailable && !bfeHero && !rec?.differentTrain.length && !connections.length && (
        <div className="jx-alert">Direct trains mein {pax ? `${pax} passengers ke liye ` : ""}confirmed seat nahi mili aur koi verified alternative provider se nahi aaya — invent nahi karte.{onOpenBoard ? " Neeche se sabhi trains dekh sakte ho." : ""}</div>
      )}
      {plan.directUnavailable && !bfeHero && onOpenBoard && (
        <button type="button" className="jx-btn jx-btn-dark jx-btn-wide" onClick={onOpenBoard}>Sabhi trains dekho / book {IC.arrow}</button>
      )}

      {/* ── Front ke OPTION CARDS (24 Sep 2026 user: "alternative trains header aur connecting
           trains header ko designful/highlight karo, aur direct trains ka option dubara mat dikhao") ──
           Direct ka apna page bhi hai, par uska entry-point upar direct section me chip se hai
           (neeche duplicate card nahi). */}
      {(hasAltPage || hasConnectPage) && (
        <div className="jx-optcards">
          <div className="jx-optcards-h">Aage kya dekh sakte ho?</div>
          {hasAltPage && (
            <button type="button" className="jx-pagecard jx-pagecard-alt" onClick={() => setPage("alt")}>
              <span className="jx-pagecard-ic">{IC.swap}</span>
              <span className="jx-pagecard-txt">
                <span className="jx-pagecard-top">
                  <strong>Alternative trains</strong>
                  <span className="jx-pagecard-badge">{altCount} option{altCount > 1 ? "s" : ""}</span>
                </span>
                <span className="jx-pagecard-sub">
                  {altBestOffer
                    ? `Best: ${altBestOffer.trainNumbers[0]} ${altBestOffer.trainNames[0]} · ${availTextOf(seatOf(altBestOffer)).text.replace(" ⚠ stale", "")}${seatOf(altBestOffer)?.fare != null ? ` · ${inr(seatOf(altBestOffer)!.fare)}` : ""}`
                    : "Same-train tricks, doosri trains, doosra station, doosri dates"}
                </span>
                <span className="jx-pagecard-sub2">Ticket tricks · doosri trains · doosra station · doosri dates</span>
              </span>
              <span className="jx-pagecard-go">Kholo {IC.chev}</span>
            </button>
          )}
          {hasConnectPage && (
            <button type="button" className="jx-pagecard jx-pagecard-connect" onClick={() => setPage("connect")}>
              <span className="jx-pagecard-ic">{IC.link}</span>
              <span className="jx-pagecard-txt">
                <span className="jx-pagecard-top">
                  <strong>Connecting trains · Leg 1 → Leg 2</strong>
                  <span className="jx-pagecard-badge">{hubs.length ? `${hubs.length} hub${hubs.length > 1 ? "s" : ""}` : `${connections.length}`}</span>
                </span>
                <span className="jx-pagecard-sub">
                  {hubs.length
                    ? hubs.map((lp) => `${lp.hubName ?? lp.hub}: Leg 1 ${lp.leg1.length} + Leg 2 ${lp.leg2.length} trains me seat`).join(" · ")
                    : `${connections.length} connecting option${connections.length > 1 ? "s" : ""} — dono legs me seat`}
                </span>
                <span className="jx-pagecard-sub2">{legsWithSeat.length > 0 ? "Dono legs bookable · do tickets" : "Leg-wise trains + seats"}</span>
              </span>
              <span className="jx-pagecard-go">Kholo {IC.chev}</span>
            </button>
          )}
        </div>
      )}

      {/* ── Explore ── */}
      {tabs.length > 0 && (
        <Section ic={IC.compass} title="Explore options">
          <div className="jx-tabs">
            {tabs.map((t) => (
              <button key={t.id} type="button" className={`jx-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(tab === t.id ? null : t.id)}>{t.ic} {t.label}</button>
            ))}
          </div>
          {tab && tab !== "connecting" && tab !== "alt_date" && <div className="jx-list">{sortedFor(tab).map(optRow)}</div>}
          {tab === "connecting" && (
            <div className="jx-list">
              {(plan.directUnavailable ? connections.slice(2, 6) : connections.slice(0, 4)).map((c, i) => <ConnCard key={i} c={c} baseDate={baseDate} onPickLeg={pickLeg} />)}
              {plan.directUnavailable && connections.length <= 2 && <div className="jx-sub">Upar wale {connections.length} hi verified connections mile.</div>}
            </div>
          )}
          {tab === "alt_date" && (
            <div className="jx-list">
              {altDates.map((d) => (
                <button key={d.date} type="button" className="jx-drow" onClick={onPickDate ? () => onPickDate(d.date) : undefined}>
                  <span className="jx-drow-date">{formatShortDate(d.date)} · {d.count} train{d.count > 1 ? "s" : ""}</span>
                  <span className="jx-drow-proof">{d.seatProof ?? (d.fastest ? `fastest ${d.fastest.number}` : "")}</span>
                  <span className="jx-lrow-chev">{IC.chev}</span>
                </button>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ── Alag page (full-screen): detail yahan, chat me sirf header ── */}
      {page && (
        <div className="jx-page" role="dialog" aria-label={page === "direct" ? "Direct trains" : page === "alt" ? "Alternative trains" : "Connecting trains"}>
          <div className="jx-page-head">
            <button type="button" className="jx-page-back" onClick={() => setPage(null)}>{IC.back} Wapas</button>
            <div className="jx-page-title">
              <strong>{page === "direct" ? `Direct trains · ${directShown.length}` : page === "alt" ? `Alternative trains · ${altCount}` : "Connecting · Leg 1 → Leg 2"}</strong>
              <span className="jx-page-sub">
                {`${plan.query.from} → ${plan.query.to} · ${formatShortDate(plan.query.date)}`}
                {page === "direct" ? ` · ${probedDirect.length}/${directShown.length} seat-checked` : page === "alt" ? " · jo direct list me nahi mila" : hubs.length ? ` · ${hubSummary}` : ` · ${connections.length} option`}
              </span>
            </div>
          </div>
          <div className="jx-page-body">
            {page === "direct" ? directPageBody : page === "alt" ? altPageBody : connectPageBody}
          </div>
        </div>
      )}

      <footer className="jx-foot">
        <span>{IC.shield} Railway data: {plan.sources.length ? plan.sources.map((s) => (s.startsWith("web_") ? "web sources" : s)).filter((v, i, a) => a.indexOf(v) === i).join(" · ") : "—"}</span>
        <span>{plan.provenance?.freshness === "stale" ? "⚠ stale — refresh karein" : asOf ? `Last checked: ${asOf}` : ""}</span>
      </footer>
    </div>
  );
}
