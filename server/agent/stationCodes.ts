/* ── Round-46 (28 Sep 2026): station-code verification net ────────────────────────────────────────
 * Live case: model ne likha "12013 … isme Haridwar (HWR) nahi aata" — jabki IR me Haridwar = HW aur
 * HWR asli me HATWAR hai. Model pura route sahi likhta hai par kabhi-kabhi code ki slip kar deta hai,
 * aur user ke liye code hi wo cheez hai jo wo IRCTC me type karta hai.
 *
 * Ye module hamare apne station data (server/data/station-codes.ts — 8989 IR stations, data.gov.in
 * list) se reply ke code+naam JODI verify karta hai. Sirf wahi cheez badli jaati hai jab naam hamare
 * data me ho aur uska code kuch aur ho — warna reply ko haath nahi lagaya jaata (koi andaza nahi).
 * Per-question rule nahi: ye ek general tool-level verification hai (R43k wahi soch).
 */
import { STATION_CODES } from "../data/station-codes.js";
import { STATIONS } from "../data/stations.js";

export type StationCodeFix = { label: string; from: string; to: string; why: string };

/* Naam ke common suffix hata do — "Ludhiana Jn" / "Ludhiana Junction" dono "ludhiana" ho jaayein. */
const NAME_SUFFIXES = new Set([
  "jn", "junction", "junctions", "cantt", "cantonment", "cnt", "city", "terminal", "terminus",
  "town", "halt", "hault", "station", "ph", "road", "bazar", "bazaar",
]);

/** Naam ka comparison form: lowercase, punctuation hata, suffix (jn/junction/cantt…) hata. */
export function normalizeStationName(raw: string): string {
  const words = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && NAME_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/** Code → naam (uppercase) hamare data se; curated list ko priority (wo apne flow ka asli data hai). */
const CODE_TO_NAME: Record<string, string> = { ...STATION_CODES };
for (const st of STATIONS) {
  const c = st.code.toUpperCase();
  if (!CODE_TO_NAME[c]) CODE_TO_NAME[c] = String(st.name ?? "").toUpperCase();
}

/* Naam → codes. Ek naam ke kai code ho sakte hain (city me 2 station) — priority: hamari curated
 * list pehle, phir chhota code, phir alphabetical (deterministic, andaza nahi). */
const NAME_TO_CODES = new Map<string, string[]>();
{
  const curated = new Set(STATIONS.map((s) => s.code.toUpperCase()));
  const push = (code: string, name: string) => {
    const key = normalizeStationName(name);
    if (!key) return;
    const arr = NAME_TO_CODES.get(key) ?? [];
    if (!arr.includes(code)) arr.push(code);
    NAME_TO_CODES.set(key, arr);
  };
  for (const st of STATIONS) push(st.code.toUpperCase(), st.name);
  for (const [code, name] of Object.entries(STATION_CODES)) {
    if (!curated.has(code)) push(code, name);
  }
  for (const arr of NAME_TO_CODES.values()) {
    arr.sort((a, b) => (curated.has(a) ? 0 : 1) - (curated.has(b) ? 0 : 1) || a.length - b.length || (a < b ? -1 : 1));
  }
}

/** Reply me code+naam JODI dhoondo: "Haridwar (HWR)" aur "HW Haridwar Jn" dono forms. */
type Pair = { label: string; code: string; start: number; end: number };

const RE_NAME_PAREN_CODE = /([A-Za-z][A-Za-z.'’-]*(?:\s+[A-Za-z.'’-]+){0,4})\s*\(\s*([A-Z]{2,6})\s*\)/g;
const RE_CODE_NAME = /\b([A-Z]{2,6})\b\s+([A-Z][A-Za-z.'’-]*(?:\s+[A-Z][A-Za-z.'’-]+){0,3})/g;
const RE_NAME_DASH_CODE = /([A-Za-z][A-Za-z.'’-]*(?:\s+[A-Za-z.'’-]+){0,4})\s*[-–—:]\s*([A-Z]{2,6})\b/g;
/* Naam-candidate ke aage-peeche ke filler words (station naam nahi hote). */
const LABEL_FILLER = new Set([
  "se", "tak", "par", "pe", "ko", "ka", "ki", "ke", "aur", "and", "via", "from", "to", "at", "in",
  "on", "the", "of", "is", "hai", "hain", "route", "stop", "stops", "station", "train", "gaadi",
  "next", "agla", "source", "run", "date", "coach", "platform", "pf", "class", "fare", "time",
]);

/** Label ke variants — station naam reply me kai shabdon ke saath aa sakta hai ("isme Haridwar",
 * "route ke hisaab se Ludhiana Jn"). Isliye shuru se shabd hataate hue aur aakhir ke filler hataate
 * hue saare reasonable variants try hote hain; jo pehla hamare data me mile wahi label maana jaata
 * hai (andaza nahi — index me hona zaroori hai). */
function labelVariants(label: string): string[] {
  const words = String(label ?? "").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  const push = (ws: string[]) => {
    const s = ws.join(" ").trim();
    if (s && !out.includes(s)) out.push(s);
  };
  const maxDrop = Math.min(words.length, 5);
  for (let i = 0; i < maxDrop; i++) push(words.slice(i));
  for (let i = 0; i < maxDrop; i++) {
    const ws = words.slice(i);
    while (ws.length && LABEL_FILLER.has(ws[ws.length - 1].toLowerCase())) ws.pop();
    push(ws);
  }
  return out;
}

/** Code aur naam ek hi station ke hain? (name ke words ka overlap — "New Delhi"/"Delhi" chalti hai) */
function sameStationish(code: string, label: string): boolean {
  const known = CODE_TO_NAME[code];
  if (!known) return false;
  const a = new Set(normalizeStationName(known).split(" ").filter(Boolean));
  const b = new Set(normalizeStationName(label).split(" ").filter(Boolean));
  if (!a.size || !b.size) return false;
  const short = a.size <= b.size ? a : b;
  for (const w of short) if ((a.size <= b.size ? b : a).has(w)) return true;
  return false;
}

/** Ek jodi verify karo. Theek ho / naam hamare data me na ho → null (kuch nahi badlega). */
export function verifyPair(label: string, code: string): StationCodeFix | null {
  const cd = String(code ?? "").toUpperCase();
  if (!cd) return null;
  for (const variant of labelVariants(label)) {
    const key = normalizeStationName(variant);
    if (!key) continue;
    const codes = NAME_TO_CODES.get(key);
    if (!codes || !codes.length) continue; /* naam hamare data me nahi — andaza nahi lagayenge */
    if (codes.includes(cd)) return null; /* sahi jodi */
    /* Code asli station ka ho aur uska naam label se milta ho (New Delhi ↔ Delhi) → chhod do. */
    if (sameStationish(cd, key)) return null;
    const known = CODE_TO_NAME[cd];
    return {
      label: variant,
      from: cd,
      to: codes[0],
      why: known ? `${cd} = ${known}` : `${cd} hamare station data me nahi`,
    };
  }
  return null;
}

/** Reply ke saare code+naam jodi verify karo; sirf galat code badalte hain (baaki text waisa hi). */
export function verifyStationCodes(reply: string): { reply: string; fixes: StationCodeFix[] } {
  const text = String(reply ?? "");
  if (!text || !/[A-Za-z]/.test(text)) return { reply: text, fixes: [] };

  const pairs: Pair[] = [];
  for (const m of text.matchAll(RE_NAME_PAREN_CODE)) {
    const label = m[1];
    const code = m[2];
    const codeStart = m.index + m[0].lastIndexOf(code);
    pairs.push({ label, code, start: codeStart, end: codeStart + code.length });
  }
  for (const m of text.matchAll(RE_CODE_NAME)) {
    const code = m[1];
    const label = m[2];
    pairs.push({ label, code, start: m.index, end: m.index + code.length });
  }
  for (const m of text.matchAll(RE_NAME_DASH_CODE)) {
    const label = m[1];
    const code = m[2];
    const codeStart = m.index + m[0].lastIndexOf(code);
    pairs.push({ label, code, start: codeStart, end: codeStart + code.length });
  }
  if (!pairs.length) return { reply: text, fixes: [] };

  const seen = new Set<string>();
  const edits: Array<{ start: number; end: number; to: string; fix: StationCodeFix }> = [];
  for (const p of pairs.sort((a, b) => a.start - b.start)) {
    const key = `${p.label.toLowerCase()}|${p.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fix = verifyPair(p.label, p.code);
    if (!fix) continue;
    if (edits.some((e) => p.start < e.end && e.start < p.end)) continue; /* overlap — pehla jeeta */
    edits.push({ start: p.start, end: p.end, to: fix.to, fix });
  }
  if (!edits.length) return { reply: text, fixes: [] };

  let out = "";
  let cursor = 0;
  for (const e of edits.sort((a, b) => a.start - b.start)) {
    out += text.slice(cursor, e.start) + e.to;
    cursor = e.end;
  }
  out += text.slice(cursor);
  const fixes = edits.map((e) => e.fix);
  /* Prod telemetry — kaunsa code, kyun (andaza nahi, log). */
  for (const f of fixes) console.log(JSON.stringify({ stationCodeFix: f }));
  return { reply: out, fixes };
}
