/* ── WEB LOOKUP (2026-09-06, user request: "kya hum esko web search scrapping
 * bhi krwayein in case AI or API failed to provide data?")
 * LAST-RESORT fallback: jab railway tools/KB se data na mile YA sawaal
 * general/current railway info ka ho (train services, rules, history, news).
 *
 * Sources (dono keyless JSON, no bot-block):
 *   1. DuckDuckGo Instant Answer API — abstract/answer
 *   2. Wikipedia search + intro extract (en, phir hi) — railway articles
 *
 * SERP scraping (Bing/DDG HTML) try kiya tha par bot-detection par
 * garbage/wrong results deta hai — untrustworthy, isliye drop.
 *
 * SAFETY (prompt rules ke saath): web data ko "web se mila" label ke saath
 * dena hai; live time/fare/seats/availability ya booking decisions par web
 * data KABHI use nahi hota. */

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

const WEB_TIMEOUT_MS = 7000;

/* Tests inject karte hain (railcore/nvidia pattern jaisa). */
let webFetchImpl: typeof fetch | null = null;
export function setWebFetch(fn: typeof fetch | null): void {
  webFetchImpl = fn ?? globalThis.fetch.bind(globalThis);
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await (webFetchImpl ?? globalThis.fetch.bind(globalThis))(url, {
      headers: { "User-Agent": "RailBook/1.0 (+https://github.com/mohitmalhotra2420/railbook; railway assistant)", Accept: "application/json" },
      signal: AbortSignal.timeout(WEB_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function clip(s: string, n: number): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

/** DuckDuckGo Instant Answer — abstract/answer (Wikipedia-sourced mostly). */
async function ddgInstantAnswer(query: string): Promise<WebSearchResult[]> {
  const j = (await fetchJson(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`)) as
    | { Abstract?: string; AbstractText?: string; AbstractURL?: string; Heading?: string; Answer?: string; DefinitionURL?: string }
    | null;
  if (!j) return [];
  const out: WebSearchResult[] = [];
  const abstract = clip(j.AbstractText || j.Abstract || "", 300);
  if (abstract) {
    out.push({
      title: clip(j.Heading || query, 100),
      url: j.AbstractURL || j.DefinitionURL || "https://duckduckgo.com",
      snippet: abstract,
    });
  }
  if (j.Answer && !abstract) {
    out.push({ title: clip(query, 100), url: "https://duckduckgo.com", snippet: clip(j.Answer, 200) });
  }
  return out;
}

/** Wikipedia search + intro extract (lang = "en" | "hi"). */
async function wikipediaLookup(query: string, lang: "en" | "hi"): Promise<WebSearchResult[]> {
  const base = `https://${lang}.wikipedia.org/w/api.php`;
  const search = (await fetchJson(
    `${base}?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3&origin=*`,
  )) as { query?: { search?: { title: string; snippet?: string }[] } } | null;
  const hits = search?.query?.search ?? [];
  if (!hits.length) return [];
  const out: WebSearchResult[] = [];
  /* Sabhi titles ka intro extract ek hi call mein */
  const titles = hits.map((h) => h.title).join("|");
  const extracts = (await fetchJson(
    `${base}?action=query&prop=extracts&exintro=1&explaintext=1&exsectionformat=plain&titles=${encodeURIComponent(titles)}&format=json&origin=*`,
  )) as { query?: { pages?: Record<string, { title?: string; extract?: string; fullurl?: string } | undefined> } } | null;
  const pages = extracts?.query?.pages ?? {};
  const byTitle = new Map<string, { title?: string; extract?: string }>();
  for (const p of Object.values(pages)) {
    if (p?.title) byTitle.set(p.title, p);
  }
  for (const h of hits) {
    const ex = byTitle.get(h.title);
    const snippet = clip(ex?.extract || h.snippet || "", 300);
    if (!snippet) continue;
    out.push({
      title: clip(h.title, 100),
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`,
      snippet,
    });
  }
  return out;
}

/** Web lookup — DDG IA + Wikipedia (en→hi). Timeout/parse-fail = [] honest empty. */
export async function webSearch(query: string, limit = 4): Promise<WebSearchResult[]> {
  const q = query.trim().slice(0, 200);
  if (!q) return [];
  /* Wikipedia PEHLE (datacenter IPs se reliable), DDG baad mein — prod logs:
   * DDG Render se TimeoutError deta hai, Wikipedia chalta hai. */
  const wikiEn = await wikipediaLookup(q, "en");
  let results = [...wikiEn];
  if (!results.length) {
    const [ddg, wikiHi] = await Promise.all([ddgInstantAnswer(q), wikipediaLookup(q, "hi")]);
    results = [...wikiHi, ...ddg];
  }
  /* Dedupe by URL */
  const seen = new Set<string>();
  const out: WebSearchResult[] = [];
  for (const r of results) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/* ── WIKIPEDIA PAGE-SCRAPE (user request 2026-09-06: "ChatGPT jaisa —
 * question ke according different websites khud se scrape karo"). Har
 * popular train ka Wikipedia page hota hai (e.g. "Haridwar–Amritsar Jan
 * Shatabdi Express") jisme speed/rake/history/slip-coach saari details
 * hoti hain. Ye search-query se page dhoondh kar POORA extract (full
 * page text) laata hai — snippet se kaafi zyada. */

export type WikipediaPage = {
  title: string;
  url: string;
  extract: string;
};

export async function findWikipediaPage(query: string, mustInclude?: string): Promise<WikipediaPage | null> {
  const q = query.trim().slice(0, 160);
  if (!q) return null;
  const base = "https://en.wikipedia.org/w/api.php";
  const search = (await fetchJson(
    `${base}?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=3&origin=*`,
  )) as { query?: { search?: { title: string }[] } } | null;
  const hits = search?.query?.search ?? [];
  if (!hits.length) return null;
  for (const hit of hits) {
    const extracts = (await fetchJson(
      `${base}?action=query&prop=extracts&explaintext=1&exsectionformat=plain&titles=${encodeURIComponent(hit.title)}&format=json&origin=*`,
    )) as { query?: { pages?: Record<string, { title?: string; extract?: string; fullurl?: string } | undefined> } } | null;
    const page = Object.values(extracts?.query?.pages ?? {})[0];
    const extract = String(page?.extract ?? "").trim();
    if (extract.length > 150) {
      /* mustInclude (jaise train number) na ho to GALAT page hai — next hit
       * try karo ("Hw Janshatabdi" search mein pehli hit Una-Link aati hai,
       * asli Amritsar-Haridwar page 2nd par hoti hai). */
      if (mustInclude && !extract.includes(mustInclude)) continue;
      return {
        title: page?.title ?? hit.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent((page?.title ?? hit.title).replace(/ /g, "_"))}`,
        extract,
      };
    }
  }
  return null;
}

/* ── WIKIPEDIA TABLE EXTRACT (round-4: ChatGPT-jaisa "har cheez ka jawab").
 * Superlative sawaal ("sabse lambi train kaunsi hai") ka jawab list-pages
 * (Longest train services of Indian Railways) ke TABLE mein hota hai —
 * explaintext tables strip kar deta hai. Wikitext parse karke top rows
 * laate hain. */

export type WikiTable = { title: string; url: string; rows: string[][] };

export async function wikiTableForPage(title: string): Promise<WikiTable | null> {
  const base = "https://en.wikipedia.org/w/api.php";
  const wt = (await fetchJson(
    `${base}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&origin=*`,
  )) as { parse?: { wikitext?: { "*": string } } } | null;
  const text = String(wt?.parse?.wikitext?.["*"] ?? "");
  if (!text) return null;
  const i = text.indexOf("{|");
  if (i < 0) return null;
  const end = text.indexOf("\n|}", i);
  const table = text.slice(i, end > 0 ? end : undefined);
  const clean = (s: string) =>
    s
      .replace(/\[\[(?:[^\]|]*\|)?([^\]|]+)\]\]/g, "$1")
      .replace(/\{\{[^{}]*\}\}/g, " ")
      .replace(/<br\s*\/?>/gi, " — ")
      .replace(/<[^>]+>/g, " ")
      .replace(/'''?/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  const rows: string[][] = [];
  for (const chunk of table.split(/\n\|-/)) {
    const cells: string[] = [];
    for (const line of chunk.split("\n")) {
      if (line.startsWith("!") || line.startsWith("|")) {
        const c = clean(line.replace(/^[!|]/, ""));
        if (c) cells.push(c);
      }
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return null;
  return {
    title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    rows,
  };
}
