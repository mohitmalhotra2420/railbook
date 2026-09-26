/* Round-31 (26 Sep 2026, user: "maine specific train ki availability poochi and AI ne sahi answer bhi
 * diya — ab AI ko passenger ko next step pe leke jaana chahiye na… answer karne ke baad AI ko next
 * uska question ke hisaab se next question poochhna chahiye na? To AI khud ka dimaag kyu nahi lagata?").
 *
 * Yahan "agla kadam" banega — par **sirf usi verified data se jo is turn me aaya** (provider rows,
 * train list, journey plan). Koi andaza nahi, koi naya number/naam/fare nahi: jo dikha wahi chip me
 * jaata hai, aur chip tap karne par wahi utterance jaati hai jo pehle se chalte hue flows ko trigger
 * karti hai (book → Round-29 auto passenger form, "saari seat wali trains batao" → poora board, etc).
 *
 * Aisa kyun (dimaag model ka nahi, data ka): model ke paas booking/payment ka koi tool nahi hai
 * (confirmBook hamesha false) — usse agla kadam "sochne" dena hi wo jagah thi jahan pehle galat screen
 * khul gayi thi (Round-18m-7) aur fake numbers bante the (standing rule: kuch bhi fake nahi). Isliye
 * agla kadam data se banta hai, aur AI ki apni line bhi apna sawaal poochh sakti hai jahan natural ho.
 */

export type NextStepSeatRow = {
  number: string;
  name?: string | null;
  classCode: string;
  status: string;
  seats?: number | null;
  rac?: number | null;
  waitlist?: number | null;
  fare?: number | null;
};

export type NextStepTrainRow = {
  number: string;
  name?: string | null;
  classes?: string[] | null;
  fare?: { classCode: string; amount: number } | null;
};

export type NextStepJourneyOption = {
  trainNumbers?: string[] | null;
  trainNames?: (string | null)[] | null;
  changes?: number | null;
  availability?: { classCode: string; status: string; seats?: number | null; rac?: number | null; waitlist?: number | null; fare?: number | null } | null;
  classOptions?: { classCode: string; status: string; seats?: number | null; rac?: number | null; waitlist?: number | null; fare?: number | null }[] | null;
};

export type NextStepOption = { id: string; label: string; utterance: string; primary?: boolean };
export type NextStepResult = { options: NextStepOption[]; hint: string | null };

export type NextStepInput = {
  /** Is turn me aayi live-board / seat rows (jo dikhi wahi). */
  seats?: NextStepSeatRow[] | null;
  /** User ne message me jo train number likha (dikhaya bhi wahi gaya). */
  focus?: string[] | null;
  /** Train list (traintable) ke rows. */
  trains?: NextStepTrainRow[] | null;
  /** Journey plan ke route options. */
  journey?: { routeOptions?: NextStepJourneyOption[] | null } | null;
  /** Live status / PNR jaise jawab me train number pata ho to. */
  trainHint?: string | null;
};

const RANK = (s: string) => (s === "AVAILABLE" ? 0 : s === "RAC" ? 1 : s === "WAITLIST" ? 2 : 3);
const ORD = (r: NextStepSeatRow) => (typeof r.seats === "number" && r.seats > 0 ? r.seats : 0);

/** "AVL 354" / "RAC 6" / "WL 22" / "N/A" — jo row me tha wahi. */
export function seatStatusLabel(r: { status: string; seats?: number | null; rac?: number | null; waitlist?: number | null }): string {
  if (r.status === "AVAILABLE") return `AVL ${r.seats ?? "—"}`;
  if (r.status === "RAC") return `RAC ${r.rac ?? "—"}`;
  if (r.status === "WAITLIST") return `WL ${r.waitlist ?? "—"}`;
  if (r.status === "NOT_AVAILABLE") return "N/A";
  return "status nahi mila";
}

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/**
 * Is turn ke data se agla kadam (max 2 chips + ek honest hint). Kuch na ho to khaali —
 * jhoothi suggestion kabhi nahi.
 */
export function nextStepsFor(input: NextStepInput): NextStepResult {
  const seats = input.seats ?? [];
  const focus = (input.focus ?? []).filter(Boolean);
  const options: NextStepOption[] = [];
  let hint: string | null = null;

  if (seats.length) {
    /* User ne jis train ki baat ki wahi pehle; warna jis order me list aayi. */
    const pool = focus.length ? seats.filter((r) => focus.includes(String(r.number))) : seats;
    const ordered = [...pool].sort((a, b) => RANK(a.status) - RANK(b.status) || ORD(b) - ORD(a));
    const best = ordered[0];
    const bookable = best && RANK(best.status) <= 2;

    if (bookable) {
      const fare = typeof best.fare === "number" && best.fare > 0 ? ` ₹${best.fare}` : "";
      options.push({
        id: "book",
        primary: true,
        label: `Book ${best.number} · ${best.classCode} (${seatStatusLabel(best)}${fare})`,
        utterance: `${best.number} mein ${best.classCode} book krdo`,
      });
      hint =
        best.status === "AVAILABLE"
          ? "Tap karne par usi train/class ka passenger form khulega — asli availability aur fare \"Review journey\" par live check honge."
          : best.status === "RAC"
            ? "RAC seat mil jaayegi — tap karne par passenger form khulega."
            : `WL ${best.waitlist ?? "—"} hai — form khul jaayega, ticket waitlist me rahega.`;
    }

    /* Doosri classes SIRF usi train ki jo book chip me gayi (doosri trains ki classes mix nahi hoti). */
    const sameTrainClasses = best ? uniq(seats.filter((r) => String(r.number) === String(best.number)).map((r) => r.classCode)) : [];
    const otherClasses = sameTrainClasses.filter((c) => c !== best?.classCode);
    const trainsSeen = uniq(seats.map((r) => String(r.number)));

    if (best && otherClasses.length) {
      options.push({
        id: "classes",
        label: `${best.number} ki doosri classes (${otherClasses.join(", ")})`,
        utterance: `${best.number} ki saari classes batao`,
      });
    } else if (trainsSeen.length > 1) {
      options.push({
        id: "more-trains",
        label: `Baaki trains bhi (${trainsSeen.length - 1})`,
        utterance: "saari seat wali trains batao",
      });
    }

    /* Koi seat hi nahi (sab N/A/Regret) → jahan seat hai wahi dikhao. */
    if (!bookable && !options.length) {
      options.push({ id: "only-available", label: "Jahan seat hai wahi dikhao", utterance: "sirf available trains batao", primary: true });
      hint = "Is list me kisi class me seat nahi hai — available wali trains alag se dekh lo.";
    }
    return { options: options.slice(0, 2), hint };
  }

  /* Train list aayi (seat data nahi) → agla natural kadam: kis me seat hai. */
  if (input.trains?.length) {
    options.push({ id: "seats", primary: true, label: "Kis train me seat hai?", utterance: "saari trains ki seat availability batao" });
    return { options: options.slice(0, 2), hint: null };
  }

  /* Journey plan (direct/connecting) → pehle bookable leg par booking. */
  const routeOptions = input.journey?.routeOptions ?? [];
  if (routeOptions.length) {
    for (const o of routeOptions) {
      const train = String(o.trainNumbers?.[0] ?? "");
      if (!train) continue;
      const cands = [o.availability, ...(o.classOptions ?? [])].filter(Boolean) as NonNullable<NextStepJourneyOption["availability"]>[];
      const best = cands.filter((c) => c && RANK(c.status) <= 2).sort((a, b) => RANK(a!.status) - RANK(b!.status))[0];
      if (!best) continue;
      options.push({
        id: "book-leg",
        primary: true,
        label: `Book ${train} · ${best.classCode} (${seatStatusLabel(best)})`,
        utterance: `${train} mein ${best.classCode} book krdo`,
      });
      hint = "Isi train/class ka passenger form khulega — fare aur availability Review journey par live check honge.";
      break;
    }
    if (!options.length) {
      options.push({ id: "next-day", primary: true, label: "Doosri date dekho", utterance: "1 day later" });
      hint = "Is plan me koi class bookable nahi — agla din dekh lo.";
    }
    return { options: options.slice(0, 2), hint };
  }

  /* Live status / PNR / schedule jaise jawab — train number pata hai to agla kadam: seat. */
  const hintTrain = String(input.trainHint ?? "").trim();
  if (hintTrain) {
    options.push({ id: "seats-of-train", primary: true, label: `${hintTrain} ki seat availability`, utterance: `${hintTrain} ki seat availability batao` });
    return { options: options.slice(0, 2), hint: null };
  }

  return { options: [], hint: null };
}
