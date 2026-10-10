/* ══ ROUND-46 (28 Sep 2026) — station-code verification net ════════════════════════════════════════
 * Live case (R45 battery): model ne likha "12013 … isme Haridwar (HWR) nahi aata" — jabki Haridwar
 * = HW aur HWR asli me HATWAR hai. Route sahi, par code galat — aur user code hi IRCTC me type karta hai.
 * Fix: reply ke "Naam (CODE)" / "CODE Naam" / "Naam — CODE" jodi hamare station data (8989 IR stations)
 * se verify hote hain; sirf tab badla jaata hai jab naam hamare data me ho aur uska code kuch aur ho.
 * User rule (R43k): per-question patch nahi — general verification. Isliye ye module sawaal se
 * independent hai: jo bhi reply user tak jaati hai, uska data sahi ho.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { verifyStationCodes, verifyPair, normalizeStationName } from "../server/agent/stationCodes";
import { scrubInternalNotes } from "../server/agent/answerMode";
import { runAgent } from "../server/agent/run";
import { setAgenticNvidiaFetch } from "../server/agent/agentic";
import { setScrapeFetch } from "../server/railway/webscrape";
import { setRailcoreFetch } from "../server/railway/railcore";
import { setProvider } from "../server/providers/index";

describe("Round-46 · station-code verification net", () => {
  it("naam-normalize: jn/junction/cantt/city suffix hataata hai, 'new' nahi", () => {
    expect(normalizeStationName("Ludhiana Junction")).toBe("ludhiana");
    expect(normalizeStationName("Ambala Cantt")).toBe("ambala");
    expect(normalizeStationName("New Delhi")).toBe("new delhi");
    expect(normalizeStationName("Haridwar Jn")).toBe("haridwar");
  });

  it("verifyPair: sahi jodi chhoti, galat code pakdi jaati hai (data-backed)", () => {
    expect(verifyPair("Haridwar", "HW")).toBe(null);
    expect(verifyPair("Ludhiana Jn", "LDH")).toBe(null);
    const bad = verifyPair("Haridwar", "HWR");
    expect(bad).toMatchObject({ label: "Haridwar", from: "HWR", to: "HW" });
    expect(bad?.why).toMatch(/HATWAR/i);
    /* naam hamare data me nahi → kuch nahi (andaza nahi lagayenge) */
    expect(verifyPair("Someplace", "ZZZZ")).toBe(null);
  });

  it("live case: 'Haridwar (HWR)' → '(HW)' (aur sirf wahi badalta hai)", () => {
    const r = verifyStationCodes("12013 (Amritsar Shatabdi) ka route NDLS → ASR hai, isme Haridwar (HWR) nahi aata.");
    expect(r.reply).toContain("Haridwar (HW)");
    expect(r.reply).not.toContain("HWR");
    expect(r.reply).toContain("NDLS → ASR");
    expect(r.fixes).toHaveLength(1);
  });

  it("code-naam aur naam-code dono forms chalte hain", () => {
    expect(verifyStationCodes("HWR Haridwar par nahi rukti").reply).toContain("HW Haridwar");
    expect(verifyStationCodes("Amritsar (HWR) se chalti hai").reply).toContain("Amritsar (ASR)");
    expect(verifyStationCodes("Haridwar (HWX) ke liye koi train nahi").reply).toContain("Haridwar (HW)");
  });

  it("FALSE POSITIVE battery: sahi replies ko haath nahi lagta (sibling/city/route/seat/fare lines)", () => {
    const keep = [
      "Bengaluru (SBC) se Mysuru (MYS) tak",
      "Mumbai (CSMT) se Howrah (HWH) tak",
      "Delhi (NZM) se Ambala (UMB) via Ludhiana (LDH)",
      "12054 LDH ke paas DDL (Dhandari Kalan) route par hai — dep 09:20.",
      "Route: NDLS → UMB → SIR → LDH → PGW → JUC → BEAS → ASR (8 stops).",
      "Seat availability: 29 Sep (kal) CC WL 20 ₹650 · 2S AVAILABLE 654 ₹205",
      "Delay: 20 min · Next stop: AMBALA CANT JN (UMB) · Platform: 3",
      "New Delhi (NDLS) 16:30 · Ambala Cant Jn (UMB) 18:51",
      "Jammu (JAT) se Katra (SVDK)",
      "(Source: confirmtkt.com — railway API se nahi, verified web site se.)",
    ];
    for (const line of keep) expect(verifyStationCodes(line).reply, line).toBe(line);
  });

  it("scrub pipeline me juda hua hai (user-facing reply ka aakhri darwaza)", () => {
    const out = scrubInternalNotes("12013 isme Haridwar (HWR) nahi aata. [END]");
    expect(out).toContain("Haridwar (HW)");
    expect(out).not.toContain("[END]");
  });

  it("end-to-end: model ka reply galat code ke saath aaye to user ko sahi code milta hai", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-test";
    process.env.RAILWAY_PROVIDER = "mock";
    setRailcoreFetch(null);
    setProvider(null);
    setScrapeFetch(async () => new Response(JSON.stringify({ success: false }), { status: 500, headers: { "Content-Type": "application/json" } }));
    setAgenticNvidiaFetch(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "12013 (Amritsar Shatabdi) ka route NDLS → ASR hai, isme Haridwar (HWR) station nahi aata." } }],
          model: "test",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const r = await runAgent({ text: "12013 haridwar par rukti hai kya", known: {}, now: "2026-09-28T01:40:00+05:30" });
    const reply = String(r.reply ?? "");
    expect(reply).toContain("Haridwar (HW)");
    expect(reply).not.toMatch(/HWR/);
  });

  afterEach(() => {
    setAgenticNvidiaFetch(null);
    setScrapeFetch(null);
    setRailcoreFetch(null);
    delete process.env.NVIDIA_API_KEY;
    process.env.RAILWAY_PROVIDER = "mock";
    setProvider(null);
  });
});

beforeEach(() => {
  setProvider(null);
});
