/* ══ Round-62 (AI Booking) — focused flow tests ══════════════════════════════════════════════════════
 * Ye tests sirf NAYE additive module (src/ai/aiBookingFlow.ts) ke hain. Purana kuch nahi chhua.
 * Niyam jo yahan verify hote hain:
 *   • slots ek hi message me aayein to dobara nahi poochha jata,
 *   • train/class sirf ASLI list se match hoti hai (warna saaf "nahi mila"),
 *   • koi fare/availability/PNR invent nahi hota,
 *   • final booking ke liye user ka explicit confirmation chahiye.
 */
import { describe, expect, it } from "vitest";
import {
  AI_BOOKING_STAGES,
  aiBookingAskLine,
  aiBookingClassSelected,
  aiBookingFinalPrompt,
  aiBookingHandoffLine,
  aiBookingHandoffTurn,
  aiBookingMissingLine,
  aiBookingPassengersReady,
  aiBookingReviewScreenOpen,
  aiBookingStart,
  aiBookingSummaryLines,
  aiBookingTrainsReady,
  aiBookingTurn,
  aiBookingCorrect,
  aiBookingReviewLine,
  looksLikeCorrection,
  parseFoodChoice,
  lastPaxNumber,
  classLabel,
  isResetCommand,
  isYes,
  matchClassInList,
  matchTrainInList,
  parsePaxCount,
  type AiBookingState,
} from "../src/ai/aiBookingFlow";
import type { ClassAvailability, Station, TrainResult } from "../src/types";

const NOW = new Date(2026, 8, 30); // 30 Sep 2026 (user ka local date)
const ASR: Station = { code: "ASR", name: "Amritsar Junction", city: "Amritsar" };
const LDH: Station = { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" };

const klass = (code: ClassAvailability["code"], status = "AVAILABLE", fare = 500): ClassAvailability => ({
  code,
  label: code,
  status: status as ClassAvailability["status"],
  fare,
  seats: 40,
});

const train = (number: string, name: string, classes: ClassAvailability[] = [klass("CC", "AVAILABLE", 425), klass("2S", "WAITLIST", 175)]): TrainResult => ({
  number,
  name,
  type: "Superfast",
  from: ASR,
  to: LDH,
  date: "2026-10-01",
  departure: "07:10",
  arrival: "09:05",
  arrivalDayOffset: 0,
  durationMinutes: 115,
  durationLabel: "1h 55m",
  runsOn: [0, 1, 2, 3, 4, 5, 6],
  classes,
});

const TRAINS = [train("12014", "Amritsar Shatabdi"), train("12498", "Shane Punjab")];

/** Ek turn ka text chhor kar state lauta deta hai (tests padhne me aasan). */
function step(state: AiBookingState, text: string, env: Parameters<typeof aiBookingTurn>[2] = {}) {
  return aiBookingTurn(state, text, { now: NOW, ...env });
}

describe("AI Booking — stages aur greeting", () => {
  it("stage list wahi hai jo user ne maangi (11 steps, isi order me)", () => {
    expect(AI_BOOKING_STAGES).toEqual([
      "AI_BOOKING_START",
      "COLLECT_JOURNEY",
      "SEARCH_TRAINS",
      "SHOW_TRAIN_OPTIONS",
      "TRAIN_SELECTED",
      "CLASS_SELECTION",
      "PASSENGER_COLLECTION",
      "PASSENGER_REVIEW",
      "BOOKING_REVIEW",
      "FINAL_CONFIRMATION",
      "IRCTC_HANDOFF",
    ]);
  });

  it("shuruaat par pehla sawaal station ka hai, booking ka koi invent data nahi", () => {
    const t = aiBookingStart(NOW);
    expect(t.state.stage).toBe("COLLECT_JOURNEY");
    expect(t.state.awaiting).toBe("from");
    expect(t.say.join(" ")).toMatch(/kahan se/i);
    expect(t.state.trainNumber).toBeNull();
    expect(t.state.classCode).toBeNull();
  });
});

describe("AI Booking — journey collection (repeat sawaal nahi)", () => {
  it("ek hi message me sab kuch: dobara kuch nahi poochha jata aur search action milta hai", () => {
    const t = step(aiBookingStart(NOW).state, "1 October ko Amritsar se Ludhiana jaana hai, 2 passengers hain");
    expect(t.state.from?.code).toBe("ASR");
    expect(t.state.to?.code).toBe("LDH");
    expect(t.state.date).toBe("2026-10-01");
    expect(t.state.pax).toBe(2);
    expect(t.state.stage).toBe("SEARCH_TRAINS");
    const search = t.actions.find((a) => a.type === "SEARCH");
    expect(search && search.type === "SEARCH" ? search.date : null).toBe("2026-10-01");
    expect(t.actions.some((a) => a.type === "SET_PASSENGER_COUNT")).toBe(true);
    /* Jo mil gaya wo dobara nahi poochha gaya */
    expect(t.say.join(" ")).not.toMatch(/kahan se jaana/i);
    expect(t.say.join(" ")).not.toMatch(/kitne passengers/i);
  });

  it("adhoora message: sirf missing cheez poochhi jati hai (date pehle se hai to dobara nahi)", () => {
    const a = step(aiBookingStart(NOW).state, "Amritsar se Ludhiana 1 October");
    expect(a.state.date).toBe("2026-10-01");
    expect(a.state.awaiting).toBe("pax");
    expect(a.say.join(" ")).toMatch(/kitne passengers/i);
  });

  it("pax phir date: state yaad rehti hai (voice/text mix)", () => {
    const a = step(aiBookingStart(NOW).state, "Amritsar se Ludhiana");
    expect(a.state.awaiting).toBe("date");
    const b = step(a.state, "2 log"); // pax pehle bata diya
    expect(b.state.pax).toBe(2);
    expect(b.state.awaiting).toBe("date");
    const c = step(b.state, "1 October");
    expect(c.state.date).toBe("2026-10-01");
    expect(c.state.stage).toBe("SEARCH_TRAINS");
  });

  it("galat/missing jawab par guess nahi — wahi slot dobara poochha jata hai", () => {
    const t = step(aiBookingStart(NOW).state, "pata nahi");
    expect(t.state.from).toBeNull();
    expect(t.state.awaiting).toBe("from");
    expect(t.state.stage).toBe("COLLECT_JOURNEY");
  });

  it("pax count 1..6 tak samajhta hai (Hinglish words bhi)", () => {
    expect(parsePaxCount("2 passengers")).toBe(2);
    expect(parsePaxCount("do log hain")).toBe(2);
    expect(parsePaxCount("hum paanch log ja rahe hain")).toBe(5);
    expect(parsePaxCount("9 passengers")).toBeNull();
  });
});

describe("AI Booking — train/class sirf asli data se", () => {
  it("search ke khaali result par saaf bolta hai (kuch bana kar nahi dikhata)", () => {
    const t = aiBookingTrainsReady({ ...aiBookingStart(NOW).state, date: "2026-10-01" }, []);
    expect(t.state.stage).toBe("COLLECT_JOURNEY");
    expect(t.say.join(" ")).toMatch(/verified train data nahi mila/i);
    expect(t.say.join(" ")).not.toMatch(/\d{4,5} .*Express/);
  });

  it("asli list aane par options stage + train ka sawaal", () => {
    const t = aiBookingTrainsReady({ ...aiBookingStart(NOW).state, date: "2026-10-01", pax: 2 }, TRAINS);
    expect(t.state.stage).toBe("SHOW_TRAIN_OPTIONS");
    expect(t.say.join(" ")).toMatch(/12014/);
    expect(t.say.join(" ")).toMatch(/kaunsi train/i);
  });

  it("list me na hone wala number → saaf inkaar, aur asli list dikhti hai", () => {
    const base: AiBookingState = { ...aiBookingStart(NOW).state, stage: "SHOW_TRAIN_OPTIONS", date: "2026-10-01" };
    const t = step(base, "99999", { trains: TRAINS });
    expect(t.state.stage).toBe("SHOW_TRAIN_OPTIONS");
    expect(t.state.trainNumber).toBeNull();
    expect(t.say.join(" ")).toMatch(/nahi hai/i);
    expect(t.say.join(" ")).toMatch(/12014/);
  });

  it("asli number par train select + usi train ki classes poochhi jati hain", () => {
    const base: AiBookingState = { ...aiBookingStart(NOW).state, stage: "SHOW_TRAIN_OPTIONS", date: "2026-10-01" };
    const t = step(base, "12014", { trains: TRAINS });
    expect(t.state.stage).toBe("CLASS_SELECTION");
    expect(t.state.trainNumber).toBe("12014");
    expect(t.say.join(" ")).toMatch(/CC/);
    expect(t.say.join(" ")).toMatch(/2S/);
  });

  it("class sirf usi train ki asli list se match hoti hai", () => {
    const classes = TRAINS[0].classes;
    expect(matchClassInList("CC", classes)?.code).toBe("CC");
    expect(matchClassInList("chair car chahiye", classes)?.code).toBe("CC");
    expect(matchClassInList("sleeper", classes)).toBeNull(); // is train me SL nahi hai
    expect(matchTrainInList("12014", TRAINS)?.number).toBe("12014");
    expect(matchTrainInList("shane punjab", TRAINS)?.number).toBe("12498");
    expect(matchTrainInList("rajdhani", TRAINS)).toBeNull();
  });

  it("class chunne ke baad passenger collection shuru + AI Book ka raasta", () => {
    const selected = step({ ...aiBookingStart(NOW).state, stage: "CLASS_SELECTION", trainNumber: "12014", pax: 2 }, "CC", {
      classes: TRAINS[0].classes,
    });
    expect(selected.state.classCode).toBe("CC");
    const confirmed = aiBookingClassSelected(selected.state, klass("CC"), { status: "AVAILABLE", seats: 42 });
    expect(confirmed.state.stage).toBe("PASSENGER_COLLECTION");
    expect(confirmed.say.join(" ")).toMatch(/passenger form khol rahi hoon/i);
    expect(confirmed.say.join(" ")).toMatch(/AVL 42/);
  });
});

describe("AI Booking — passenger conversation (form fields ke hisaab se)", () => {
  const base = (): AiBookingState => ({
    ...aiBookingStart(NOW).state,
    stage: "PASSENGER_COLLECTION",
    classCode: "CC",
    pax: 2,
    paxIndex: 0,
    drafts: [{}, {}],
    awaiting: "paxName",
  });

  it("ek sentence me naam+age+gender+berth → saare fields bhar jate hain", () => {
    const t = step(base(), "Rahul Sharma, 31 male, window");
    const patch = t.actions.find((a) => a.type === "PATCH_PASSENGER");
    expect(patch && patch.type === "PATCH_PASSENGER" ? patch.patch : {}).toEqual({
      name: "Rahul Sharma",
      age: "31",
      gender: "MALE",
      berthPreference: "Window",
    });
    /* Passenger 1 complete → ab passenger 2 ka naam */
    expect(t.say.join(" ")).toMatch(/Passenger 2 ka naam/i);
    expect(t.state.paxIndex).toBe(1);
  });

  it("adhoori detail par sirf missing field poochhta hai", () => {
    const a = step(base(), "Rahul Sharma");
    expect(a.state.awaiting).toBe("paxAge");
    expect(a.say.join(" ")).toMatch(/age/i);
    const b = step(a.state, "31");
    expect(b.state.awaiting).toBe("paxGender");
  });

  it("do passengership form-ready: dono complete hone par review ka sawaal", () => {
    let s = base();
    s = step(s, "Rahul Sharma, 31, male, window").state;
    const done = step(s, "Neha, 28, female, window");
    expect(done.state.stage).toBe("PASSENGER_REVIEW");
    expect(done.say.join(" ")).toMatch(/review booking khol rahi hoon/i);
    /* Automation: AI khud review booking kholta hai (maujooda goReview) */
    expect(done.actions.some((a) => a.type === "OPEN_REVIEW")).toBe(true);
  });

  it("form ke asli state se sync (idempotent — same sawaal dobara nahi)", () => {
    const s = base();
    const first = aiBookingPassengersReady(s, [{ name: "", age: "", gender: "", berthPreference: "" }]);
    expect(first.state.awaiting).toBe("paxName");
    const again = aiBookingPassengersReady(first.state, [{ name: "", age: "", gender: "", berthPreference: "" }]);
    expect(again.say).toEqual([]); // loop nahi
  });
});

describe("AI Booking — review, explicit confirmation, IRCTC", () => {
  it("summary mein sirf diya gaya asli data aata hai (fare na ho to invent nahi)", () => {
    const lines = aiBookingSummaryLines({
      from: ASR,
      to: LDH,
      date: "2026-10-01",
      trainNumber: "12014",
      trainName: "Amritsar Shatabdi",
      classCode: "CC",
      passengers: [{ name: "Rahul Sharma", age: "31", gender: "MALE", berthPreference: "Window" }],
      fareTotal: 850,
    }).join("\n");
    expect(lines).toMatch(/Amritsar Junction → Ludhiana Junction/);
    expect(lines).toMatch(/Train: 12014 Amritsar Shatabdi/);
    expect(lines).toMatch(/Class: CC/);
    expect(lines).toMatch(/Passenger 1: Rahul Sharma, 31, male, Window/);
    expect(lines).toMatch(/Fare: ₹850/);

    const noFare = aiBookingSummaryLines({
      from: ASR,
      to: LDH,
      date: "2026-10-01",
      trainNumber: "12014",
      classCode: "CC",
      passengers: [{ name: "Rahul" }],
    }).join("\n");
    expect(noFare).toMatch(/invent nahi/i);
    expect(noFare).not.toMatch(/₹/);
  });

  it("'haan' par AI khud Continue to IRCTC karta hai (maujooda handoff) — lekin koi fake booking nahi", () => {
    const s: AiBookingState = { ...aiBookingStart(NOW).state, stage: "FINAL_CONFIRMATION", awaiting: "confirm" };
    const t = step(s, "haan theek hai");
    expect(t.state.stage).toBe("IRCTC_HANDOFF");
    expect(t.state.confirmed).toBe(true);
    /* Sirf maujooda IRCTC handoff action — PNR/confirmation kuch nahi banata */
    expect(t.actions).toEqual([{ type: "IRCTC_HANDOFF" }]);
    expect(t.say.join(" ")).toMatch(/Continue to IRCTC dab rahi hoon/i);
  });

  it("'nahi' par wapas passenger details par (change path)", () => {
    const s: AiBookingState = { ...aiBookingStart(NOW).state, stage: "BOOKING_REVIEW", drafts: [{ name: "Rahul Sharma", age: "31", gender: "MALE", berthPreference: "" }], pax: 1 };
    const t = step(s, "nahi, berth badalni hai");
    expect(t.state.stage).toBe("PASSENGER_COLLECTION");
    expect(t.state.awaiting).toBe("paxBerth");
  });

  it("review screen khulte hi AI final question poochhti hai (aur kuch submit nahi karti)", () => {
    const s: AiBookingState = {
      ...aiBookingStart(NOW).state,
      from: ASR,
      to: LDH,
      date: "2026-10-01",
      trainNumber: "12014",
      classCode: "CC",
      pax: 2,
    };
    const t = aiBookingFinalPrompt(s, 850);
    expect(t.state.stage).toBe("FINAL_CONFIRMATION");
    expect(t.state.awaiting).toBe("confirm");
    expect(t.actions).toEqual([]); // khud se kuch submit/click nahi
    expect(t.say.join(" ")).toMatch(/Booking summary ready hai/);
    expect(t.say.join(" ")).toMatch(/final details hain ya kuch edit/i);
    expect(t.say.join(" ")).toMatch(/Continue to IRCTC khud dabakar .* autofill/i);
    expect(aiBookingHandoffTurn(s).actions).toEqual([{ type: "IRCTC_HANDOFF" }]);
  });

  it("nayi booking command par poora context reset (purani journey carry nahi hoti)", () => {
    const s: AiBookingState = { ...aiBookingStart(NOW).state, stage: "PASSENGER_COLLECTION", from: ASR, to: LDH, date: "2026-10-01", pax: 2 };
    expect(isResetCommand("nayi booking shuru karo")).toBe(true);
    const t = step(s, "nayi booking shuru karo");
    expect(t.state.stage).toBe("COLLECT_JOURNEY");
    expect(t.state.from).toBeNull();
    expect(t.actions[0]).toEqual({ type: "RESET" });
  });

  it("yes/no words ka behaviour", () => {
    expect(isYes("haan continue karo")).toBe(true);
    expect(isYes("nahi")).toBe(false);
    expect(isYes("theek hai")).toBe(true);
  });

  it("class ka label asli CLASS_LABELS se aata hai", () => {
    expect(classLabel("CC")).toBe("AC Chair Car");
    expect(classLabel(null)).toBe("");
    expect(aiBookingAskLine("class")).toMatch(/class/i);
  });
});

describe("AI Booking — corrections (ChatGPT jaisa: sirf badla hua slot replace hota hai)", () => {
  const collected = (): AiBookingState => {
    const t = step(aiBookingStart(NOW).state, "1 October ko Amritsar se Ludhiana, 2 passengers");
    return t.state;
  };

  it('"Actually 2 October kar do" → date replace, route + passengers preserve, FRESH search', () => {
    const t = aiBookingCorrect(collected(), "Actually 2 October kar do", { now: NOW });
    expect(t).not.toBeNull();
    expect(t!.state.date).toBe("2026-10-02");
    expect(t!.state.from?.code).toBe("ASR");
    expect(t!.state.to?.code).toBe("LDH");
    expect(t!.state.pax).toBe(2);
    expect(t!.state.stage).toBe("SEARCH_TRAINS");
    const search = t!.actions.find((a) => a.type === "SEARCH");
    expect(search && search.type === "SEARCH" ? search.date : null).toBe("2026-10-02");
    expect(t!.say.join(" ")).toMatch(/Baaki journey waisi hi hai/i);
  });

  it("correction ke baad purani chuni hui train/class carry nahi hoti (nayi search)", () => {
    const withTrain: AiBookingState = { ...collected(), stage: "CLASS_SELECTION", trainNumber: "12014", classCode: "CC" };
    const t = aiBookingCorrect(withTrain, "sorry, 2 October kar do", { now: NOW });
    expect(t!.state.trainNumber).toBeNull();
    expect(t!.state.classCode).toBeNull();
  });

  it("adhoori journey par correction → sirf missing cheez poochhi jati hai", () => {
    const partial = step(aiBookingStart(NOW).state, "Amritsar se Ludhiana").state;
    const t = aiBookingCorrect(partial, "actually 2 October kar do", { now: NOW });
    expect(t!.state.date).toBe("2026-10-02");
    expect(t!.state.from?.code).toBe("ASR");
    expect(t!.say.join(" ")).toMatch(/kitne passengers/i); // pax hi missing tha
  });

  it("correction sirf tab jab ishara ho — normal answer par nahi", () => {
    expect(looksLikeCorrection("2 October")).toBe(false);
    expect(aiBookingCorrect(collected(), "2 October", { now: NOW })).toBeNull();
    /* class chunna correction nahi hai */
    expect(aiBookingCorrect({ ...collected(), stage: "CLASS_SELECTION" }, "CC kar do", { now: NOW })).toBeNull();
  });

  it("passenger-count correction kaam karta hai (route/date same)", () => {
    const t = aiBookingCorrect(collected(), "2 passengers ki jagah 4 kar do", { now: NOW });
    expect(t!.state.pax).toBe(4);
    expect(t!.state.date).toBe("2026-10-01");
    expect(lastPaxNumber("2 passengers ki jagah 4 kar do")).toBe(4);
  });
});

describe("AI Booking — Hinglish + food + partial sentences", () => {
  it('"12014 wali" aur "12014 wali train" dono asli list se match hote hain', () => {
    const base: AiBookingState = { ...aiBookingStart(NOW).state, stage: "SHOW_TRAIN_OPTIONS", date: "2026-10-01" };
    expect(step(base, "12014 wali", { trains: TRAINS }).state.trainNumber).toBe("12014");
    expect(step(base, "12014 wali train", { trains: TRAINS }).state.trainNumber).toBe("12014");
  });

  it('"Rahul Sharma, 31 male." par sirf berth poochhi jati hai', () => {
    const base: AiBookingState = { ...aiBookingStart(NOW).state, stage: "PASSENGER_COLLECTION", classCode: "CC", pax: 1, drafts: [{}], awaiting: "paxName" };
    const t = step(base, "Rahul Sharma, 31 male.");
    expect(t.state.awaiting).toBe("paxBerth");
    expect(t.say.join(" ")).toMatch(/berth/i);
  });

  it("khaana (veg / non-veg / no food) maujooda form ke field me jaata hai", () => {
    expect(parseFoodChoice("veg")).toBe("VEG");
    expect(parseFoodChoice("non veg khana")).toBe("NON_VEG");
    expect(parseFoodChoice("khana nahi chahiye")).toBe("NO_FOOD");
    expect(parseFoodChoice("31 male")).toBeNull();
    const base: AiBookingState = { ...aiBookingStart(NOW).state, stage: "PASSENGER_COLLECTION", classCode: "CC", pax: 1, drafts: [{}], awaiting: "paxName" };
    const t = step(base, "Rahul Sharma, 31, male, window, veg meal");
    const patch = t.actions.find((a) => a.type === "PATCH_PASSENGER");
    expect(patch && patch.type === "PATCH_PASSENGER" ? patch.patch.foodChoice : null).toBe("VEG");
    /* naam saaf rehta hai — "veg"/"window" naam me nahi ghusste */
    expect(patch && patch.type === "PATCH_PASSENGER" ? patch.patch.name : null).toBe("Rahul Sharma");
  });

  it("review line conversational hai (form jaisa nahi) aur sirf asli values bolti hai", () => {
    const st: AiBookingState = { ...aiBookingStart(NOW).state, from: ASR, to: LDH, date: "2026-10-01", trainNumber: "12014", classCode: "CC", pax: 2 };
    const line = aiBookingReviewLine(st, 850);
    expect(line).toMatch(/Booking summary ready hai/);
    expect(line).toMatch(/Amritsar Junction se Ludhiana Junction/);
    expect(line).toMatch(/train 12014/);
    expect(line).toMatch(/class CC/);
    expect(line).toMatch(/₹850/);
    expect(line).toMatch(/continue karun/i);
    const noFare = aiBookingReviewLine({ ...st, trainNumber: null, classCode: null }, null);
    expect(noFare).not.toMatch(/₹/);
  });
});

describe("AI Booking — full automation (R62c)", () => {
  const full = (): AiBookingState => {
    const t = step(aiBookingStart(NOW).state, "1 October ko Amritsar se Ludhiana, 2 passengers");
    const withTrain = step(t.state, "12014", { trains: TRAINS }).state;
    const withClass = step(withTrain, "CC", { classes: TRAINS[0].classes }).state;
    return aiBookingClassSelected(withClass, klass("CC"), { status: "AVAILABLE", seats: 42 }).state;
  };

  it("food ka sawaal sirf tab jab train me options hon (pantry API)", () => {
    const s = full();
    /* pantry true → berth ke baad khaana poochha jata hai */
    let withFood = step(s, "Rahul Sharma, 31, male, window", { foodExpected: true }).state;
    expect(withFood.awaiting).toBe("paxFood");
    const answered = step(withFood, "veg", { foodExpected: true });
    expect(answered.state.drafts[0].foodChoice).toBe("VEG");
    /* pantry false/unknown → khaana ka sawaal hi nahi */
    const noFood = step(s, "Rahul Sharma, 31, male, window", { foodExpected: false }).state;
    expect(noFood.awaiting).not.toBe("paxFood");
    const unknown = step(s, "Rahul Sharma, 31, male, window", {}).state;
    expect(unknown.awaiting).not.toBe("paxFood");
  });

  it("1 se 6 passengers tak ek-ek karke details — sab complete hone par review khulta hai", () => {
    const base: AiBookingState = { ...aiBookingStart(NOW).state, stage: "PASSENGER_COLLECTION", classCode: "CC", pax: 3, drafts: [{}, {}, {}], awaiting: "paxName" };
    let s = base;
    let turn = step(s, "Rahul Sharma, 31, male, window");
    s = turn.state;
    expect(turn.say.join(" ")).toMatch(/Ab passenger 2 ki details/);
    turn = step(s, "Neha, 28, female, window");
    s = turn.state;
    expect(turn.say.join(" ")).toMatch(/Ab passenger 3 ki details/);
    turn = step(s, "Aman, 45, male, window");
    expect(turn.state.stage).toBe("PASSENGER_REVIEW");
    expect(turn.actions.some((a) => a.type === "OPEN_REVIEW")).toBe(true);
    expect(turn.actions.filter((a) => a.type === "PATCH_PASSENGER")).toHaveLength(1);
  });

  it("missing details ki saaf line (food ke saath/siva)", () => {
    expect(aiBookingMissingLine({ name: "Rahul Sharma" }, 0)).toMatch(/age, gender, berth preference/);
    expect(aiBookingMissingLine({ name: "Rahul Sharma", age: "31", gender: "MALE", berthPreference: "Window" }, 1, { food: true })).toMatch(/khaana/);
    expect(aiBookingMissingLine({ name: "Rahul Sharma", age: "31", gender: "MALE", berthPreference: "Window" }, 1)).toMatch(/saari details mil gayi/i);
  });

  it("review par 'nahi' → wapas passenger details par (edit raasta)", () => {
    const s: AiBookingState = { ...aiBookingStart(NOW).state, stage: "FINAL_CONFIRMATION", awaiting: "confirm", drafts: [{ name: "Rahul Sharma", age: "31", gender: "MALE", berthPreference: "" }], pax: 1 };
    const t = step(s, "nahi, berth badalni hai");
    expect(t.state.stage).toBe("PASSENGER_COLLECTION");
    expect(t.state.awaiting).toBe("paxBerth");
    expect(t.actions).toEqual([]);
  });
});

/* ── R63-fix (30 Sep, user ka asli screenshot) ───────────────────────────────────────────────────────
 * User ne likha: "Mujhe amritsar se delhi jaana hai" → AI ne phir bhi "Aur kahan jaana hai?" poochha,
 * phir "दिल्ली जाना है" par bhi wahi. Wajah: bare "delhi"/"दिल्ली" ek CITY hai (usme 3 station hain),
 * ALIASES me station ke roop me nahi tha — slot khaali reh gaya aur sawaal loop ban gaya.
 * Ab: city ka naam = asli station list ka ek hi saaf sawaal, aur dobara wahi city bole to default
 * station (saaf disclosure ke saath). Koi invent nahi. */
describe("R63 — city (cluster) + Devanagari station naam", () => {
  it("screenshot wala case: 'amritsar se delhi' → ek hi sawaal, delhi ke asli station list ke saath", () => {
    const s = step(aiBookingStart(NOW).state, "Mujhe amritsar se delhi jaana hai");
    expect(s.state.from?.code).toBe("ASR");
    expect(s.state.to).toBeNull();
    expect(s.state.awaiting).toBe("to");
    expect(s.state.pendingCity?.city).toBe("delhi");
    expect(s.say.join(" ")).toMatch(/NDLS New Delhi/);
    expect(s.say.join(" ")).toMatch(/kaunse wala/i);
  });

  it("Devanagari 'दिल्ली जाना है' par bhi aage badhta hai (loop nahi) — default + disclosure", () => {
    const s1 = step(aiBookingStart(NOW).state, "Mujhe amritsar se delhi jaana hai");
    const s2 = step(s1.state, "दिल्ली जाना है");
    expect(s2.state.to?.code).toBe("NDLS");
    expect(s2.state.pendingCity).toBeNull();
    expect(s2.say.join(" ")).toMatch(/New Delhi/);
    expect(s2.state.awaiting).toBe("date");
  });

  it("city ke asli station ka jawab (code/naam/Devanagari) seedha le liya jaata hai", () => {
    const s1 = step(aiBookingStart(NOW).state, "delhi se jaipur jaana hai");
    /* "delhi" from-slot par aaya → usi ka sawaal, jaipur (asli station) to-slot me. */
    expect(s1.state.to?.code).toBe("JP");
    expect(s1.state.awaiting).toBe("from");
    const s2 = step(s1.state, "NDLS");
    expect(s2.state.from?.code).toBe("NDLS");
    expect(s2.state.to?.code).toBe("JP");
  });

  it("ek message me do city ('jalandhar se mumbai') → dono ka sawaal ek-ek karke", () => {
    const s1 = step(aiBookingStart(NOW).state, "mujhe jalandhar se mumbai jaana hai, 2 log");
    expect(s1.state.pendingCity?.city).toBe("jalandhar");
    const s2 = step(s1.state, "koi bhi");
    expect(s2.state.from?.code).toBe("JUC");
    expect(s2.state.pendingCity?.city).toBe("mumbai");
    const s3 = step(s2.state, "BCT");
    expect(s3.state.to?.code).toBe("BCT");
    expect(s3.state.pax).toBe(2);
  });

  it("class me na chalti berth ka shabd naam me nahi ghusa karta (E2E me pakda gaya)", () => {
    const base: AiBookingState = {
      ...aiBookingStart(NOW).state,
      stage: "PASSENGER_COLLECTION",
      classCode: "CC",
      pax: 1,
      drafts: [{}],
      awaiting: "paxName",
    };
    const t = step(base, "Neha Sharma, 29, female, lower");
    const d = t.state.drafts[0];
    expect(d.name).toBe("Neha Sharma");
    expect(d.berthPreference ?? "").toBe("");
    expect(t.say.join(" ")).toMatch(/CC me “lower” berth nahi hoti/);
    expect(d.foodChoice ?? "").toBe("");
  });

  it("saaf station naam pehle jaisa hi chalta hai (city logic beech me nahi aata)", () => {
    const s = step(aiBookingStart(NOW).state, "ludhiana se new delhi, 1 October, 2 passengers");
    expect(s.state.from?.code).toBe("LDH");
    expect(s.state.to?.code).toBe("NDLS");
    expect(s.state.date).toBe("2026-10-01");
    expect(s.state.pendingCity).toBeNull();
  });
});

/* ══ R4 (30 Sep 2026) — user ke 2 screenshots se aaye ASLI bugs ══════════════════════════════════════
 * (a) "लुधियाना से नई दिल्ली जाना है" par AI route ULTA kar deta tha (New Delhi se Ludhiana).
 * (b) user ne route dobara bata diya to AI purana (galat) pair dohraata rehta tha.
 * (c) "बर्थ प्रेफरेंस में विंडो सेलेक्ट करो" na samajh me aaya aur wo poora vaakya NAAM ban gaya.
 * Yahan sirf in tibbi cases ke permanent tests hain (round-end regression guard).
 */
describe("R4 — direction, route restatement, Hindi berth", () => {
  it("Hindi me likha route sahi direction me set hota hai (from=LDH, to=NDLS — ulta nahi)", () => {
    const t = step(aiBookingStart(NOW).state, "लुधियाना से नई दिल्ली जाना है");
    expect(t.state.from?.code).toBe("LDH");
    expect(t.state.to?.code).toBe("NDLS");
    expect(t.state.pendingCity).toBeNull();
    expect(t.say.join(" ")).toMatch(/Ludhiana Junction se New Delhi/);
    /* date poochhi jaati hai (route confirm ho chuka) */
    expect(t.say.join(" ")).toMatch(/date/i);
  });

  it("Devanagari me ulta route bhi sahi (नई दिल्ली से लुधियाना)", () => {
    const t = step(aiBookingStart(NOW).state, "नई दिल्ली से लुधियाना जाना है");
    expect(t.state.from?.code).toBe("NDLS");
    expect(t.state.to?.code).toBe("LDH");
  });

  it("user route dobara bata de (correction) to naya pair maana jaata hai + fresh search", () => {
    let s = step(aiBookingStart(NOW).state, "लुधियाना से नई दिल्ली जाना है").state;
    s = step(s, "1 October, 2 log").state;
    expect([s.from?.code, s.to?.code]).toEqual(["LDH", "NDLS"]);
    const t = step(s, "पर मैंने तो बोला नई दिल्ली से लुधियाना जाना है ना");
    expect([t.state.from?.code, t.state.to?.code]).toEqual(["NDLS", "LDH"]);
    expect(t.state.date).toBe("2026-10-01");
    expect(t.state.pax).toBe(2);
    /* fresh search (asli provider) — maujooda SEARCH action, koi naya rasta nahi */
    const search = t.actions.find((a) => a.type === "SEARCH") as { from?: Station; to?: Station } | undefined;
    expect(search?.from?.code).toBe("NDLS");
    expect(search?.to?.code).toBe("LDH");
  });

  it("route dobara wahi bata de to kuch nahi bigadta (wahi pair, koi fresh search jhooth-moot)", () => {
    let s = step(aiBookingStart(NOW).state, "ludhiana se new delhi, 1 October, 2 passengers").state;
    const t = step(s, "Ludhiana se New Delhi hi jaana hai");
    expect([t.state.from?.code, t.state.to?.code]).toEqual(["LDH", "NDLS"]);
  });

  it("Hindi berth shabd samajh me aata hai (SL me 'विंडो' nahi chalti, CC me chalti hai)", () => {
    const sl: AiBookingState = {
      ...aiBookingStart(NOW).state,
      stage: "PASSENGER_COLLECTION",
      classCode: "SL",
      pax: 1,
      drafts: [{ name: "Rahul Sharma", age: "31", gender: "MALE" }],
      awaiting: "paxBerth",
    };
    /* SL me Window berth hoti hi nahi — invent nahi, saaf line */
    const t1 = step(sl, "बर्थ प्रेफरेंस में विंडो सेलेक्ट करो");
    expect(t1.state.drafts[0].berthPreference ?? "").toBe("");
    expect(t1.say.join(" ")).toMatch(/SL me “विंडो” berth nahi hoti/);

    const cc: AiBookingState = { ...sl, classCode: "CC" };
    const t2 = step(cc, "बर्थ प्रेफरेंस में विंडो सेलेक्ट करो");
    expect(t2.state.drafts[0].berthPreference).toBe("Window");
    expect(t2.state.drafts[0].name).toBe("Rahul Sharma");
  });

  it("Hindi berth bolne par wo vaakya NAAM nahi ban jaata (screenshot 2 ka asli bug)", () => {
    const cc: AiBookingState = {
      ...aiBookingStart(NOW).state,
      stage: "PASSENGER_COLLECTION",
      classCode: "CC",
      pax: 1,
      drafts: [{ age: "31", gender: "MALE" }],
      awaiting: "paxName",
    };
    const t = step(cc, "बर्थ प्रेफरेंस में विंडो सेलेक्ट करो");
    const d = t.state.drafts[0];
    expect(d.name ?? "").toBe("");
    expect(d.berthPreference).toBe("Window");
    /* naam abhi bhi poochha jaata hai (naam invent nahi hota) */
    expect(t.say.join(" ")).toMatch(/naam/i);
  });

  it("English berth (lower/upper) pehle jaisa hi chalta hai", () => {
    const sl: AiBookingState = {
      ...aiBookingStart(NOW).state,
      stage: "PASSENGER_COLLECTION",
      classCode: "SL",
      pax: 1,
      drafts: [{ name: "Neha Sharma", age: "29", gender: "FEMALE" }],
      awaiting: "paxBerth",
    };
    const t = step(sl, "lower berth de do");
    expect(t.state.drafts[0].berthPreference).toBe("Lower");
    expect(t.state.drafts[0].name).toBe("Neha Sharma");
  });
});
