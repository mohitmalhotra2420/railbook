/* /api/version must report the chain the orchestrator really uses (AI_LLM_MODELS override), not the stale NVIDIA_MODEL env. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";

const app = createApp();
const saved = { ...process.env };

describe("/api/version reports the active model chain", () => {
  beforeEach(() => {
    process.env.NVIDIA_API_KEY = "test_nv_not_real";
    process.env.NVIDIA_MODEL = "meta/muse-glimmer-30b";
    process.env.NVIDIA_FALLBACK_MODEL = "openai/gpt-oss-20b";
    process.env.AI_LLM_BASE_URL = "https://ollama.com/v1";
    process.env.AI_LLM_API_KEY = "test_key_not_real";
    process.env.AI_LLM_MODELS = "gpt-oss:120b,gpt-oss:20b,gemma4:31b";
  });
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  it("shows the Ollama chain when AI_LLM_* override is active (not muse)", async () => {
    const res = await request(app).get("/api/version");
    expect(res.status).toBe(200);
    expect(res.body.primaryModel).toBe("gpt-oss:120b");
    expect(res.body.fallbackModel).toBe("gpt-oss:20b");
    expect(res.body.modelChain).toEqual(["gpt-oss:120b", "gpt-oss:20b", "gemma4:31b"]);
    expect(res.body.provider).toBe("nvidia");
    expect(JSON.stringify(res.body)).not.toContain("test_key_not_real");
  });

  it("falls back to NVIDIA env chain when no override is set", async () => {
    delete process.env.AI_LLM_BASE_URL;
    delete process.env.AI_LLM_API_KEY;
    delete process.env.AI_LLM_MODELS;
    const res = await request(app).get("/api/version");
    expect(res.body.primaryModel).toBe("meta/muse-glimmer-30b");
    expect(res.body.fallbackModel).toBe("openai/gpt-oss-20b");
  });
});
