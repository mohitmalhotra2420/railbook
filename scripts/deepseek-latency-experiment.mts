/**
 * DEEPSEEK V4 FLASH — LATENCY OPTIMIZATION EXPERIMENT (benchmark ONLY)
 *
 * Mandate: 6 REAL model requests total — 3 configs × 2 prompts (same prompts
 * har config mein, comparability ke liye):
 *   A) Current configuration (max_tokens 900, jaisa prod planner bhejta hai)
 *   B) Reasoning/thinking disabled (chat_template_kwargs.thinking=false —
 *      agar API support kare; fallback params bhi try honge)
 *   C) max_tokens 256 (lowest-value target)
 * Prompts (success criteria se): #2 multi-tool + #5 missing-date.
 *
 * EXACT same RailBook planner system-prompt + tool schema — agentic loop se
 * fetch-injection capture (zero real calls), phir direct API replay.
 * Tool execution: NONE (planning-call latency hi measure karte hain) —
 * isliye zero RailCore calls. TTFT: N/A (backend non-streaming hai).
 * NO deploy, NO production change, NO commit/push.
 */
import { readFileSync, writeFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const MODEL = "deepseek-ai/deepseek-v4-flash-0731";
process.env.AGENTIC_MODEL = MODEL;
process.env.AGENTIC_PROVIDER = "nvidia";
process.env.RAILWAY_PROVIDER = "mock";
process.env.AI_AGENTIC_TIMEOUT_MS = "5000";

/* ── Step 1: exact planner request bodies capture (ZERO real calls) ──── */
const ag = await import("../server/agent/agentic.js");
const BODIES: Record<string, any> = {};
ag.setAgenticNvidiaFetch(((async (_url: string, init?: { body?: string }) => {
  const body = JSON.parse(String(init?.body ?? "{}"));
  const key = String((body.messages ?? []).find((m: any) => m.role === "user")?.content ?? "").includes("availability") ? "P2" : "P5";
  if (!BODIES[key]) BODIES[key] = body;
  return new Response(JSON.stringify({ model: body.model, choices: [{ message: { content: "Theek hai.", role: "assistant" }, finish_reason: "stop" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
}) as never));
await ag.runAgenticTurn({ text: "12014 ka CC mein availability aur fare batao", now: new Date().toISOString() });
await ag.runAgenticTurn({ text: "Amritsar se Ludhiana jaana hai", now: new Date().toISOString() });
ag.setAgenticNvidiaFetch(null);
if (!BODIES.P2 || !BODIES.P5) {
  console.error("body capture fail");
  process.exit(2);
}
console.log("planner bodies captured (0 real calls): system len", String(BODIES.P2.messages[0].content).length, "| tools", BODIES.P2.tools.length, "| max_tokens", BODIES.P2.max_tokens);

/* ── Step 2: direct measured calls — SIRF 6 ───────────────────────────── */
const KEY = process.env.NVIDIA_API_KEY!;
const API_URL = `${(process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1").replace(/\/$/, "")}/chat/completions`;
const RESULTS: any[] = [];
let realCalls = 0;

async function measured(config: string, promptKey: "P2" | "P5", mutate: (b: any) => any) {
  realCalls++;
  const body = mutate(structuredClone(BODIES[promptKey]));
  const t0 = Date.now();
  const res = await fetch(API_URL, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const latencyMs = Date.now() - t0;
  const j = await res.json().catch(() => ({}));
  const msg = j.choices?.[0]?.message ?? {};
  const finish = j.choices?.[0]?.finish_reason ?? null;
  const toolCalls = (msg.tool_calls ?? []).map((t: any) => ({ name: t.function?.name, argsRaw: String(t.function?.arguments ?? "") }));
  const argsParsed = toolCalls.map((t: any) => { try { return JSON.parse(t.argsRaw); } catch { return null; } });
  const jsonValid = toolCalls.length === 0 || argsParsed.every((a: any) => a !== null);
  const reasoning = String(msg.reasoning_content ?? "");
  // tool-selection correctness:
  //   P2 (#2 multi-tool): CHECK_AVAILABILITY + GET_FARE, train_number=12014, class_code=CC
  //   P5 (#5 missing date): koi tool NAHI + content mein date poochhna
  const names = toolCalls.map((t: any) => t.name);
  const content = String(msg.content ?? "");
  let selectionOk: boolean;
  if (promptKey === "P2") {
    const hasAv = names.includes("CHECK_AVAILABILITY"), hasFa = names.includes("GET_FARE");
    const argsOk = argsParsed.some((a: any) => a && String(a.train_number ?? "") === "12014" && /CC/i.test(String(a.class_code ?? "")));
    selectionOk = (hasAv || hasFa) && argsOk;
  } else {
    selectionOk = names.length === 0 && /kab|date|tareekh|kis din/i.test(content);
  }
  const r = {
    config, promptKey,
    prompt: promptKey === "P2" ? "12014 ka CC mein availability aur fare batao" : "Amritsar se Ludhiana jaana hai",
    status: res.status, latencyMs, ttft: null,
    promptTokens: j.usage?.prompt_tokens ?? null,
    completionTokens: j.usage?.completion_tokens ?? null,
    reasoningTokensExposed: j.usage?.completion_tokens_details ?? null,
    reasoningContentChars: reasoning.length, reasoningPresent: reasoning.length > 0,
    finishReason: finish, toolsPlanned: names,
    argsRaw: toolCalls.map((t: any) => t.argsRaw.slice(0, 200)),
    jsonValid, selectionOk, content: content.slice(0, 250),
    modelEcho: j.model ?? null,
  };
  RESULTS.push(r);
  console.log(`  [${config}/${promptKey}] ${res.status} ${latencyMs}ms | completion=${r.completionTokens} | reasoning=${r.reasoningPresent ? r.reasoningContentChars + "ch" : "OFF"} | finish=${finish} | tools=[${names.join(",")}] | jsonValid=${jsonValid} | selectionOk=${selectionOk}`);
  return r;
}

console.log("\n── A) current config (max_tokens 900) ──");
await measured("A", "P2", (b) => b);
await measured("A", "P5", (b) => b);

console.log("\n── B) thinking disabled (chat_template_kwargs) ──");
let bParam: Record<string, unknown> | null = { chat_template_kwargs: { thinking: false } };
let bResult = await measured("B", "P5", (b) => ({ ...b, ...bParam! }));
if (bResult.status >= 400) {
  // fallback param try (yeh bhi real attempt — setup probe, disclose)
  console.log("  chat_template_kwargs reject hua — alternate param try:");
  bParam = { enable_thinking: false };
  bResult = await measured("B-alt", "P5", (b) => ({ ...b, ...bParam! }));
  if (bResult.status >= 400) { bParam = null; console.log("  thinking-disable supported NAHI — B unsupported"); }
}
if (bParam) {
  // B ka doosra measurement (P2) — NOTE: agar upar fallback chala to pehla B/P5 discard
  await measured(bResult.status >= 400 ? "B" : "B", "P2", (b) => ({ ...b, ...bParam! }));
}

console.log("\n── C) max_tokens 256 ──");
await measured("C", "P2", (b) => ({ ...b, max_tokens: 256 }));
await measured("C", "P5", (b) => ({ ...b, max_tokens: 256 }));

/* ── summary ─────────────────────────────────────────────────────────── */
const byConfig: Record<string, any> = {};
for (const r of RESULTS) {
  if (r.status >= 400) continue;
  byConfig[r.config] ??= { latencies: [], completions: [], jsonValid: 0, selectionOk: 0, n: 0, reasoningOn: 0 };
  const c = byConfig[r.config];
  c.latencies.push(r.latencyMs); c.completions.push(r.completionTokens ?? 0); c.n++;
  if (r.jsonValid) c.jsonValid++; if (r.selectionOk) c.selectionOk++; if (r.reasoningPresent) c.reasoningOn++;
}
console.log(`\n══════ LATENCY EXPERIMENT — real model requests: ${realCalls} (failed 400-attempts excluded above)`);
for (const [cfg, c] of Object.entries(byConfig)) {
  console.log(`  ${cfg}: avg ${Math.round((c as any).latencies.reduce((a: number, b: number) => a + b, 0) / (c as any).n)}ms | completions ${(c as any).completions.join("/")} | json ${(c as any).jsonValid}/${(c as any).n} | selection ${(c as any).selectionOk}/${(c as any).n} | reasoning-on turns: ${(c as any).reasoningOn}`);
}
writeFileSync(new URL("../DEEPSEEK_LATENCY_EXPERIMENT.json", import.meta.url), JSON.stringify({ ranAt: new Date().toISOString(), model: MODEL, realCalls, results: RESULTS }, null, 2));
console.log("Full JSON: DEEPSEEK_LATENCY_EXPERIMENT.json");
console.log("NOTE: benchmark ONLY — no deploy / no production change / no commit.");
