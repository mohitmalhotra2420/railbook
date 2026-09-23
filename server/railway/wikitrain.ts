/**
 * Wikipedia train facts — provider chain sab fail hone par bhi "train kya hai,
 * kahan se kahan jaati hai, kitne din chalti hai" ka VERIFIED reference
 * (Wikipedia ka public REST/search API, koi key nahi).
 *
 * Kab use hota hai:
 *  - `/api/trains/:number/facts` — train ka naam/route/frequency ka reference.
 *  - Provider chain me sabse aakhir (facts-only fallback) — kabhi seat/fare ka
 *    dawa nahi karta; seat data sirf seat-probe sources se aata hai.
 *
 * Honesty: sirf summary text + page URL dete hain; koi number/seat invent nahi.
 */
const UA = "RailBook/1.0 (railway concierge; contact: app)";
const TIMEOUT_MS = 9_000;
const TTL_MS = 24 * 60 * 60_000;

export type WikiTrainFacts = {
  query: string;
  title: string;
  summary: string;
  url: string;
  source: "web_wikipedia";
  fetchedAt: string;
};

let fetchImpl: typeof fetch | null = null;
export function _setWikipediaFetchForTests(fn: typeof fetch | null): void {
  fetchImpl = fn;
}
export function _clearWikipediaCache(): void {
  cache.clear();
}

const cache = new Map<string, { at: number; facts: WikiTrainFacts | null }>();

function doFetch(): typeof fetch {
  return fetchImpl ?? globalThis.fetch.bind(globalThis);
}

type SearchJson = { query?: { search?: { title?: string; snippet?: string }[] } };
type SummaryJson = { title?: string; extract?: string; content_urls?: { desktop?: { page?: string } }; type?: string };

/** Search se best page chuno — train number title me ho to wahi pehle. */
export function pickWikiTitle(trainNumberOrName: string, search: { title?: string; snippet?: string }[]): string | null {
  const num = String(trainNumberOrName).trim();
  const scored = search
    .map((s) => {
      const title = String(s.title ?? "");
      const text = `${title} ${String(s.snippet ?? "")}`.replace(/<[^>]*>/g, "");
      let score = 0;
      if (num && title.includes(num)) score += 4;
      if (num && text.includes(num)) score += 2;
      if (/express|superfast|rajdhani|shatabdi|duronto|intercity|mail/i.test(title)) score += 1;
      return { title, score };
    })
    .filter((s) => s.title && s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.title ?? null;
}

export async function wikipediaTrainFacts(trainNumberOrName: string): Promise<WikiTrainFacts | null> {
  const q = String(trainNumberOrName ?? "").trim();
  if (!q || q.length > 60) return null;
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.facts;
  const facts = await (async (): Promise<WikiTrainFacts | null> => {
    try {
      const searchUrl =
        `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=` +
        encodeURIComponent(`${q} train Indian Railways`);
      const sr = await doFetch()(searchUrl, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!sr.ok) return null;
      const sj = (await sr.json()) as SearchJson;
      const title = pickWikiTitle(q, sj.query?.search ?? []);
      if (!title) return null;
      const sumUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
      const rr = await doFetch()(sumUrl, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!rr.ok) return null;
      const j = (await rr.json()) as SummaryJson;
      const summary = String(j.extract ?? "").trim();
      if (!summary) return null;
      return {
        query: q,
        title: String(j.title ?? title),
        summary,
        url: String(j.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`),
        source: "web_wikipedia",
        fetchedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  })();
  cache.set(key, { at: Date.now(), facts });
  return facts;
}
