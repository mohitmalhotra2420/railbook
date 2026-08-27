import { config } from "dotenv";
import { configure, getAvailability } from "railkit";

config({ path: new URL("../.env", import.meta.url) });
configure((process.env.RAILKIT_API_KEY || "").trim());

const res = await getAvailability("12014", "ASR", "LDH", "23-08-2026", "CC", "GN");
const d = res?.data || {};
const days = Array.isArray(d.availability) ? d.availability : [];
console.log(
  JSON.stringify(
    {
      success: Boolean(res?.success),
      error: res?.error || res?.message || null,
      topKeys: d && typeof d === "object" ? Object.keys(d) : [],
      train: d.train || null,
      fare: d.fare || null,
      dayCount: days.length,
      days: days.slice(0, 4).map((x) => ({
        date: x.date,
        status: x.status,
        availabilityText: x.availabilityText,
        rawStatus: x.rawStatus,
        prediction: x.prediction,
        predictionPercentage: x.predictionPercentage,
        canBook: x.canBook,
      })),
    },
    null,
    2,
  ),
);
