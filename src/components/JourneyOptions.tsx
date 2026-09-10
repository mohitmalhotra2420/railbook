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
import { addDays, formatShortDate, inr } from "../format";

const BADGE_LABEL: Record<string, string> = {
  best_overall: "Best overall",
  fastest: "⚡ Fastest",
  direct: "🚆 Direct",
  fewest_changes: "🚆 Fewest changes",
  best_availability: "💺 Best availability",
  cheapest: "₹ Cheapest",
  earliest: "🌅 Earliest",
};

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

function availText(o: AgentRouteOption): { text: string; tone: "ok" | "warn" | "bad" | "muted" } {
  const a = o.availability;
  if (!a) return { text: "Seat data nahi", tone: "muted" };
  /* Round-18m: 24h+ purani web-cache → "last known" + ⚠, kabhi fresh AVL nahi dikhta. */
  const st = a.stale ? " ⚠ stale" : "";
  if (a.status === "AVAILABLE") return { text: `${a.classCode} AVL${a.seats != null ? ` ${a.seats}` : ""}${st}`, tone: a.stale ? "warn" : "ok" };
  if (a.status === "RAC") return { text: `${a.classCode} RAC${a.rac != null ? ` ${a.rac}` : ""}${st}`, tone: "warn" };
  if (a.status === "WAITLIST") return { text: `${a.classCode} WL${a.waitlist != null ? ` ${a.waitlist}` : ""}${st}`, tone: "bad" };
  if (a.status === "NOT_AVAILABLE") return { text: `${a.classCode} Not available`, tone: "bad" };
  return { text: `${a.classCode} ${a.status}`, tone: "muted" };
}

function layoverLabel(m: number): string {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}h${r ? ` ${r}m` : ""}` : `${r}m`;
}

/* Round-18m-3: connecting option ke har leg ki apni row — train NAAM, boarding
 * station (naam+code), date, aur US SEGMENT ki seat. Tap → usi leg ki seat query
 * (JAT→BDTS jaisi galat poori-route query kabhi nahi). */
function LegRows({ legs, baseDate, onPickLeg }: { legs: AgentRouteLeg[]; baseDate?: string | null; onPickLeg?: (leg: AgentRouteLeg) => void }) {
  let dayCursor = 0;
  return (
    <div className="jo-legs">
      {legs.map((l, i) => {
        const depDay = l.departureDayOffset ?? dayCursor;
        const arrDay = depDay + (l.arrivalDayOffset || 0);
        dayCursor = arrDay;
        const av = availTextOf(l.availability);
        return (
          <button type="button" key={`${l.trainNumber}-${i}`} className="jo-leg" onClick={onPickLeg ? () => onPickLeg({ ...l, departureDayOffset: depDay }) : undefined}>
            <div className="jo-leg-head">
              <span className="jo-no">{l.trainNumber}</span> <span className="jo-name">{l.trainName}</span>
              <span className={`jo-avl jo-avl-${av.tone}`}>{av.text}</span>
            </div>
            <div className="jo-leg-line">
              <strong>{l.departure}</strong> {l.fromName ?? l.from} ({l.from}){baseDate ? ` · ${legDateLabel(baseDate, depDay)}` : ""} → <strong>{l.arrival}</strong> {l.toName ?? l.to} ({l.to}){baseDate ? ` · ${legDateLabel(baseDate, arrDay)}` : dayTag(l.arrivalDayOffset)}
            </div>
            {i < legs.length - 1 && <div className="jo-leg-change">↓ Yahan train badlo: {l.toName ?? l.to} ({l.to})</div>}
          </button>
        );
      })}
    </div>
  );
}

function OptionRow({ o, onPick, baseDate, onPickLeg }: { o: AgentRouteOption; onPick?: (o: AgentRouteOption) => void; baseDate?: string | null; onPickLeg?: (leg: AgentRouteLeg) => void }) {
  const av = availText(o);
  if (o.changes > 0 && o.legs.length > 1) {
    return (
      <div className="jo-row jo-row-multi">
        <div className="jo-row-main">
          <div className="jo-row-times">
            <strong>{o.departure}</strong> → <strong>{o.arrival}</strong>
            <span className="jo-day">{dateTag(baseDate, o.arrivalDayOffset)}</span>
            <span className="jo-dot">·</span>
            <span>{o.durationLabel ?? "—"}</span>
            <span className="jo-dot">·</span>
            <span>{o.changes} change{o.layoverMinutes != null ? ` · ${layoverLabel(o.layoverMinutes)} layover` : ""}</span>
          </div>
          <LegRows legs={o.legs} baseDate={baseDate} onPickLeg={onPickLeg} />
        </div>
      </div>
    );
  }
  return (
    <button type="button" className="jo-row" onClick={onPick ? () => onPick(o) : undefined}>
      <div className="jo-row-main">
        <div className="jo-row-title">
          <span className="jo-no">{o.trainNumbers.join(" + ")}</span>
          <span className="jo-name">{o.trainNames[0]}{o.trainNames.length > 1 ? ` + ${o.trainNames.length - 1}` : ""}</span>
        </div>
        <div className="jo-row-times">
          <strong>{o.departure}</strong> → <strong>{o.arrival}</strong>
          <span className="jo-day">{dateTag(baseDate, o.arrivalDayOffset)}</span>
          <span className="jo-dot">·</span>
          <span>{o.durationLabel ?? "—"}</span>
          <span className="jo-dot">·</span>
          <span>{o.changes ? `${o.changes} change` : "Direct"}</span>
        </div>
      </div>
      <div className="jo-row-side">
        <span className={`jo-avl jo-avl-${av.tone}`}>{av.text}</span>
        {o.availability?.fare != null && <span className="jo-fare">{inr(o.availability.fare)}</span>}
      </div>
    </button>
  );
}

function ConnectionRow({ c, baseDate, onPickLeg }: { c: AgentConnection; baseDate?: string | null; onPickLeg?: (leg: AgentRouteLeg) => void }) {
  return (
    <div className="jo-conn">
      <LegRows legs={c.legs} baseDate={baseDate} onPickLeg={onPickLeg} />
      <div className="jo-conn-wait">⏳ {layoverLabel(c.layoverMinutes)} layover @ {c.stationName ?? c.station} ({c.station})</div>
      {c.totalDurationMinutes != null && <div className="jo-conn-total">Total {layoverLabel(c.totalDurationMinutes)} · dono trains ki seat alag-alag book hogi</div>}
    </div>
  );
}

type Tab = "fastest" | "fewest_changes" | "best_availability" | "cheapest" | "connecting" | "alt_date";

export function JourneyOptions({
  plan,
  onPickTrain,
  onPickLeg,
  onPickBoardEarlier,
  onPickDate,
  onPickStations,
  onOpenBoard,
}: {
  plan: AgentJourneyPlan;
  onPickTrain?: (trainNumber: string) => void;
  /** Round-18m-3: connecting leg tap → us leg ke segment+date ki seat query. */
  onPickLeg?: (leg: { trainNumber: string; from: string; to: string; date: string }) => void;
  /** Round-18m-6: book-from-earlier tap → seat check for bookFrom→destination. */
  onPickBoardEarlier?: (o: { trainNumber: string; bookFrom: string; boardAt: string; destination: string; classCode: string }) => void;
  onPickDate?: (ymd: string) => void;
  /** Round-18 §8: user explicitly confirms a different boarding/destination station. */
  onPickStations?: (from: string, to: string) => void;
  /** Round-18e: open the bookable TrainBoard (explicit user action, never auto). */
  onOpenBoard?: () => void;
}) {
  const [tab, setTab] = useState<Tab | null>(null);
  const best = plan.best;
  const others = plan.routeOptions.filter((o) => o !== best);
  const byBadge = (b: string) => others.filter((o) => o.badges.includes(b) || o.category === b);
  const direct = plan.routeOptions.filter((o) => o.changes === 0);
  const connections = plan.connections.length ? plan.connections : plan.recovery?.connecting ?? [];
  const altDates = plan.alternativeDates.filter((d) => d.count > 0);

  const allTabs: { id: Tab; label: string; count: number }[] = [
    { id: "fastest", label: "⚡ Fastest", count: direct.length ? Math.min(direct.length, 5) : 0 },
    { id: "best_availability", label: "💺 Best availability", count: plan.routeOptions.filter((o) => o.availability?.status === "AVAILABLE").length },
    { id: "cheapest", label: "💰 Lowest fare", count: plan.routeOptions.filter((o) => o.availability?.fare != null).length },
    { id: "fewest_changes", label: "🚆 Fewest changes", count: plan.routeOptions.length ? Math.min(plan.routeOptions.length, 5) : 0 },
    { id: "connecting", label: "🔁 Connecting", count: plan.recovery && plan.directUnavailable ? Math.max(0, connections.length - 2) : connections.length },
    { id: "alt_date", label: "📅 Alternative date", count: altDates.length },
  ];
  const tabs = allTabs.filter((t) => t.count > 0);

  const sortedFor = (t: Tab): AgentRouteOption[] => {
    const all = [...plan.routeOptions];
    if (t === "fastest") return all.filter((o) => o.durationMinutes != null).sort((x, y) => x.durationMinutes! - y.durationMinutes! || x.trainNumbers[0].localeCompare(y.trainNumbers[0])).slice(0, 5);
    if (t === "fewest_changes") return all.sort((x, y) => x.changes - y.changes || (x.durationMinutes ?? 1e9) - (y.durationMinutes ?? 1e9)).slice(0, 5);
    if (t === "best_availability")
      return all.filter((o) => o.availability?.status === "AVAILABLE").sort((x, y) => (y.availability?.seats ?? 0) - (x.availability?.seats ?? 0) || x.trainNumbers[0].localeCompare(y.trainNumbers[0])).slice(0, 5);
    if (t === "cheapest")
      return all.filter((o) => o.availability?.fare != null).sort((x, y) => (x.availability!.fare! - y.availability!.fare!) || x.trainNumbers[0].localeCompare(y.trainNumbers[0])).slice(0, 5);
    return [];
  };

  const pick = onPickTrain ? (o: AgentRouteOption) => onPickTrain(o.trainNumbers[0]) : undefined;
  const baseDate = plan.query.date;
  const pickLeg = onPickLeg ? (l: AgentRouteLeg) => onPickLeg({ trainNumber: l.trainNumber, from: l.from, to: l.to, date: addDays(baseDate, l.departureDayOffset ?? 0) }) : undefined;
  const rec = plan.recovery;
  const altStations = (rec?.alternateStations ?? []).filter((o) => o.count > 0);
  const partial = rec?.partialRoute;
  const partialPlans = partial?.plans.filter((p) => p.fullyAvailable) ?? [];

  return (
    <div className="jo-wrap">
      <div className="jo-head">
        <div>
          <div className="jo-kicker">RailBook Atlas</div>
          <strong>{plan.query.from} → {plan.query.to}</strong>
          <span className="jo-muted"> · {formatShortDate(plan.query.date)}{plan.query.travelClass ? ` · ${plan.query.travelClass}` : ""}</span>
        </div>
        <span className="jo-count">{plan.routeOptions.length} option{plan.routeOptions.length === 1 ? "" : "s"}</span>
      </div>

      {plan.summary && (
        <div className="jo-summary">
          <span className="jo-summary-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" /></svg>
          </span>
          <div className="jo-summary-text">
            <div className="jo-summary-label">AI journey summary</div>
            {plan.summary}
          </div>
        </div>
      )}
      {plan.conflicts && plan.conflicts.length > 0 && (
        <div className="jo-alert">{plan.conflicts[0].message} <span className="jo-alert-sub">({plan.conflicts.map((c) => c.trainNumber).join(", ")} — sources: {plan.conflicts[0].sources.join(" vs ")})</span></div>
      )}
      {plan.directUnavailable && (
        <div className="jo-alert">
          Direct seat nahi mili. Ye alternatives mile:
          {!connections.length && plan.notes.some((n) => /Connecting routes mile lekin/.test(n)) && (
            <div className="jo-split-note">🔁 Connecting routes mile, lekin kisi mein dono trains par seat available nahi thi (WL/N-A) — isliye connecting option nahi diya.</div>
          )}
          {!rec?.differentTrain.length && !connections.length && !partialPlans.length && !altDates.length && (
            <div className="jo-alert-sub">Provider se koi verified alternative nahi aaya — invent nahi karenge.</div>
          )}
        </div>
      )}

      {best && !plan.directUnavailable && (
        <div className="jo-best">
          <div className="jo-best-label">BEST FOR YOU</div>
          <div className="jo-best-title">
            <span className="jo-no">{best.trainNumbers.join(" + ")}</span> {best.trainNames[0]}
          </div>
          <div className="jo-best-times">
            <strong>{best.departure}</strong>
            <span className="jo-arrow">→</span>
            <strong>{best.arrival}</strong>
            <span className="jo-day">{dateTag(baseDate, best.arrivalDayOffset)}</span>
          </div>
          <div className="jo-best-grid">
            <div><span className="jo-ic">⏱</span>{best.durationLabel ?? "—"}</div>
            <div><span className="jo-ic">🚆</span>{best.changes ? `${best.changes} change · ${best.layoverMinutes != null ? layoverLabel(best.layoverMinutes) : ""}` : "Direct"}</div>
            <div className={`jo-avl-cell jo-avl-${availText(best).tone}`}><span className="jo-ic">💺</span>{availText(best).text}</div>
            <div><span className="jo-ic">₹</span>{best.availability?.fare != null ? inr(best.availability.fare) : "Fare on select"}</div>
          </div>
          {best.changes > 0 && best.legs.length > 1 && <LegRows legs={best.legs} baseDate={baseDate} onPickLeg={pickLeg} />}
          <div className="jo-badges">
            {best.badges.map((b) => (
              <span key={b} className={`jo-badge jo-badge-${b}`}>{BADGE_LABEL[b] ?? b}</span>
            ))}
          </div>
          <div className="jo-cta-row">
            {pick && (
              <button type="button" className="jo-cta" onClick={() => pick(best)}>
                Is train ko dekho
              </button>
            )}
            {onOpenBoard && (
              <button type="button" className="jo-cta jo-cta-book" onClick={onOpenBoard}>
                Sabhi trains · Book →
              </button>
            )}
          </div>
        </div>
      )}
      {plan.directUnavailable && onOpenBoard && (
        <button type="button" className="jo-cta jo-cta-book jo-cta-wide" onClick={onOpenBoard}>
          Phir bhi sabhi trains dekho / book →
        </button>
      )}

      {plan.directUnavailable && rec && (
        <div className="jo-recovery">
          {(rec.boardFromEarlier ?? []).length > 0 && (
            <div className="jo-sec">
              <div className="jo-sec-title">🎫 Same train — pichhle station se ticket, board yahin se</div>
              {(rec.boardFromEarlier ?? []).slice(0, 2).map((b) => {
                const av = availTextOf(b.availability);
                return (
                  <button
                    type="button"
                    key={`${b.trainNumber}-${b.bookFrom}`}
                    className="jo-bfe"
                    onClick={onPickBoardEarlier ? () => onPickBoardEarlier({ trainNumber: b.trainNumber, bookFrom: b.bookFrom, boardAt: b.boardAt, destination: b.destination, classCode: b.availability.classCode }) : undefined}
                  >
                    <div className="jo-bfe-head">
                      <span className="jo-no">{b.trainNumber}</span> <span className="jo-name">{b.trainName}</span>
                      <span className={`jo-avl jo-avl-${av.tone}`}>{av.text}</span>
                    </div>
                    <div className="jo-bfe-grid">
                      <div><div className="jo-bfe-k">Book from</div><div className="jo-bfe-v">{b.bookFromName ?? b.bookFrom}</div><div className="jo-bfe-s">{b.bookFrom}{b.bookFromDeparture ? `, ${b.bookFromDeparture}` : ""}</div></div>
                      <div><div className="jo-bfe-k">Boarding</div><div className="jo-bfe-v">{b.boardAtName ?? b.boardAt}</div><div className="jo-bfe-s">{b.boardAt}{b.boardAtDeparture ? `, ${b.boardAtDeparture}` : ""}</div></div>
                      <div><div className="jo-bfe-k">Deboarding</div><div className="jo-bfe-v">{b.destinationName ?? b.destination}</div><div className="jo-bfe-s">{b.destination}{b.arrival ? `, ${b.arrival}` : ""}{b.arrivalDayOffset ? ` · ${formatShortDate(addDays(baseDate, b.arrivalDayOffset))}` : ""}</div></div>
                    </div>
                    <div className="jo-split-note">
                      {b.boardAt}→{b.destination} par {b.directStatus === "WAITLIST" ? "WL" : b.directStatus ?? "seat nahi"} tha; {b.bookFrom} se book karne par {av.text}{b.availability.fare != null ? ` · ${inr(b.availability.fare)}` : ""}. Boarding point {b.boardAt} rakhein (IRCTC mein boarding station change option). Provider: {b.source}.
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {rec.differentTrain.length > 0 && (
            <div className="jo-sec">
              <div className="jo-sec-title">🚆 Doosri train (seat available)</div>
              {rec.differentTrain.slice(0, 4).map((o) => <OptionRow key={o.trainNumbers.join("+")} o={o} onPick={pick} baseDate={baseDate} onPickLeg={pickLeg} />)}
            </div>
          )}
          {partial && (partialPlans.length > 0 || partial.sameTrainSwitch) && (
            <div className="jo-sec">
              <div className="jo-sec-title">✂️ Same train, split booking ({partial.trainNumber} · {partial.classCode})</div>
              {partialPlans.slice(0, 2).map((p) => (
                <div key={p.switchStation} className="jo-split">
                  {p.segments.map((s) => (
                    <div key={`${s.from}-${s.to}`} className="jo-split-seg">
                      <span>{s.from} → {s.to}</span>
                      <span className="jo-avl jo-avl-ok">{s.classCode} AVL{s.seats != null ? ` ${s.seats}` : ""}</span>
                    </div>
                  ))}
                  <div className="jo-split-note">Seat change @ {p.switchStationName ?? p.switchStation} · berth no. chart ke baad</div>
                </div>
              ))}
              {partial.sameTrainSwitch && !partialPlans.length && (
                <div className="jo-split">
                  <div className="jo-split-seg">
                    <span>{partial.sameTrainSwitch.segment.from} → {partial.sameTrainSwitch.segment.to}</span>
                    <span className="jo-avl jo-avl-ok">{partial.sameTrainSwitch.segment.classCode} AVL{partial.sameTrainSwitch.segment.seats != null ? ` ${partial.sameTrainSwitch.segment.seats}` : ""}</span>
                  </div>
                  <div className="jo-split-note">Seat {partial.sameTrainSwitch.afterStationName ?? partial.sameTrainSwitch.afterStation} ke baad available — pehle segment ki seat provider ne nahi di</div>
                </div>
              )}
            </div>
          )}
          {connections.length > 0 && (
            <div className="jo-sec">
              <div className="jo-sec-title">🔁 Connecting journey — dono trains mein seat available</div>
              {connections.slice(0, 2).map((c, i) => <ConnectionRow key={i} c={c} baseDate={baseDate} onPickLeg={pickLeg} />)}
            </div>
          )}
          {altStations.length > 0 && (
            <div className="jo-sec">
              <div className="jo-sec-title">📍 Doosra station, same city (aapka route badla nahi — confirm karein)</div>
              {altStations.slice(0, 3).map((o) => {
                const av = o.best ? availText(o.best) : null;
                return (
                  <button
                    key={`${o.from}-${o.to}`}
                    type="button"
                    className="jo-row"
                    onClick={onPickStations ? () => onPickStations(o.from, o.to) : undefined}
                  >
                    <div className="jo-row-main">
                      <div className="jo-row-title">
                        <span className="jo-no">{o.from} → {o.to}</span>
                        <span className="jo-name">{o.changed === "origin" ? "alternate boarding" : "alternate destination"} · {o.count} trains</span>
                      </div>
                      {o.best && (
                        <div className="jo-row-times">
                          <span className="jo-no">{o.best.trainNumbers[0]}</span> <strong>{o.best.departure}</strong> → <strong>{o.best.arrival}</strong>
                          <span className="jo-day">{dateTag(baseDate, o.best.arrivalDayOffset)}</span>
                          <span className="jo-dot">·</span>
                          <span>{o.best.durationLabel ?? "—"}</span>
                        </div>
                      )}
                    </div>
                    <div className="jo-row-side">
                      {av && <span className={`jo-avl jo-avl-${av.tone}`}>{av.text}</span>}
                      <span className="jo-src">{o.source}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {altDates.length > 0 && (
            <div className="jo-sec">
              <div className="jo-sec-title">📅 Alternative date (aapki date badli nahi)</div>
              <div className="jo-chips">
                {altDates.map((d) => (
                  <button key={d.date} type="button" className="jo-chip" onClick={onPickDate ? () => onPickDate(d.date) : undefined}>
                    {formatShortDate(d.date)} · {d.count} train{d.count > 1 ? "s" : ""}{d.seatProof ? ` · ${d.seatProof}` : ""}
                  </button>
                ))}
              </div>
              {/* Round-18m (user: "12th ko seat hai bola, wahan bhi WL thi") — count = trains chalti hain, seat ka daawa nahi. */}
              <div className="jo-split-note">Ye sirf trains ka count hai — seat status us date par tap karke dekhein{altDates.some((d) => d.seatProof) ? "; jahan likha hai wahi seat-check hua hai" : ""}.</div>
            </div>
          )}
        </div>
      )}

      {tabs.length > 0 && (
        <div className="jo-others">
          <div className="jo-others-label">YOU MAY ALSO CONSIDER</div>
          <div className="jo-chips">
            {tabs.map((t) => (
              <button key={t.id} type="button" className={`jo-chip${tab === t.id ? " active" : ""}`} onClick={() => setTab(tab === t.id ? null : t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          {tab && tab !== "connecting" && tab !== "alt_date" && (
            <div className="jo-list">{sortedFor(tab).map((o) => <OptionRow key={o.rank} o={o} onPick={pick} baseDate={baseDate} onPickLeg={pickLeg} />)}</div>
          )}
          {tab === "connecting" && (
            <div className="jo-list">
              {/* Round-18m: recovery block mein pehli 2 already dikhi — yahan sirf BAAKI (duplicate nahi). */}
              {(rec && plan.directUnavailable ? connections.slice(2, 6) : connections.slice(0, 4)).map((c, i) => <ConnectionRow key={i} c={c} baseDate={baseDate} onPickLeg={pickLeg} />)}
              {rec && plan.directUnavailable && connections.length <= 2 && <div className="jo-empty">Upar wale 2 hi verified connections mile.</div>}
            </div>
          )}
          {tab === "alt_date" && (
            <div className="jo-list jo-chips">
              {altDates.map((d) => (
                <button key={d.date} type="button" className="jo-chip" onClick={onPickDate ? () => onPickDate(d.date) : undefined}>
                  {formatShortDate(d.date)} · {d.count} train{d.count > 1 ? "s" : ""}{d.fastest ? ` · fastest ${d.fastest.number}` : ""}{d.seatProof ? ` · ${d.seatProof}` : ""}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="jo-foot">
        Real railway data{plan.sources.length ? ` · ${plan.sources.join(", ")}` : ""}
        {plan.provenance ? (plan.provenance.freshness === "stale" ? " · ⚠ stale — refresh karein" : ` · as of ${new Date(plan.provenance.retrievedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`) : ""}
        {" · ranking deterministic · reliability data unavailable"}
      </div>
    </div>
  );
}
