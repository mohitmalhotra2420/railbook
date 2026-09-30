#!/usr/bin/env node
/* ══ openai-edge-tts END-TO-END CHECK (Round "Voice Agent R2") ═════════════════════════════════════════
 * User: "Do NOT fake the integration … The integration must actually call the configured
 * OpenAI-compatible openai-edge-tts server when the environment variables are present."
 *
 * Isliye ye script dono taraf ASLI HTTP karta hai (koi mock nahi):
 *   1) ek chhota **OpenAI-compatible TTS server** local par chalta hai (wahi API jaisa
 *      travisvn/openai-edge-tts deta hai: POST /v1/audio/speech → audio/mpeg);
 *   2) hamara ASLI app server (`createApp()`, wahi jo Render par chalta hai) us I server se
 *      `VOICE_TTS_BASE_URL` ke through baat karta hai;
 *   3) client jaisa request `POST /api/voice/tts` par jaata hai aur wapas aaye **asli MP3 bytes**
 *      verify hote hain.
 *
 * Chalane ka tarika:  npx tsx tools/check-edge-tts-e2e.mts
 * ══════════════════════════════════════════════════════════════════════════════════════════════════ */
import { createServer } from "node:http";
import { createApp } from "../server/app";

const KEY = "edge-local-secret";
const VOICE = "hi-IN-SwaraNeural";
const MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xfb, 0x90, 0x00]);

type Seen = { url: string; auth: string; body: Record<string, string> } | null;
let seenRequests: Seen[] = [];
let failNext = false;

/* 1) Local OpenAI-compatible TTS server (openai-edge-tts ka API shape). */
const tts = createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.endsWith("/audio/speech")) {
    res.writeHead(404).end("not found");
    return;
  }
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c as Buffer));
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}") as Record<string, string>;
    seenRequests.push({ url: req.url!, auth: String(req.headers.authorization ?? ""), body });
    if (failNext) {
      res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: "edge down" }));
      return;
    }
    res.writeHead(200, { "content-type": "audio/mpeg", "content-length": MP3.length }).end(MP3);
  });
});

let failures = 0;
const checks = 0 as number;
let total = 0;
function ok(label: string, cond: boolean, extra = "") {
  total += 1;
  if (!cond) failures += 1;
  console.log(`   ${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

async function main() {
  await new Promise<void>((r) => tts.listen(0, "127.0.0.1", r));
  const ttsPort = (tts.address() as { port: number }).port;
  console.log(`\n═══ openai-edge-tts end-to-end check ═══`);
  console.log(`local TTS server: http://127.0.0.1:${ttsPort}/v1  (OpenAI-compatible /audio/speech)`);

  /* 2) App server — env se provider configure (jaise Render par hoga). */
  process.env.VOICE_TTS_PROVIDER = "openai";
  process.env.VOICE_TTS_BASE_URL = `http://127.0.0.1:${ttsPort}/v1`;
  process.env.VOICE_TTS_API_KEY = KEY;
  delete process.env.VOICE_TTS_MODEL;
  delete process.env.VOICE_TTS_VOICE;

  const app = createApp();
  const srv = createServer(app);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const appPort = (srv.address() as { port: number }).port;
  const base = `http://127.0.0.1:${appPort}`;
  console.log(`app server:       ${base}  (wahi createApp jo Render par chalta hai)\n`);

  const cfg = (await (await fetch(`${base}/api/voice/config`)).json()) as Record<string, unknown>;
  ok("config: serverTts true + model tts-1 (default)", cfg.serverTts === true && cfg.model === "tts-1", JSON.stringify(cfg));
  ok("config: key kabhi expose nahi", !JSON.stringify(cfg).includes(KEY));

  const text = "Bilkul, main Amritsar se Delhi ke liye kal ki trains check kar raha hoon.";
  const res = await fetch(`${base}/api/voice/tts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, lang: "hi-IN" }),
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  ok("client ka request → /api/voice/tts → 200 audio/mpeg", res.status === 200 && /audio\/mpeg/.test(res.headers.get("content-type") ?? ""));
  ok("asli MP3 bytes wapas aaye (transport sach me chala)", bytes.equals(MP3), `${bytes.length} bytes`);

  const seen = seenRequests.at(-1)!;
  ok("upstream call bilkul {VOICE_TTS_BASE_URL}/audio/speech par gayi", seen.url === "/v1/audio/speech", seen.url);
  ok("server-side Authorization header bheja gaya", seen.auth === `Bearer ${KEY}`);
  ok(
    "request me model/voice/input/response_format=mp3",
    seen.body.model === "tts-1" && seen.body.voice === VOICE && seen.body.response_format === "mp3" && seen.body.input === text,
    JSON.stringify({ model: seen.body.model, voice: seen.body.voice, response_format: seen.body.response_format }),
  );

  /* Male voice sirf env se */
  process.env.VOICE_TTS_VOICE = "hi-IN-MadhurNeural";
  await fetch(`${base}/api/voice/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "namaste" }) });
  ok("male voice sirf env se badalta hai (hi-IN-MadhurNeural)", seenRequests.at(-1)!.body.voice === "hi-IN-MadhurNeural");
  delete process.env.VOICE_TTS_VOICE;

  /* TTS down → 502, aur config phir bhi serverTts true (client device voice par gir jaata hai) */
  failNext = true;
  const down = await fetch(`${base}/api/voice/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "namaste" }) });
  const downBody = (await down.json()) as Record<string, unknown>;
  ok("edge-tts down → 502 (client device-TTS fallback)", down.status === 502);
  ok("error body me key/base URL leak nahi", !JSON.stringify(downBody).includes(KEY) && !JSON.stringify(downBody).includes(String(ttsPort)));

  console.log(`\n═══ RESULT: ${total - failures}/${total} checks pass ═══`);
  srv.close();
  tts.close();
  if (failures) process.exit(1);
  console.log("✅ openai-edge-tts integration asli HTTP par verify ho gaya (koi mock nahi).\n");
}

main().catch((e) => {
  console.error("❌ check fail:", e instanceof Error ? e.message : e);
  tts.close();
  process.exit(1);
});
