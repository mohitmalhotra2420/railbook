/* Round-27 (26 Sep 2026, user screenshots) — teen cheezein:

 *   1) "Yeh ek hi class dikha raha, jabhi ki aur bhi classes mein seat available hai same train mein
 *      (ConfirmTkt par check kiya) … mere question ke answer mein" → seat wali line me ab har train ki
 *      **saari** classes ek saath (`12013 AMRITSAR SHTABDI — CC AVL 444 ₹675 · 3A AVL 71 ₹520 · EC AVL 23
 *      ₹1,015`), aur chat me train-wise block (SeatListBlock) — koi class chhupi nahi.
 *   2) "Baki ki trains live board par hai aa raha" + "agar yahan koi class pe tap kare to user ko seedha
 *      passenger form pe laajao" → chat ka seat answer ab live-board rows se train-wise block banata hai
 *      aur har class chip tappable hai (tap = usi train/class ka passenger form, wahi bookingFromSeatRow
 *      flow jo Seat Finder/direct card ke chips par lagta hai).
 *   3) "Mic working nahi hai" → Android WebView me Web Speech API nahi hota; app ka naya native
 *      SpeechRecognizer bridge (window.RailBookVoice) + client adapter (`nativeSpeech.ts`).
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

import { groupRowsByTrain, missingSeatLines, seatSummaryLine, trainClassesText, type SeatFilterRow } from "../server/agent/seatFilter";
import { seatListGroups, stripDuplicatedSeatRows } from "../src/chatText";
import { ReplyText } from "../src/components/ReplyText";
import { TrainClassBlock } from "../src/components/TrainClassBlock";
import { createRecognizer, isSpeechSupported } from "../src/voice/speech";
import { hasNativeVoice } from "../src/voice/nativeSpeech";

const mk = (number: string, name: string, classCode: string, status: string, extra: Partial<SeatFilterRow> = {}): SeatFilterRow => ({
  number,
  name,
  classCode,
  status,
  seats: status === "AVAILABLE" ? 50 : null,
  rac: status === "RAC" ? 9 : null,
  waitlist: status === "WAITLIST" ? 14 : null,
  fare: 150,
  departure: "06:10",
  durationMinutes: 300,
  ...extra,
});

describe("Round-27 · ek train ki SAARI classes (ek hi class nahi)", () => {
  it("groupRowsByTrain + trainClassesText — train ki saari classes ek text me", () => {
    const rows = [
      mk("12013", "AMRITSAR SHTABDI", "CC", "AVAILABLE", { seats: 444, fare: 675 }),
      mk("12013", "AMRITSAR SHTABDI", "EC", "AVAILABLE", { seats: 23, fare: 1015 }),
      mk("19611", "All ASR EXP", "SL", "AVAILABLE", { seats: 174 }),
    ];
    const groups = groupRowsByTrain(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0].number).toBe("12013");
    expect(groups[0].classes.map((c) => c.classCode)).toEqual(["CC", "EC"]);
    expect(trainClassesText(groups[0].classes)).toBe("CC AVL 444 ₹675 · EC AVL 23 ₹1,015");
  });

  it("summary line: har train ke saath uski saari classes (aur count bhi sahi)", () => {
    const pick = {
      seat: [
        mk("12013", "AMRITSAR SHTABDI", "CC", "AVAILABLE", { seats: 444, fare: 675 }),
        mk("12013", "AMRITSAR SHTABDI", "EC", "AVAILABLE", { seats: 23, fare: 1015 }),
        mk("19611", "All ASR EXP", "SL", "AVAILABLE", { seats: 174 }),
        mk("19611", "All ASR EXP", "3A", "AVAILABLE", { seats: 71, fare: 520 }),
      ],
      wl: [],
      missingClass: 0,
      unknownTime: 0,
    };
    const line = seatSummaryLine(
      pick,
      { classCodes: [], classGroup: null, onlyAvailable: true, sortBy: null, departAfterMinute: null },
      { from: "LDH", to: "ASR" },
    );
    expect(line).toContain("2 trains");
    expect(line).toContain("12013 CC AVL 444 ₹675 · EC AVL 23 ₹1,015");
    expect(line).toContain("19611 SL AVL 174 ₹150 · 3A AVL 71 ₹520");
  });

  it("missingSeatLines: jo train jawab me nahi aayi, uski SAARI classes ek line me", () => {
    const rows = [
      mk("12013", "AMRITSAR SHTABDI", "CC", "AVAILABLE", { seats: 444, fare: 675 }),
      mk("12013", "AMRITSAR SHTABDI", "3A", "AVAILABLE", { seats: 71, fare: 520 }),
      mk("12013", "AMRITSAR SHTABDI", "EC", "AVAILABLE", { seats: 23, fare: 1015 }),
    ];
    const lines = missingSeatLines("Kuch aur train 19611 ki baat", rows);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\* 12013 AMRITSAR SHTABDI — CC AVL 444 ₹675 · 3A AVL 71 ₹520 · EC AVL 23 ₹1,015 — 06:10 departure$/);
  });

  it("seatListGroups (client): train-wise groups + seat count (WL bhi dikhti hai)", () => {
    const groups = seatListGroups([
      { number: "12013", name: "SHTABDI", classCode: "CC", status: "AVAILABLE", seats: 444, rac: null, waitlist: null, fare: 675, departure: "06:10" },
      { number: "12013", name: "SHTABDI", classCode: "EC", status: "AVAILABLE", seats: 23, rac: null, waitlist: null, fare: 1015, departure: "06:10" },
      { number: "12926", name: "PASCHIM EXPRESS", classCode: "SL", status: "WAITLIST", seats: null, rac: null, waitlist: 60, fare: 285, departure: "07:20" },
    ]);
    expect(groups.map((g) => g.number)).toEqual(["12013", "12926"]);
    expect(groups[0].seatCount).toBe(2);
    expect(groups[1].seatCount).toBe(0);
    expect(groups[1].rows[0].status).toBe("WAITLIST");
  });

  it("chat ke chips: tap par wahi row callback (class → passenger form ka rasta)", () => {
    const picked: string[] = [];
    const { container } = render(
      <TrainClassBlock
        number="12013"
        name="AMRITSAR SHTABDI"
        countText="2 classes (2 me seat)"
        rows={[
          { code: "CC", status: "AVAILABLE", seats: 444, fare: 675, seat: true },
          { code: "3A", status: "AVAILABLE", seats: 71, fare: 520, seat: true },
        ]}
        onChip={(c) => picked.push(c.code)}
      />,
    );
    const chips = [...container.querySelectorAll(".sf-cchip")] as HTMLElement[];
    expect(chips).toHaveLength(2);
    fireEvent.click(chips[0]);
    fireEvent.click(chips[1]);
    expect(picked).toEqual(["CC", "3A"]);
    /* chips par status/fare bhi wahi jo row me tha */
    expect(chips[0].textContent).toContain("CC");
    expect(chips[0].textContent).toContain("AVL 444");
    expect(chips[0].textContent).toContain("675");
  });

  it("text se duplicate seat rows hat jaate hain (block me waise bhi zyada detail dikhti hai)", () => {
    const text = [
      "27 Sep 2026, SL class, 1 passenger ke liye seat wali trains mili hain:",
      "* 12013 AMRITSAR SHTABDI — CC — AVAILABLE 444 seats — ₹675",
      "* 19611 All ASR EXP — SL — AVAILABLE 174 seats — ₹150 — 06:10 departure",
      "💺 18 trains — 10 me seat (AVL/RAC), 8 me WL/N-A: …",
      "Ye sab live board se hain.",
    ].join("\n");
    const clean = stripDuplicatedSeatRows(text);
    expect(clean).not.toContain("* 12013");
    expect(clean).not.toContain("* 19611");
    expect(clean).toContain("💺 18 trains"); /* summary line rehti hai */
    expect(clean).toContain("Ye sab live board se hain."); /* prose rehti hai */
  });

  it("ReplyText: grouped line se us train ki SAARI classes ki rows banti hain (AVL compact bhi)", () => {
    const reply =
      "27 Sep 2026, 1 passenger ke liye seat wali trains:\n" +
      "* 12013 AMRITSAR SHTABDI — CC AVL 444 ₹675 · 3A AVL 71 ₹520 · EC AVL 23 ₹1,015 — 06:10 departure\n" +
      "* 12926 PASCHIM EXPRESS — SL WL 60 ₹285 · 3A N/A";
    const { container } = render(<ReplyText text={reply} />);
    const rows = [...container.querySelectorAll(".rp-row")].map((el) => el.textContent ?? "");
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const all = rows.join(" | ");
    expect(all).toContain("12013");
    expect(all).toContain("CC");
    expect(all).toContain("444");
    expect(all).toContain("3A");
    expect(all).toContain("71");
    expect(all).toContain("EC");
    expect(all).toContain("1,015");
    expect(all).toContain("12926");
    expect(all).toContain("60");
  });

  it("Concierge me wiring maujood hai (seatlist block + chip tap → onBookSeat)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/views/Concierge.tsx"), "utf8");
    expect(src).toContain('type: "seatlist"');
    expect(src).toContain("agentRes.seatFilter");
    expect(src).toMatch(/onBookSeat\?\.\(row/);
    expect(src).toContain("SeatListBlock");
    expect(src).toContain("seatListGroups");
  });
});

describe("Round-27 · mic — native bridge (Android WebView me Web Speech nahi hota)", () => {
  afterEach(() => {
    delete (window as unknown as { RailBookVoice?: unknown }).RailBookVoice;
    delete (window as unknown as { __railbookVoice?: unknown }).__railbookVoice;
  });

  it("bridge na ho (browser) → purana Web Speech behaviour, native nahi", () => {
    expect(hasNativeVoice()).toBe(false);
    const rec = createRecognizer("hi-IN");
    /* jsdom me SpeechRecognition nahi hota — isliye null; asli browser me Web Speech milta hai. */
    expect(rec).toBeNull();
  });

  it("bridge ho (RailBook app) → native recognizer: start/stop + asli transcripts", () => {
    const calls: string[] = [];
    (window as unknown as { RailBookVoice: unknown }).RailBookVoice = {
      start: (lang: string) => calls.push(`start:${lang}`),
      stop: () => calls.push("stop"),
      abort: () => calls.push("abort"),
      isAvailable: () => true,
    };
    expect(hasNativeVoice()).toBe(true);
    expect(isSpeechSupported()).toBe(true); /* app me mic supported maana jaata hai */

    const rec = createRecognizer("hi-IN");
    expect(rec).toBeTruthy();
    const finals: string[] = [];
    const partials: string[] = [];
    rec!.onresult = (ev) => {
      const t = ev.results[0]?.[0]?.transcript ?? "";
      if (ev.results[0]?.isFinal) finals.push(t);
      else partials.push(t);
    };
    const dispatch = (window as unknown as { __railbookVoice: { dispatch: (j: string) => void } }).__railbookVoice.dispatch;

    rec!.start();
    expect(calls[0]).toBe("start:hi-IN");
    dispatch(JSON.stringify({ type: "start" }));
    dispatch(JSON.stringify({ type: "partial", text: "ludhiana se" }));
    dispatch(JSON.stringify({ type: "final", text: "Ludhiana se Amritsar SL me seat" }));
    expect(partials).toEqual(["ludhiana se"]);
    expect(finals).toEqual(["Ludhiana se Amritsar SL me seat"]);

    rec!.stop();
    expect(calls).toContain("stop");

    /* error bhi wahi shape me aata hai jo purana flow padhta hai */
    const errs: string[] = [];
    rec!.onerror = (ev) => errs.push(String(ev.error));
    dispatch(JSON.stringify({ type: "error", code: "not-allowed" }));
    dispatch(JSON.stringify({ type: "end" }));
    expect(errs).toEqual(["not-allowed"]);
  });

  it("app ka native bridge sach me maujood hai (Kotlin + manifest)", () => {
    const root = path.resolve(process.cwd(), "..", "app/android-app/app/src/main");
    const kt = fs.readFileSync(path.join(root, "java/com/railbook/assist/VoiceBridge.kt"), "utf8");
    expect(kt).toContain("SpeechRecognizer.createSpeechRecognizer");
    expect(kt).toContain("RecognizerIntent.EXTRA_PARTIAL_RESULTS");
    expect(kt).toContain("window.__railbookVoice");
    const main = fs.readFileSync(path.join(root, "java/com/railbook/assist/MainActivity.kt"), "utf8");
    expect(main).toContain('addJavascriptInterface(vb, "RailBookVoice")');
    const manifest = fs.readFileSync(path.join(root, "AndroidManifest.xml"), "utf8");
    expect(manifest).toContain("android.speech.RecognitionService");
    expect(manifest).toContain("android.permission.RECORD_AUDIO");
  });
});
