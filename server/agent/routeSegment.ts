/* ── Round-49 (29 Sep 2026): "jo train maangi hui destination tak jaati hi nahi, wo board me kyun?" ──
 * User (screenshot, 29 Sep): LDH → SVDK maanga tha, board me 12265 JAT DURONTO / 13151 KOAA JAT EXPRES
 * bhi aa gayi — dono **Jammu Tawi (JAT) par khatam** hoti hain, SVDK (Katra) tak jaati hi nahi. User:
 * "maine to svdk tak maangi hai confirm seat wo fir jammu ki kyu dikha rha beech mein".
 *
 * ConfirmTkt ka route-board "aas-paas ke bade station" wali trains bhi de deta hai (JAT, Katra ke liye) —
 * par user ke liye wo unbookable hai: nahi to seat us segment ki hai, nahi wo station pahunchti hai.
 *
 * Fix (general, provider data hi use karta hai — kuch invent nahi): board ke HAR train ka route
 * (routedSchedule, wahi timetable jo baaki jagah chalti hai) dekha jaata hai; jo train `to` tak nahi
 * jaati (ya `from` par rukti hi nahi / order ulta hai) wo list se **hat jati hai** aur ek saaf note
 * aata hai ("12265 sirf JAT tak jaati hai"). Route pata na chale to train **rakh li jaati hai**
 * (andaza nahi) — sirf verified-negative hataate hain.
 *
 * Ye routeCheck.ts wala hi usool hai (tool-level verification, per-question rule nahi): claim se pehle
 * apne data se check karo.
 */
import { routedSchedule } from "../railway/router.js";

export type SegmentDrop = { number: string; name: string; last: string; reason: string };

type Cover = { order: Map<string, number>; first: string; last: string } | null;

/** Tests ke liye injectable schedule resolver (default: provider timetable). */
let scheduleResolver: (n: string) => Promise<{ stops?: { code: string }[] } | null> = async (n) => {
  const routed = await routedSchedule(n);
  const sched = routed?.schedule;
  return sched && "stops" in sched ? (sched as { stops?: { code: string }[] }) : null;
};

export function setSegmentScheduleResolver(fn: typeof scheduleResolver): void {
  scheduleResolver = fn;
}

const coverCache = new Map<string, { cover: Cover; at: number }>();
const COVER_TTL_MS = 6 * 60 * 60 * 1000; /* din bhar train ka route nahi badalta */

export function clearSegmentCache(): void {
  coverCache.clear();
}

async function routeCover(number: string): Promise<Cover> {
  const hit = coverCache.get(number);
  if (hit && Date.now() - hit.at < COVER_TTL_MS) return hit.cover;
  let cover: Cover = null;
  try {
    const sched = await scheduleResolver(number);
    const stops = (sched?.stops ?? []).map((s) => String(s?.code ?? "").trim().toUpperCase()).filter(Boolean);
    if (stops.length >= 2) {
      const order = new Map<string, number>();
      stops.forEach((c, i) => {
        if (!order.has(c)) order.set(c, i);
      });
      cover = { order, first: stops[0], last: stops[stops.length - 1] };
    }
  } catch {
    cover = null; /* route pata nahi — kuch nahi hataate */
  }
  coverCache.set(number, { cover, at: Date.now() });
  return cover;
}

/** Train `from → to` segment serve karti hai? `null` = pata nahi (unverified). */
export function servesSegment(cover: Cover, from: string, to: string): boolean | null {
  if (!cover) return null;
  const f = String(from ?? "").trim().toUpperCase();
  const t = String(to ?? "").trim().toUpperCase();
  if (!f || !t) return null;
  const i = cover.order.get(f);
  const j = cover.order.get(t);
  if (i == null || j == null) return false;
  return i < j;
}

/** Ek saath kitni schedules check karein (latency guard). */
const CONCURRENCY = 6;

/**
 * Board ke trains me se sirf wo rakho jo `from → to` sach me jaati hain.
 * `dropped` me wo trains aati hain jinhe hataya gaya (note banane ke liye).
 */
export async function filterTrainsServingSegment<T extends { trainNumber: string; trainName?: string }>(
  trains: T[],
  from: string,
  to: string,
): Promise<{ trains: T[]; dropped: SegmentDrop[] }> {
  if (!trains.length || !from || !to) return { trains, dropped: [] };
  const uniq: string[] = [];
  for (const t of trains) {
    const n = String(t.trainNumber ?? "").trim();
    if (n && !uniq.includes(n)) uniq.push(n);
  }
  const verdict = new Map<string, boolean | null>();
  for (let i = 0; i < uniq.length; i += CONCURRENCY) {
    const batch = uniq.slice(i, i + CONCURRENCY);
    const got = await Promise.all(batch.map(async (n) => [n, servesSegment(await routeCover(n), from, to)] as const));
    for (const [n, v] of got) verdict.set(n, v);
  }
  const kept: T[] = [];
  const dropped: SegmentDrop[] = [];
  for (const t of trains) {
    const n = String(t.trainNumber ?? "").trim();
    const v = verdict.get(n);
    if (v === false) {
      const cover = coverCache.get(n)?.cover ?? null;
      const reason = cover ? `last stop ${cover.last}` : "route verify nahi hua";
      dropped.push({ number: n, name: String(t.trainName ?? "").trim(), last: cover?.last ?? "?", reason });
      continue;
    }
    kept.push(t);
  }
  if (dropped.length) {
    /* Prod telemetry — kaunsi trains, kis wajah se hati (andaza nahi, log). */
    console.log(JSON.stringify({ routeDrop: { from, to, dropped: dropped.map((d) => `${d.number}(${d.last})`) } }));
  }
  return { trains: kept, dropped };
}

/** Hati hui trains ki ek saaf line (reply/board me lagane ke liye) — sirf facts, koi instruction nahi. */
export function routeDropNote(dropped: SegmentDrop[], to: string): string | null {
  if (!dropped.length) return null;
  const shown = dropped.slice(0, 4).map((d) => `${d.number}${d.name ? ` ${d.name}` : ""} (last stop ${d.last})`);
  const more = dropped.length > 4 ? ` +${dropped.length - 4} aur` : "";
  return `ℹ️ ${shown.join(", ")} — ye ${to} tak nahi jaati, isliye list se hata di.`;
}

/* ── Round-50 (29 Sep 2026, user "Haan banado"): JAT-tak wali trains ka alag section ───────────────
 * Jo trains maangi hui destination tak nahi jaati (jaise LDH→SVDK me JAT par khatam hone wali), unme
 * se jo abhi seat-detih hain wo **alag section** me dikhti hain — saaf label ke saath: "ye sirf JAT tak
 * jaati hain (aage ka safar khud)". IRCTC bhi Katra search me yahi trains dikhata hai (LDH JN → S M V D
 * KATRA board me JAT destination ke saath), isliye option chhupna nahi chahiye — bas main list se alag
 * rehna chahiye. Seats/number wahi board rows se (kuch invent nahi). */
type ClassRow = {
  code?: string | null;
  classCode?: string | null;
  status?: string | null;
  seats?: number | null;
  rac?: number | null;
  waitlist?: number | null;
};

/** Sirf seat-detih classes (AVAILABLE/RAC) — section ka maksad "yahaan confirm seat hai" hai; WL
 *  offer karna jhootha lagega (main list ka rule bhi wahi hai). */
function classBit(c: ClassRow): string | null {
  const code = String(c.classCode ?? c.code ?? "").trim().toUpperCase();
  if (!code) return null;
  const st = String(c.status ?? "").toUpperCase();
  if (st === "AVAILABLE") return c.seats != null ? `${code} AVL ${c.seats}` : `${code} AVL`;
  if (st === "RAC") return c.rac != null ? `${code} RAC ${c.rac}` : `${code} RAC`;
  return null;
}

export function nearbyCandidatesNote<T extends { trainNumber: string; trainName?: string; classes?: ClassRow[] }>(
  trains: T[],
  dropped: SegmentDrop[],
  from: string,
  to: string,
): string | null {
  if (!trains.length || !dropped.length) return null;
  const byLast = new Map<string, string[]>();
  for (const t of trains) {
    const n = String(t.trainNumber ?? "").trim();
    const drop = dropped.find((d) => d.number === n);
    if (!drop) continue;
    const bits = (t.classes ?? []).map(classBit).filter((x): x is string => Boolean(x)).slice(0, 4);
    if (!bits.length) continue; /* seat ka data hi nahi — section me kuch nahi likhte */
    const name = String(t.trainName ?? "").trim();
    const line = `${n}${name ? ` ${name}` : ""} (${bits.join(" · ")})`;
    const key = drop.last || "?";
    const arr = byLast.get(key) ?? [];
    if (!arr.includes(line)) arr.push(line);
    byLast.set(key, arr);
  }
  if (!byLast.size) return null;
  const parts: string[] = [];
  for (const [last, lines] of byLast) {
    parts.push(`🧭 ${last} tak (aage ka safar khud): ${lines.slice(0, 3).join(" | ")}${lines.length > 3 ? ` | +${lines.length - 3} aur` : ""}`);
  }
  const lastStops = [...byLast.keys()];
  return `${parts.join("\n")}\n(Inme ${from}→${lastStops.join("/")} tak ka ticket hota hai, ${to} ka nahi.)`;
}
