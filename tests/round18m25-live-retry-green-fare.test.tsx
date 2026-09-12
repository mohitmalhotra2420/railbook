/* Round-18m-25 (user JAT→NDLS screenshots, 12:57 IST): (1) side pill "2A AVL 56" bina fare; (2) AVL "Not
 * fresh" tan/yellow tha — available = green hamesha; (3) data 12 din purana — railyatri live pull
 * transient "Unable to perform Transaction" par turant cache par gir jaata tha; ab 2 retry, phir cache. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, render } from "@testing-library/react";
import React from "react";
import { scrapeSeatAvailabilityWeb, setScrapeFetch } from "../server/railway/webscrape.js";
import { JourneyOptions } from "../src/components/JourneyOptions";
import type { AgentJourneyPlan } from "../src/ai/agent";

describe("Round-18m-25", () => {
  it("railyatri: transient live failure → retried live (fresh IRCTC), NOT the 12-day-old cache", async () => {
    const d = new Date(Date.now() + 2 * 86400000);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const key = `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
    const nowIso = new Date().toISOString().replace("Z", "+05:30");
    const calls: string[] = [];
    setScrapeFetch(async (u: unknown) => {
      calls.push(String(u));
      const live = String(u).includes("refresh=true");
      if (live && calls.filter((c) => c.includes("refresh=true")).length === 1) return new Response(JSON.stringify({ success: false, error: "Unable to perform Transaction, Please try later.", data_from: "IRCTC", seat_availibility: [] }), { status: 200 });
      if (live) return new Response(JSON.stringify({ success: true, data_from: "IRCTC", seat_availibility: [{ availablity_date: key, availablity_status: "GNWL6/WL4", ticket_fare: 1345, last_updated_at: nowIso }] }), { status: 200 });
      return new Response(JSON.stringify({ success: true, data_from: "CACHED", seat_availibility: [{ availablity_date: key, availablity_status: "AVAILABLE-0056", ticket_fare: 1345, last_updated_at: "2026-08-31 13:37:50 +0530", cache_text: "As of 12 days ago" }] }), { status: 200 });
    });
    try {
      const r = await scrapeSeatAvailabilityWeb("19804", ymd, "JAT", "NDLS", "2A", "GN");
      expect(calls.filter((c) => c.includes("refresh=true")).length).toBe(2);
      expect(calls.some((c) => !c.includes("refresh=true"))).toBe(false); // cache never consulted
      expect(r?.status).toBe("WAITLIST");
      expect(r?.waitlist).toBe(4);
      expect(r?.live).toBe(true);
    } finally { setScrapeFetch(null); }
  }, 15000);
  it("maintenance window → no live retry, straight to cache", async () => {
    const d = new Date(Date.now() + 2 * 86400000);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const key = `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
    const now = new Date(); const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} 00:05:00 +0530`;
    const calls: string[] = [];
    setScrapeFetch(async (u: unknown) => {
      calls.push(String(u));
      if (String(u).includes("refresh=true")) return new Response(JSON.stringify({ success: false, error: "Currently services are not available due to daily maintenance downtime. Services will resume at 00:20 hrs." }), { status: 200 });
      return new Response(JSON.stringify({ success: true, data_from: "CACHED", seat_availibility: [{ availablity_date: key, availablity_status: "RLWL58/WL45", ticket_fare: 530, last_updated_at: stamp, cache_text: "As of 1 hour ago" }] }), { status: 200 });
    });
    try {
      const r = await scrapeSeatAvailabilityWeb("13152", ymd, "LDH", "BSB", "SL", "GN");
      expect(calls.filter((c) => c.includes("refresh=true")).length).toBe(1);
      expect(r?.waitlist).toBe(45);
    } finally { setScrapeFetch(null); }
  });
  it("UI: side seat pill shows fare; stale AVL is TAN with age label (Round-18m-26 scheme)", () => {
    const plan = {
      query: { from: "JAT", to: "NDLS", date: "2030-01-13", travelClass: null, preference: "best_overall", passengers: 1 },
      best: null, connections: [], alternativeDates: [], directUnavailable: false, notes: [], sources: ["web_railyatri"],
      routeOptions: [{ id: "D:19804", trainNumbers: ["19804"], trainNames: ["KOTA EXPRESS"], origin: "JAT", destination: "NDLS", departure: "00:20", arrival: "13:35", arrivalDayOffset: 0, durationMinutes: 795, durationLabel: "13h 15m", changes: 0, legs: [], probed: true,
        availability: { classCode: "2A", status: "AVAILABLE", seats: 56, rac: null, waitlist: null, fare: 1345, source: "web_railyatri", stale: true },
        classOptions: [{ classCode: "2A", status: "AVAILABLE", seats: 56, rac: null, waitlist: null, fare: 1345, source: "web_railyatri", stale: true }, { classCode: "SL", status: "WAITLIST", seats: null, rac: null, waitlist: 51, fare: 360, source: "web_railyatri" }] }],
      recovery: { reason: "", differentTrain: [], partialRoute: null, connecting: [], alternativeDates: [], boardFromEarlier: [] },
    } as unknown as AgentJourneyPlan;
    const { container, getByText } = render(<JourneyOptions plan={plan} />);
    fireEvent.click(getByText("Fastest"));
    const pill = container.querySelector(".jx-lrow .jx-seat");
    expect(pill?.className).toContain("jx-seat-stale");
    expect(pill?.textContent).toContain("2A AVL 56");
    expect(pill?.textContent).toContain("1,345");
    expect(pill?.textContent).toMatch(/pehle ka data|purana data/);
    const src = readFileSync("src/components/JourneyOptions.tsx", "utf8");
    expect(src).toContain("function ToneLegend");
  });
});
