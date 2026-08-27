/** Named-train compare from provider timetable only. Never invent fare/AVL. */

export function spokenTrainNumbers(text: string): string[] {
  return [...text.matchAll(/\b(\d{5})\b/g)].map((m) => m[1]);
}

const COMPARE_CUE =
  /\b(better|compare|recommend|kaunsi|kaun si|kon si|konsi|vs|versus|ya|yan|or|aur)\b|कौनसी|कौन सी|बेहतर|तुलना/;

export function isNamedTrainCompare(text: string): boolean {
  const t = text.toLowerCase();
  return spokenTrainNumbers(t).length >= 2 && COMPARE_CUE.test(t);
}

export type CompareStop = {
  code: string;
  name: string;
  arrival?: string | null;
  departure?: string | null;
};

export type CompareSchedule = {
  trainNumber: string;
  trainName?: string;
  stops?: CompareStop[];
  durationMinutes?: number | null;
  classes?: string[];
};

function hhmm(raw?: string | null): number | null {
  const m = String(raw ?? "").match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function durationLabelFromMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function fullRunMinutes(s: CompareSchedule): number | null {
  if (s.durationMinutes && s.durationMinutes > 0) return s.durationMinutes;
  const stops = s.stops ?? [];
  if (stops.length < 2) return null;
  const start = hhmm(stops[0].departure || stops[0].arrival);
  const end = hhmm(stops[stops.length - 1].arrival || stops[stops.length - 1].departure);
  if (start == null || end == null) return null;
  return end >= start ? end - start : end + 1440 - start;
}

export function formatGoesToAnswer(
  sched: CompareSchedule | null,
  num: string,
  destCity: string,
  destCodes: string[],
): string {
  if (!sched) {
    return `Train ${num} ka timetable nahi mila. Main ${destCity || "halt"} invent nahi karunga.`;
  }
  const stops = sched.stops ?? [];
  const first = stops[0];
  const last = stops[stops.length - 1];
  const route = first && last ? `${first.code} ${first.name} → ${last.code} ${last.name}` : "";
  const hits = destCodes.length ? destHalts(sched, destCodes) : [];
  const title = `${sched.trainNumber} ${sched.trainName || ""}`.trim();
  if (hits.length) {
    const halt = hits
      .map((d) => `${d.name} (${d.code})${d.arrival && d.arrival !== "--" ? ` ${d.arrival}` : ""}`)
      .join(", ");
    return `Haan. ${title} ${destCity} pe rukti hai — ${halt}.${route ? `\nRoute: ${route}` : ""}\n(Timetable — gadh ke nahi.)`;
  }
  const codes = destCodes.length ? destCodes.join("/") : destCity;
  return `Nahi. ${title} ${destCity || "wahan"} (${codes}) pe nahi rukti.${route ? `\nRoute: ${route}` : ""}\n(Timetable — gadh ke nahi.)`;
}

export function destHalts(s: CompareSchedule, destCodes: string[]): CompareStop[] {
  const want = new Set(destCodes.map((c) => c.toUpperCase()));
  return (s.stops ?? []).filter((st) => want.has(st.code.toUpperCase()));
}

function summarize(s: CompareSchedule | null, num: string, destCodes: string[]): string {
  if (!s) return `${num}: timetable provider se nahi mili.`;
  const stops = s.stops ?? [];
  const first = stops[0];
  const last = stops[stops.length - 1];
  const dur = fullRunMinutes(s);
  const classes = (s.classes ?? []).filter(Boolean);
  const dest = destCodes.length ? destHalts(s, destCodes) : [];
  return [
    `${s.trainNumber} ${s.trainName || ""}`.trim(),
    first && last ? `Route: ${first.code} ${first.name} → ${last.code} ${last.name}` : null,
    first?.departure ? `Start: ${first.departure}` : null,
    last?.arrival ? `End: ${last.arrival}` : null,
    dur != null ? `Full run: ${durationLabelFromMinutes(dur)}` : null,
    dest.length
      ? `Dest halt: ${dest.map((d) => `${d.name} (${d.code})${d.arrival ? ` ${d.arrival}` : ""}`).join(", ")}`
      : destCodes.length
        ? "Dest halt: in stations pe nahi rukti (timetable)"
        : null,
    classes.length ? `Classes (timetable): ${classes.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatScheduleCompare(
  a: CompareSchedule | null,
  b: CompareSchedule | null,
  nums: string[],
  destCodes: string[] = [],
): string {
  const n0 = nums[0] ?? "?????";
  const n1 = nums[1] ?? "?????";
  const body = `${summarize(a, n0, destCodes)}\n\n${summarize(b, n1, destCodes)}`;
  const extras: string[] = [];
  const da = a ? fullRunMinutes(a) : null;
  const db = b ? fullRunMinutes(b) : null;
  if (da != null && db != null && da !== db) {
    const faster = da < db ? n0 : n1;
    extras.push(
      `Full-run time: ${faster} chhoti hai (${durationLabelFromMinutes(Math.min(da, db))} vs ${durationLabelFromMinutes(Math.max(da, db))}).`,
    );
  }
  const destA = a && destCodes.length ? destHalts(a, destCodes) : [];
  const destB = b && destCodes.length ? destHalts(b, destCodes) : [];
  if (destCodes.length && destA.length && !destB.length) {
    extras.push(`${n0} dest pe rukti hai, ${n1} nahi — timetable ke mutabik.`);
  } else if (destCodes.length && destB.length && !destA.length) {
    extras.push(`${n1} dest pe rukti hai, ${n0} nahi — timetable ke mutabik.`);
  }
  return `${body}${extras.length ? `\n\n${extras.join("\n")}` : ""}\n\nSirf provider timetable. Fare/seats invent nahi. Ticket ke liye origin, date, passengers bolo.`;
}
