/**
 * Round-18 — SMART TRAIN PICKER (SEARCH_TRAIN_BY_NUMBER / SEARCH_TRAIN_BY_NAME).
 *
 * User "12014" / "Shatabdi" / "Amritsar Shatabdi" bole → REAL validated
 * train list (RailCore → RailRadar → IndianRailAPI → erail train list). Koi
 * hardcoded fake list nahi. Matching order:
 *   1. exact train number       2. exact (normalized) name
 *   3. normalized partial name  4. route/station context filter (optional)
 * Route (from/to) sirf tab jab provider ne diya — warna null (honest).
 */
import { routedTrainInfo, routedSchedule, routedTrainNameSearch, type ServedProvider } from "../railway/router.js";

export type TrainPick = {
  number: string;
  name: string;
  from: string | null;
  fromName?: string | null;
  to: string | null;
  toName?: string | null;
  departure: string | null;
  arrival: string | null;
  type?: string | null;
  match: "exact_number" | "exact_name" | "partial_name" | "route_context";
  source: string;
};

export type TrainPickerResult = {
  query: string;
  kind: "number" | "name";
  matches: TrainPick[];
  /** True when exactly one confident match → UI can preselect. */
  single: boolean;
  source: ServedProvider | string;
  note: string | null;
};

/** Small edit distance (spelling variants: SHATABDI vs SHTABDI, RAJDHANI vs RAJDHNI). */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
export function tokenMatches(want: string, nameTokens: string[]): boolean {
  return nameTokens.some((nt) => nt === want || (want.length >= 4 && (nt.startsWith(want) || want.startsWith(nt) && nt.length >= 4)) || (want.length >= 5 && editDistance(want, nt) <= (want.length >= 8 ? 2 : 1)));
}

export function normalizeTrainName(s: string): string {
  return s
    .toUpperCase()
    .replace(/\b(EXPRESS|EXP|SF|SUPERFAST|SPL|SPECIAL|MAIL|JN|JUNCTION)\b/g, " ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract 5-digit train numbers and a cleaned name phrase from free text. */
export function extractTrainQuery(text: string): { numbers: string[]; namePhrase: string | null } {
  const numbers = [...new Set((text.match(/\b\d{5}\b/g) ?? []))];
  let phrase = text
    .replace(/\b\d{5}\b/g, " ")
    .replace(/\b(ka|ki|ke|wali|wala|train|status|time|timing|kya|hai|hain|batao|dikhao|chahiye|ticket|mein|me|available|kahan|kaha|kab|aaj|kal|abhi|ko|se|tak|ke liye|please|plz|schedule|route|fare|seat|book|booking|dekho|check|karo|kar|do)\b/gi, " ")
    .replace(/[?!.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (phrase.length < 4) phrase = "";
  return { numbers, namePhrase: phrase || null };
}

async function enrichRoute(number: string): Promise<{ from: string | null; fromName: string | null; to: string | null; toName: string | null; departure: string | null; arrival: string | null; name: string | null; source: string | null }> {
  try {
    const s = await routedSchedule(number);
    const stops = (s.schedule && "stops" in s.schedule ? (s.schedule.stops as { code: string; name: string; arrival: string | null; departure: string | null }[]) : []) ?? [];
    if (stops.length >= 2) {
      const a = stops[0];
      const b = stops[stops.length - 1];
      return { from: a.code, fromName: a.name ?? null, to: b.code, toName: b.name ?? null, departure: a.departure ?? null, arrival: b.arrival ?? null, name: s.schedule?.trainName ?? null, source: s.provider };
    }
  } catch {
    /* fallthrough */
  }
  return { from: null, fromName: null, to: null, toName: null, departure: null, arrival: null, name: null, source: null };
}

export async function pickTrains(query: string, opts: { context?: { from?: string | null; to?: string | null }; limit?: number; enrich?: boolean } = {}): Promise<TrainPickerResult> {
  const q = query.trim();
  const limit = opts.limit ?? 6;
  const { numbers, namePhrase } = extractTrainQuery(q);

  /* 1. Exact train number(s). */
  if (numbers.length) {
    const matches: TrainPick[] = [];
    let source: string = "none";
    for (const n of numbers.slice(0, 3)) {
      const info = await routedTrainInfo(n);
      if (!info.info?.trainName) continue;
      source = info.provider;
      const r = opts.enrich === false ? null : await enrichRoute(n);
      matches.push({
        number: n,
        name: info.info.trainName,
        from: r?.from ?? null,
        fromName: r?.fromName ?? null,
        to: r?.to ?? null,
        toName: r?.toName ?? null,
        departure: r?.departure ?? null,
        arrival: r?.arrival ?? null,
        match: "exact_number",
        source: r?.source ?? info.provider,
      });
    }
    return {
      query: q,
      kind: "number",
      matches,
      single: matches.length === 1,
      source,
      note: matches.length ? null : `${numbers.join(", ")} kisi provider mein nahi mili — number check karein.`,
    };
  }

  /* 2/3. Name → provider name search, then rank exact > partial. */
  if (!namePhrase) return { query: q, kind: "name", matches: [], single: false, source: "none", note: "Train number ya naam samajh nahi aaya." };
  const named = await routedTrainNameSearch(namePhrase);
  const want = normalizeTrainName(namePhrase);
  const wantTokens = want.split(" ").filter(Boolean);
  const scored = named.trains
    .map((t) => {
      const nn = normalizeTrainName(t.name);
      const nTok = nn.split(" ").filter(Boolean);
      const exact = nn === want || (wantTokens.length === nTok.length && wantTokens.every((tok) => tokenMatches(tok, nTok)));
      const allTokens = wantTokens.length > 0 && wantTokens.every((tok) => tokenMatches(tok, nTok));
      const anyToken = wantTokens.some((tok) => tok.length >= 4 && tokenMatches(tok, nTok));
      const score = exact ? 0 : allTokens ? 1 : anyToken ? 2 : 3;
      return { t, score, exact, allTokens };
    })
    .filter((x) => x.score < 3)
    .sort((a, b) => a.score - b.score || a.t.number.localeCompare(b.t.number))
    /* Round-18f: providers return case/spelling variants of the same train — one card per number. */
    .filter((x, i, arr) => arr.findIndex((y) => y.t.number === x.t.number) === i);

  /* 4. Route context: if user context has from/to, prefer trains whose provider route touches it. */
  const ctxFrom = opts.context?.from?.toUpperCase();
  const ctxTo = opts.context?.to?.toUpperCase();
  const contextual = ctxFrom || ctxTo ? scored.filter((x) => (x.t.from && x.t.from.toUpperCase() === ctxFrom) || (x.t.to && x.t.to.toUpperCase() === ctxTo)) : [];
  const ordered = (contextual.length ? [...contextual, ...scored.filter((x) => !contextual.includes(x))] : scored)
    .filter((x, i, arr) => arr.findIndex((y) => y.t.number === x.t.number) === i);

  const matches: TrainPick[] = ordered.slice(0, limit).map((x) => ({
    number: x.t.number,
    name: x.t.name,
    from: x.t.from || null,
    to: x.t.to || null,
    departure: null,
    arrival: null,
    type: x.t.type || null,
    match: contextual.includes(x) ? "route_context" : x.exact ? "exact_name" : "partial_name",
    source: named.provider,
  }));
  /* Enrich top few with schedule endpoints when provider gave no route (erail list). */
  if (opts.enrich !== false) {
    await Promise.all(
      matches.slice(0, 3).map(async (m) => {
        if (m.from && m.to && m.departure) return;
        const r = await enrichRoute(m.number);
        if (r.from) Object.assign(m, { from: r.from, fromName: r.fromName, to: r.to, toName: r.toName, departure: r.departure, arrival: r.arrival, source: r.source ?? m.source });
      }),
    );
  }
  return {
    query: q,
    kind: "name",
    matches,
    single: matches.length === 1,
    source: named.provider,
    note: matches.length ? (named.provider === "web_erail" ? "Route/time sirf top trains ke liye verify hua (erail train list se naam+number)." : null) : `"${namePhrase}" naam se koi train nahi mili.`,
  };
}
