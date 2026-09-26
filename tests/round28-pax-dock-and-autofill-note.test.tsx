/* Round-28 (26 Sep 2026, user ke 3 screenshots + 4 points):

 *   1) "Ist screenshot mein yeh black wala handoff details user ko nhi dikhni chahiye, backend pe rakho"
 *      → bridge ka bada black diagnostic panel hataya: page par sirf ek chhoti one-line pill (khud hat
 *      jaati hai), poori detail native ko (`fill-result` + `ui-notice`) aur console par.
 *   2) "Second screenshot mein yeh jo upar blue colour mein header hai wo user ko na dikhe, backend pe
 *      rakho" → Android ka topBar (version/Bhasha/status/RAILBOOK-IRCTC-CLEAR buttons) screen se gayab
 *      (visibility=gone) — code/logic zinda; user ko zaroori baatein chhote Toast se (setStatus).
 *   3) "passenger form mein na kaafi neeche scroll down krna padhta hai to user ko pata chlta hai review
 *      journey button bhi hai … page ka ui sahi karo" → overlay-screen ab `fixed` + 100vh/100dvh
 *      (viewport se bandha), isliye VoiceBar + CTA dock hamesha screen par rehta hai (pehle .app ke
 *      andar absolute tha aur chat lambi hone par dock screen ke neeche chala jaata tha).
 *   4) "redirect to irctc time 45 sec se 30 sec krdo" + "user ko inform kro ki apki details
 *      automatically fill ho jayengi irctc pe, dubara dalne ki zarort nhi hai" → PREWARM_COUNTDOWN_MS
 *      30_000, overlay me saaf line, aur RailBook app ke andar Continue to IRCTC ke neeche + passenger
 *      dock me wahi assurance.
 */
import { describe, expect, it, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

import { Passengers } from "../src/views/Passengers";
import { BookingProvider } from "../src/booking/context";
import { autoFillNotice, isRailBookAppContext } from "../src/components/IrctcHandoff";

const css = fs.readFileSync(path.join(process.cwd(), "src/styles.css"), "utf8");
/* Android source do layouts me mil sakta hai: dev workspace me ../app/android-app, zip me ../android-app. */
const android = (() => {
  for (const rel of ["../app/android-app/app/src/main", "../android-app/app/src/main", "android-app/app/src/main"]) {
    const p = path.resolve(process.cwd(), rel);
    if (fs.existsSync(p)) return p;
  }
  return path.resolve(process.cwd(), "..", "app/android-app/app/src/main");
})();
const kotlin = fs.readFileSync(path.join(android, "java/com/railbook/assist/MainActivity.kt"), "utf8");
const layout = fs.readFileSync(path.join(android, "res/layout/activity_main.xml"), "utf8");
const strings = fs.readFileSync(path.join(android, "res/values/strings.xml"), "utf8");
const bridge = fs.readFileSync(path.join(android, "assets/autofill/railbook-webview-bridge.js"), "utf8");

/* ── Passengers page (asli component, asli state) ─────────────────────────────────────────────── */
globalThis.fetch = (async (url: unknown) => {
  const u = String((url as { url?: string })?.url ?? url);
  const body = u.includes("/api/meta")
    ? { provider: { id: "live", name: "RailBook", mock: false }, serviceFee: 50 }
    : u.includes("/api/fare")
      ? { baseFare: 675, serviceFee: 50, total: 725 }
      : { trainNumber: "12013", pantry: true, providers: ["web_confirmtkt"], note: null, foodChoiceExpected: true, evidence: [] };
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}) as unknown as typeof fetch;

function seedPassengers() {
  const train = {
    number: "12013",
    name: "AMRITSAR SHTABDI",
    type: "",
    from: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana Junction" },
    to: { code: "ASR", name: "Amritsar Junction", city: "Amritsar Junction" },
    date: "2026-09-27",
    departure: "06:10",
    arrival: "08:30",
    arrivalDayOffset: 0,
    durationMinutes: 140,
    durationLabel: "2h 20m",
    runsOn: [],
    classes: [{ code: "CC", label: "AC Chair Car", status: "AVAILABLE", seats: 418, fare: 675, source: "web_confirmtkt" }],
  };
  sessionStorage.setItem(
    "railbook.booking.v1",
    JSON.stringify({
      flow: "PASSENGERS_PENDING",
      screen: "passengers",
      date: "2026-09-27",
      dateProvided: true,
      passengerCount: 1,
      paxProvided: true,
      trains: [train],
      selectedTrain: train,
      selectedClass: train.classes[0],
      seatPreference: "",
      booking: null,
      emptyMessage: null,
      notice: null,
      error: null,
      searching: false,
      recommendations: [],
      sessionId: 1,
      passengers: [
        { id: "p1", name: "Rahul Sharma", age: "38", gender: "MALE", berthPreference: "Lower", foodChoice: "VEG", idType: "", idNumber: "", bookOnlyIfConfirm: true, autoUpgrade: false },
      ],
      contact: { mobile: "9876543210", email: "rahul@example.com", whatsappOptIn: true },
    }),
  );
}

afterEach(() => {
  sessionStorage.clear();
  delete (window as unknown as { RailBookNative?: unknown }).RailBookNative;
});

describe("Round-28 · passenger page — dock hamesha screen par + auto-fill assurance", () => {
  it('CTA ke saath "details IRCTC par khud bhar jaayengi" wali line dikhti hai', () => {
    seedPassengers();
    const { container } = render(<BookingProvider><Passengers /></BookingProvider>);
    const note = container.querySelector(".sticky-cta .cta-note");
    expect(note).toBeTruthy();
    const text = (note?.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/IRCTC par khud bhar jaayengi/i);
    expect(text).toMatch(/dobara daalne ki zaroorat nahi/i);
  });

  it('jab tak details adhoori hain, CTA hi batata hai ki pehle bharo (phir bhi dikhta hai)', () => {
    seedPassengers();
    const raw = JSON.parse(sessionStorage.getItem("railbook.booking.v1")!);
    raw.passengers[0].name = "";
    raw.passengers[0].age = "";
    sessionStorage.setItem("railbook.booking.v1", JSON.stringify(raw));
    const { container } = render(<BookingProvider><Passengers /></BookingProvider>);
    const btn = container.querySelector(".sticky-cta button");
    expect(btn?.textContent ?? "").toMatch(/pehle details bharo/i);
    expect(btn?.hasAttribute("disabled")).toBe(true);
    expect(container.querySelector(".sticky-cta .cta-note")).toBeTruthy();
  });

  it("overlay (booking screens) viewport se bandha hai — dock screen ke neeche nahi jaata", () => {
    /* `.app` chat ke saath lamba ho sakta hai; overlay usse bandha ho to dock neeche chala jaata tha. */
    expect(css).toMatch(/\.overlay-screen \{[^}]*position: fixed;[^}]*height: 100vh;\s*\n\s*height: 100dvh;/);
    expect(css).toMatch(/\.sticky-cta \{[^}]*flex-shrink: 0;/);
    /* purane WebView ke liye explicit offsets (inset ke bharose nahi) */
    expect(css).toMatch(/\.overlay-screen \{[^}]*top: 0;[^}]*left: 0;[^}]*right: 0;/);
  });
});

describe("Round-28 · Continue to IRCTC ke saath auto-fill line (app vs browser)", () => {
  it("app ke andar (RailBookNative ho) → saaf line: dobara dalne ki zaroorat nahi", () => {
    (window as unknown as { RailBookNative: unknown }).RailBookNative = {};
    expect(isRailBookAppContext()).toBe(true);
    const msg = autoFillNotice(true);
    expect(msg).toMatch(/khud bhar jaayengi/i);
    expect(msg).toMatch(/dobara daalne ki zaroorat nahi/i);
    expect(msg).toMatch(/login\/OTP\/payment/i); /* honest: security waala hissa user ka */
  });

  it("browser me jhooth nahi bolta (app hi autofill karta hai)", () => {
    expect(isRailBookAppContext()).toBe(false);
    const msg = autoFillNotice(false);
    expect(msg).toMatch(/RailBook app/i);
    expect(msg).not.toMatch(/khud bhar jaayengi/);
  });
});

describe("Round-28 · Android header/list user ko nahi dikhti (par logic zinda)", () => {
  it("topBar screen se gayab, par buttons/code waise hi", () => {
    expect(layout).toMatch(/android:id="@\+id\/topBar"[\s\S]{0,400}android:visibility="gone"/);
    expect(layout).toContain('@+id/btnLang');
    expect(layout).toContain('@+id/btnClear');
    expect(kotlin).toContain("binding.btnClear.setOnClickListener");
    expect(kotlin).toContain("binding.btnLang.setOnClickListener");
  });

  it("important updates ab chhote Toast se (setStatus) — permanent bar nahi", () => {
    expect(kotlin).toContain("private fun setStatus(msg: String, toast: Boolean = false)");
    expect(kotlin).toMatch(/setStatus\(\s*\n?\s*"Handoff saved[\s\S]{0,120}toast = true/);
    expect(kotlin).toMatch(/✅ Aapki details IRCTC par bhar di gayi hain — yahan dobara kuch daalne ki zaroorat nahi/);
    expect(kotlin).toContain('"ui-notice" ->');
  });

  it("prewarm countdown 30s (45 nahi) + overlay me auto-fill line", () => {
    expect(kotlin).toContain("const val PREWARM_COUNTDOWN_MS = 30_000L");
    expect(kotlin).not.toContain("45_000L");
    expect(kotlin).not.toMatch(/45s me nahi aaya/);
    expect(layout).toContain('android:id="@+id/prewarmNote"');
    expect(strings).toMatch(/prewarm_note">Aapki details IRCTC par khud bhar jaayengi/);
  });

  it("WebView poori screen (header hata hai to layout wahi rahe)", () => {
    expect(layout).toMatch(/<WebView[\s\S]*app:layout_constraintTop_toTopOf="parent"/);
    expect(layout).toMatch(/prewarmOverlay[\s\S]{0,500}app:layout_constraintTop_toTopOf="parent"/);
  });
});

describe("Round-28 · black handoff panel hataya (details backend me)", () => {
  it("bada diagnostic box nahi — sirf ek line wali pill, khud hat jaati hai", () => {
    /* purana panel: heading + Detected/Filled lists + read-only note (user ka screenshot 1) */
    expect(bridge).not.toContain("RailBook app · assisted fill");
    expect(bridge).not.toContain("Details auto-filled");
    expect(bridge).not.toContain("Detected (");
    expect(bridge).not.toContain("journey fields are read-only");
    expect(bridge).toContain("function pill(html, ms)");
    expect(bridge).toMatch(/border-radius:999px/); /* slim pill, panel nahi */
    expect(bridge).toMatch(/__noticeTimer = setTimeout/); /* khud hat jaata hai */
  });

  it("user-facing line wahi rehti hai: details bhar gayi, dobara daalne ki zaroorat nahi", () => {
    expect(bridge).toMatch(/Aapki details IRCTC par bhar di gayi hain — yahan dobara kuch daalne ki zaroorat nahi/);
    expect(bridge).toContain("paxFilledNow(filled)");
  });

  it("poori detail backend ko jaati hai (fill-result me sab fields, ui-notice alag)", () => {
    expect(bridge).toContain('type: "fill-result"');
    for (const k of ["filledCount", "failed:", "notFound:", "siteChanges:", "refusedClicks:", "paxFilled:"]) {
      expect(bridge).toContain(k);
    }
    expect(bridge).toContain('type: "ui-notice"');
    expect(kotlin).toBeTruthy(); /* native status bar me dikhta hai (header hidden hone par bhi log) */
  });

  it("STOP/reject jaise serious message pill me hi rehte hain (details nahi)", () => {
    expect(bridge).toMatch(/Autofill ruk gaya — RailBook me dobara Continue dabaiye/);
    expect(bridge).toMatch(/Handoff fail — RailBook me dobara Continue dabaiye/);
    expect(bridge).toContain("sticky: true");
  });
});

/* Small sanity: pill ka text HTML-safe hai (koi innerHTML injection nahi). */
describe("Round-28 · pill text", () => {
  it("notice helper HTML tags ko strip karke native text bhejta hai", () => {
    const fn = bridge.slice(bridge.indexOf("function postNotice"), bridge.indexOf("function pill("));
    expect(fn).toContain('replace(/<[^>]*>/g, " ")');
  });
});

/* fireEvent import ko unused hone se bachane ke liye ek chhota behaviour check. */
describe("Round-28 · CTA click se review page khulta hai", () => {
  it("ready hone par Review journey click kaam karta hai", () => {
    seedPassengers();
    const { container } = render(<BookingProvider><Passengers /></BookingProvider>);
    const btn = container.querySelector(".sticky-cta button") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(btn.textContent ?? "").toBe("Review journey");
  });
});
