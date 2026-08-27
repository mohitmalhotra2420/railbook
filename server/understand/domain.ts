/** Railway-only assistant. Never answer general-purpose questions. */
export const RAIL_ONLY_REPLY =
  "Main sirf railway travel aur ticket booking mein help kar sakta hoon. Aap kahan se kahan jaana chahte hain?";

const JAILBREAK =
  /ignore (all )?(previous|prior|above) instructions|act as a general|forget railway|developer mode|system prompt|reveal (your )?(instructions|prompt)|tell me anything|jailbreak|dan mode/i;

const OFF_TOPIC =
  /\b(python|javascript|typescript|programming|code likh| likh ke do|algorithm|weather|mausam|recipe|khana ban|movie|film|joke|mazak|politics|election|news|restaurant|hotel recommend|shopping|essay|email likh|story likh|relationship|medical advice|doctor|stock market|crypto|bitcoin)\b/i;

const RAIL_CUE =
  /\b(train|ticket|pnr|booking|jana|jaana|passenger|berth|sleeper|tatkal|rac|waitlist|3ac|2ac|1ac|seat available|fare|class|station|express|shatabdi|irctc|railway|wallet)\b|जाना|टिकट|ट्रेन|पीएनआर/i;

const BOOKING_FILLER =
  /^(haan|han|haa|yes|ok|okay|theek|theek hai|achha|acha|nahi|nahee|no|mat karo|haan kar do|nahi change karo)([.!? ]*)?$/i;

export function isJailbreak(text: string): boolean {
  return JAILBREAK.test(text);
}

export function isBookingFiller(text: string): boolean {
  return BOOKING_FILLER.test(text.trim());
}

export function isOutOfDomain(
  text: string,
  ctx: { lastAsked?: string | null; hasBookingContext?: boolean } = {},
): boolean {
  const raw = text.trim();
  if (!raw) return false;
  if (isBookingFiller(raw) && ctx.hasBookingContext) return false;
  if (ctx.lastAsked && isBookingFiller(raw)) return false;
  if (JAILBREAK.test(raw) && !RAIL_CUE.test(raw)) return true;
  if (OFF_TOPIC.test(raw) && !RAIL_CUE.test(raw)) return true;
  return false;
}
