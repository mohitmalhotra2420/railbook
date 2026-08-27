import { describe, expect, it } from "vitest";
import { extractIntent } from "../src/ai/intent";
import { planTurn } from "../src/ai/orchestrate";
import { initialBooking } from "../src/booking/state";
import {
  VOICE_MESSAGES,
  collapseRepeatWords,
  collectTranscript,
  mergeGrowingText,
  stabilizeTranscript,
  isSpeechSupported,
  mapGetUserMediaError,
  mapSpeechError,
} from "../src/voice/speech";
import { normalizeSpokenClass } from "../src/voice/spokenClass";

const NOW = new Date(2026, 7, 19);

describe("voice speech helpers", () => {
  it("maps permission and recognition errors to friendly copy", () => {
    expect(mapSpeechError("not-allowed")).toBe("denied");
    expect(mapSpeechError("audio-capture")).toBe("unavailable");
    expect(mapSpeechError("no-speech")).toBe("no-speech");
    expect(mapSpeechError("network")).toBe("failed");
    expect(VOICE_MESSAGES.denied).toMatch(/Microphone permission chahiye/);
    expect(VOICE_MESSAGES.unsupported).toMatch(/type karke/);
    expect(VOICE_MESSAGES.failed).toMatch(/Dobara try/);
    expect(mapGetUserMediaError({ name: "NotAllowedError" })).toBe("denied");
    expect(mapGetUserMediaError({ name: "NotFoundError" })).toBe("unavailable");
  });

  it("collects interim and final transcripts from recognition events", () => {
    const ev = {
      resultIndex: 0,
      results: [
        { isFinal: false, 0: { transcript: "Mujhe Amritsar" }, length: 1 },
        { isFinal: true, 0: { transcript: "Mujhe Amritsar se Delhi kal jana hai" }, length: 1 },
      ],
    };
    const { interim, final } = collectTranscript(ev);
    expect(interim).toMatch(/Amritsar/);
    expect(final).toBe("Mujhe Amritsar se Delhi kal jana hai");
  });

  it("does not stack the same spoken word twice", () => {
    const ev = {
      resultIndex: 0,
      results: [
        { isFinal: true, 0: { transcript: "gender" }, length: 1 },
        { isFinal: true, 0: { transcript: "gender male" }, length: 1 },
      ],
    };
    expect(collapseRepeatWords("जेंडर जेंडर मलै")).toBe("जेंडर मलै");
    expect(normalizeSpokenClass("एस एल")).toBe("SL");
    expect(normalizeSpokenClass("एस एस एल ई ई पी ई आर").toLowerCase()).toMatch(/sleeper|sl/);
    expect(collectTranscript(ev).final.toLowerCase()).toBe("gender male");
  });

  it("keeps one growing Hindi sentence instead of stacking copies", () => {
    const stacked =
      "देहरादून की देहरादून की एक देहरादून की एक टिकट देहरादून की एक टिकट देना देहरादून की एक टिकट देना अमृतसर देहरादून की एक टिकट देना अमृतसर से देहरादून की एक टिकट देना अमृतसर से";
    expect(stabilizeTranscript(stacked)).toBe("देहरादून की एक टिकट देना अमृतसर से");
    expect(mergeGrowingText(["देहरादून की", "देहरादून की एक", "देहरादून की एक टिकट देना अमृतसर से"])).toBe(
      "देहरादून की एक टिकट देना अमृतसर से",
    );
  });

  it("collapses Chrome hi-IN Amritsar–Ludhiana growing copies", () => {
    const stacked =
      "अमृतसर से लुधियाना की ट्रेस अमृतसर से लुधियाना की ट्रांस बताना अमृतसर से लुधियाना की ट्रांस बताना कौन-कौन अमृतसर से लुधियाना की ट्रांस बताना कौन-कौन सी अमृतसर से लुधियाना की ट्रांस बताना कौन-कौन सी है";
    const clean = stabilizeTranscript(stacked);
    expect(clean).toMatch(/अमृतसर से लुधियाना/);
    expect(clean.split("अमृतसर").length - 1).toBe(1);
    expect(clean.length).toBeLessThan(80);
    const ev = {
      resultIndex: 0,
      results: [
        { isFinal: false, 0: { transcript: "अमृतसर से लुधियाना की ट्रेस" }, length: 1 },
        { isFinal: false, 0: { transcript: "अमृतसर से लुधियाना की ट्रांस बताना" }, length: 1 },
        { isFinal: false, 0: { transcript: "अमृतसर से लुधियाना की ट्रांस बताना कौन-कौन सी है" }, length: 1 },
      ],
    };
    expect(collectTranscript(ev).interim.split("अमृतसर").length - 1).toBe(1);
  });

  it("does not claim support without a browser speech API", () => {
    expect(isSpeechSupported()).toBe(false);
  });
});

describe("on-screen voice matching", () => {
  it("selects train, class and berth from spoken screen words", async () => {
    const { matchTrainBySpeech, matchClassBySpeech, matchBerthBySpeech } = await import(
      "../src/voice/matchVisible"
    );
    const trains = [
      {
        number: "14632",
        name: "Dehradun Express",
        type: "Express",
        from: { code: "ASR", name: "ASR", city: "Amritsar" },
        to: { code: "DDN", name: "DDN", city: "Dehradun" },
        date: "2026-08-22",
        departure: "21:35",
        arrival: "09:45",
        arrivalDayOffset: 1,
        durationMinutes: 730,
        durationLabel: "12h",
        runsOn: [0, 1, 2, 3, 4, 5, 6],
        classes: [
          { code: "SL" as const, label: "Sleeper", status: "WAITLIST" as const, fare: 0, waitlist: 161 },
          { code: "3A" as const, label: "AC 3 Tier", status: "WAITLIST" as const, fare: 0, waitlist: 34 },
        ],
      },
    ];
    expect(matchTrainBySpeech("dehradun express select kro", trains)?.number).toBe("14632");
    expect(
      matchTrainBySpeech("Amritsar Shatabdi", [
        { ...trains[0], number: "22126", name: "NAGPUR AC EXP" },
        { ...trains[0], number: "12014", name: "AMRITSAR SHTABDI" },
      ])?.number,
    ).toBe("12014");
    expect(
      matchTrainBySpeech("अमृतसर शताब्दी", [
        { ...trains[0], number: "22126", name: "NAGPUR AC EXP" },
        { ...trains[0], number: "12014", name: "AMRITSAR SHTABDI" },
      ])?.number,
    ).toBe("12014");
    expect(
      matchTrainBySpeech("न्यू वंदे भारत एक्सप्रेस सिलेक्ट", [
        {
          ...trains[0],
          number: "22478",
          name: "New Delhi Vande Bharat Express",
        },
      ])?.number,
    ).toBe("22478");
    expect(matchClassBySpeech("sleeper", trains[0].classes)?.code).toBe("SL");
    expect(matchClassBySpeech("SL", trains[0].classes)?.code).toBe("SL");
    expect(matchClassBySpeech("3AC select kro", trains[0].classes)?.code).toBe("3A");
    expect(matchClassBySpeech("3", trains[0].classes)?.code).toBe("3A");
    expect(matchClassBySpeech("तीन", trains[0].classes)?.code).toBe("3A");
    expect(matchClassBySpeech("एसी 3 टियर", trains[0].classes)?.code).toBe("3A");
    expect(matchClassBySpeech("स्लीपर", trains[0].classes)?.code).toBe("SL");
    expect(matchBerthBySpeech("lower", ["Lower", "Upper", "Middle"])).toBe("Lower");
    expect(matchBerthBySpeech("side upper wali", ["Lower", "Side Upper"])).toBe("Side Upper");
    expect(matchBerthBySpeech("coupe", ["Cabin", "Coupe", "Lower", "Upper"])).toBe("Coupe");
    expect(matchBerthBySpeech("कूपे", ["Cabin", "Coupe", "Lower"])).toBe("Coupe");
    expect(matchBerthBySpeech("cabin", ["Cabin", "Coupe", "Lower"])).toBe("Cabin");
  });
});

describe("passenger voice fill", () => {
  it("fills English name and gender from speech", async () => {
    const { parsePassengerSpeech, nextPassengerAsk } = await import("../src/voice/passengerSpeech");
    expect(nextPassengerAsk({ name: "", age: "", gender: "", berthPreference: "" })).toBe("name");
    expect(nextPassengerAsk({ name: "Ravi Singh", age: "", gender: "", berthPreference: "" })).toBe("age");
    expect(nextPassengerAsk({ name: "Ravi Singh", age: "28", gender: "", berthPreference: "" })).toBe("gender");
    expect(nextPassengerAsk({ name: "Ravi Singh", age: "28", gender: "MALE", berthPreference: "" })).toBe("berth");
    expect(nextPassengerAsk({ name: "Ravi Singh", age: "28", gender: "MALE", berthPreference: "Lower" })).toBeNull();
    expect(parsePassengerSpeech("Rahul Sharma")).toMatchObject({ name: "Rahul Sharma" });
    expect(parsePassengerSpeech("female")).toMatchObject({ gender: "FEMALE" });
    expect(parsePassengerSpeech("फीमेल")).toMatchObject({ gender: "FEMALE" });
    expect(parsePassengerSpeech("जेंडर मलै").gender).toBe("MALE");
    expect(parsePassengerSpeech("फीमेल").name).toBeUndefined();
    expect(parsePassengerSpeech("male")).toMatchObject({ gender: "MALE" });
    expect(parsePassengerSpeech("male").name).toBeUndefined();
    expect(parsePassengerSpeech("mail", [], "gender")).toMatchObject({ gender: "MALE" });
    expect(parsePassengerSpeech("mail", [], "gender").name).toBeUndefined();
    expect(parsePassengerSpeech("मेल", [], "gender")).toMatchObject({ gender: "MALE" });
    expect(parsePassengerSpeech("female", [], "gender").name).toBeUndefined();
    expect(parsePassengerSpeech("other", [], "gender")).toMatchObject({ gender: "OTHER" });
    expect(parsePassengerSpeech("अदर", [], "gender")).toMatchObject({ gender: "OTHER" });
    expect(parsePassengerSpeech("male", [], "name").name).toBeUndefined();
    expect(parsePassengerSpeech("male", [], "name").gender).toBe("MALE");
    expect(parsePassengerSpeech("Rahul123")).toMatchObject({ name: "Rahul" });
    expect(parsePassengerSpeech("ladki")).toMatchObject({ gender: "FEMALE" });
    expect(parsePassengerSpeech("purush")).toMatchObject({ gender: "MALE" });
    expect(parsePassengerSpeech("mera naam Ravi Singh hai umar 28 male")).toMatchObject({
      name: "Ravi Singh",
      age: "28",
      gender: "MALE",
    });
  });

  it("keeps Hindi names instead of stripping them", async () => {
    const { parseSpokenName } = await import("../src/voice/passengerSpeech");
    expect(parseSpokenName("राहुल शर्मा")).toMatch(/राहुल/);
  });
});

describe("voice transcripts use the same intent engine", () => {
  it("understands spoken Hinglish journey phrases", () => {
    const a = extractIntent("Mujhe Amritsar se Delhi kal jana hai", NOW);
    expect(a.from?.code).toBe("ASR");
    expect(a.to).toBeUndefined();
    expect(a.unresolvedTo).toMatch(/Delhi/i);
    expect(a.date).toBe("2026-08-20");

    const b = extractIntent("Amritsar se Delhi ki do ticket book karni hai", NOW);
    expect(b.from?.code).toBe("ASR");
    expect(b.to).toBeUndefined();
    expect(b.unresolvedTo).toMatch(/Delhi/i);
    expect(b.passengerCount).toBe(2);

    const c = extractIntent("Delhi se Mumbai 20 August ko jana hai", NOW);
    expect(c.from).toBeUndefined();
    expect(c.unresolvedFrom).toMatch(/Delhi/i);
    expect(c.to).toBeUndefined();
    expect(c.unresolvedTo).toMatch(/Mumbai/i);
    expect(c.date).toBe("2026-08-20");
  });

  it("opens bookings for meri booking check karo", () => {
    const turn = planTurn({
      text: "Meri booking check karo",
      now: NOW,
      booking: initialBooking("2026-08-19"),
      prefs: {},
      saved: [],
    });
    expect(turn.openBookings).toBe(true);
  });
});
