/* ── Round-40 (27 Sep 2026) ──────────────────────────────────────────────────────────────────────
 * User (3 baar): "AI khud kyu nhi samajhke sahi se outcome deta? jaise chatgpt/gemini/claude/manus —
 * koi bhi trains/Indian railway/booking/live status/stations sawaal par ek dum accurate answer/outcome do."
 *
 * LIVE root cause (code me dekha): final answer par `groundingCheck` HAR 3+ digit number aur HAR
 * uppercase token ko tool-evidence se match karta tha. Isliye jab model apne railway knowledge se
 * sahi jawab likhta tha (jaise "1853", "23 platforms"), usko "ungrounded" maan kar phenk diya jaata
 * tha — user ko "verified data nahi mila"/raw dump milta tha. ChatGPT aisa nahi karta: general
 * knowledge seedha bolta hai, aur LIVE data ke liye tools lagata hai.
 *
 * Fix: sawaal ko do modes me baanto —
 *   • LIVE mode  (seat/fare/live/PNR/coach/platform/booking/journey — aaj ka verified data):
 *     strict grounding (sirf tools ka data). Jhootha fare/seat/status kabhi nahi.
 *   • KNOWLEDGE mode (baaki sab — general railway knowledge, rules, history, comparison, station
 *     info, capability): model apne knowledge se seedha jawab de sakta hai; live-claims (₹, AVL/RAC/
 *     WL, PNR, platform N) phir bhi evidence se verify hote hain.
 */
const TRAIN_NO_RE = /\b\d{4,5}\b/;

/** LIVE/verified-data sawaal — inme sirf tools ka data chalega. */
export function liveDataQuestion(text: string): boolean {
  const t = normalizeRailText(text);
  if (!t) return false;
  /* Khaas train + uske live/local facts */
  const trainNo = TRAIN_NO_RE.test(t);
  const liveish =
    /\b(seat|seats|seats? available|availability|avl|rac|waitlist|waiting ?list|wl)\b/.test(t) ||
    /\b(live|status|running status|abhi kahan|kahan hai|kahan h|late|late chal|late hai|delay|kitni der|platform|coach position|kaha pahunch|pahunchi|pahuncha)\b/.test(t) ||
    /\b(pnr|chart|coach|bogie|dabba)\b/.test(t) ||
    /\b(fare|kiraya|kitne ka|kitna paisa|price|rate)\b/.test(t) ||
    /\b(book|booking|ticket|reserve|confirm|irctc|payment|wallet)\b/.test(t);
  if (trainNo && liveish) return true;
  /* PNR/chart/coach-position — hamesha verified data (kisi bhi train number ke bina bhi). */
  if (/\b(pnr|chart|coach position|platform number)\b/.test(t)) return true;
  /* Journey search (route + trains) — provider ka live kaam ("ASR se NDLS trains batao"). */
  if (/\b(trains?|gaadi|gadi)\b/.test(t) && /\bse\b|\bfrom\b/.test(t)) return true;
  /* Khaas train ka route/stops/timetable (train number ke saath) — schedule data provider se. */
  if (TRAIN_NO_RE.test(t) && /\b(route|stops?|halts?|timetable|schedule|kahan rukti|kahan rukta|kahan se kahan)\b/.test(t)) return true;
  /* "Is Saturday ko Vande Bharat chalegi?" — kisi khaas din ki running/availability = verified data. */
  if (
    /\b(chalegi|chalega|chal rahi|mil jayegi|milegi|milengi)\b/.test(t) &&
    /\b(aaj|kal|parso|agle|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar|ravivar)\b/.test(t) &&
    /\b(train|gaadi|gadi|express|rajdhani|shatabdi|vande|duronto|tejas)\b/.test(t)
  ) {
    return true;
  }
  /* Train-ref + live-ish shabd (bina train number ke bhi): "vivek express mein seat available hai kya",
   * "Rajdhani ka fare" — kisi khaas gaadi ka live data = verified hi chalega. */
  if (
    /\b(seat|seats|berth|berths|availability|avl|rac|waitlist|waiting ?list|wl|fare|kiraya|status|late|delay|pnr)\b/.test(t) &&
    /\b(express|rajdhani|shatabdi|vande|duronto|tejas|garib|humsafar|superfast|intercity|memu|passenger|special)\b/.test(t)
  ) {
    return true;
  }
  /* Booking hukm (bina train number bhi) — "kal ke liye ticket book kar do" → LIVE mode (koi
   * invented fare/seat nahi). Rules/procedure sawaal ("ticket kaise book kare") KNOWLEDGE rehte hain. */
  if (/\b(book|booking|reserve|reservation)\b/.test(t) && !/\b(kaise|kare|karna|process|rule|rules|kitne baje|kab khulti|kab khulta|kab se)\b/.test(t)) return true;
  /* Specific journey data (bina train number bhi): aaj/kal ki seat/fare/status */
  if (/\b(aaj|kal|abhi|right now|today)\b/.test(t) && liveish && /\b(trains?|gaadi|gadi|train ka)\b/.test(t)) return true;
  /* "X se Y kitne baje/nikal" jaise timetable asks — live journey data */
  if (/\b(kitne baje|kab nikalti|kab pahunchegi|kitna time lagega)\b/.test(t) && /\b(train|gaadi|express|rajdhani|shatabdi|vande)\b/.test(t)) return true;
  return false;
}

/** Common railway typos/ASR-alternatives → sahi shabd (samajhne ke liye; reply me original hi jaata hai). */
const TYPO_MAP: [RegExp, string][] = [
  [/\bstatsu?\b/g, "status"],
  [/\bstat[uo]s\b/g, "status"],
  [/\bavailablity|availbilty|availabilty\b/g, "availability"],
  [/\bseet|seattt\b/g, "seat"],
  [/\bgaadi|ghadi|gadii|gaadii\b/g, "train"],
  [/\btrian|tarain|tarinn\b/g, "train"],
  [/\bkirayaa|kirya|kiray\b/g, "kiraya"],
  [/\bfaree\b/g, "fare"],
  [/\btime ?table|time tabel|time tbale|timetabl\b/g, "timetable"],
  [/\btatkaal|tatakal\b/g, "tatkal"],
  [/\bwaiting ?lis+t\b/g, "waiting list"],
  [/\bpnr ?no|pnr number\b/g, "pnr"],
  [/\bstationn|stasion|stataion\b/g, "station"],
  [/\bplatfrom|platformm\b/g, "platform"],
  [/\bconfirmm|confrim\b/g, "confirm"],
  [/\bbookin|boking\b/g, "booking"],
  [/\bvande ?bharat|vandebharat|bnde bharat\b/g, "vande bharat"],
  [/\brajdhni|rajdani|rajdhaani\b/g, "rajdhani"],
  [/\bshtabdi|shatabadi|shatabdii\b/g, "shatabdi"],
  [/\bladhiana|ludhiyana\b/g, "ludhiana"],
  [/\bamratsar\b/g, "amritsar"],
  [/\bharidvar|hridwar\b/g, "haridwar"],
];

/** Samajhne se pehle halka normalisation (reply me original text hi jaata hai). */
export function normalizeRailText(text: string): string {
  let t = String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  for (const [re, to] of TYPO_MAP) t = t.replace(re, to);
  return t;
}

/** KNOWLEDGE mode ka safety net: model apne knowledge se jawab de sakta hai, par usme agar LIVE claim
 * (fare ₹, AVL/RAC/WL count, PNR, platform number) ho aur wo tool-evidence me na ho to jawab
 * ungrounded — user ka rule "kuch bhi fake nahi" (fare/seat invention kabhi nahi). */
export function liveClaimCheck(content: string, evidenceText: string): { grounded: boolean; evidence: string } {
  const bad: string[] = [];
  const patterns = [
    /₹\s*(\d[\d,]*)/g,
    /\b(?:AVL|AVAILABLE|RAC|WL|WAITLIST|REGRET)\s*:?\s*(\d[\d,]*)/gi,
    /\bPNR\s*:?\s*(\d{6,})/gi,
    /\bplatform\s*:?\s*(\d{1,3})\b/gi,
    /\b(\d[\d,]*)\s*(?:seats?|berths?)\s*(?:available|khali|vacant|free|left)\b/gi,
    /\bseats?\s*(?:available|khali|vacant|left)\s*:?\s*(\d[\d,]*)/gi,
  ];
  for (const re of patterns) {
    for (const m of String(content ?? "").matchAll(re)) {
      const num = String(m[1] ?? "").replace(/[^\d]/g, "");
      if (num && num.length >= 2 && !evidenceText.includes(num)) bad.push(num);
    }
  }
  return { grounded: bad.length === 0, evidence: [...new Set(bad)].join(",") };
}
