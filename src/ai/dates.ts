import { addDays, formatShortDate, pad, todayYmd } from "../format";

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, ravivar: 0, raviwar: 0,
  monday: 1, mon: 1, somvar: 1, somwar: 1,
  tuesday: 2, tue: 2, mangalvar: 2, mangalwar: 2,
  wednesday: 3, wed: 3, budhvar: 3, budhwar: 3,
  thursday: 4, thu: 4, guruvar: 4, guruwar: 4,
  friday: 5, fri: 5, shukravar: 5, shukrawar: 5,
  saturday: 6, sat: 6, shanivar: 6, shaniwar: 6,
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, janvari: 1, जनवरी: 1,
  feb: 2, february: 2, farvari: 2, फरवरी: 2,
  mar: 3, march: 3, मार्च: 3,
  apr: 4, april: 4, अप्रैल: 4,
  may: 5, mai: 5, मई: 5,
  jun: 6, june: 6, जून: 6,
  jul: 7, july: 7, जुलाई: 7,
  aug: 8, august: 8, agast: 8, अगस्त: 8,
  sep: 9, sept: 9, september: 9, सितंबर: 9, सितम्बर: 9,
  oct: 10, october: 10, अक्टूबर: 10, अक्तूबर: 10,
  nov: 11, november: 11, नवंबर: 11, नवम्बर: 11,
  dec: 12, december: 12, दिसंबर: 12, दिसम्बर: 12,
};

const MONTH_ALT = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

export interface DateHit {
  date?: string;
  ambiguous?: { date: string; label: string }[];
  weekday?: number;
}

function ymdFromParts(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function nextWeekday(fromYmd: string, dow: number): string {
  const [y, m, d] = fromYmd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const cur = dt.getDay();
  let add = (dow - cur + 7) % 7;
  if (add === 0) add = 7;
  return addDays(fromYmd, add);
}

export function upcomingDay(day: number, now: Date): string | undefined {
  if (!Number.isInteger(day) || day < 1 || day > 31) return undefined;
  const today = todayYmdFrom(now);
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  for (let i = 0; i < 3; i++) {
    const probe = new Date(y, m - 1, day);
    if (probe.getMonth() === m - 1) {
      const date = ymdFromParts(y, m, day);
      if (date >= today) return date;
    }
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return undefined;
}

export function parseDatePhrase(
  text: string,
  now = new Date(),
  opts: { allowDayOnly?: boolean } = {},
): DateHit {
  const raw = text.toLowerCase();
  const today = todayYmdFrom(now);

  const iso = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso && iso[1] >= today) return { date: iso[1] };

  if (/\b(aaj|today|aj)\b/.test(raw) || /(?<!\p{L})आज(?!\p{L})/u.test(raw)) return { date: today };
  if (
    (/\b(kal|tomorrow)\b/.test(raw) || /(?<!\p{L})कल(?!\p{L})/u.test(raw)) &&
    !/\bparso\b/.test(raw) &&
    !/(?<!\p{L})परसो/u.test(raw)
  ) {
    return { date: addDays(today, 1) };
  }
  if (/\b(parso|parson|day after)\b/.test(raw) || /(?<!\p{L})परसों|(?<!\p{L})परसो/u.test(raw)) {
    return { date: addDays(today, 2) };
  }

  const slash = raw.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (slash) {
    const d = Number(slash[1]);
    const mo = Number(slash[2]);
    let y = slash[3] ? Number(slash[3]) : now.getFullYear();
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      let date = ymdFromParts(y, mo, d);
      if (date < today) date = ymdFromParts(y + 1, mo, d);
      return { date };
    }
  }

  if (/\b(weekend|hafte ke end)\b/.test(raw)) {
    const sat = nextWeekday(today, 6);
    const sun = nextWeekday(today, 0);
    return {
      ambiguous: [
        { date: sat, label: `Sat ${formatShortDate(sat)}` },
        { date: sun, label: `Sun ${formatShortDate(sun)}` },
      ],
    };
  }

  if (/\b(next week|agle hafte|agle week)\b/.test(raw) && !/\b(monday|somvar|sunday|friday)\b/.test(raw)) {
    const mon = nextWeekday(today, 1);
    return {
      ambiguous: [
        { date: mon, label: `Mon ${formatShortDate(mon)}` },
        { date: addDays(mon, 2), label: `Wed ${formatShortDate(addDays(mon, 2))}` },
      ],
    };
  }

  const coming = raw.match(
    /\b(?:coming|agle|agla|next)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat|ravivar|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar)\b/,
  );
  if (coming) {
    const dow = WEEKDAYS[coming[1]];
    return { date: nextWeekday(today, dow), weekday: dow };
  }

  const named = raw.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s*(${MONTH_ALT})`, "u"));
  if (named) {
    const d = Number(named[1]);
    const mo = MONTHS[named[2].toLowerCase()] ?? MONTHS[named[2]];
    if (mo && d >= 1 && d <= 31) {
      let date = ymdFromParts(now.getFullYear(), mo, d);
      if (date < today) date = ymdFromParts(now.getFullYear() + 1, mo, d);
      return { date };
    }
  }

  const monthFirst = raw.match(new RegExp(`(${MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?`, "u"));
  if (monthFirst) {
    const mo = MONTHS[monthFirst[1].toLowerCase()] ?? MONTHS[monthFirst[1]];
    const d = Number(monthFirst[2]);
    if (mo && d >= 1 && d <= 31) {
      let date = ymdFromParts(now.getFullYear(), mo, d);
      if (date < today) date = ymdFromParts(now.getFullYear() + 1, mo, d);
      return { date };
    }
  }

  const dayKo = raw.match(/(\d{1,2})\s*(?:को|ko|तारीख|तारिख|tarikh|tareekh|tariq)/u);
  if (dayKo) {
    const date = upcomingDay(Number(dayKo[1]), now);
    if (date) return { date };
  }

  if (opts.allowDayOnly) {
    const bare = raw.match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
    if (bare) {
      const date = upcomingDay(Number(bare[1]), now);
      if (date) return { date };
    }
  }

  const nextWd = raw.match(
    /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat|ravivar|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar)\b/,
  );
  if (nextWd) {
    const dow = WEEKDAYS[nextWd[1]];
    return { date: nextWeekday(today, dow), weekday: dow };
  }

  const wd = raw.match(
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat|ravivar|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar|raviwar|somwar)\b/,
  );
  if (wd) {
    const dow = WEEKDAYS[wd[1]];
    const next = nextWeekday(today, dow);
    const [y, m, d] = today.split("-").map(Number);
    const todayDow = new Date(y, m - 1, d).getDay();
    if (todayDow === dow) {
      return {
        weekday: dow,
        ambiguous: [
          { date: today, label: formatShortDate(today) },
          { date: next, label: formatShortDate(next) },
        ],
      };
    }
    return { date: next, weekday: dow };
  }

  return {};
}

const IST_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** India-first: "aaj"/"kal" always follow IST, whatever the device/server clock says. */
export function todayYmdFrom(now: Date): string {
  try {
    return IST_YMD.format(now);
  } catch {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
}

/** Live/history only. Booking still uses parseDatePhrase (kal = tomorrow). */
export function parseStatusDate(text: string, now = new Date()): string | undefined {
  const raw = text.toLowerCase();
  const today = todayYmdFrom(now);
  if (
    /\b(yesterday|yasterday|ysterday|yester day|prev(?:ious)?\s*day|pichle din|pichhla din|last day)\b/.test(raw) ||
    /यस्टरडे|येस्टरडे|यस्टर्डे|यस्टरडे|बीता कल|पिछले दिन|कल वाली completed/.test(text)
  ) {
    return addDays(today, -1);
  }
  const liveCue = /\b(live|running|status|history|completed)\b/.test(raw) || /लाइव|स्टेटस|इतिहास/.test(raw);
  if (liveCue && (/कल/.test(raw) || /\bkal\b/.test(raw)) && !/\b(tomorrow|aane wala|agle din)\b/.test(raw)) {
    return addDays(today, -1);
  }

  const named = raw.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s*(${MONTH_ALT})`, "u"));
  if (named) {
    const d = Number(named[1]);
    const mo = MONTHS[named[2].toLowerCase()] ?? MONTHS[named[2]];
    if (mo && d >= 1 && d <= 31) {
      const thisYear = ymdFromParts(now.getFullYear(), mo, d);
      const age = (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
        new Date(now.getFullYear(), mo - 1, d).getTime()) / 86400000;
      if (thisYear <= today && age >= 0 && age <= 40) return thisYear;
    }
  }
  const slash = raw.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (slash) {
    const d = Number(slash[1]);
    const mo = Number(slash[2]);
    let y = slash[3] ? Number(slash[3]) : now.getFullYear();
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      const date = ymdFromParts(y, mo, d);
      if (date <= today && date >= addDays(today, -40)) return date;
    }
  }
  return undefined;
}

export { todayYmd };
