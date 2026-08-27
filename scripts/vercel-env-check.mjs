import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url) });

const token = (process.env.VERCEL_TOKEN || "").trim();
const teamId = "team_mjPt9Nv2iYRaq4Ag1KrCJseo";
const projectId = "prj_OZR43H0BKgFy3Ly9wlvvWaxKhuHK";
if (!token) {
  console.error("NO_TOKEN");
  process.exit(1);
}

const res = await fetch(
  `https://api.vercel.com/v9/projects/${projectId}/env?teamId=${teamId}&decrypt=false`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const json = await res.json();
if (!res.ok) {
  console.log(JSON.stringify({ status: res.status, error: json.error || json }, null, 2));
  process.exit(1);
}
const rows = (json.envs || json).map((e) => ({
  id: e.id,
  key: e.key,
  target: e.target,
  type: e.type,
  valueLen: typeof e.value === "string" ? e.value.length : null,
}));
console.log(
  JSON.stringify(
    {
      status: res.status,
      keys: rows.map((r) => r.key).sort(),
      railway: rows.filter((r) => /RAILKIT|RAILCORE|RAILWAY|RAILRADAR|NVIDIA/i.test(r.key)),
    },
    null,
    2,
  ),
);
