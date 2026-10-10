import { afterEach, describe, expect, it, vi } from "vitest";
import { isAssistantHash } from "../src/assistant/route";
import { ASSISTANT_HISTORY_LIMIT, sendAssistantTurn, trimHistory } from "../src/assistant/client";

describe("assistant route", () => {
  it("matches #/assistant only", () => {
    expect(isAssistantHash("#/assistant")).toBe(true);
    expect(isAssistantHash("#assistant/")).toBe(true);
    expect(isAssistantHash("#/Assistant")).toBe(true);
    expect(isAssistantHash("#admin/models")).toBe(false);
    expect(isAssistantHash("")).toBe(false);
    expect(isAssistantHash("#/assistant/extra")).toBe(false);
  });
});

describe("assistant history", () => {
  it("drops empty messages and keeps the last N", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ role: "user" as const, content: `m${i}` }));
    const out = trimHistory([{ role: "user", content: "  " }, ...many]);
    expect(out).toHaveLength(ASSISTANT_HISTORY_LIMIT);
    expect(out[out.length - 1].content).toBe("m14");
  });
});

describe("sendAssistantTurn", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts text + history to /api/agent and returns the reply", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ reply: "Kis date ko?" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const reply = await sendAssistantTurn("kal", [{ role: "user", content: "Amritsar se Delhi" }]);
    expect(reply).toBe("Kis date ko?");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/agent");
    expect(JSON.parse(String(init.body))).toEqual({
      text: "kal",
      history: [{ role: "user", content: "Amritsar se Delhi" }],
    });
  });

  it("throws the server error message on failure", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "text is required." }), { status: 400 }));
    await expect(sendAssistantTurn("", [])).rejects.toThrow("text is required.");
  });

  it("gives a safe fallback when reply is empty (no invented facts)", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({}), { status: 200 }));
    const reply = await sendAssistantTurn("hi", []);
    expect(reply).toMatch(/verified jawab/);
  });
});
