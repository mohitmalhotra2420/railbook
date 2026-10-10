/* ── Round-55: "in me se best train batao" jaise FOLLOW-UP ka shared logic ───────────────────────────
 * User (screenshots 29 Sep): pehli list mili (Sachkhand sameth), phir "esmein se best train btao" —
 * AI ne list dobara dump kar di (aur dobara fetch par trains badal bhi gayi thin). ChatGPT wale behaviour
 * ke liye: (a) follow-up pehchano, (b) pichhli list ke wahi trains lo, (c) jawab me EK winner + "kyun".
 * Ye module dono jagah use hota hai — run.ts (adequacy/rescue) aur agentic.ts (system block + rule).
 */

/** "in me se / isme / esmein / inse / among these" — pichhli list ko point karne wale shabd. */
export const PICK_FOLLOWUP_RE =
  /\b(in|inhi|inme|in\s*me|isme|is\s*me|esme|es\s*me|esmein|is\s*mein|inse|inko|unme|un\s*me|en|among|out\s+of)\b[^\n]{0,24}\b(se|mein|among|of)?\b/i;

/** "best / sabse acchi / recommend / kaunsi lein" wale shabd. */
export const PICK_BEST_WORD_RE =
  /\b(best|behtar|badhiya|acchi|achhi|sabse\s+(?:best|behtar|acchi|achhi|badhiya|fast|tez|sahi)|recommend\w*|suggest\w*|kaun\s*si\s+(?:lein|lu|book|choose)|which\s+(?:one|is\s+best)|सबसे|बेहतर|सुझाव)\b/i;

/** Pichhle assistant jawab me likhi train numbers (candidates) — max 12. */
export function previousListTrains(history: Array<{ role?: string; content?: string }> | undefined): string[] {
  const prev = [...(history ?? [])].reverse().find((h) => h?.role === "assistant" && typeof h.content === "string");
  const nums = [...new Set(String(prev?.content ?? "").match(/\b\d{5}\b/g) ?? [])];
  return nums.slice(0, 12);
}

/** Kya ye sawaal pichhli list me se chunne ka hai? (history me ≥2 trains + chunav wale shabd) */
export function isPickFollowup(text: string, history?: Array<{ role?: string; content?: string }>): boolean {
  const t = String(text ?? "");
  const nums = previousListTrains(history);
  if (nums.length < 2) return false;
  if (PICK_BEST_WORD_RE.test(t)) return true;
  return PICK_FOLLOWUP_RE.test(t) && /\b(train|trains|gadi|gaadi|wala|wali)\b/i.test(t);
}

/** User ke shabdon me waqt ka zikr? (subah/savere/dopahar/shaam/raat/8 baje/12:30/am-pm/morning...) */
export const ASKED_WINDOW_RE =
  /\b(subah|savere|saveray|dopahar|dophar|shaam|sham|raat|raat\s*ko|morning|afternoon|evening|night|tonight|\d{1,2}\s*(?:baje|bje|am|pm)|\d{1,2}:\d{2})\b/i;

export function askedTimeWindow(text: string): boolean {
  return ASKED_WINDOW_RE.test(String(text ?? ""));
}

/** User ne waqt nahi bataya to model ke chupke lagaye time-window filter hata do (train chhupane band). */
export function dropUnaskedWindow(
  text: string,
  args: Record<string, unknown> | null | undefined,
): { args: Record<string, unknown>; dropped: boolean } {
  const out: Record<string, unknown> = { ...(args ?? {}) };
  if (askedTimeWindow(text)) return { args: out, dropped: false };
  const dropped = Boolean(out.depart_after ?? out.depart_before);
  out.depart_after = null;
  out.depart_before = null;
  return { args: out, dropped };
}
