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
 * LIVE STATUS (2026-09-06, user ne booking-critical scraping bhi authorize ki):
 *   - railyatri.in/live-train-status/<num>-<name> (SSR __NEXT_DATA__.ltsData —
 *     NTES-based: current station, delay, ETA, upcoming stations)
 *   NOTE: fare/seat-availability ke liye abhi koi publicly accessible SSR
 *   source nahi mila (ConfirmTkt 404-shell, ixigo/trainspnrstatus 403,
 *   RailYatri availability client-side API auth-dependent) — wo sirf API se.
 *
 * Bot-block/parse-change par null/[] — honest empty, koi crash nahi. */

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
    const host = (() => {
      try {
        return new URL(String(url)).hostname;
      } catch {
        return "";
      }
    })();
    /* Full browser fingerprint — kuch CDNs (trainspnrstatus) incomplete
     * headers par 403 dete hain. Referer host ka khud ka page hai. */
    const res = await (scrapeFetchImpl ?? globalThis.fetch.bind(globalThis))(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        Referer: "https://" + host + "/",
      },
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
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
          : provider === "web_railyatri"
            ? "railyatri.in"
            : provider === "web_railenquiry"
              ? "railenquiry.in"
              : provider === "web_erail"
                ? "erail.in"
                : null;
  return site ? ` (Source: ${site} — railway API se nahi, verified web site se.)` : "";
}

/* ── LIVE STATUS via RailYatri SSR (user-authorized booking-critical scrape,
 * 2026-09-06). Page /live-train-status/<num>-<name> poora __NEXT_DATA__
 * embed karta hai jisme pageProps.ltsData = NTES-based live position hai:
 * delay, current station, eta/etd, upcoming_stations, update_time. */

export type ScrapedLiveStatus = {
  trainNumber: string;
  trainName: string;
  status: string;
  delayMinutes: number | null;
  lastUpdatedAt: string | null;
  currentStation: string | null;
  nextStation: string | null;
  journeyDate: string | null;
  provider: "web_railyatri" | "web_railenquiry";
  sourceUrl: string;
};

type LtsData = {
  success?: boolean;
  train_number?: string;
  train_name?: string;
  delay?: number;
  update_time?: string;
  current_station_code?: string;
  current_station_name?: string;
  at_src?: boolean;
  at_dstn?: boolean;
  ahead_distance_text?: string;
  title?: string;
  new_message?: string;
  awaiting_update?: boolean;
  next_station_code?: string;
  next_station_name?: string;
  eta?: string;
  etd?: string;
  status?: string;
  train_start_date?: string;
  upcoming_stations?: { station_code?: string; station_name?: string; eta?: string }[];
};

function parseNextData(html: string): Record<string, unknown> | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    /* malformed JSON — parse fail, honest null */
  }
  return null;
}

export function parseRailYatriLive(html: string, trainNumber: string, sourceUrl: string): ScrapedLiveStatus | null {
  const root = parseNextData(html);
  if (!root) return null;
  const props = root.props as Record<string, unknown> | undefined;
  const pageProps = props?.pageProps as Record<string, unknown> | undefined;
  const lts = pageProps?.ltsData as LtsData | undefined;
  if (!lts || lts.success !== true) return null;
  const delay = typeof lts.delay === "number" ? lts.delay : null;
  const currentName = String(lts.current_station_name ?? "").replace(/~+$/, "").trim();
  const currentCode = String(lts.current_station_code ?? "").trim();
  const upcoming = Array.isArray(lts.upcoming_stations) ? lts.upcoming_stations : [];
  const next = upcoming[0];
  const nextLabel = next
    ? `${String(next.station_name ?? "").replace(/~+$/, "").trim() || next.station_code || ""}${next.eta ? ` (${next.eta})` : ""}`.trim()
    : null;
  /* "Train starts at 17:00" (12951 jab tak start na ho) jaise short-form
   * payloads: position fields nahi hote, title/new_message/next_station
   * hi asli live info hai — reject mat karo. */
  const title = String(lts.title ?? "").trim();
  const msg = String(lts.new_message ?? "").trim();
  const nextFallback = String(lts.next_station_name ?? lts.next_station_code ?? "").replace(/~+$/, "").trim();
  if (!currentName && !currentCode && delay === null && upcoming.length === 0 && !title && !nextFallback) return null;
  const status = lts.at_dstn
    ? "Journey completed"
    : title
      ? msg ? `${title} — ${msg}` : title
      : lts.status === "T" && currentName
        ? `Running — near ${currentName}${lts.ahead_distance_text ? `, ${lts.ahead_distance_text}` : ""}`
        : lts.status === "A" && currentName
          ? `At ${currentName}`
          : lts.status === "S" || (lts.at_src && !currentName)
            ? "At source"
            : String(lts.status ?? "").trim() || "Running";
  return {
    trainNumber: String(lts.train_number ?? trainNumber),
    trainName: String(lts.train_name ?? "").trim(),
    status,
    delayMinutes: delay,
    lastUpdatedAt: String(lts.update_time ?? "").trim() || null,
    currentStation: currentName || currentCode || null,
    nextStation: nextLabel || nextFallback || null,
    journeyDate: String(lts.train_start_date ?? "").trim() || null,
    provider: "web_railyatri",
    sourceUrl,
  };
}

/** URL pattern: /live-train-status/<num>-<name-slug> — naam approximate bhi
 * chalta hai (server number se match karta hai), par bilkul naam ke bina 404. */
export async function scrapeLiveStatusWeb(trainNumber: string, trainName?: string | null): Promise<ScrapedLiveStatus | null> {
  const num = String(trainNumber ?? "").trim();
  if (!/^\d{4,6}$/.test(num)) return null;
  /* Round-16b: RailYatri sirf number se route karta hai — slug koi bhi chale
   * (verified 2026-09-07: /12904-x → same __NEXT_DATA__). Naam optional. */
  const name = String(trainName ?? "").trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-") || "train";
  const sourceUrl = `https://www.railyatri.in/live-train-status/${num}-${name}`;
  const html = await fetchHtml(sourceUrl);
  if (!html) return null;
  return parseRailYatriLive(html, num, sourceUrl);
}


/* ── RAILENQUIRY.IN LIVE STATUS (round-6, NTES-question se nikla discovery):
 * enquiry.indianrail.gov.in (NTES) datacenter IPs par firewall-level drop
 * karta hai (TLS handshake hi nahi hota) — anti-bot evasion nahi karenge.
 * railenquiry.in usi enquiry-data ka SSR mirror hai: number-only URL
 * (/runningstatus/12958 — trainName hint ki zaroorat NAHI), plain HTML mein
 * "+7 Mins Late · RUNNING · KHALILPUR · Departed from X(CODE) at HH:MM". */

export function parseRailEnquiryLive(html: string, trainNumber: string, sourceUrl: string): ScrapedLiveStatus | null {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n");
  const lines = text
    .split("\n")
    .map((l) => l.replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const hay = lines.join(" | ");

  /* Train naam: <title>12958 Swrn J Rajdhani Live Train Running Status</title> */
  const title = (/\<title\>\s*([\s\S]+?)\<\/title\>/i.exec(html)?.[1] ?? "").trim();
  const tm = new RegExp(`^\\s*${trainNumber}\\s+(.+?)\\s+Live Train Running Status\\s*$`, "i").exec(title);
  const trainName = tm ? tm[1].trim() : `Train ${trainNumber}`;

  const delayM = /([+-]?\d+)\s*Mins\s*Late/i.exec(hay);
  const onTime = /\bOn Time\b/i.test(hay);
  const delayMinutes = delayM ? Number(delayM[1].replace("+", "")) : onTime ? 0 : null;

  const runM = /RUNNING\s*·\s*([A-Za-z .'-]+)/i.exec(hay);
  const depM = /Departed from ([A-Za-z .'-]+?)\s*\(([A-Z]{2,10})\)\s*at\s*(\d{1,2}:\d{2})\s*([\d]{2}-\w{3})/i.exec(hay);
  const arrM = /Arrived at ([A-Za-z .'-]+?)\s*\(([A-Z]{2,10})\)/i.exec(hay);
  const currentStation = depM ? depM[1].trim() : arrM ? arrM[1].trim() : runM ? runM[1].trim() : null;

  let status: string | null = null;
  if (depM) status = `Departed from ${depM[1].trim()} (${depM[2]}) at ${depM[3]} ${depM[4]}`;
  else if (arrM) status = `Arrived at ${arrM[1].trim()} (${arrM[2]})`;
  else if (runM) status = `Running · ${runM[1].trim()}`;
  else if (onTime) status = "On time";
  if (!status && delayMinutes == null) return null;

  return {
    trainNumber,
    trainName,
    status: status ?? `${delayMinutes} mins late`,
    delayMinutes,
    lastUpdatedAt: depM ? `${depM[3]} ${depM[4]}` : null,
    currentStation,
    nextStation: null,
    journeyDate: null,
    provider: "web_railenquiry",
    sourceUrl,
  };
}

export async function scrapeLiveStatusRailEnquiry(trainNumber: string): Promise<ScrapedLiveStatus | null> {
  const num = String(trainNumber ?? "").trim();
  if (!/^\d{4,6}$/.test(num)) return null;
  const sourceUrl = `https://railenquiry.in/runningstatus/${num}`;
  const html = await fetchHtml(sourceUrl);
  if (!html) return null;
  return parseRailEnquiryLive(html, num, sourceUrl);
}

/* ------------------------------------------------------------------ */
/* Round-7 (2026-09-06): FARE web-fallback — erail.in/train-fare/{num} */
/* ------------------------------------------------------------------ */
/* erail ka fare page poora SSR deta hai — classes header + quota rows:
 *   ROW ['', 'CC', '2S', 'GN']            ← classes (last col kabhi quota-tag)
 *   ROW ['General', '650', '205', '140']
 *   ROW ['Tatkal', '825', '220', '-']
 * Sirf known IR classes hi columns maante hain ('GN' jaise tags skip).
 * Availability numbers erail/confirmTkt/sab mirrors client-side (auth API)
 * se laate hain — SSR availability source exist nahi karta (round-7 research). */

export type ScrapedFareClass = {
  code: string;
  general: number | null;
  tatkal: number | null;
};

export type ScrapedFare = {
  trainNumber: string;
  classes: ScrapedFareClass[];
  provider: "web_erail";
  sourceUrl: string;
};

const KNOWN_IR_CLASSES = new Set(["1A", "2A", "3A", "3E", "SL", "CC", "EC", "2S", "EA"]);

function parseFareCell(raw: string): number | null {
  const cleaned = raw.replace(/[₹,\s]/g, "");
  if (!cleaned || cleaned === "-") return null;
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseErailFare(html: string, trainNumber: string, sourceUrl: string): ScrapedFare | null {
  /* Round-7b: erail ka fare-table layout vary karta hai — Render body mein
   * fare-classes table "Total fare for" marker ke BAAD aati hai, sandbox body
   * mein PEHLE. Isliye marker sirf page-confirm ke liye, fare-table dhoondhne
   * ke liye saari tables scan — jo General/Tatkal + class-header de wahi. */
  if (!html.includes("Total fare for")) return null;
  const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].map((m) => m[1]);

  for (const tbl of tables) {
    const rows = [...tbl.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((rm) =>
        [...rm[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cm) =>
          cm[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(),
        ),
      )
      .filter((cells) => cells.length > 0);
    if (rows.length === 0) continue;

    /* Header row: pehla cell khali/label, baaki sab short uppercase tokens. */
    const header = rows.find((cells) => {
      if (cells.length < 2) return false;
      const rest = cells.slice(1);
      return rest.length >= 1 && rest.every((c) => /^[A-Z0-9]{1,3}$/.test(c));
    });
    if (!header) continue;

    const classCols: { index: number; code: string }[] = [];
    header.slice(1).forEach((code, i) => {
      if (KNOWN_IR_CLASSES.has(code)) classCols.push({ index: i + 1, code });
    });
    if (classCols.length === 0) continue;

    const quotaRow = (label: string): string[] | null =>
      rows.find((cells) => cells[0]?.toLowerCase() === label) ?? null;
    const general = quotaRow("general");
    const tatkal = quotaRow("tatkal");
    if (!general && !tatkal) continue;

    const classes: ScrapedFareClass[] = classCols.map(({ index, code }) => ({
      code,
      general: general ? parseFareCell(general[index] ?? "") : null,
      tatkal: tatkal ? parseFareCell(tatkal[index] ?? "") : null,
    }));
    /* Kisi bhi class mein fare na mile to ye table fare-table nahi. */
    if (classes.some((c) => c.general != null || c.tatkal != null)) {
      return { trainNumber, classes, provider: "web_erail", sourceUrl };
    }
  }
  return null;
}

export async function scrapeTrainFareWeb(trainNumber: string): Promise<ScrapedFare | null> {
  const num = String(trainNumber ?? "").trim();
  if (!/^\d{4,6}$/.test(num)) return null;
  const sourceUrl = `https://erail.in/train-fare/${num}`;
  const html = await fetchHtml(sourceUrl);
  if (!html) return null;
  return parseErailFare(html, num, sourceUrl);
}

/* ------------------------------------------------------------------ */
/* Round-7: STATION-LOOKUP web-fallback — railenquiry.in/station/{CODE} */
/* ------------------------------------------------------------------ */
/* Title format: "<title>{Name} ({CODE}) Railway Station</title>" (SSR). */

export type ScrapedStation = {
  code: string;
  name: string;
  city: string;
  provider: "web_railenquiry" | "web_erail";
  sourceUrl: string;
};

export function parseRailEnquiryStation(html: string, code: string, sourceUrl: string): ScrapedStation | null {
  const m = html.match(/<title>([^<]{2,80}?)\s*\(([A-Za-z]{2,5})\)\s*Railway\s+Station<\/title>/i);
  if (!m) return null;
  const name = m[1].replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  if (!name || /^railway/i.test(name)) return null;
  if (m[2].toUpperCase() !== code.toUpperCase()) return null;
  return { code: code.toUpperCase(), name, city: name, provider: "web_railenquiry", sourceUrl };
}

export async function scrapeStationLookupWeb(code: string): Promise<ScrapedStation | null> {
  const c = String(code ?? "").trim();
  if (!/^[A-Za-z]{2,5}$/.test(c)) return null;
  const sourceUrl = `https://railenquiry.in/station/${c.toUpperCase()}`;
  const html = await fetchHtml(sourceUrl);
  if (html) {
    const parsed = parseRailEnquiryStation(html, c, sourceUrl);
    if (parsed) return parsed;
  }
  /* Round-16b: railenquiry.in Render (datacenter) IP se block hai — erail ki
   * full station list se exact code match (same list jo name-search use karti hai). */
  const list = await erailStationList();
  const hit = list.find((s) => s.code === c.toUpperCase());
  if (!hit) return null;
  return {
    code: hit.code,
    name: hit.name,
    city: hit.name.replace(/\s+(Jn|Junction|Cantt|City|Terminus|Central|Town|Road|Halt|H)$/i, "").trim() || hit.name,
    provider: "web_erail",
    sourceUrl: "https://erail.in/",
  };
}

/* ── SEAT AVAILABILITY via RailYatri SA JSON (Round-16, user request
 * 2026-09-07: "api fail ho jaaye to seat availability ... web se scrape").
 * railyatri.in ka seat-availability page client-side jo endpoint call
 * karta hai (sa.railyatri.in/api/v3/seat/availability/<train>/<date>/
 * <from>/<to>/<class>/<quota>.json) — keyless, IRCTC-sourced (cached,
 * `last_updated_at` ke saath). 6 din ki rows aati hain; hum maangi hui
 * date ki row lete hain. Status text "AVAILABLE-0288" / "RAC 12" /
 * "GNWL45/WL20" / "REGRET" / "NOT AVAILABLE" / "TRAIN DEPARTED". */

export type ScrapedSeatAvailability = {
  trainNumber: string;
  date: string; // YYYY-MM-DD
  classCode: string;
  quota: string;
  statusText: string; // raw IRCTC-style string
  status: "AVAILABLE" | "RAC" | "WAITLIST" | "NOT_AVAILABLE" | "UNKNOWN";
  seats: number | null;
  rac: number | null;
  waitlist: number | null;
  ticketFare: number | null;
  totalFare: number | null;
  lastUpdatedAt: string | null;
  cacheText: string | null;
  provider: "web_railyatri";
  sourceUrl: string;
};

export function parseIrctcAvailabilityText(raw: string): Pick<ScrapedSeatAvailability, "status" | "seats" | "rac" | "waitlist"> {
  const t = String(raw ?? "").trim().toUpperCase();
  const num = (re: RegExp) => {
    const m = t.match(re);
    return m ? Number(m[1]) : null;
  };
  if (/^(AVAILABLE|AVL|CURR_AVBL)/.test(t)) return { status: "AVAILABLE", seats: num(/(\d+)/), rac: null, waitlist: null };
  if (/^RAC/.test(t)) return { status: "RAC", seats: null, rac: num(/RAC\s*-?\s*(\d+)/), waitlist: null };
  if (/WL\s*-?\s*\d+/.test(t) || /^(GNWL|RLWL|PQWL|TQWL|RSWL|RQWL|CKWL)/.test(t)) {
    /* "GNWL45/WL20" — current WL (second number) hi user ke liye matter karta hai. */
    const all = [...t.matchAll(/WL\s*-?\s*(\d+)/g)].map((m) => Number(m[1]));
    return { status: "WAITLIST", seats: null, rac: null, waitlist: all.length ? all[all.length - 1] : null };
  }
  if (/REGRET|NOT AVAILABLE|TRAIN DEPARTED|CHARTING DONE|CLASS NOT EXIST|NOT_AVAILABLE/.test(t)) {
    return { status: "NOT_AVAILABLE", seats: 0, rac: null, waitlist: null };
  }
  return { status: "UNKNOWN", seats: null, rac: null, waitlist: null };
}

const SA_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function ryDateKey(ymd: string): string {
  /* API rows "8-9-2026" (D-M-YYYY, no padding) dete hain. */
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  return `${Number(m[3])}-${Number(m[2])}-${m[1]}`;
}

export async function scrapeSeatAvailabilityWeb(
  trainNumber: string,
  dateYmd: string,
  from: string,
  to: string,
  classCode: string,
  quota = "GN",
): Promise<ScrapedSeatAvailability | null> {
  const num = String(trainNumber).trim();
  if (!/^\d{5}$/.test(num) || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;
  const f = String(from).toUpperCase();
  const t = String(to).toUpperCase();
  const c = String(classCode).toUpperCase();
  const q = String(quota || "GN").toUpperCase();
  const url =
    `https://sa.railyatri.in/api/v3/seat/availability/${num}/${dateYmd}/${f}/${t}/${c}/${q}.json` +
    `?device_type_id=6&utm_source=dweb_sa&user_id=-2345434&authentication_token=&train_search=true&train_source=${f}&train_destination=${t}`;
  try {
    const res = await (scrapeFetchImpl ?? globalThis.fetch.bind(globalThis))(url, {
      headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.railyatri.in/" },
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      success?: boolean;
      error?: string | null;
      seat_availibility?: {
        availablity_date?: string;
        availablity_status?: string;
        seat_avl?: number | null;
        ticket_fare?: number | null;
        total_fare?: number | null;
        last_updated_at?: string | null;
        cache_text?: string | null;
      }[];
    } | null;
    const rows = j?.seat_availibility ?? [];
    if (!j?.success || !rows.length) return null;
    const want = ryDateKey(dateYmd);
    const row = rows.find((r) => String(r.availablity_date ?? "").trim() === want) ?? null;
    if (!row) return null;
    const statusText = String(row.availablity_status ?? "").trim();
    if (!statusText) return null;
    const parsed = parseIrctcAvailabilityText(statusText);
    if (parsed.status === "UNKNOWN") return null;
    /* FRESHNESS guard: RailYatri cache purana ho sakta hai ("As of 16 days
     * ago" dekha) — booking-critical data 24h se purana kabhi nahi dete;
     * stale = null (honest UNKNOWN upar). Timestamp parse na ho to bhi null. */
    const updatedMs = Date.parse(String(row.last_updated_at ?? "").replace(" +0530", "+05:30").replace(" ", "T"));
    if (!Number.isFinite(updatedMs) || Date.now() - updatedMs > SA_MAX_AGE_MS) return null;
    /* Journey date beet chuki ho to bhi nahi. */
    if (Date.parse(`${dateYmd}T23:59:59+05:30`) < Date.now()) return null;
    const seats = parsed.status === "AVAILABLE" && typeof row.seat_avl === "number" ? row.seat_avl : parsed.seats;
    return {
      trainNumber: num,
      date: dateYmd,
      classCode: c,
      quota: q,
      statusText,
      status: parsed.status,
      seats,
      rac: parsed.rac,
      waitlist: parsed.waitlist,
      ticketFare: typeof row.ticket_fare === "number" ? row.ticket_fare : null,
      totalFare: typeof row.total_fare === "number" ? row.total_fare : null,
      lastUpdatedAt: row.last_updated_at ?? null,
      cacheText: row.cache_text ?? null,
      provider: "web_railyatri",
      sourceUrl: `https://www.railyatri.in/seat-availability/${num}`,
    };
  } catch {
    return null;
  }
}

/* ── STATION NAME SEARCH via erail.in station list (Round-16). erail.in
 * apni site ke liye poori ~9000-station "CODE,Name,CODE,Name…" list
 * (/js/cmp/stations.js) serve karta hai — local DB (~70 stations) aur
 * railenquiry (sirf code→name) ke baad NAME-search ke liye yahi last
 * resort. Ek baar fetch, 6 ghante memory cache. */

let erailStationsCache: { at: number; list: { code: string; name: string }[] } | null = null;
const ERAIL_STATIONS_TTL_MS = 6 * 60 * 60 * 1000;

export async function erailStationList(): Promise<{ code: string; name: string }[]> {
  if (erailStationsCache && Date.now() - erailStationsCache.at < ERAIL_STATIONS_TTL_MS) return erailStationsCache.list;
  const html = await fetchHtml("https://erail.in/js/cmp/stations.js?v=092f8");
  if (!html) return erailStationsCache?.list ?? [];
  const m = html.match(/StationsData\s*=\s*"([^"]+)"/);
  if (!m) return erailStationsCache?.list ?? [];
  const parts = m[1].split(",");
  const list: { code: string; name: string }[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const code = parts[i].trim();
    const name = parts[i + 1].trim();
    if (/^[A-Z]{1,5}$/.test(code) && name && !/^\d+$/.test(name)) list.push({ code, name });
  }
  if (list.length > 1000) erailStationsCache = { at: Date.now(), list };
  return list;
}

export function _setErailStationsCacheForTests(list: { code: string; name: string }[] | null): void {
  erailStationsCache = list ? { at: Date.now(), list } : null;
}

/** Name/code search — exact code, phir name-prefix, phir name-contains.
 * "Jn"/"Junction" normalize. Max `limit` results. */
export async function scrapeStationSearchWeb(query: string, limit = 6): Promise<ScrapedStation[]> {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (q.length < 2) return [];
  const list = await erailStationList();
  if (!list.length) return [];
  const norm = (n: string) => n.toLowerCase().replace(/\bjn\b/g, "junction").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const qn = norm(q);
  const scored: { s: { code: string; name: string }; score: number }[] = [];
  for (const s of list) {
    const n = norm(s.name);
    let score = 0;
    if (s.code.toLowerCase() === q) score = 100;
    else if (n === qn) score = 90;
    else if (n.startsWith(qn + " ")) score = 80;
    else if (n.startsWith(qn)) score = 70;
    else if (new RegExp(`\\b${qn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(n)) score = 50;
    if (score) scored.push({ s, score });
  }
  scored.sort((a, b) => b.score - a.score || a.s.name.length - b.s.name.length);
  return scored.slice(0, limit).map(({ s }) => ({
    code: s.code,
    name: s.name,
    city: s.name.replace(/\s+(Jn|Junction|Cantt|City|Terminus|Central|Town|Road|Halt|H)$/i, "").trim() || s.name,
    provider: "web_erail",
    sourceUrl: "https://erail.in/",
  }));
}

/* ───────────────────────── Round-16n: trains-between-stations (web) ─────────────────────────
 * User (2026-09-08): "RailCore daily limit hit → fallback par bhi trains nahi
 * dikh rahi, web scraping lagayi thi na?" — train SEARCH ka web fallback tha
 * hi nahi (sirf schedule/fare/availability/live ka tha). erail.in ka public
 * getTrains endpoint '~'-delimited rows deta hai: number, name, src/dst,
 * boarding FROM/TO code (exact — DLI vs NDLS alag), dep, arr, duration
 * (HH.MM, 24h+ bhi), 7-char running-days bitmask (Mon..Sun), aur class list. */
export type ScrapedTrainRow = {
  number: string;
  name: string;
  fromCode: string;
  fromName: string;
  toCode: string;
  toName: string;
  departure: string; // HH:MM
  arrival: string; // HH:MM
  durationMinutes: number;
  runsOn: number[]; // JS getDay(): 0=Sun..6=Sat
  classes: string[];
  type: string;
};

export type ScrapedTrainSearch = {
  trains: ScrapedTrainRow[];
  provider: "web_erail";
  sourceUrl: string;
};

function erailTime(raw: string): string | null {
  const m = String(raw ?? "").match(/^(\d{1,2})\.(\d{2})$/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function erailDuration(raw: string): number | null {
  const m = String(raw ?? "").match(/^(\d{1,3})\.(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** erail bitmask: 7 chars Mon..Sun → JS days (0=Sun). */
function erailDays(mask: string): number[] {
  const m = String(mask ?? "").trim();
  if (!/^[01]{7}$/.test(m)) return [0, 1, 2, 3, 4, 5, 6];
  const out: number[] = [];
  for (let i = 0; i < 7; i++) if (m[i] === "1") out.push((i + 1) % 7);
  return out.length ? out : [0, 1, 2, 3, 4, 5, 6];
}

export function parseErailTrainList(text: string): ScrapedTrainRow[] {
  const rows = String(text ?? "")
    .split("^")
    .map((r) => r.trim())
    .filter(Boolean);
  const out: ScrapedTrainRow[] = [];
  for (const row of rows) {
    const f = row.split("~");
    if (f.length < 14) continue;
    const number = f[0].trim();
    if (!/^\d{5}$/.test(number)) continue;
    const dep = erailTime(f[10]);
    const arr = erailTime(f[11]);
    const dur = erailDuration(f[12]);
    if (!dep || !arr || dur == null) continue;
    const classField = f.find((x) => /^(?:[A-Z0-9]{2}:[^|]*\|)+$/.test(x)) ?? "";
    const classes = [...classField.matchAll(/(?:^|\|)([A-Z0-9]{2}):/g)].map((m) => m[1]);
    const type = f.find((x) => /^(SUPERFAST|MAIL_EXPRESS|SHATABDI|RAJDHANI|COMPOSITE|RAIL_MOTOR|DURONTO|GARIB_RATH|VANDE_BHARAT|PASSENGER|MEMU|DEMU)$/.test(x)) ?? "Express";
    out.push({
      number,
      name: f[1].trim(),
      fromCode: f[7].trim().toUpperCase(),
      fromName: f[6].trim(),
      toCode: f[9].trim().toUpperCase(),
      toName: f[8].trim(),
      departure: dep,
      arrival: arr,
      durationMinutes: dur,
      runsOn: erailDays(f[13]),
      classes,
      type,
    });
  }
  return out;
}

export async function scrapeTrainsBetweenWeb(from: string, to: string): Promise<ScrapedTrainSearch | null> {
  const f = String(from ?? "").trim().toUpperCase();
  const t = String(to ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2,5}$/.test(f) || !/^[A-Z]{2,5}$/.test(t)) return null;
  const url = `https://erail.in/rail/getTrains.aspx?Station_From=${f}&Station_To=${t}&DataSource=0&Language=0&Cache=true`;
  const body = await fetchHtml(url);
  if (!body) return null;
  const trains = parseErailTrainList(body);
  if (!trains.length) return null;
  return { trains, provider: "web_erail", sourceUrl: url };
}
