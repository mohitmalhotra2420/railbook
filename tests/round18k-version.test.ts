/** Round-18k — /api/version exposes the live build; index.html is never cached. */
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";

describe("Round-18k /api/version", () => {
  it("returns build info with no-store cache header", async () => {
    const res = await request(createApp()).get("/api/version");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toHaveProperty("startedAt");
    expect(res.body).toHaveProperty("primaryModel");
  });
});
