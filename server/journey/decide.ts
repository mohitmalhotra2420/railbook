/* Round-18m-13 — AI journey DECISION.
 *
 * User: "engine ki jagah AI journey planner handle kare — recommendation bhi,
 * seat availability bhi, leg-1/leg-2 bhi; AI (LLM) sab handle kare har cheez
 * samajh ke." Engine ka kaam ab sirf DATA lana hai (API / verified web-scrape:
 * har direct train × har class, same-train book-from-earlier, connecting legs).
 * FAISLA — kaunsa option recommend, kis order mein, kyun — LLM karta hai.
 *
 * Grounding (invent-proof): model sirf candidate IDs se chunta hai; har candidate
 * ke saath uska REAL seat board jata hai; output JSON → validate: unknown id
 * drop, "seat hai" claim sirf seatTier fresh/stale wale par, ₹ sirf real fare.
 * Model fail/timeout → deterministic rules fallback (source:"rules") — kabhi
 * blank nahi, kabhi jhooth nahi. */
import { env } from "../env.js";
import type { JourneyCandidate, JourneyDecision, JourneyPlan, RouteAvailability } from "./types.js";
import { enoughSeats, legBookable } from "./engine.js";

const tierOf = (a: RouteAvailability | null | undefined, pax: number | null): JourneyCandidate["seatTier"] => {
  if (!a) return "none";
  if (legBookable(a, pax)) return "fresh";
  if (a.stale && (a.status === "AVAILABLE" || a.status === "RAC") && enoughSeats(a, pax)) return "stale";
  return "none";
};
const bestRow = (rows: RouteAvailability[], pax: number | null): RouteAvailability | null =>
  rows.find((r) => legBookable(r, pax)) ?? rows.find((r) => r.stale && (r.status === "AVAILABLE" || r.status === "RAC") && enoughSeats(r, pax)) ?? rows[0] ?? null;

/** Engine data → flat candidate list (direct, same-train earlier-stop, connecting). */
export function buildCandidates(plan: JourneyPlan): JourneyCandidate[] {
  const pax = plan.query.passengers ?? null;
  const out: JourneyCandidate[] = [];
  for (const o of plan.routeOptions) {
    if (o.changes !== 0) continue;
    const rows = o.classOptions?.length ? o.classOptions : o.availability ? [o.availability] : [];
    const a = bestRow(rows, pax) ?? o.availability ?? null;
    out.push({ id: `D:${o.trainNumbers[0]}`, kind: "direct", trainNumbers: [o.trainNumbers[0]], label: o.trainNames[0] ?? "", departure: o.departure, arrival: o.arrival, durationMinutes: o.durationMinutes ?? null, availability: a, classOptions: rows, seatTier: o.probed === false ? "none" : tierOf(a, pax), boardAt: o.origin });
  }
  for (const b of plan.recovery?.boardFromEarlier ?? []) {
    const rows = b.classOptions?.length ? b.classOptions : [b.availability];
    const a = bestRow(rows, pax) ?? b.availability;
    out.push({ id: `B:${b.trainNumber}:${b.bookFrom}${b.bookUpto ? `>${b.bookUpto}` : ""}`, kind: "bfe", trainNumbers: [b.trainNumber], label: b.trainName, departure: b.boardAtDeparture, arrival: b.arrival, durationMinutes: b.durationMinutes ?? null, availability: a, classOptions: rows, seatTier: tierOf(a, pax), bookFrom: b.bookFrom, boardAt: b.boardAt, bookUpto: b.bookUpto ?? null });
  }
  const conns = [...(plan.legPlans ?? []).map((l) => l.best).filter(Boolean), ...plan.connections, ...(plan.recovery?.connecting ?? [])];
  const seen = new Set<string>();
  for (const c of conns) {
    if (!c || c.legs.length < 2) continue;
    const id = `C:${c.station}:${c.legs.map((l) => l.trainNumber).join("+")}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const legTiers = c.legs.map((l) => tierOf(l.availability ?? null, pax) === "fresh" || (l.classOptions ?? []).some((r) => legBookable(r, pax)) ? "fresh" : tierOf(l.availability ?? null, pax));
    const tier: JourneyCandidate["seatTier"] = legTiers.every((t) => t === "fresh") ? "fresh" : legTiers.every((t) => t !== "none") ? "stale" : "none";
    out.push({ id, kind: "connecting", trainNumbers: c.legs.map((l) => l.trainNumber), label: c.legs.map((l) => l.trainName).join(" → "), departure: c.legs[0].departure, arrival: c.legs[c.legs.length - 1].arrival, durationMinutes: c.totalDurationMinutes ?? null, availability: c.legs[c.legs.length - 1].availability ?? null, classOptions: c.legs.flatMap((l) => l.classOptions ?? (l.availability ? [l.availability] : [])), seatTier: tier, hub: c.station, layoverMinutes: c.layoverMinutes });
  }
  return out;
}

const rowTxt = (r: RouteAvailability) => `${r.classCode} ${r.status === "AVAILABLE" ? `AVL ${r.seats ?? ""}`.trim() : r.status === "RAC" ? `RAC ${r.rac ?? ""}`.trim() : r.status === "WAITLIST" ? `WL ${r.waitlist ?? ""}`.trim() : r.status}${r.fare != null ? ` ₹${r.fare}` : ""}${r.stale ? " (STALE 24h+ cache)" : ""}`;
const dur = (m: number | null) => (m == null ? "?" : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`);

export function candidateSheet(plan: JourneyPlan, cands: JourneyCandidate[]): string {
  const pax = plan.query.passengers ?? 1;
  const L: string[] = [];
  L.push(`ROUTE ${plan.query.from} -> ${plan.query.to} on ${plan.query.date}, ${pax} passenger(s)${plan.query.travelClass ? `, preferred class ${plan.query.travelClass}` : ""}.`);
  L.push("DATA RULES: FRESH = live provider data now. STALE = 24h+ old web cache (may have changed; must be re-verified before booking). WL = waitlisted, not a seat. RAC = treated as an AVAILABLE seat for ANY party size (travel confirmed, berth confirms after chart preparation); prefer AVL over RAC only when both exist. A train with no rows was NOT checked (unknown, not 'no seat').");
  L.push("");
  L.push("CANDIDATES (id | kind | trains | timing | duration | seat board):");
  for (const c of cands) {
    const kind = c.kind === "direct" ? `DIRECT from ${c.boardAt}` : c.kind === "bfe" ? (c.bookUpto ? `SAME TRAIN, ticket ${c.bookFrom}->${c.bookUpto} (${c.bookFrom !== c.boardAt ? "earlier stop, " : ""}beyond destination; traveller boards ${c.boardAt} and DEBOARDS at destination, pays fare upto ${c.bookUpto})` : `SAME TRAIN, ticket from ${c.bookFrom} (earlier stop), board at ${c.boardAt}`) : `CONNECTING via ${c.hub}, layover ${c.layoverMinutes ?? "?"} min`;
    const board = c.classOptions.length ? c.classOptions.map(rowTxt).join("; ") : "NOT CHECKED";
    L.push(`${c.id} | ${kind} | ${c.trainNumbers.join("+")} ${c.label} | dep ${c.departure ?? "?"} arr ${c.arrival ?? "?"} | ${dur(c.durationMinutes)} | tier=${c.seatTier.toUpperCase()} | ${board}`);
  }
  /* Round-18m-18: leg-wise coverage facts — model ko pata ho ki connecting legs par
   * HAR train × HAR class (aur train-origin / 1-2 stop aage tak ki ticket) check hui. */
  for (const lp of plan.legPlans ?? []) {
    const l2 = lp.leg2All ?? lp.leg2;
    const l1 = lp.leg1All ?? lp.leg1;
    L.push("");
    L.push(`CONNECTING VIA ${lp.hub}: leg-1 ${plan.query.from}->${lp.hub} ${lp.leg1.length}/${lp.checkedLeg1} trains with a seat; leg-2 ${lp.hub}->${plan.query.to} ${lp.leg2.length}/${lp.checkedLeg2} trains with a seat (every class checked; also ticket from each train's origin and 1-2 stops beyond destination).`);
    if (!lp.leg2.length) L.push(`  leg-2 trains checked (all WL/N-A): ${l2.map((l) => `${l.trainNumber} [${(l.classOptions ?? []).map((r) => `${r.classCode} ${r.status === "WAITLIST" ? `WL${r.waitlist ?? ""}` : r.status}`).join(", ") || "no data"}]`).join("; ")}`);
    if (!lp.leg1.length) L.push(`  leg-1 trains checked (all WL/N-A): ${l1.map((l) => l.trainNumber).join(", ")}`);
    if (!lp.leg1.length || !lp.leg2.length) L.push(`  => via ${lp.hub} is NOT a usable route (one leg has zero seated trains). Do NOT present the other leg's seated trains as an option.`);
  }
  return L.join("\n");
}

export const DECISION_PRINCIPLES = `You are RailBook's AI journey planner for Indian Railways. You DECIDE which option the traveller should book — the engine only fetched data. Think like a smart, honest friend.
Decision principles (apply judgement, not a formula):
1. Seat certainty for the WHOLE party first: FRESH AVL/RAC (enough for pax) beats everything; RAC counts as a seat for any party size (AVL preferred when both exist).
2. A DIRECT train from the user's origin with a FRESH seat is preferred over a same-train earlier-stop ticket or a connection. A same-train earlier-stop ticket (kind bfe) is a smart trick when the direct segment is WL — the traveller still boards at origin, only pays a little extra. Likewise a "book upto" ticket (bfe with ticket beyond destination) is valid: the traveller boards at origin, deboards at their destination, pays fare upto the farther station — recommend it when direct/earlier/connecting have no seat.
3. STALE AVL is a real lead but NOT proof — you may recommend it only if nothing FRESH exists, and you must say it needs a Seat check first. Never present STALE as confirmed.
4. Then speed (shorter duration), sensible departure time, fewer changes, then cost/class.
5. Never invent trains, seats, fares or times. Only use candidate ids from the sheet. WL/NOT CHECKED candidates must never be described as having a seat.
6. If a DIRECT train that is FASTER than your pick shows STALE AVL (e.g. "14624 3A AVL 11 (STALE)"), you MUST mention it in why: it may be the best if a Seat check confirms it — tell the traveller to check it first.
Output ONLY JSON: {"recommendedId": "<id>", "ranking": ["<id>", ...top 5 ids best first], "verdict": "<one Hinglish sentence, max 30 words: what to book and why>", "why": ["<4-5 full Hinglish sentences, 10-24 words each: seat certainty for the party, which options were rejected and why (name them), time trade-off vs the fastest, cost/class, booking practicality/risk>"]}.
In verdict and why: write like a human — train NUMBER + NAME (e.g. "13308 Gangasatluj Exp, ticket Phillaur se"), NEVER candidate ids like B:13308:PHR. Hinglish = Roman Hindi mixed with English (e.g. "14624 mein 3A AVL 11 dikh raha hai lekin data purana hai — pehle Seat check karo"). No markdown.`;

async function askModel(model: string, sheet: string, timeoutMs: number): Promise<{ recommendedId?: string; ranking?: string[]; verdict?: string; why?: string[] } | null> {
  const key = env.nvidiaApiKey;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.nvidiaBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: 700, reasoning_effort: "low", messages: [{ role: "system", content: DECISION_PRINCIPLES }, { role: "user", content: `${sheet}\n\nDecide now. Return the JSON only.` }] }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
    const raw = String(j.choices?.[0]?.message?.content ?? "");
    if (process.env.WHY_DEBUG) console.error("[decide raw]", model, raw.slice(0, 1500));
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]) as { recommendedId?: string; ranking?: string[]; verdict?: string; why?: string[] };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Deterministic fallback — same principles, no model. */
export function rulesDecision(plan: JourneyPlan, cands: JourneyCandidate[]): JourneyDecision {
  const tierRank = { fresh: 0, stale: 1, none: 2 } as const;
  const kindRank = { direct: 0, bfe: 1, connecting: 2 } as const;
  const sorted = [...cands].sort((a, b) => tierRank[a.seatTier] - tierRank[b.seatTier] || kindRank[a.kind] - kindRank[b.kind] || (a.durationMinutes ?? 9e9) - (b.durationMinutes ?? 9e9) || a.id.localeCompare(b.id));
  const rec = sorted[0] ?? null;
  return { source: "rules", model: null, recommendedId: rec?.id ?? null, recommended: rec, ranking: sorted.slice(0, 5).map((c) => c.id), candidates: cands, whyPoints: plan.whyPoints ?? [], verdict: plan.summary ?? null };
}

const CONFIRM_RE = /confirm|available|\bAVL\b|seat (?:hai|milegi|mil rahi|pakki)|guaranteed|seats? open/i;

export async function decideJourney(plan: JourneyPlan, opts: { timeoutMs?: number } = {}): Promise<JourneyDecision> {
  const cands = buildCandidates(plan);
  const fallback = rulesDecision(plan, cands);
  if (!cands.length || !env.nvidiaApiKey || process.env.VITEST) return fallback;
  const sheet = candidateSheet(plan, cands);
  const t = opts.timeoutMs ?? 10000;
  /* Muse primary, gpt-oss fallback (same policy as the agent). */
  let model = env.nvidiaModel;
  let r = await askModel(model, sheet, t);
  if (!r && env.nluModel && env.nluModel !== env.nvidiaModel) {
    model = env.nluModel;
    r = await askModel(model, sheet, 12000);
  }
  if (!r) return fallback;
  return validateDecision(plan, cands, r, model) ?? fallback;
}

export type RawDecision = { recommendedId?: string; ranking?: string[]; verdict?: string; why?: string[] };

/** Lenient JSON for model decisions: exact parse first; then repair a missing trailing
 *  `]`/`}` (models cut the last brace) — content itself is never altered, and every value is
 *  still validated by validateDecision. Returns null when it still isn't valid JSON. */
export function parseDecisionJson(text: string): RawDecision | null {
  const t = text.trim();
  const tries = [t, `${t}}`, `${t}]}`, `${t}"]}`, `${t}"}`];
  for (const x of tries) {
    try {
      const j = JSON.parse(x);
      if (j && typeof j === "object" && !Array.isArray(j)) return j as RawDecision;
    } catch { /* next repair */ }
  }
  return null;
}

/** Round-18m-29: model output → grounded JourneyDecision (null = invalid → caller uses rules).
 *  Same invent-proof validation as before (unknown id drop, seat claims only on seated
 *  candidates, ₹ only real fares, stale-faster-direct reminder) — now reusable by the agentic
 *  final step, jahan model decision + user reply EK hi call mein deta hai (3 AI calls → 2). */
export function validateDecision(plan: JourneyPlan, cands: JourneyCandidate[], r: RawDecision, model: string | null): JourneyDecision | null {
  const byId = new Map(cands.map((c) => [c.id, c]));
  /* Round-18m-29: model kabhi bare train number ("22462") ya "22462+12345" bhejta hai —
   * sirf tab map karo jab EXACTLY ek candidate match kare (koi guess nahi). */
  const resolveId = (raw: unknown): string | null => {
    const id = String(raw ?? "").trim();
    if (!id) return null;
    if (byId.has(id)) return id;
    if (byId.has(`D:${id}`)) return `D:${id}`;
    const hits = cands.filter((c) => c.trainNumbers.join("+") === id || c.trainNumbers.join("→") === id);
    return hits.length === 1 ? hits[0].id : null;
  };
  const recId = resolveId(r.recommendedId);
  const rec = recId ? byId.get(recId) ?? null : null;
  if (!rec) return null;
  /* Guard: model may not recommend a WL/unchecked option when a fresh-seat option exists. */
  if (rec.seatTier === "none" && cands.some((c) => c.seatTier === "fresh")) return null;
  const ranking = Array.from(new Set([rec.id, ...(Array.isArray(r.ranking) ? r.ranking.map(resolveId).filter((x): x is string => !!x) : [])])).filter((id) => byId.has(id)).slice(0, 5);
  const fares = new Set<number>();
  for (const c of cands) for (const row of c.classOptions) if (row.fare != null) fares.add(row.fare);
  const seatless = new Set(cands.filter((c) => c.seatTier === "none").flatMap((c) => c.trainNumbers));
  const seatOk = new Set(cands.filter((c) => c.seatTier !== "none").flatMap((c) => c.trainNumbers));
  const known = new Set(cands.flatMap((c) => c.trainNumbers));
  const okPoint = (x: string) => {
    if (x.length < 12 || x.length > 220) return false;
    const trains = x.match(/\b\d{5}\b/g) ?? [];
    if (!trains.every((n) => known.has(n))) return false;
    if (CONFIRM_RE.test(x) && trains.some((n) => seatless.has(n) && !seatOk.has(n)) && !/\b(WL|waitlist|nahi|not|no seat|reject)/i.test(x)) return false;
    const rupees = [...x.matchAll(/₹\s?(\d[\d,]*)/g)].map((m) => Number(m[1].replace(/,/g, "")));
    if (!rupees.every((n) => fares.has(n))) return false;
    return true;
  };
  /* IDs → human text (model ko mana hai, phir bhi aa jaayein to). */
  const humanize = (x: string) => x
    .replace(/\bB:(\d{5}):([A-Z]{2,5})\b/g, (_m, tn: string, st: string) => `${tn} ${byId.get(`B:${tn}:${st}`)?.label ?? ""} (ticket ${st} se)`.replace(/\s+/g, " "))
    .replace(/\bC:([A-Z]{2,5}):(\d{5})\+(\d{5})\b/g, (_m, hub: string, a: string, b: string) => `${a} → ${b} via ${hub}`)
    .replace(/\bD:(\d{5})\b/g, (_m, tn: string) => `${tn} ${byId.get(`D:${tn}`)?.label ?? ""}`.replace(/\s+/g, " "))
    .trim();
  const why = (Array.isArray(r.why) ? r.why : []).filter((x): x is string => typeof x === "string").map((x) => humanize(x.trim().replace(/^[-•*]\s*/, ""))).filter(okPoint).slice(0, 5);
  const verdict = typeof r.verdict === "string" && okPoint(humanize(r.verdict)) ? humanize(r.verdict) : null;
  /* Principle 6 guard: faster direct with STALE AVL → ensure the traveller is told (rules line if the model forgot). */
  const recDur = rec.durationMinutes ?? 9e9;
  const fasterStale = cands.filter((c) => c.kind === "direct" && c.seatTier === "stale" && (c.durationMinutes ?? 9e9) < recDur && c.id !== rec.id).sort((a, b) => (a.durationMinutes ?? 9e9) - (b.durationMinutes ?? 9e9));
  const fastestStale = fasterStale[0] ?? null;
  if (fastestStale && !why.some((w) => w.includes(fastestStale.trainNumbers[0]) && /seat check|purana|stale|verify|confirm/i.test(w))) {
    const c = fastestStale;
    const a = c.availability;
    why.unshift(`${c.trainNumbers[0]} ${c.label} (${dur(c.durationMinutes)}) mein ${a ? rowTxt(a).replace(/ \(STALE.*\)/, "") : "AVL"} dikh rahi hai lekin data 24h+ purana hai — pehle iska Seat check karo; fresh AVL nikle to yahi sabse fast seat-wala option hai.`);
  }
  if (why.length < 3) {
    /* AI picked, but explanation weak → keep the AI pick, top up with rules points. */
    for (const p of plan.whyPoints ?? []) if (why.length < 5 && !why.includes(p)) why.push(p);
  }
  return { source: "ai", model, recommendedId: rec.id, recommended: rec, ranking, candidates: cands, whyPoints: why.slice(0, 5), verdict, verifyFirst: fastestStale ? { id: fastestStale.id, trainNumber: fastestStale.trainNumbers[0], label: fastestStale.label, durationMinutes: fastestStale.durationMinutes, availability: fastestStale.availability } : null };
}
