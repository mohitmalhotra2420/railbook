/**
 * Round-18c — §8 alternate boarding/destination station (same city cluster)
 * is a SUGGESTION with provenance, never a silent origin/destination change;
 * §14 TRACK_TRAIN carries a freshness envelope.
 */
import { describe, it, expect } from "vitest";
import { clusterSiblings } from "../server/journey/engine.js";
import { makeProvenance } from "../server/providers/provenance.js";

describe("Round-18c §8 clusterSiblings", () => {
  it("returns same-city siblings for a cluster station, excluding itself", () => {
    const sib = clusterSiblings("NDLS");
    expect(sib.length).toBeGreaterThan(0);
    expect(sib).not.toContain("NDLS");
    expect(sib.every((c) => /^[A-Z]{2,5}$/.test(c))).toBe(true);
  });
  it("returns [] for a non-cluster station (no invented alternates)", () => {
    expect(clusterSiblings("ASR")).toEqual([]);
    expect(clusterSiblings("PTA")).toEqual([]);
  });
  it("is case-insensitive and deterministic", () => {
    expect(clusterSiblings("ndls")).toEqual(clusterSiblings("NDLS"));
  });
});

describe("Round-18c §14 live-status freshness envelope", () => {
  it("marks an old provider update as stale, a recent one as live/fresh", () => {
    const old = makeProvenance({ source: "railradar", kind: "live_status", requestDate: "2026-09-10", travelDate: "2026-09-10", providerUpdatedAt: new Date(Date.now() - 6 * 3600_000).toISOString() });
    expect(old.freshness).toBe("stale");
    const now = makeProvenance({ source: "railradar", kind: "live_status", requestDate: "2026-09-10", travelDate: "2026-09-10", providerUpdatedAt: new Date().toISOString() });
    expect(["live", "fresh"]).toContain(now.freshness);
  });
});
