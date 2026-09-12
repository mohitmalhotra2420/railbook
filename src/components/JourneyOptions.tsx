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
import { useState } from "react";
import type { AgentConnection, AgentJourneyPlan, AgentRouteLeg, AgentRouteOption } from "../ai/agent";
import type { JSX, ReactNode } from "react";
import { addDays, formatShortDate, inr } from "../format";

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
function availTextOf(a: AvailLike | null | undefined): { text: string; tone: "ok" | "warn" | "bad" | "muted" } {
  if (!a) return { text: "Seat data nahi", tone: "muted" };
  const st = a.stale ? " ⚠ stale" : "";
  if (a.status === "AVAILABLE") return { text: `${a.classCode} AVL${a.seats != null ? ` ${a.seats}` : ""}${st}`, tone: a.stale ? "warn" : "ok" };
  if (a.status === "RAC") return { text: `${a.classCode} RAC${a.rac != null ? ` ${a.rac}` : ""}${st}`, tone: "warn" };
  if (a.status === "WAITLIST") return { text: `${a.classCode} WL${a.waitlist != null ? ` ${a.waitlist}` : ""}${st}`, tone: "bad" };
  if (a.status === "NOT_AVAILABLE") return { text: `${a.classCode} Not available`, tone: "bad" };
  return { text: `${a.classCode} ${a.status}`, tone: "muted" };
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
  chev: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>,
  bolt: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>,
  swap: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h14l-3-3M20 16H6l3 3" /></svg>,
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
  const text = av.text.replace(" ⚠ stale", "");
  return (
    <span className={`jx-seat jx-seat-${av.tone}${size === "lg" ? " jx-seat-lg" : ""}`}>
      <span className="jx-seat-main">{text}</span>
      {a?.stale && <span className="jx-seat-sub">(Not fresh)</span>}
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
          const inner = <>{av.text.replace(" ⚠ stale", "")}{r.fare != null ? ` · ${inr(r.fare)}` : ""}{r.stale ? <span className="jx-cchip-tag">{onPick ? "↻ Refresh" : "(Not fresh)"}</span> : null}</>;
          return onPick ? (
            <button key={r.classCode} type="button" className={`jx-cchip jx-cchip-btn jx-cchip-${r.stale ? "stale" : av.tone}`} onClick={(e) => { e.stopPropagation(); onPick(r); }} title={`${r.classCode} ki fresh seat check`}>{inner}</button>
          ) : (
            <span key={r.classCode} className={`jx-cchip jx-cchip-${r.stale ? "stale" : av.tone}`}>{inner}</span>
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
            {chips.slice(0, 3).map((r) => { const av = availTextOf(r); return <span key={r.classCode} className={`jx-cchip jx-cchip-${r.stale ? "stale" : av.tone}`}>{av.text.replace(" ⚠ stale", "")}{r.fare != null ? ` · ${inr(r.fare)}` : ""}</span>; })}
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
                  <div className="jx-classes-chips">{(l.classOptions ?? []).filter((r) => r.classCode !== l.availability?.classCode).slice(0, 4).map((r) => { const av = availTextOf(r); return <span key={r.classCode} className={`jx-cchip jx-cchip-${r.stale ? "stale" : av.tone}`}>{av.text.replace(" ⚠ stale", "")}{r.fare != null ? ` · ${inr(r.fare)}` : ""}</span>; })}</div>
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

function LegPlanCard({ lp, baseDate, pax, onPickLeg }: { lp: NonNullable<AgentJourneyPlan["legPlans"]>[number]; baseDate?: string | null; pax?: number | null; onPickLeg?: (leg: AgentRouteLeg) => void }) {
  const bestA = lp.best?.legs[0];
  return (
    <div className="jx-legplan">
      <div className="jx-legplan-head">{IC.link} <strong>Via {lp.hubName ?? lp.hub}</strong> <span className="jx-sub">({lp.hub}) · {lp.leg1.length + lp.leg2.length} trains with seats{pax ? ` for ${pax} pax` : ""}</span></div>
      {lp.best && (
        <>
          <div className="jx-legplan-best">{IC.star} AI ka joint best combo{lp.best.totalDurationMinutes != null ? ` · ${layoverLabel(lp.best.totalDurationMinutes)} total` : ""} · layover {layoverLabel(lp.best.layoverMinutes)}</div>
          <ConnCard c={lp.best} baseDate={baseDate} onPickLeg={onPickLeg} />
        </>
      )}
      <LegList title={`Leg 1 · ${lp.leg1[0]?.from ?? lp.leg1All?.[0]?.from ?? ""} → ${lp.hub}`} legs={lp.leg1} checked={lp.checkedLeg1} baseDate={baseDate} dayOffset={0} onPickLeg={onPickLeg} all={lp.leg1All} />
      <LegList title={`Leg 2 · ${lp.hub} → ${lp.leg2[0]?.to ?? lp.leg2All?.[0]?.to ?? ""}`} legs={lp.leg2} checked={lp.checkedLeg2} baseDate={baseDate} dayOffset={bestA?.arrivalDayOffset ?? lp.leg2All?.[0]?.departureDayOffset ?? 0} onPickLeg={onPickLeg} all={lp.leg2All} />
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
}: {
  plan: AgentJourneyPlan;
  onPickTrain?: (trainNumber: string) => void;
  /** Round-18m-14: class chip tap → fresh seat check for that train/class/segment. */
  onPickClass?: (q: { trainNumber: string; classCode: string; from: string; to: string; date?: string | null; boardAt?: string | null }) => void;
  /** Round-18m-3: connecting leg tap → us leg ke segment+date ki seat query. */
  onPickLeg?: (leg: { trainNumber: string; from: string; to: string; date: string; classCode?: string | null; ticketFrom?: string | null; ticketUpto?: string | null }) => void;
  /** Round-18m-6: book-from-earlier tap → seat check for bookFrom→destination. */
  onPickBoardEarlier?: (o: { trainNumber: string; bookFrom: string; boardAt: string; destination: string; classCode: string }) => void;
  onPickDate?: (ymd: string) => void;
  /** Round-18 §8: user explicitly confirms a different boarding/destination station. */
  onPickStations?: (from: string, to: string) => void;
  /** Round-18e: open the bookable TrainBoard (explicit user action, never auto). */
  onOpenBoard?: () => void;
}) {
  const [tab, setTab] = useState<Tab | null>(null);
  const [whyOpen, setWhyOpen] = useState(true);
  const best = plan.best;
  const direct = plan.routeOptions.filter((o) => o.changes === 0);
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
  const heroDirect = aiRec ? (aiRec.kind === "direct" || aiRec.kind === "connecting" ? best : null) : !plan.directUnavailable && !bfeHero ? best : null;
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
  const optRow = (o: AgentRouteOption) =>
    o.changes > 0 && o.legs.length > 1 ? (
      <ConnCard key={o.trainNumbers.join("+")} c={{ station: o.legs[0].to, stationName: o.legs[0].toName ?? null, legs: o.legs, layoverMinutes: o.layoverMinutes ?? 0, totalDurationMinutes: o.durationMinutes, valid: true } as unknown as AgentConnection} baseDate={baseDate} onPickLeg={pickLeg} />
    ) : (
      <ListRow key={o.trainNumbers.join("+")} no={o.trainNumbers[0]} name={o.trainNames[0]} mid={`${o.origin}→${o.destination}`} midSub={`${o.departure} · ${o.arrival}${dateTag(baseDate, o.arrivalDayOffset)}`} dur={o.durationLabel} durSub="Direct" seat={o.availability} chips={(o.classOptions ?? []).filter((r) => r.classCode !== o.availability?.classCode)} onClick={pick ? () => pick(o) : undefined} />
    );
  /* Round-18m-12 (user: "har train × har class check ho, RAC bhi dikhe"): seat-check
   * audit list — HAR direct train ka poora class board (AVL/RAC/WL/N-A, stale ⚠), aur
   * jo train probe nahi hui usko saaf "seat data nahi aayi" — "seat nahi" nahi. */
  const probedDirect = direct.filter((o) => o.probed);
  const unprobedDirect = direct.filter((o) => !o.probed);
  const [boardOpen, setBoardOpen] = useState(true);
  const seatBoard = direct.length > 0 && (
    <Section ic={IC.train} title={`Direct trains ${plan.query.from}→${plan.query.to}`} badge={`${probedDirect.length}/${direct.length} seat-checked`} foot={unprobedDirect.length ? `${unprobedDirect.map((o) => o.trainNumbers[0]).join(", ")}: seat data provider se nahi aayi — inhe "seat nahi" nahi maana; Refresh seats se dobara check karo.` : "Har direct train ki har class ka status upar hai — RAC bhi booking option hai (berth chart ke baad)."}>
      <button type="button" className="jx-why-head" onClick={() => setBoardOpen((v) => !v)}>{boardOpen ? "Hide" : "Show"} {direct.length} trains · har class ka seat status <span className={`jx-caret${boardOpen ? " open" : ""}`} /></button>
      {boardOpen && [...direct].sort((a, b) => (a.departure ?? "").localeCompare(b.departure ?? "")).map((o) => (
        <div key={o.trainNumbers[0]} className="jx-sb-row">
          <button type="button" className="jx-sb-head" onClick={pick ? () => pick(o) : undefined}><span className="jx-no">{o.trainNumbers[0]}</span> <span className="jx-name">{o.trainNames[0]}</span> <span className="jx-sub">{o.departure}→{o.arrival}{dateTag(baseDate, o.arrivalDayOffset)} · {o.durationLabel ?? ""}</span>{aiRec?.kind === "direct" && aiRec.trainNumbers[0] === o.trainNumbers[0] && <span className="jx-sb-pick">{IC.star} AI pick</span>}</button>
          {o.classOptions && o.classOptions.length ? <ClassRow label="" rows={o.classOptions} onPick={onPickClass ? (r) => onPickClass({ trainNumber: o.trainNumbers[0], classCode: r.classCode, from: o.origin, to: o.destination }) : undefined} /> : <button type="button" className="jx-sub jx-linkbtn" onClick={onPickClass ? () => onPickClass({ trainNumber: o.trainNumbers[0], classCode: "", from: o.origin, to: o.destination }) : undefined}>{o.probed ? "Koi class data nahi" : "Seat data provider se nahi aayi"} · ↻ check karo</button>}
        </div>
      ))}
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

  return (
    <div className="jx-wrap">
      {/* ── Header ── */}
      <header className="jx-head">
        <div className="jx-kicker">RailBook Atlas · Journey plan</div>
        <div className="jx-route"><span>{plan.query.from}</span><span className="jx-route-arrow">{IC.arrow}</span><span>{plan.query.to}</span></div>
        <div className="jx-meta">
          <span className="jx-pill">{IC.cal} {formatShortDate(plan.query.date)}</span>
          <span className="jx-pill">{IC.users} {pax ? `${pax} passenger${pax > 1 ? "s" : ""}` : `${plan.routeOptions.length} trains`}</span>
          {plan.query.travelClass && <span className="jx-pill">{plan.query.travelClass}</span>}
          {pax && <span className="jx-pill">{IC.train} {plan.routeOptions.length} trains</span>}
        </div>
      </header>

      {pills.length > 0 && (
        <div className="jx-status">
          {pills.map((p, i) => (
            <span key={i} className={`jx-spill jx-spill-${p.tone}`}>{p.ic} <strong>{p.strong}</strong>{p.rest ? ` ${p.rest}` : ""}</span>
          ))}
        </div>
      )}
      {plan.conflicts && plan.conflicts.length > 0 && <div className="jx-alert">{plan.conflicts[0].message}</div>}
      {plan.audit && (plan.audit.directProbed > 0 || plan.audit.bfeStopsChecked > 0 || plan.audit.connLeg1Checked > 0) && (
        <div className="jx-audit">
          <span className="jx-audit-k">{IC.check} Checked{plan.audit.passengers ? ` for ${plan.audit.passengers} pax` : ""}:</span>
          <span>{plan.audit.directProbed}/{plan.audit.directTrains} direct trains</span>
          <span>· {direct.reduce((n, o) => n + (o.classOptions?.length ?? 0), 0)} class rows</span>
          {plan.audit.bfeStopsChecked > 0 && <span>· Leg-1 (train origin → {plan.query.from}): {plan.audit.bfeTrains} trains × {plan.audit.bfeStopsChecked} earlier-stop segments, every class</span>}
          {plan.audit.connLeg1Checked > 0 && <span>· via {plan.audit.connHubs.join("/")}: leg-1 {plan.audit.connLeg1Checked} trains + leg-2 {plan.audit.connLeg2Checked} trains, every class (specials incl.)</span>}
        </div>
      )}

      {/* Round-18m-13 (user: "pehle direct trains dikhao, phir alternatives"). */}
      {seatBoard}
      {plan.decision?.verdict && (
        <div className="jx-verdict"><span className="jx-why-ic">{IC.spark}</span><div><strong>AI ka faisla{plan.decision.source === "ai" ? "" : " (rules)"}</strong><div>{plan.decision.verdict}</div></div></div>
      )}
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
            <span className="jx-hero-title">{decidedBy ? "AI Recommended" : "Recommended"} · {heroDirect.changes ? `${heroDirect.changes} change` : "Direct"}</span>
            <button type="button" className="jx-why-btn" onClick={() => setWhyOpen((v) => !v)}>Why this? <span className={`jx-caret${whyOpen ? " open" : ""}`} /></button>
          </div>
          <div className="jx-hero-train">
            <span className="jx-no jx-no-lg">{heroDirect.trainNumbers.join(" + ")}</span>
            <span className="jx-name jx-name-lg">{heroDirect.trainNames[0]}</span>
            <SeatPill a={heroDirect.availability} size="lg" />
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
          <ClassRow label="All classes (this train) · tap = fresh check" rows={heroDirect.classOptions ?? (heroDirect.availability ? [heroDirect.availability] : [])} onPick={onPickClass ? (r) => onPickClass({ trainNumber: heroDirect.trainNumbers[0], classCode: r.classCode, from: heroDirect.origin, to: heroDirect.destination }) : undefined} />
          <div className="jx-hero-cta">
            <div className="jx-hero-note">
              <span className="jx-hero-note-ic">{isOk(heroDirect.availability) ? IC.shield : IC.warn}</span>
              <div><strong>{isOk(heroDirect.availability) ? "Seat verified" : heroDirect.availability?.stale && (heroDirect.availability.status === "AVAILABLE" || heroDirect.availability.status === "RAC") ? "Available (not fresh) — verify" : "Availability may have changed"}</strong><div className="jx-sub">{heroDirect.availability?.stale ? "Data 24h+ purana (web cache) — Seat check se refresh karo, phir book" : asOf ? `Last checked: ${asOf}` : "Seat check se confirm karein"}</div></div>
            </div>
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

      {plan.directUnavailable && !bfeHero && !rec?.differentTrain.length && !connections.length && (
        <div className="jx-alert">Direct trains mein {pax ? `${pax} passengers ke liye ` : ""}confirmed seat nahi mili aur koi verified alternative provider se nahi aaya — invent nahi karte.{onOpenBoard ? " Neeche se sabhi trains dekh sakte ho." : ""}</div>
      )}
      {plan.directUnavailable && !bfeHero && onOpenBoard && (
        <button type="button" className="jx-btn jx-btn-dark jx-btn-wide" onClick={onOpenBoard}>Sabhi trains dekho / book {IC.arrow}</button>
      )}

      {/* ── Sections ── */}
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
                  <span className="jx-classes-chips">{(b.classOptions ?? []).filter((r) => r.classCode !== b.availability.classCode).slice(0, 3).map((r) => { const av = availTextOf(r); return <span key={r.classCode} className={`jx-cchip jx-cchip-${r.stale ? "stale" : av.tone}`}>{av.text.replace(" ⚠ stale", "")}{r.fare != null ? ` · ${inr(r.fare)}` : ""}</span>; })}</span>
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
      {plan.directUnavailable && (plan.legPlans?.length ?? 0) > 0 && (
        <Section ic={IC.link} title="Connecting · leg-wise seat options" badge={`${plan.legPlans!.length} hub${plan.legPlans!.length > 1 ? "s" : ""}`} foot={pax ? `Har train par ${pax} passengers ke liye seat verify hui hai — dono tickets alag book hongi.` : "Har train provider-verified — tickets alag-alag book hongi."}>
          {plan.legPlans!.map((lp) => <LegPlanCard key={lp.hub} lp={lp} baseDate={baseDate} pax={pax} onPickLeg={pickLeg} />)}
        </Section>
      )}
      {plan.directUnavailable && !(plan.legPlans?.length) && connections.length > 0 && (
        <Section ic={IC.link} title="Connecting · dono trains mein seat" badge={`${connections.length}`} foot={pax ? `Har leg par ${pax} passengers ke liye seat verify hui hai — dono tickets alag book hongi.` : "Dono legs provider-verified — tickets alag-alag book hongi."}>
          {connections.slice(0, 2).map((c, i) => <ConnCard key={i} c={c} baseDate={baseDate} onPickLeg={pickLeg} />)}
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

      <footer className="jx-foot">
        <span>{IC.shield} Railway data: {plan.sources.length ? plan.sources.map((s) => (s.startsWith("web_") ? "web sources" : s)).filter((v, i, a) => a.indexOf(v) === i).join(" · ") : "—"}</span>
        <span>{plan.provenance?.freshness === "stale" ? "⚠ stale — refresh karein" : asOf ? `Last checked: ${asOf}` : ""}</span>
      </footer>
    </div>
  );
}
