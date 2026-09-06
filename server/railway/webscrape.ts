/* ── VERIFIED-SITE WEB SCRAPING fallback (user request 2026-09-06):
 * "agar data API se na mile to verified sites (indian railway, ixigo,
 * make my trip, cris, etc — koi bhi verified site) se web scraping se
 * data le aaye."
 *
 * LAST-RESORT: RailCore (primary) + RailKit (fallback) dono fail hone par
 * hi chalta hai — routedSchedule() ke ant mein. Data HAMESHA source-labeled
 * jaata hai (provider: "web_ixigo" / "web_confirmtkt") taaki reply mein
 * saaf dikhe ki ye railway API nahi, verified public site se aaya hai.
 *
 * Sources (dono SSR — plain HTML mein poora timetable milta hai):
 *   1. ixigo.com/trains/<num>      (Stn Code|Stn Name|Arrives|Departs|…)
 *   2. confirmtkt.com/train-schedule/<num> (Station Name - Code|Arrives|Departs)
 *   3. trainspnrstatus.com/train-schedule/<num> ([#, NAME, CODE, arr, dep])
 *
 * COACH POSITION (2026-09-06, user: "har cheez API fail par web se"):
 *   - trainspnrstatus.com/train-coach-position/<num> (SSR coach boxes)
 *
 * Data types jo WEB se KABHI nahi (safety): live status, fare, seats/
 * availability, PNR, booking — sirf railway API se.
 *
 * Bot-block/parse-change par [] — honest empty, koi crash nahi. */

export type ScrapedStop = {
  code: string;
  name: string;
  arrival: string | null;
  departure: string | null;
};

export type ScrapedSchedule = {
  trainNumber: string;
  trainName: string | null;
  stops: ScrapedStop[];
  provider: "web_ixigo" | "web_confirmtkt" | "web_trainspnrstatus";
  sourceUrl: string;
};

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const SCRAPE_TIMEOUT_MS = 9000;

/* Tests inject karte hain (setWebFetch pattern). */
let scrapeFetchImpl: typeof fetch | null = null;
export function setScrapeFetch(fn: typeof fetch | null): void {
  scrapeFetchImpl = fn ?? globalThis.fetch.bind(globalThis);
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await (scrapeFetchImpl ?? globalThis.fetch.bind(globalThis))(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9", Accept: "text/html" },
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(JSON.stringify({ scrape: "http_error", url: String(url).slice(0, 100), status: res.status }));
      return null;
    }
    return await res.text();
  } catch (e) {
    console.error(JSON.stringify({ scrape: "fetch_error", url: String(url).slice(0, 100), err: String(e).slice(0, 120) }));
    return null;
  }
}

const TIME_RE = /(\d{1,2}:\d{2})/;

/** H1/title se train ka naam (jaise "12014 Amritsar Shtabdi: Train Route" → "Amritsar Shtabdi"). */
function trainNameFromHtml(html: string): string | null {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const raw = (h1 && h1.trim()) || pageTitle(html) || "";
  const m = String(raw)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\d{4,6}\s*/g, " ")
    .replace(/[:|·-].*/g, " ")
    .replace(/\b(train|route|schedule|timetable|time table)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (m.length < 4) return null;
  return m.slice(0, 60);
}

function pageTitle(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{3,100})["']/i)?.[1];
  if (og) return og.replace(/\s*\(\d{4,6}\).*/i, "").replace(/\s*[-|·].*(train|schedule|timetable|route).*/i, "").trim() || null;
  const t = html.match(/<title[^>]*>([^<]{3,100})<\/title>/i)?.[1];
  if (!t) return null;
  return t.replace(/\s*\(\d{4,6}\).*/i, "").replace(/\s*[-|·].*(train|schedule|timetable|route).*/i, "").replace(/\s*(train )?(schedule|timetable|time table|route).*/i, "").trim() || null;
}

/* ── ixigo parser: <table> rows — ||ASR|||Amritsar Jn|||starts||04:55||…
 *    Ya arrival "starts", departure "04:55".                               */
function parseIxigo(html: string, trainNumber: string): ScrapedSchedule | null {
  const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/g) ?? [];
  for (const table of tables) {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
    const stops: ScrapedStop[] = [];
    for (const row of rows) {
      const cells = (row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g) ?? []).map((c) =>
        c.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(),
      );
      if (cells.length < 4) continue;
      /* Offset-safe: cells mein pehla solid A-Z 2-5 code dhoondo (ixigo
       * rows mein leading empty/index cells aate hain). */
      let ci = -1;
      for (let i = 0; i < Math.min(cells.length - 2, 6); i++) {
        if (/^[A-Z]{2,5}$/.test(cells[i].toUpperCase()) && /[a-z]/.test(cells[i + 1] ?? "")) {
          ci = i;
          break;
        }
      }
      if (ci < 0) continue;
      const code = cells[ci].toUpperCase();
      const name = cells[ci + 1] ?? "";
      const arrives = cells[ci + 2] ?? "";
      const departs = cells[ci + 3] ?? "";
      const arrival = /start/i.test(arrives) ? null : (arrives.match(TIME_RE)?.[1] ?? null);
      const departure = departs.match(TIME_RE)?.[1] ?? null;
      stops.push({ code, name, arrival, departure });
    }
    if (stops.length >= 3) {
      return {
        trainNumber,
        trainName: trainNameFromHtml(html),
        stops,
        provider: "web_ixigo",
        sourceUrl: `https://www.ixigo.com/trains/${trainNumber}`,
      };
    }
  }
  return null;
}

/* ── ConfirmTkt parser: ||2|||Beas - BEAS|||05:23|||05:25||…
 *    Station "Name - CODE" ek hi cell mein hota hai.                      */
function parseConfirmTkt(html: string, trainNumber: string): ScrapedSchedule | null {
  const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/g) ?? [];
  for (const table of tables) {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
    const stops: ScrapedStop[] = [];
    for (const row of rows) {
      const cells = (row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g) ?? []).map((c) =>
        c.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(),
      );
      if (cells.length < 4) continue;
      if (cells[0] && !/^\d+$/.test(cells[0])) continue;
      const stn = cells[1] ?? "";
      const m = stn.match(/^(.*?)\s*-\s*([A-Za-z]{2,5})$/);
      if (!m) continue;
      const name = m[1].trim();
      const code = m[2].toUpperCase();
      if (!name) continue;
      const arrives = cells[2] ?? "";
      const departs = cells[3] ?? "";
      const arrival = /start/i.test(arrives) ? null : (arrives.match(TIME_RE)?.[1] ?? null);
      const departure = departs.match(TIME_RE)?.[1] ?? null;
      stops.push({ code, name, arrival, departure });
    }
    if (stops.length >= 3) {
      return {
        trainNumber,
        trainName: trainNameFromHtml(html),
        stops,
        provider: "web_confirmtkt",
        sourceUrl: `https://www.confirmtkt.com/train-schedule/${trainNumber}`,
      };
    }
  }
  return null;
}

/* ── trainspnrstatus parser: ||1||AMRITSAR||ASR|||--:--|||04:55||…
 *    Name PEHLE (uppercase), code BAAD mein — ConfirmTkt ka ulta.          */
function parseTrainSpnr(html: string, trainNumber: string): ScrapedSchedule | null {
  const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/g) ?? [];
  for (const table of tables) {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
    const stops: ScrapedStop[] = [];
    for (const row of rows) {
      const cells = (row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g) ?? []).map((c) =>
        c.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(),
      );
      if (cells.length < 5) continue;
      /* Pattern: [#, NAME, CODE, arrives, departs, halt, ...] */
      let idx = -1;
      for (let i = 0; i < Math.min(cells.length - 3, 4); i++) {
        if (/^\d+$/.test(cells[i]) && /^[A-Za-z .]{3,40}$/.test(cells[i + 1] ?? "") && /^[A-Z]{2,5}$/.test((cells[i + 2] ?? "").toUpperCase())) {
          idx = i;
          break;
        }
      }
      if (idx < 0) continue;
      const name = cells[idx + 1];
      const code = cells[idx + 2].toUpperCase();
      const arrives = cells[idx + 3] ?? "";
      const departs = cells[idx + 4] ?? "";
      const arrival = /--:--|start/i.test(arrives) ? null : (arrives.match(TIME_RE)?.[1] ?? null);
      const departure = /--:--|end/i.test(departs) ? null : (departs.match(TIME_RE)?.[1] ?? null);
      stops.push({ code, name, arrival, departure });
    }
    if (stops.length >= 3) {
      return {
        trainNumber,
        trainName: trainNameFromHtml(html),
        stops,
        provider: "web_trainspnrstatus",
        sourceUrl: `https://www.trainspnrstatus.com/train-schedule/${trainNumber}`,
      };
    }
  }
  return null;
}

/** Verified-site scrape (last-resort): ixigo → ConfirmTkt → trainspnrstatus.
 *  Sab fail → null (honest empty — koi invent nahi). */
export async function scrapeTrainScheduleWeb(trainNumber: string): Promise<ScrapedSchedule | null> {
  const num = String(trainNumber ?? "").trim();
  if (!/^\d{4,6}$/.test(num)) return null;
  const sources: { url: string; parse: (html: string, num: string) => ScrapedSchedule | null }[] = [
    { url: `https://www.ixigo.com/trains/${num}`, parse: parseIxigo },
    { url: `https://www.confirmtkt.com/train-schedule/${num}`, parse: parseConfirmTkt },
    { url: `https://www.trainspnrstatus.com/train-schedule/${num}`, parse: parseTrainSpnr },
  ];
  for (const src of sources) {
    const html = await fetchHtml(src.url);
    if (!html) continue;
    const parsed = src.parse(html, num);
    if (parsed) return parsed;
  }
  return null;
}


/* ── COACH POSITION web-scrape (user request 2026-09-06: "pehle API, fail
 * par verified site se") — trainspnrstatus.com SSR coach boxes:
 *   <button aria-label="Select coach C5">...<span class="text-lg">C5</span>
 *   <span ...>CC</span> ... Pos <!-- -->12</button>
 * Live-verified 2026-09-06: 12014 → 18 coaches LPR,E2,E1,C14…C1,LPR. */

export type ScrapedCoach = {
  name: string;
  classCode: string;
  positionFromEngine: number;
  sequence: number;
};

export type ScrapedCoachPosition = {
  trainNumber: string;
  trainName: string | null;
  coaches: ScrapedCoach[];
  provider: "web_trainspnrstatus";
  sourceUrl: string;
};

/** Site labels → standard class codes (UNRESERVED → UR). */
function normalizeCoachClass(label: string): string {
  const t = String(label ?? "").trim().toUpperCase();
  if (t === "UNRESERVED" || t === "GEN" || t === "GENERAL") return "UR";
  return t || "??";
}

function parseCoachSpnr(html: string, trainNumber: string): ScrapedCoachPosition | null {
  const coaches: ScrapedCoach[] = [];
  const re =
    /aria-label="Select coach ([A-Z0-9]+)"[\s\S]*?<span class="text-lg">[^<]*<\/span><span class="text-\[10px\][^"]*">([^<]*)<\/span>[\s\S]*?Pos <!-- -->(\d+)<\/div><\/button>/g;
  for (const m of html.matchAll(re)) {
    const pos = Number(m[3]);
    if (!Number.isFinite(pos) || pos < 1) continue;
    coaches.push({ name: m[1], classCode: normalizeCoachClass(m[2]), positionFromEngine: pos, sequence: pos });
  }
  if (!coaches.length) return null;
  coaches.sort((a, b) => a.sequence - b.sequence);
  return {
    trainNumber,
    trainName: trainNameFromHtml(html),
    coaches,
    provider: "web_trainspnrstatus",
    sourceUrl: `https://www.trainspnrstatus.com/train-coach-position/${trainNumber}`,
  };
}

export async function scrapeCoachPositionWeb(trainNumber: string): Promise<ScrapedCoachPosition | null> {
  const num = String(trainNumber ?? "").trim();
  if (!/^\d{4,6}$/.test(num)) return null;
  const html = await fetchHtml(`https://www.trainspnrstatus.com/train-coach-position/${num}`);
  if (!html) return null;
  return parseCoachSpnr(html, num);
}

/** Shared source-label — tools.ts / agentic.ts replies mein lagta hai. */
export function webSourceLabel(provider: string): string {
  const site =
    provider === "web_ixigo"
      ? "ixigo.com"
      : provider === "web_trainspnrstatus"
        ? "trainspnrstatus.com"
        : provider === "web_confirmtkt"
          ? "confirmtkt.com"
          : null;
  return site ? ` (Source: ${site} — railway API se nahi, verified web site se.)` : "";
}
