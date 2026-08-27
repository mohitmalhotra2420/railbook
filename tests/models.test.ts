import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import {
  parseModelCatalog,
  resetModelCache,
  selectChatModel,
  isSuitableChatModel,
  buildModelChain,
} from "../server/understand/models";
import { resetNvidiaCache } from "../server/understand/nvidia";

const app = createApp();
const realFetch = globalThis.fetch;

afterEach(() => {
  process.env.NVIDIA_API_KEY = "";
  process.env.NVIDIA_BASE_URL = "";
  process.env.NVIDIA_MODEL = "";
  globalThis.fetch = realFetch;
  resetModelCache();
  resetNvidiaCache();
});

describe("model catalog helpers", () => {
  it("parses mixed catalog fields and never invents ids", () => {
    const models = parseModelCatalog({
      data: [
        {
          id: "chat-small",
          name: "Chat Small",
          owned_by: "bl",
          context_length: 16000,
          pricing: { prompt: 0.1, completion: 0.2 },
          architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        },
        { id: "text-embedding-3", name: "Embed", description: "embeddings" },
        { name: "no-id-skipped" },
        {
          id: "vision-draw",
          name: "Image Gen",
          description: "dall-e style",
          modalities: ["image"],
        },
      ],
    });
    expect(models.map((m) => m.id)).toEqual(["chat-small", "text-embedding-3", "vision-draw"]);
    expect(models.find((m) => m.id === "chat-small")?.suitable).toBe(true);
    expect(models.find((m) => m.id === "text-embedding-3")?.suitable).toBe(false);
    expect(models.find((m) => m.id === "vision-draw")?.suitable).toBe(false);
    expect(selectChatModel(models)).toBe("chat-small");
  });

  it("does not assume unknown pricing is free", () => {
    const models = parseModelCatalog({
      data: [
        { id: "cheap", context_length: 8000, pricing: { prompt: 0.01, completion: 0.02 } },
        { id: "mystery", context_length: 128000 },
      ],
    });
    expect(models.find((m) => m.id === "mystery")?.inputPricing).toBe("unknown");
    expect(selectChatModel(models)).toBe("cheap");
  });

  it("isSuitableChatModel rejects embeddings and audio-only", () => {
    expect(isSuitableChatModel({
      id: "whisper-1", name: "Whisper", provider: null, description: null,
      contextLength: null, inputPricing: "unknown", outputPricing: "unknown",
      capabilities: [], modalities: ["audio"], suitable: false,
    })).toBe(false);
  });

  it("GET /api/admin/models does not leak the API key", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-secret-should-not-leak";
    process.env.NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://integrate.api.nvidia.com/v1/models");
      return new Response(JSON.stringify({ data: [{ id: "ok-chat", owned_by: "nvidia" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const res = await request(app).get("/api/admin/models?refresh=1");
    expect(res.status).toBe(200);
    expect(res.body.endpoint).toBe("https://integrate.api.nvidia.com/v1/models");
    expect(res.body.models[0].id).toBe("ok-chat");
    expect(JSON.stringify(res.body)).not.toMatch(/nvapi-secret|Authorization|Bearer/i);
  });

  it("refresh reports 401 without guessing another endpoint", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-secret-should-not-leak";
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response("nope", { status: 401 });
    }) as typeof fetch;
    const res = await request(app).post("/api/admin/models/refresh");
    expect(urls).toEqual(["https://integrate.api.nvidia.com/v1/models"]);
    expect(res.body.status).toBe("Auth failed");
    expect(res.body.connected).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/nvapi-secret|Bearer/i);
  });

  it("buildModelChain only uses catalog ids and adds another free model", () => {
    const models = parseModelCatalog({
      data: [
        { id: "free-a", name: "A", context_length: 8000, pricing: { prompt: 0, completion: 0 }, architecture: { modality: "text->text" } },
        { id: "free-b", name: "B", context_length: 32000, pricing: { prompt: 0, completion: 0 }, architecture: { modality: "text->text" } },
        { id: "paid-b", name: "Paid", context_length: 8000, pricing: { prompt: 1, completion: 1 }, architecture: { modality: "text->text" } },
      ],
    });
    const chain = buildModelChain(models);
    expect(chain[0]).toBe("free-b");
    expect(chain).toContain("free-a");
    expect(chain).not.toContain("ghost-model");
  });

  it("missing key returns a friendly admin error", async () => {
    const res = await request(app).post("/api/admin/models/refresh");
    expect(res.body.error).toMatch(/API key is not configured/i);
    expect(res.body.models).toEqual([]);
  });
});
