#!/usr/bin/env npx tsx
/* ══ E2E: AI Booking ka POORA automation flow, LIVE production data ke saath ═══════════════════════════
 * User (30 Sep): "ek baar tum automation complete booking flow test kro na".
 *
 * Ye script asli app ka flow code (`src/ai/aiBookingFlow.ts`) chalti hai aur uski har need asli
 * production API se poori karti hai — koi mock, koi invent nahi:
 *
 *   journey → city/station sawaal → search (/api/trains) → train select → class select
 *   → passengers (1..2, food pantry se) → auto review (OPEN_REVIEW) → final confirm → IRCTC handoff
 *
 * Chalane ka tarika:   npx tsx tools/e2e-ai-booking-prod.mts
 * Base badalna ho:     RAILBOOK_BASE=https://railbook-gegs.onrender.com npx tsx tools/e2e-ai-booking-prod.mts
 * ══════════════════════════════════════════════════════════════════════════════════════════════════ */

import {
  aiBookingAskLine,
  aiBookingClassSelected,
  aiBookingFinalPrompt,
  aiBookingHandoffTurn,
  aiBookingPassengersReady,
  aiBookingStart,
  aiBookingSummaryLines,
  aiBookingTrainsReady,
  aiBookingTurn,
  type AiBookingState,
} from "../src/ai/aiBookingFlow";
import type { ClassAvailability, Station, TrainResult } from "../src/types";

const BASE = process.env.RAILBOOK_BASE ?? "https://railbook-gegs.onrender.com";
let failures = 0;
let checks = 0;

function ok(label: string, cond: boolean, extra = "") {
  checks += 1;
  if (!cond) failures += 1;
  console.log(`   ${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

function say(turn: { say: string[] }) {
  return turn.say.join(" | ");
}

function show(who: "USER" | "AI ", text: string) {
  console.log(`\n${who}: ${text}`);
}

async function main() {
  console.log(`\n═══ RailBook AI Booking — E2E automation test @ ${BASE} ═══`);

  /* 0) Production version + asli train data */
  const version = await getJson<{ commit: string; primaryModel: string }>("/api/version");
  console.log(`\nprod commit: ${version.commit} · model: ${version.primaryModel}`);

  const date = new Date(Date.now() + 6 * 86400_000);
  const ymd = date.toISOString().slice(0, 10);
  const dayMonth = `${date.getUTCDate()} ${date.toLocaleString("en-IN", { month: "long", timeZone: "UTC" })}`;
  console.log(`test date: ${dayMonth} (${ymd})`);

  const board = await getJson<{ trains: TrainResult[] }>(`/api/trains?from=ASR&to=NDLS&date=${ymd}`);
  console.log(`live board (ASR→NDLS): ${board.trains?.length ?? 0} trains`);
  ok("asli board aaya (search provider se)", (board.trains?.length ?? 0) > 0);

  /* 1) Flow shuru + journey (user ka asli screenshot wala shuru) */
  let state: AiBookingState = aiBookingStart(new Date()).state;
  show("AI ", say(aiBookingStart(new Date())));

  let turn = aiBookingTurn(state, "Mujhe amritsar se delhi jaana hai, 2 log");
  setState(turn.state);
  show("USER", "Mujhe amritsar se delhi jaana hai, 2 log");
  show("AI ", say(turn));

  /* "delhi" ek city hai (3 station) → AI ko ek saaf sawaal poochna chahiye (loop nahi) */
  if (state.pendingCity) {
    ok("city par loop nahi — asli station list ke saath ek sawaal", /NDLS New Delhi/.test(say(turn)));
  }

  /* Devanagari jawab bhi chalta hai (screenshot me yahi atka tha) */
  turn = aiBookingTurn(state, state.pendingCity ? "नई दिल्ली" : "NDLS");
  setState(turn.state);
  show("USER", "नई दिल्ली");
  show("AI ", say(turn));
  ok("Devanagari/Hindi station naam resolve hua", state.to?.code === "NDLS", `to=${state.to?.code}`);

  /* 2) Date + pax → asli search */
  turn = aiBookingTurn(state, `${dayMonth}, 2 log`);
  setState(turn.state);
  show("USER", `${dayMonth}, 2 log`);
  show("AI ", say(turn));
  const searchAction = turn.actions.find((a) => a.type === "SEARCH");
  ok("search action aaya (maujooda searchRoute ke through)", Boolean(searchAction));
  ok("2 passengers set hue", state.pax === 2, `pax=${state.pax}`);

  /* 3) Asli board ka result flow me */
  turn = aiBookingTrainsReady(state, board.trains);
  setState(turn.state);
  show("AI ", say(turn));
  ok("AI ne asli trains gina kar bataye", /mili hain/.test(say(turn)));
  ok("AI ne khud poochha \"kaunsi train leni hai\"", /Kaunsi train leni hai/.test(say(turn)));

  /* 4) Train select (user bolta hai, AI asli list se match karti hai) */
  const picked = board.trains.find((t) => (t.classes?.length ?? 0) > 1) ?? board.trains[0];
  const classes = picked.classes ?? [];
  turn = aiBookingTurn(state, `${picked.number} wali`, { trains: board.trains });
  setState(turn.state);
  show("USER", `${picked.number} wali`);
  show("AI ", say(turn));
  ok("train asli board se select hui", state.trainNumber === picked.number, `train=${state.trainNumber}`);
  ok("classes asli provider list se aayi", /CC|2S|3A|SL|1A|2A|EC/.test(say(turn)));

  /* 5) Class select (live availability ke saath) */
  const klass = classes.find((c) => c.status === "AVAILABLE") ?? classes[0];
  turn = aiBookingTurn(state, klass.code, { classes });
  show("USER", klass.code);
  show("AI ", say(turn));
  turn = aiBookingClassSelected(turn.state, klass, klass, { food: false });
  setState(turn.state);
  show("AI ", say(turn));
  ok("class select + passenger form khula", state.stage === "PASSENGER_COLLECTION", `stage=${state.stage}`);
  ok("AI ne passenger details khud poochhna shuru kiya", /Passenger 1 ka naam/.test(say(turn)));

  /* 6) Pantry check (food ka sawaal sirf jab train me catering ho) */
  const pantry = await getJson<{ foodChoiceExpected: boolean }>(`/api/trains/${picked.number}/pantry`);
  const food = pantry.foodChoiceExpected === true;
  console.log(`\npantry ${picked.number}: foodChoiceExpected=${food}`);

  /* 7) Passengers — AI ek-ek field khud poochhti hai */
  const paxA = food ? "Rahul Sharma, 31, male, window, veg" : "Rahul Sharma, 31, male, window";
  turn = aiBookingTurn(state, paxA, { foodExpected: food });
  setState(turn.state);
  show("USER", paxA);
  show("AI ", say(turn));
  ok("passenger 1 note hua", /Rahul Sharma/.test(say(turn)));
  ok("naam me berth shabd nahi ghusa", !/Rahul Sharma (Lower|Upper|Window)/.test(say(turn)));

  const paxB = food ? "Neha Sharma, 29, female, lower, no food" : "Neha Sharma, 29, female, lower";
  turn = aiBookingTurn(state, paxB, { foodExpected: food });
  setState(turn.state);
  show("USER", paxB);
  show("AI ", say(turn));
  ok("naam saaf raha (CC me 'lower' naam me nahi ghusa)", !/Neha Sharma Lower/.test(say(turn)));
  if (turn.state.awaiting === "paxBerth") {
    ok("class me na chalti berth par saaf line aayi", /nahi hoti/.test(say(turn)));
    turn = aiBookingTurn(turn.state, "aisle", { foodExpected: food });
    setState(turn.state);
    show("USER", "aisle");
    show("AI ", say(turn));
  }
  /* Chat raasta khud OPEN_REVIEW deta hai jab saari details mil jaayein. */
  const chatOpenedReview = turn.actions.some((a) => a.type === "OPEN_REVIEW");

  /* 8) Saari details complete → auto OPEN_REVIEW (AI khud review booking kholti hai) */
  const passengers = [
    { name: "Rahul Sharma", age: "31", gender: "MALE", berthPreference: "Window", foodChoice: food ? "VEG" : undefined },
    { name: "Neha Sharma", age: "29", gender: "FEMALE", berthPreference: "Lower", foodChoice: food ? "NO_FOOD" : undefined },
  ];
  /* View ka raasta (passenger form sync): agar chat ne pehle hi review khol diya ho to guard chalta hai. */
  const ready = aiBookingPassengersReady(state, passengers, food);
  setState(ready.state);
  if (ready.say.length) show("AI ", say(ready));
  const openedReview = chatOpenedReview || ready.actions.some((a) => a.type === "OPEN_REVIEW");
  ok("AI khud review booking kholta hai (OPEN_REVIEW)", openedReview);
  ok("stage PASSENGER_REVIEW par", state.stage === "PASSENGER_REVIEW", `stage=${state.stage}`);

  /* 9) Review screen par final sawaal (asli fare screen se) */
  /* Fare: screen ka asli total yahan available nahi (wo booking state me hota hai) — invent na karo. */
  const fareTotal = null;
  turn = aiBookingFinalPrompt(state, fareTotal);
  setState(turn.state);
  show("AI ", say(turn));
  ok("final confirmation poochha", /final details hain/.test(say(turn)));
  ok("fare invent nahi kiya (koi nakli ₹ nahi)", !/Fare ₹|Fare: ₹/.test(say(turn)));

  /* 10) "haan" → AI khud Continue to IRCTC (handoff action) */
  turn = aiBookingTurn(state, "haan");
  setState(turn.state);
  show("USER", "haan");
  show("AI ", say(turn));
  ok("IRCTC handoff action aaya (button AI khud dabata hai)", turn.actions.some((a) => a.type === "IRCTC_HANDOFF"));
  ok("login/OTP/payment user par hi hain", /Login \/ OTP \/ payment aap hi/.test(say(turn)));

  /* 11) Safety: "nahi" par IRCTC nahi khulta (edit raasta) */
  const before = aiBookingFinalPrompt({ ...state, stage: "FINAL_CONFIRMATION", awaiting: "confirm" }, fareTotal);
  const edit = aiBookingTurn(before.state, "nahi, berth badalni hai");
  ok("'nahi' par IRCTC handoff nahi hota", !edit.actions.some((a) => a.type === "IRCTC_HANDOFF"));
  ok("wapas passenger details par le jaata hai", edit.state.stage === "PASSENGER_COLLECTION", `stage=${edit.state.stage}`);

  ok("handoff line text (fallback) maujood hai", aiBookingAskLine("confirm").length > 10);
  const summary = aiBookingSummaryLines({
    from: state.from,
    to: state.to,
    date: state.date,
    trainNumber: state.trainNumber,
    trainName: state.trainName,
    classCode: state.classCode,
    passengers,
    fareTotal: null,
  }).join("\n");
  ok("summary me honest fare line (live screen se)", /review screen par live fare/.test(summary));
  ok("summary me passenger + class maujood", /Passenger 2: Neha Sharma/.test(summary) && /Class: CC/.test(summary));

  console.log(`\n═══ RESULT: ${checks - failures}/${checks} checks pass ═══`);
  if (failures) {
    console.error(`❌ ${failures} check fail — upar dekho.`);
    process.exit(1);
  }
  console.log("✅ AI Booking ka poora automation flow live prod data ke saath PASS hua.\n");

  function setState(next: AiBookingState) {
    state = next;
  }
}

main().catch((e) => {
  console.error("\n❌ E2E fail:", e instanceof Error ? e.message : e);
  process.exit(1);
});
