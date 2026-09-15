/* Round-18m-40 (user: "hubs bhi AI decide kare khud"): connecting-journey ke liye kaunse junctions par
 * change karna sensible hai — ye ab AI chunta hai (railway geography ki samajh se), engine nahi.
 *
 * Flow: engine CANDIDATE hubs banata hai (direct trains ke route ke beech ke junctions + configured
 * major hubs) aur AI ko deta hai: origin, destination, fastest direct time, har candidate ka naam/code,
 * kya wo direct route par padta hai aur kis position par. AI 0–4 hubs lautata hai jinse REAL detour nahi
 * banta (aage nikal kar wapas nahi). Engine sirf unhi par leg-1/leg-2 seat scan karta hai.
 * AI fail/timeout → fallback: route-derived junctions (deterministic, koi guess nahi). */
import { env } from "../env.js";

export type HubCandidate = {
  code: string;
  name: string | null;
  /** direct route par kaunse index par (0 = origin ke baad pehla) — null = route par nahi (fixed list se). */
  onRouteIndex: number | null;
  routeLength: number | null;
  fromFixedList: boolean;
};

export type HubDecision = {
  hubs: string[];
  source: "ai" | "rules";
  model: string | null;
  reason: string | null;
};

const HUB_PRINCIPLES = `You choose CHANGE-OVER stations (hubs) for an Indian Railways connecting journey. You know Indian railway geography.
Rules:
1. ALWAYS return hubs — even when fast direct trains exist. The traveller may not get a seat in their class on the direct train, or the direct timings may not suit them, so connecting options via sensible junctions must be offered too. Return 0 only if literally no candidate is a genuine intermediate point (e.g. adjacent stations).
2. A hub is sensible only if it lies BETWEEN origin and destination along a realistic rail path — never one that forces the traveller to overshoot and come back (Amritsar→Ludhiana via New Delhi is absurd; Amritsar→Ludhiana via Jalandhar City or Phagwara is fine; Ludhiana→Varanasi via New Delhi, Ambala, Lucknow, Kanpur is fine).
3. Prefer big junctions with many trains on BOTH legs. Candidates marked onRoute=true are on the fastest direct train's own route (safe). Fixed-list candidates are big cities that may or may not be on the way — use geography to accept or reject.
4. Return as MANY sensible hubs as exist, up to 6, best first (most trains / most central first). Output ONLY JSON: {"hubs":["CODE",...],"reason":"<one short English sentence>"}. Only codes from the candidate list.`;

let hubFetchImpl: typeof fetch | null = null;
export function setHubFetch(fn: typeof fetch | null): void {
  hubFetchImpl = fn;
}

export async function decideHubsWithAI(args: {
  from: string;
  fromName?: string | null;
  to: string;
  toName?: string | null;
  fastestDirectMinutes: number | null;
  candidates: HubCandidate[];
  timeoutMs?: number;
}): Promise<HubDecision> {
  const routeDerived = args.candidates.filter((c) => c.onRouteIndex != null).map((c) => c.code);
  const fallback: HubDecision = { hubs: routeDerived.slice(0, 6), source: "rules", model: null, reason: routeDerived.length ? "route-derived junctions (AI unavailable)" : "no intermediate junction on the direct route" };
  if (!args.candidates.length) return { hubs: [], source: "rules", model: null, reason: "no candidates" };
  const key = env.nvidiaApiKey;
  if (!key || process.env.VITEST) return fallback;
  const sheet = [
    `ORIGIN ${args.from}${args.fromName ? ` (${args.fromName})` : ""} → DESTINATION ${args.to}${args.toName ? ` (${args.toName})` : ""}.`,
    args.fastestDirectMinutes != null ? `Fastest direct train: ${Math.floor(args.fastestDirectMinutes / 60)}h ${args.fastestDirectMinutes % 60}m.` : "No direct train found.",
    "CANDIDATES (code | name | onRoute | position):",
    ...args.candidates.map((c) => `${c.code} | ${c.name ?? "?"} | ${c.onRouteIndex != null ? "true" : "false (fixed list)"} | ${c.onRouteIndex != null && c.routeLength ? `${c.onRouteIndex + 1}/${c.routeLength}` : "-"}`),
    "Decide now. JSON only.",
  ].join("\n");
  /* Muse primary (project rule), gpt-oss fallback — dono ek hi budget mein. */
  const chain = [env.nvidiaModel, (process.env.NVIDIA_FALLBACK_MODEL ?? "openai/gpt-oss-20b").trim()].filter((m, i, a) => m && a.indexOf(m) === i);
  const perModelMs = args.timeoutMs ?? 40000;
  const askOne = async (model: string): Promise<{ raw: string; model: string } | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perModelMs);
    try {
      const res = await (hubFetchImpl ?? globalThis.fetch.bind(globalThis))(`${env.nvidiaBaseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        signal: controller.signal,
        body: JSON.stringify({ model, temperature: 0.1, max_tokens: 2500, ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}), messages: [{ role: "system", content: HUB_PRINCIPLES }, { role: "user", content: sheet }] }),
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { model?: string; choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[] };
      const raw = String(j.choices?.[0]?.message?.content ?? "") || String(j.choices?.[0]?.message?.reasoning_content ?? "");
      if (process.env.HUB_DEBUG) console.error("[hubs raw]", j.model, raw.slice(-600));
      return raw ? { raw, model: j.model ?? model } : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    let got: { raw: string; model: string } | null = null;
    for (const m of chain) {
      got = await askOne(m);
      if (got && /\{[\s\S]*"hubs"[\s\S]*\}/.test(got.raw)) break;
      got = null;
    }
    if (!got) return fallback;
    const raw = got.raw;
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    let parsed: { hubs?: unknown; reason?: unknown };
    try {
      parsed = JSON.parse(m[0]) as { hubs?: unknown; reason?: unknown };
    } catch {
      parsed = JSON.parse(m[0] + "}") as { hubs?: unknown; reason?: unknown };
    }
    const allowed = new Set(args.candidates.map((c) => c.code.toUpperCase()));
    const hubs = (Array.isArray(parsed.hubs) ? parsed.hubs : [])
      .map((h) => String(h).toUpperCase().trim())
      .filter((h, i, arr) => allowed.has(h) && arr.indexOf(h) === i && h !== args.from && h !== args.to)
      .slice(0, 6);
    if (!hubs.length && routeDerived.length) {
      /* User rule (Round-18m-41): direct ho ya na ho, connecting options hamesha — AI ne 0 diye to route junctions. */
      return { hubs: routeDerived.slice(0, 6), source: "ai", model: got.model, reason: `${typeof parsed.reason === "string" ? parsed.reason.slice(0, 120) + " — " : ""}route junctions rakhe (class/time options ke liye)` };
    }
    return { hubs, source: "ai", model: got.model, reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : null };
  } catch {
    return fallback;
  }
}
