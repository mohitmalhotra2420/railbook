/**
 * Production deploy via Vercel REST.
 * Never prints tokens or API keys. Never uploads .env.
 */
import { config } from "dotenv";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

config({ path: new URL("../.env", import.meta.url) });

const token = (process.env.VERCEL_TOKEN || "").trim();
const railkitKey = (process.env.RAILKIT_API_KEY || "").trim();
const railcoreKey = (process.env.RAILCORE_API_KEY || "").trim();
const teamId = "team_mjPt9Nv2iYRaq4Ag1KrCJseo";
const projectId = "prj_OZR43H0BKgFy3Ly9wlvvWaxKhuHK";
const projectName = "railbook";
const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

if (!token) {
  console.error("FAIL: VERCEL_TOKEN missing");
  process.exit(1);
}
if (!railcoreKey) {
  console.error("FAIL: RAILCORE_API_KEY missing");
  process.exit(1);
}
// RAILKIT_API_KEY is only required locally when it is missing on Vercel;
// otherwise the stored value below is kept untouched.


const headers = {
  Authorization: `Bearer ${token}`,
};

async function api(method, path, body, extra = {}) {
  const url = path.includes("?")
    ? `https://api.vercel.com${path}${path.includes("teamId=") ? "" : `&teamId=${teamId}`}`
    : `https://api.vercel.com${path}?teamId=${teamId}`;
  const res = await fetch(url, {
    method,
    headers: {
      ...headers,
      ...(body && !(body instanceof Buffer) ? { "Content-Type": "application/json" } : {}),
      ...extra.headers,
    },
    body: body instanceof Buffer ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, json };
}

function redact(obj) {
  return JSON.parse(
    JSON.stringify(obj ?? {}).replace(/railkit_[A-Za-z0-9]+|vcp_[A-Za-z0-9]+|nvapi-[A-Za-z0-9_-]+/g, "[REDACTED]"),
  );
}

// ── 1) Env: railcore primary, railkit fallback, no railradar ─────────
const envList = await api("GET", `/v9/projects/${projectId}/env`);
if (!envList.ok) {
  console.error("ENV_LIST_FAIL", envList.status, redact(envList.json?.error || envList.json));
  process.exit(1);
}
const envs = envList.json.envs || [];
const byKey = Object.fromEntries(envs.map((e) => [e.key, e]));

const envActions = [];

async function upsertEnv(key, value, type) {
  if (byKey[key]) {
    const patch = await api("PATCH", `/v9/projects/${projectId}/env/${byKey[key].id}`, {
      key,
      value,
      type,
      target: ["production", "preview", "development"],
    });
    envActions.push({ op: "patch", key, status: patch.status, ok: patch.ok });
    return;
  }
  const created = await api("POST", `/v10/projects/${projectId}/env`, {
    key,
    value,
    type,
    target: ["production", "preview", "development"],
  });
  envActions.push({ op: "create", key, status: created.status, ok: created.ok });
}

await upsertEnv("RAILWAY_PROVIDER", "railcore", "plain");
await upsertEnv("RAILCORE_API_KEY", railcoreKey, "encrypted");
if (!byKey.RAILKIT_API_KEY) {
  if (!railkitKey) {
    console.error("FAIL: RAILKIT_API_KEY missing locally and on Vercel — add it to .env");
    process.exit(1);
  }
  await upsertEnv("RAILKIT_API_KEY", railkitKey, "encrypted");
} else {
  envActions.push({ op: "keep", key: "RAILKIT_API_KEY", ok: true });
}
if (!byKey.NVIDIA_MODEL) {
  await upsertEnv("NVIDIA_MODEL", "openai/gpt-oss-20b", "plain");
} else {
  envActions.push({ op: "keep", key: "NVIDIA_MODEL", ok: true });
}

for (const key of ["RAILRADAR_API_KEY", "RAILRADAR_BASE_URL"]) {
  if (byKey[key]) {
    const del = await api("DELETE", `/v9/projects/${projectId}/env/${byKey[key].id}`);
    envActions.push({ op: "delete", key, status: del.status, ok: del.ok });
  }
}

console.log("ENV_ACTIONS", JSON.stringify(envActions));

const envAfter = await api("GET", `/v9/projects/${projectId}/env`);
const afterKeys = (envAfter.json.envs || []).map((e) => e.key).sort();
console.log("ENV_KEYS", JSON.stringify(afterKeys));

// ── 2) Collect files ─────────────────────────────────────────────────
const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  ".git",
  ".vercel",
  ".arena",
  "coverage",
  ".vite",
  ".cache",
]);
const SKIP_FILE = new Set([".env", ".env.local", ".env.production"]);

function shouldSkipFile(name) {
  if (SKIP_FILE.has(name)) return true;
  if (name.startsWith(".env.")) return true;
  if (name.endsWith(".log")) return true;
  return false;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name) || shouldSkipFile(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile()) out.push(full);
  }
  return out;
}

const files = walk(root);
console.log("FILE_COUNT", files.length);

// ── 3) Upload ────────────────────────────────────────────────────────
async function uploadOne(full) {
  const buf = readFileSync(full);
  const sha = createHash("sha1").update(buf).digest("hex");
  const file = relative(root, full).split("\\").join("/");
  let lastErr = "";
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`https://api.vercel.com/v2/files?teamId=${teamId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "x-vercel-digest": sha,
          "Content-Length": String(buf.length),
        },
        body: buf,
      });
      if (res.ok || res.status === 200) return { file, sha, size: buf.length };
      lastErr = `${res.status} ${(await res.text()).slice(0, 120)}`;
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastErr = String(err && err.message ? err.message : err).slice(0, 120);
    }
    await new Promise((r) => setTimeout(r, 400 * attempt));
  }
  throw new Error(`upload ${file} ${lastErr}`);
}

const uploaded = [];
const concurrency = 6;
for (let i = 0; i < files.length; i += concurrency) {
  const chunk = files.slice(i, i + concurrency);
  const done = await Promise.all(chunk.map(uploadOne));
  uploaded.push(...done);
  if ((i / concurrency) % 8 === 0) console.log("UPLOADED", uploaded.length, "/", files.length);
}
console.log("UPLOAD_DONE", uploaded.length);

// ── 4) Create production deployment ──────────────────────────────────
const created = await api(
  "POST",
  `/v13/deployments?skipAutoDetectionConfirmation=1`,
  {
    name: projectName,
    project: projectId,
    target: "production",
    files: uploaded,
    projectSettings: {
      framework: "vite",
      buildCommand: "npx vite build",
      outputDirectory: "dist",
      installCommand: "npm install",
    },
  },
);
if (!created.ok) {
  console.error("DEPLOY_CREATE_FAIL", created.status, redact(created.json));
  process.exit(1);
}
const id = created.json.id || created.json.uid;
const url = created.json.url;
console.log("DEPLOY_CREATED", JSON.stringify({ id, url, readyState: created.json.readyState }));

// ── 5) Poll ──────────────────────────────────────────────────────────
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const st = await api("GET", `/v13/deployments/${id}`);
  const state = st.json?.readyState || st.json?.status;
  console.log("DEPLOY_STATE", state);
  if (state === "READY" || state === "ERROR" || state === "CANCELED") {
    console.log(
      "DEPLOY_FINAL",
      JSON.stringify({
        id,
        state,
        url: st.json?.url,
        alias: st.json?.alias,
        inspectorUrl: st.json?.inspectorUrl,
        readySubstate: st.json?.readySubstate,
        errorCode: st.json?.errorCode || null,
        errorMessage: st.json?.errorMessage || null,
      }),
    );
    if (state !== "READY") process.exit(1);
    process.exit(0);
  }
}
console.error("DEPLOY_TIMEOUT");
process.exit(1);
