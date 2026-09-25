/* Round-20 (25 Sep, user): "passenger form IRCTC ke according same to same rakhna, except insurance,
 * payment part. Passenger details same to same IRCTC jaisa. Jis train mein catering hai usmein catering
 * rakho. Train class real train data ke according — jis train mein jo class hai wahi dikhe."
 *
 * Verify (client-only, jsdom):
 *   • Passenger form ke upar journey summary apne aap: train number · naam · date · from → to · class · fare.
 *   • IRCTC wale fields maujood: name/age/gender/berth + food (catering par) + ID proof + 2 checkbox
 *     + contact details (mobile/email/whatsapp) — aur insurance/payment ka koi block nahi.
 *   • Catering: pantry true → food choice dikhta hai; false → note, food field nahi.
 *   • Berth options us class ke hisaab se (real BERTH_BY_CLASS).
 * Chat ke lambe answer (screenshot 3) ka render bhi yahin: ReplyText. */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../src/voice/speakGuide", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/voice/speakGuide")>();
  return { ...actual, speakGuide: vi.fn(), cancelGuide: vi.fn() };
});

import { BookingProvider, useBooking } from "../src/booking/context";
import { Passengers } from "../src/views/Passengers";
import { ReplyText } from "../src/components/ReplyText";
import type { TrainResult } from "../src/types";

const train: TrainResult = {
  number: "12014",
  name: "AMRITSAR SHATABDI",
  type: "",
  from: { code: "ASR", name: "Amritsar Junction", city: "Amritsar Junction" },
  to: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana Junction" },
  date: "2026-09-26",
  departure: "04:55",
  arrival: "06:57",
  arrivalDayOffset: 0,
  durationMinutes: 122,
  durationLabel: "2h 02m",
  runsOn: [],
  classes: [{ code: "CC", label: "AC Chair Car", status: "AVAILABLE", seats: 410, fare: 490, source: "web_confirmtkt" }],
};

function stubApi(pantry: boolean | null) {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
    const u = String(url);
    const body = u.includes("/pantry")
      ? {
          trainNumber: "12014",
          pantry,
          providers: pantry == null ? [] : ["erail"],
          note: pantry == null ? "pantry info provider se nahi aayi" : null,
        }
      : u.includes("/api/meta")
        ? { provider: { id: "test", name: "Test", mock: false }, serviceFee: 50 }
        : u.includes("/api/wallet")
          ? { wallet: { balance: 10000, currency: "INR", transactions: [] } }
          : u.includes("/api/bookings")
            ? { bookings: [] }
            : {};
    return { ok: true, json: async () => body };
  });
}

function seed() {
  sessionStorage.setItem(
    "railbook.booking.v1",
    JSON.stringify({
      ...JSON.parse(JSON.stringify({})),
      screen: "passengers",
      flow: "PASSENGERS_PENDING",
      date: "2026-09-26",
      dateProvided: true,
      passengerCount: 1,
      paxProvided: true,
      trains: [train],
      selectedTrain: train,
      selectedClass: train.classes[0],
      seatPreference: "No Preference",
      passengers: [{ id: "p1", name: "", age: "", gender: "", berthPreference: "" }],
      contact: { mobile: "", email: "", whatsappOptIn: true },
    }),
  );
}

beforeEach(() => {
  sessionStorage.clear();
  stubApi(true);
  seed();
});
afterEach(() => sessionStorage.clear());

describe("Round-20 · IRCTC jaisa passenger form", () => {
  it("upar journey summary apne aap: train number, date, from → to, class, fare", async () => {
    render(
      <BookingProvider>
        <Passengers />
      </BookingProvider>,
    );
    const trip = await waitFor(() => {
      const el = document.querySelector(".pax-trip");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(trip.textContent).toContain("12014");
    expect(trip.textContent).toContain("AMRITSAR SHATABDI");
    expect(trip.textContent).toContain("2026-09-26");
    expect(trip.textContent).toContain("ASR");
    expect(trip.textContent).toContain("LDH");
    expect(trip.textContent).toContain("Amritsar Junction");
    expect(trip.textContent).toContain("Ludhiana Junction");
    expect(trip.querySelector(".pax-trip-class")?.textContent).toBe("CC");
    expect(trip.textContent).toContain("₹490");
  });

  it("IRCTC wale fields hain: passenger + contact, aur insurance/payment block nahi", async () => {
    const { container } = render(
      <BookingProvider>
        <Passengers />
      </BookingProvider>,
    );
    await waitFor(() => expect(container.querySelector(".pax-trip")).toBeTruthy());
    expect(screen.getByLabelText(/Name/i)).toBeTruthy();
    expect(screen.getByLabelText(/Age/i)).toBeTruthy();
    expect(screen.getByLabelText(/Gender/i)).toBeTruthy();
    expect(screen.getByLabelText(/Berth preference/i)).toBeTruthy();
    expect(screen.getByLabelText(/ID proof/i)).toBeTruthy();
    expect(screen.getByText(/Book only if confirm berths are allotted/i)).toBeTruthy();
    expect(screen.getByText(/Consider for auto up-gradation/i)).toBeTruthy();
    expect(screen.getByLabelText(/Mobile number/i)).toBeTruthy();
    expect(screen.getByLabelText(/^Email/i)).toBeTruthy();
    expect(screen.getByText(/Journey updates WhatsApp/i)).toBeTruthy();
    /* Insurance / payment ka koi field yahan nahi (user ne chhoda) */
    expect(container.textContent).not.toMatch(/insurance premium|travel insurance|UPI|net banking/i);
  });

  it("catering: pantry ho to food choice IRCTC jaisa, warna field nahi", async () => {
    const { container, unmount } = render(
      <BookingProvider>
        <Passengers />
      </BookingProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText(/Food choice/i)).toBeTruthy());
    const food = screen.getByLabelText(/Food choice/i) as HTMLSelectElement;
    expect([...food.options].map((o) => o.textContent)).toEqual(["Select", "Veg meal", "Non-veg meal", "No food (mujhe nahi chahiye)"]);
    expect(container.querySelector(".pax-catering")?.textContent).toMatch(/pantry hai/i);
    unmount();

    /* pantry false → khaana field nahi, aur honest note (kuch invent nahi) */
    stubApi(false);
    const { container: c2 } = render(
      <BookingProvider>
        <Passengers />
      </BookingProvider>,
    );
    await waitFor(() => expect(c2.querySelector(".pax-catering")).toBeTruthy());
    await waitFor(() => expect(String(c2.querySelector(".pax-catering")?.textContent)).toMatch(/pantry nahi hai/i));
    expect(c2.querySelector("#food-p1")).toBeNull();
  });

  it("berth options us class ke hisaab se (asli data — CC me window/aisle)", async () => {
    const { container } = render(
      <BookingProvider>
        <Passengers />
      </BookingProvider>,
    );
    await waitFor(() => expect(container.querySelector(".pax-trip")).toBeTruthy());
    const berth = screen.getByLabelText(/Berth preference/i) as HTMLSelectElement;
    const opts = [...berth.options].map((o) => o.value).filter(Boolean);
    expect(opts).toContain("Window");
    expect(opts).toContain("Aisle");
    expect(opts).not.toContain("Side Lower"); /* sleeper ka berth CC me nahi */
  });

  it("mobile sirf 10 digit (IRCTC jaisa) — warna review block", async () => {
    render(
      <BookingProvider>
        <Passengers />
      </BookingProvider>,
    );
    const mob = await waitFor(() => screen.getByLabelText(/Mobile number/i) as HTMLInputElement);
    fireEvent.change(mob, { target: { value: "98abc76543210" } });
    expect(mob.value).toBe("9876543210");
  });
});

describe("Round-20 · chat ka lamba answer", () => {
  it("bullet wali train rows ko sundar rows me todta hai (koi line nahi chhupti)", () => {
    const text = [
      "Window ke hisaab se (04:00-12:00) — ASR → LDH, sab class, sabhi trains:",
      "• 12014 AMRITSAR SHATABDI – CC AVAILABLE 410 seats ₹490, dep 04:55",
      "• 14653 HSR ASR EXPRESS – SL AVAILABLE 9 seats ₹150, dep 04:35",
      "• 18309 SBP JAT EXPRESS – SL WL 12 ₹150, dep 05:16",
    ].join("\n");
    const { container } = render(<ReplyText text={text} />);
    expect(container.querySelectorAll(".rp-row").length).toBe(3);
    const rows = [...container.querySelectorAll(".rp-row")].map((r) => r.textContent);
    expect(rows[0]).toContain("12014");
    expect(rows[0]).toContain("AVL 410");
    expect(rows[0]).toContain("₹490");
    expect(rows[2]).toContain("WL 12");
    expect(container.querySelector(".rp-st.wl")).toBeTruthy();
    expect(container.textContent).toContain("Window ke hisaab se");
  });

  it("pattern match na ho to poora text waisa hi (kuch chhupta nahi)", () => {
    const text = "Direct trains nahi mili. Alternatives dekho ya doosri date try karo.";
    const { container } = render(<ReplyText text={text} />);
    expect(container.querySelectorAll(".rp-row").length).toBe(0);
    expect(container.textContent).toBe(text);
  });

  it("screenshot 3 wala ek-line jawab (star bullets) bhi rows me tootta hai", () => {
    const text =
      "LDH → ASR, kal 26 Sep, Dopahar 12:00–17:00 window: * 11057 CSMT ASR EXPRESS – 3E AVAILABLE 44 seats ₹520, dep 12:55 * 11057 CSMT ASR EXPRESS – 2A AVAILABLE 18 seats ₹725, dep 12:55 * 14649 SARYU YAMUNA EX – 3A AVAILABLE 1 seat ₹520, dep 14:16 * 14649 SARYU YAMUNA EX – 2A AVAILABLE 1 seat ₹725, dep 14:16 * 14649 SARYU YAMUNA EX – 1A AVAILABLE 3 seats ₹1190, dep 14:16 22 trains check ki, is window me seat wali 2 trains dikh rahi hain.";
    const { container } = render(<ReplyText text={text} />);
    const rows = [...container.querySelectorAll(".rp-row")].map((r) => r.textContent);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain("11057");
    expect(rows[0]).toContain("AVL 44");
    expect(rows[0]).toContain("₹520");
    expect(rows[0]).toContain("12:55");
    expect(rows[4]).toContain("1A");
    /* window wali line upar chip me, aur aakhri sentence neeche tail me (kuch nahi chhupta) */
    expect(container.querySelector(".rp-headchip")?.textContent).toContain("LDH → ASR");
    expect(container.querySelector(".rp-tail")?.textContent).toContain("22 trains check ki");
  });

  it("server ke SEAT rows (pipe) bhi rows ban jaate hain", () => {
    const text =
      "ASR → LDH · live board\nSEAT (3 rows): 12014 AMRITSAR SHTABDI · CC · AVAILABLE 475 seats · ₹510 · 04:55 | 12926 PASCHIM EXPRESS · 2A · AVAILABLE 15 seats · ₹770 · 07:20 | 14654 ASR HSR EXPRESS · SL · WAITLIST 30 · ₹150 · 15:10";
    const { container } = render(<ReplyText text={text} />);
    expect(container.querySelectorAll(".rp-row").length).toBe(3);
    expect(container.querySelector(".rp-st.wl")?.textContent).toContain("WL 30");
  });
});
