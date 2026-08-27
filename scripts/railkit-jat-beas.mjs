import { config } from "dotenv";
import { configure, searchTrainBetweenStations } from "railkit";

config({ path: new URL("../.env", import.meta.url) });
configure((process.env.RAILKIT_API_KEY || "").trim());

const started = Date.now();
const res = await searchTrainBetweenStations("JAT", "BEAS", "23-08-2026");
const rows = Array.isArray(res?.data) ? res.data : [];
console.log(
  JSON.stringify(
    {
      success: Boolean(res?.success),
      error: res?.error || res?.message || null,
      count: rows.length,
      latencyMs: Date.now() - started,
      sample: rows.slice(0, 6).map((t) => ({
        no: t.train_no,
        name: t.train_name,
        dep: t.from_time,
        arr: t.to_time,
        from: t.from_stn_code,
        to: t.to_stn_code,
      })),
    },
    null,
    2,
  ),
);
