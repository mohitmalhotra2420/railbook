/* Web/data provider preference — SERVER side (26 Sep 2026).
 *
 * User (26 Sep 2026, Round-33): "first use confirm tkt, then rail yatri, then e rail on API
 * fallback to fetch relevant data, like fare, seat availability, timings, route, station codes,
 * live status, etc. depends on user question… don't fake anything sab real and live data hona chahiye."
 *
 * Ye module sirf PREFERENCE rakhta hai (koi call nahi karta): jab primary railway APIs (RailCore /
 * RailKit / RailRadar / IndianRailAPI) data na dein, to web fallback isi order me try hota hai —
 *   1) confirmtkt.com   (2) railyatri.in   (3) erail.in
 * Har capability ke liye chain wahi hai, par sirf wahi sites jinko wo cheez WAQAI deti hai
 * (jo site capability support nahi karti wo chain me aati hi nahi — jhootha attempt nahi).
 *
 * Pure + tested: order badalna ho to sirf WEB_PROVIDER_ORDER badlo, poori chain follow karti hai.
 */

export const WEB_PROVIDER_ORDER = ["web_confirmtkt", "web_railyatri", "web_erail"] as const;

export type WebProviderId = (typeof WEB_PROVIDER_ORDER)[number];

export type WebCapability =
  | "availability" /* per train+class seat/status (+fare) */
  | "fare" /* per train+class fare */
  | "trains-between" /* route ka train list: timings + classes + fare */
  | "schedule" /* stops/route + timings */
  | "station" /* station code / naam lookup */
  | "live"; /* live running status */

/** Har capability me kaun-kaun si site WAQAI data deti hai (baaki chain se bahar). */
export const WEB_CAPABILITY_SUPPORT: Record<WebCapability, WebProviderId[]> = {
  /* ConfirmTkt route board = status + seats/WL/RAC + fare per class; RailYatri SA = wahi (IRCTC data);
   * erail ke paas seat/status nahi — sirf fare, isliye availability chain me wo aakhir me (fare-only row). */
  availability: ["web_confirmtkt", "web_railyatri", "web_erail"],
  /* ConfirmTkt board me fare hota hai, RailYatri SA me ticket fare, erail fare page (segment-aware). */
  fare: ["web_confirmtkt", "web_railyatri", "web_erail"],
  /* ConfirmTkt route board = poora route: trains + departure/arrival + classes + fare.
   * RailYatri ke paas trains-between ka web endpoint nahi hai (chain me nahi).
   * erail trains-between list (IRCTC timetable data) — timings + classes (fare nahi). */
  "trains-between": ["web_confirmtkt", "web_erail"],
  /* ConfirmTkt train-schedule (code|arrival|departure rows) pehle, phir baaki scrapers. */
  schedule: ["web_confirmtkt", "web_erail"],
  /* Station code/naam: erail ki full station list (railenquiry code-lookup isse pehle chalta hai,
   * wo provider key "none"/routenri ye module ke bahar hai — yahan sirf web sites ki baat hai). */
  station: ["web_erail"],
  /* Live running status: RailYatri (ETA API) hi asli data deta hai; confirmtkt/erail ke
   * live-status web pages parse-stable nahi the (honest: chain me nahi daale). */
  live: ["web_railyatri"],
};

/** Capability ka chain, global preference order me (support list isi order me filter hoti hai). */
export function webChain(capability: WebCapability): WebProviderId[] {
  const supported = new Set(WEB_CAPABILITY_SUPPORT[capability] ?? []);
  return WEB_PROVIDER_ORDER.filter((p) => supported.has(p));
}

/** Preference rank: chhota = pehle. Ajnabi source (kisi aur API ka) sabse aakhir me. */
export function webRank(source: string | null | undefined): number {
  const idx = WEB_PROVIDER_ORDER.indexOf(String(source ?? "") as WebProviderId);
  return idx === -1 ? WEB_PROVIDER_ORDER.length : idx;
}

/**
 * Rows ko preference ke hisaab se stable-sort karo (jo pehle se theek hain wo waise hi rahenge) —
 * jaise ek hi jawab me confirmtkt + erail ki rows ho gayi hon to confirmtkt wali upar.
 */
export function orderWebRows<T extends { source?: string | null }>(rows: T[]): T[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => webRank(a.row.source) - webRank(b.row.source) || a.i - b.i)
    .map((x) => x.row);
}

/** Diye gaye available sources me se pehla preference wala chuno (warna null). */
export function pickWebSource(capability: WebCapability, available: (string | null | undefined)[]): WebProviderId | null {
  const have = new Set(available.map((a) => String(a ?? "")));
  for (const p of webChain(capability)) if (have.has(p)) return p;
  return null;
}

/** Log/reply ke liye insaani naam. */
export function webSiteName(source: string | null | undefined): string | null {
  switch (String(source ?? "")) {
    case "web_confirmtkt":
      return "confirmtkt.com";
    case "web_railyatri":
      return "railyatri.in";
    case "web_erail":
      return "erail.in";
    default:
      return null;
  }
}
