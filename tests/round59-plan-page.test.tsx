/* ══ ROUND-59 (29 Sep 2026, user screenshots 23:19) ═══════════════════════════════════════════════════
 * User: *"Connecting trains are not showing leg 1 and leg 2 … connecting trains next chat page pe open ho
 * same chat page par nhi"* + *"don't change the logic jo humne set kara tha connecting trains ke liye"*.
 *
 * Ye test do cheezein lock karta hai:
 *   (a) planIsShowable — connecting-only plan (routeOptions khaali, connections bhare) par bhi card bane;
 *   (b) PlanPageSheet — plan apne ALAG page par khule: loading → plan (leg 1/leg 2 + Book), back se band,
 *       khaali/error par saaf message + retry + chat fallback. Phrasing (planPageAsk) wahi R57 wali.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlanPageSheet, planIsShowable, planPageAsk, type PlanPageState } from "../src/views/Concierge";
import type { AgentJourneyPlan, AgentRouteLeg } from "../src/ai/agent";

const leg = (over: Partial<AgentRouteLeg> = {}): AgentRouteLeg => ({
  trainNumber: "12054",
  trainName: "ASR JANSHATABDI",
  from: "ASR",
  to: "PGW",
  fromName: "Amritsar Jn",
  toName: "Phagwara",
  departure: "09:20",
  arrival: "10:05",
  arrivalDayOffset: 0,
  durationMinutes: 45,
  availability: { classCode: "2S", status: "AVAILABLE", seats: 41, rac: null, waitlist: null, fare: 110, source: "confirmtkt" },
  ...over,
});

const basePlan = {
  provenance: { sources: [], freshness: "fresh" },
  query: { from: "ASR", to: "LDH", date: "2026-09-30", travelClass: null, passengers: 1, preference: "best_overall" },
  best: null,
  routeOptions: [],
  connections: [],
  alternativeDates: [],
  directUnavailable: false,
  sources: [],
  audit: { directProbed: 0, directTrains: 0, connLeg1Checked: 2, connLeg2Checked: 2, bfeStopsChecked: 0, bfeTrains: 0, connHubs: ["PGW"], passengers: 1 },
} as unknown as AgentJourneyPlan;

const connPlan = {
  ...basePlan,
  connections: [
    {
      legs: [leg(), leg({ trainNumber: "12926", trainName: "PASCHIM EXPRESS", from: "PGW", to: "LDH", availability: { classCode: "SL", status: "AVAILABLE", seats: 59, rac: null, waitlist: null, fare: 360, source: "confirmtkt" } })],
      layoverMinutes: 24,
      totalDurationMinutes: 190,
      hub: "PGW",
    },
  ],
} as unknown as AgentJourneyPlan;

function st(over: Partial<PlanPageState> = {}): PlanPageState {
  return {
    page: "connect",
    from: "ASR",
    to: "LDH",
    date: "2026-09-30",
    loading: false,
    progress: null,
    plan: connPlan,
    reply: null,
    error: null,
    tries: 1,
    ...over,
  };
}

describe("Round-59 · plan kab card banega", () => {
  it("connecting-only plan (routeOptions khaali) bhi card banata hai — yahi bug tha", () => {
    expect(planIsShowable(connPlan)).toBe(true);
    expect(planIsShowable({ ...basePlan, directUnavailable: true } as AgentJourneyPlan)).toBe(true);
    expect(planIsShowable({ ...basePlan, routeOptions: [{}] } as unknown as AgentJourneyPlan)).toBe(true);
  });
  it("khaali plan par card nahi (jhooth nahi)", () => {
    expect(planIsShowable(basePlan)).toBe(false);
    expect(planIsShowable(null)).toBe(false);
    expect(planIsShowable(undefined)).toBe(false);
  });
  it("plan maangne ka text R57 wali phrasing hi rehta hai (logic same)", () => {
    expect(planPageAsk("connect", "ASR", "LDH", "2026-09-30", 1)).toBe(
      "ASR se LDH 2026-09-30 ka poora plan banao — connecting trains aur leg-wise seat bhi dikhao (1 passenger ke liye)",
    );
    expect(planPageAsk("alt", "ASR", "LDH", "2026-09-30", 2)).toContain("alternative trains aur doosri dates bhi dikhao");
  });
});

describe("Round-59 · plan ka apna page", () => {
  it("plan aane par leg 1 + leg 2 aur Book buttons usi page par", () => {
    const onBookLeg = vi.fn();
    render(<PlanPageSheet st={st()} onClose={() => undefined} onRetry={() => undefined} onChatFallback={() => undefined} onBookLeg={onBookLeg} />);
    expect(screen.getAllByText("Connecting trains · Leg 1 → Leg 2").length).toBeGreaterThan(0);
    const books = screen.getAllByText(/Book Leg/);
    expect(books.length).toBe(2);
    fireEvent.click(books[0]);
    expect(onBookLeg).toHaveBeenCalledTimes(1);
    expect(onBookLeg.mock.calls[0][0].trainNumber).toBe("12054");
  });

  it("loading par progress + back turant kaam karta hai", () => {
    const onClose = vi.fn();
    render(<PlanPageSheet st={st({ loading: true, plan: null, progress: "Seat checks… 4/9 checks" })} onClose={onClose} onRetry={() => undefined} onChatFallback={() => undefined} />);
    expect(screen.getByText("Seat checks… 4/9 checks")).toBeTruthy();
    fireEvent.click(screen.getByText("← Wapas"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("plan na mile to saaf message + dobara try + chat fallback", () => {
    const onRetry = vi.fn();
    const onChat = vi.fn();
    render(
      <PlanPageSheet
        st={st({ plan: null, error: "Connecting options nahi mile." })}
        onClose={() => undefined}
        onRetry={onRetry}
        onChatFallback={onChat}
      />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Connecting options nahi mile/)).toBeTruthy();
    fireEvent.click(screen.getByText("↻ Dobara try"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Chat me poochho"));
    expect(onChat).toHaveBeenCalledTimes(1);
  });

  it("connect page par combo na ho to honest note (khaali page nahi)", () => {
    render(<PlanPageSheet st={st({ plan: basePlan })} onClose={() => undefined} onRetry={() => undefined} onChatFallback={() => undefined} />);
    expect(screen.getByText(/connecting combo nahi mila/)).toBeTruthy();
  });
});
