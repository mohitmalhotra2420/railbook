import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import {
  parseNvidiaCatalog,
  resetNvidiaCache,
  classifyNvidiaModel,
  isNvidiaChatModel,
} from "../server/understand/nvidia";

const app = createApp();
const realFetch = globalThis.fetch;

afterEach(() => {
  process.env.NVIDIA_API_KEY = "";
  process.env.NVIDIA_BASE_URL = "";
  globalThis.fetch = realFetch;
  resetNvidiaCache();
});

describe("NVIDIA model discovery", () => {
  it("parses OpenAI-style catalog and never invents ids", () => {
    const models = parseNvidiaCatalog({
      object: "list",
      data: [
        { id: "meta/llama-3.1-8b-instruct", owned_by: "meta", object: "model" },
        { id: "nvidia/nv-embedqa-e5-v5", owned_by: "nvidia" },
        { id: "black-forest-labs/flux.1-dev", owned_by: "black-forest-labs" },
        { name: "no-id-skipped" },
      ],
    });
    expect(models.map((m) => m.id)).toEqual([
      "meta/llama-3.1-8b-instruct",
      "nvidia/nv-embedqa-e5-v5",
      "black-forest-labs/flux.1-dev",
    ]);
    expect(models.find((m) => m.id === "meta/llama-3.1-8b-instruct")?.suitable).toBe(true);
    expect(models.find((m) => m.id === "nvidia/nv-embedqa-e5-v5")?.kind).toBe("embedding");
    expect(models.find((m) => m.id === "black-forest-labs/flux.1-dev")?.kind).toBe("image");
  });

  it("filters embedding, image, and audio models from chat-suitable", () => {
    expect(classifyNvidiaModel("nvidia/nv-embedqa-mistral-7b-v2")).toBe("embedding");
    expect(classifyNvidiaModel("stabilityai/stable-diffusion-xl")).toBe("image");
    expect(classifyNvidiaModel("nvidia/parakeet-ctc-1.1b-asr")).toBe("audio");
    expect(
      isNvidiaChatModel({
        id: "meta/llama-3.3-70b-instruct",
        name: "Llama",
        description: null,
        kind: "chat",
      }),
    ).toBe(true);
  });

  it("missing key does not call NVIDIA and does not leak secrets", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("nope", { status: 500 });
    }) as typeof fetch;
    const res = await request(app).get("/api/admin/nvidia");
    expect(called).toBe(false);
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
    expect(res.body.status).toBe("Not configured");
    expect(res.body.label).toMatch(/NVIDIA API/);
    expect(res.body.modelsAvailable).toBe(0);
    expect(JSON.stringify(res.body)).not.toMatch(/nvapi-|Bearer /i);
  });

  it("GET /api/admin/nvidia does not leak the API key", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-secret-should-not-leak";
    process.env.NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://integrate.api.nvidia.com/v1/models");
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? "";
      expect(auth.startsWith("Bearer ")).toBe(true);
      return new Response(
        JSON.stringify({
          data: [{ id: "nvidia/nemotron-mini-4b-instruct", owned_by: "nvidia" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    const res = await request(app).get("/api/admin/nvidia?refresh=1");
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.label).toBe("NVIDIA API: Connected");
    expect(res.body.modelsAvailable).toBe(1);
    expect(res.body.models[0].id).toBe("nvidia/nemotron-mini-4b-instruct");
    expect(JSON.stringify(res.body)).not.toMatch(/nvapi-secret|Authorization|Bearer/i);
  });

  it("401 is Auth failed and does not guess another endpoint", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-secret-should-not-leak";
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response("nope", { status: 401 });
    }) as typeof fetch;
    const res = await request(app).post("/api/admin/nvidia/refresh");
    expect(urls).toEqual(["https://integrate.api.nvidia.com/v1/models"]);
    expect(res.body.status).toBe("Auth failed");
    expect(res.body.connected).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/nvapi-secret|Bearer/i);
  });
});
