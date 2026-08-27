/** Railway-only assistant. Never answer general-purpose questions. */
export const RAIL_ONLY_REPLY =
  "Main sirf railway travel aur ticket booking mein help kar sakta hoon. Aap kahan se kahan jaana chahte hain?";

const JAILBREAK =
  /ignore (all )?(previous|prior|above) instructions|act as a general|forget railway|developer mode|system prompt|reveal (your )?(instructions|prompt)|tell me anything|jailbreak|dan mode/i;

const OFF_TOPIC =
  /\b(python|javascript|typescript|programming|code likh| likh ke do|algorithm|weather|mausam|recipe|khana ban|movie|film|joke|mazak|politics|election|news|restaurant|hotel recommend|shopping|essay|email likh|story likh|relationship|medical advice|doctor|stock market|crypto|bitcoin)\b/i;

const RAIL_CUE =
  /\b(train|ticket|pnr|booking|jana|jaana|passenger|berth|sleeper|tatkal|rac|waitlist|3ac|2ac|1ac|seat available|fare|class|station|express|shatabdi|irctc|railway|walet|wallet)\b|जाना|टिकट|ट्रेन|पीएनआर/i;

const BOOKING_FILLER =
  /^(haan|han|haa|yes|ok|okay|theek|theek hai|achha|acha|nahi|nahee|no|mat karo|haan kar do|nahi change karo)([.!? ]*)?$/i;

export function isJailbreak(text: string): boolean {
  return JAILBREAK.test(text);
}

export function isBookingFiller(text: string): boolean {
  return BOOKING_FILLER.test(text.trim());
}

const ASK_MEANING = /\b(kya hota|kya hai|matlab|meaning|full form|ka matlab)\b|क्या होता|मतलब|क्या है/;

/** Stable class/status glossary — not live IRCTC rules. */
export function glossaryReply(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;
  if (!ASK_MEANING.test(raw.toLowerCase()) && !ASK_MEANING.test(raw)) return null;
  const t = raw.toLowerCase();
  if (/\b\d{5}\b/.test(t)) return null;
  if (/\b(kahan|kaha|live|status|fare|seat|available|pnr)\b/.test(t)) return null;
  if (/\b(cc|chair car)\b/.test(t) || /सीसी|चेयर कार/.test(raw)) {
    return "CC = AC Chair Car. Baithne ki AC seat, berth nahi. Day trains (jaise Shatabdi) mein common hai. Live seats/fare provider se aate hain.";
  }
  if (/\b(ec|executive)\b/.test(t)) {
    return "EC = Executive Chair Car. CC se upar wali chair class, zyada fare. Availability provider se check hoti hai.";
  }
  if (/\b(sl|sleeper)\b/.test(t) || /स्लीपर/.test(raw)) {
    return "SL = Sleeper class. Non-AC berth (lower/middle/upper). Confirm/WL provider se aata hai — main gadh ke nahi bataunga.";
  }
  if (/\b(3a|3ac|3 ac|third ac)\b/.test(t) || /थर्ड एसी/.test(raw)) {
    return "3A = AC 3 Tier. AC sleeper, 6 berth per bay. Seats/fare provider se.";
  }
  if (/\b(2a|2ac|2 ac|second ac)\b/.test(t)) {
    return "2A = AC 2 Tier. AC sleeper, 4 berth per bay. Provider se availability.";
  }
  if (/\b(1a|1ac|first ac)\b/.test(t)) {
    return "1A = AC First Class. Coupe/cabin. Sabse mehngi AC sleeper. Live fare provider se.";
  }
  if (/\b(2s|second sitting)\b/.test(t)) {
    return "2S = Second Sitting. Non-AC baithne ki seat. Unreserved/GS alag hota hai.";
  }
  if (/\b(3e|3e economy)\b/.test(t)) {
    return "3E = AC 3 Economy. 3A jaisi AC sleeper, thodi alag layout. Seats provider se.";
  }
  if (/\b(rac)\b/.test(t) || /आरएसी/.test(raw)) {
    return "RAC = Reservation Against Cancellation. Seat share ho sakti hai; confirm tabhi jab provider RAC se confirm dikhaye.";
  }
  if (/\b(wl|waitlist|waiting)\b/.test(t) || /वेटलिस्ट|प्रतीक्षा/.test(raw)) {
    return "WL = Waitlist. Ticket confirm nahi. Number provider se aata hai — main WL invent nahi karunga.";
  }
  if (/\b(tatkal)\b/.test(t) || /तत्काल/.test(raw)) {
    return "Tatkal = last-window quota (TQ). Fare/AVL general se alag ho sakte hain. Official window IRCTC pe hai — main rule gadh ke nahi bataunga.";
  }
  return null;
}

/** True when the utterance is not a railway request and not in-flow filler. */
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
