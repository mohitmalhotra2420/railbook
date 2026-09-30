// @vitest-environment jsdom
/* ══ R4 · COMPLETE BOOKING TEST (live) — asli server + asli provider + asli model ════════════════════
 * User ne bola: "ek baar tum complete booking test kro". Ye wo test hai — koi mock data nahi:
 *   • asli Express app (`createApp()`) isi process me uthta hai (.env se provider chain + model keys,
 *     sab server-side hi rehte hain — client par kuch nahi jaata),
 *   • UI me poora asli app render hota hai (Concierge → AI Booking overlay → Review + IRCTC handoff),
 *   • route → train → class → 2 passengers → review → IRCTC handoff, sab maujooda code se,
 *   • aakhir me ek general sawaal — jawab asli model (/api/agent) se.
 *
 * Default suite me ye SKIP rehta hai (network + model latency). Chalane ke liye:
 *   RAILBOOK_LIVE_E2E=1 npx vitest run tests/ai-booking-live-e2e.test.tsx --testTimeout=900000
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const LIVE = process.env.RAILBOOK_LIVE_E2E === "1";
const suite = LIVE ? describe : describe.skip;

type TrainRow = { number: string; name: string; classes: { code: string; label?: string; status: string; fare: number | null; seats?: number | null }[] };
type Target = { from: string; to: string; ymd: string; human: string; train: TrainRow; classCode: string; fare: number | null; status: string };

suite("R4 · complete booking (live: asli provider + asli model)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let server: any = null;
  let base = "";
  const calls: string[] = [];
  let realFetch: typeof globalThis.fetch | null = null;
  let trainsSeen: TrainRow[] = [];
  /* App ne khud (relative URL se) kaunse trains queries bheje — direction bug ka pakka proof. */
  const appSearchUrls: string[] = [];
  /* Chat brain se poochhe gaye sawaal (item-4 proof: jawab asli model se aata hai). */
  const brainAsked: string[] = [];
  let target: Target | null = null;

  beforeAll(async () => {
    /* jsdom me scroll APIs nahi hoti — asli app inhe maangta hai (sirf test ke liye shim). */
    const anyEl = Element.prototype as unknown as { scrollTo?: () => void; scrollIntoView?: () => void };
    if (!anyEl.scrollTo) anyEl.scrollTo = () => undefined;
    if (!anyEl.scrollIntoView) anyEl.scrollIntoView = () => undefined;
    if (!window.scrollTo) window.scrollTo = (() => undefined) as typeof window.scrollTo;

    const { createApp } = await import("../server/app");
    const app = createApp() as unknown as { listen: (p: number, h: string, cb: () => void) => unknown };
    await new Promise<void>((res) => {
      server = app.listen(0, "127.0.0.1", () => res());
    });
    base = `http://127.0.0.1:${server.address().port}`;
    realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const full = url.startsWith("http") ? url : base + url;
      calls.push(url.split("?")[0]);
      if (!url.startsWith("http") && url.includes("/api/trains?")) appSearchUrls.push(url);
      if (url.includes("/api/agent")) {
        try {
          brainAsked.push(JSON.parse(String(init?.body ?? "{}")).text as string);
        } catch {
          brainAsked.push("");
        }
      }
      return await (realFetch as typeof fetch)(full as RequestInfo, init);
    }) as typeof fetch;
    await findBookingTarget();
  }, 300_000);

  afterAll(async () => {
    if (realFetch) globalThis.fetch = realFetch;
    if (server) await new Promise<void>((res) => server?.close(() => res()));
  });

  /** Asli provider se ek aisi journey dhundo jiski ek class sach me bookable ho (mock nahi). */
  async function findBookingTarget() {
    const routes: { from: string; to: string }[] = [
      { from: "LDH", to: "NDLS" },
      { from: "ASR", to: "NDLS" },
      { from: "LDH", to: "DLI" },
      { from: "NDLS", to: "LDH" },
    ];
    const offsets = [12, 14, 17, 21];
    const f = globalThis.fetch;
    for (const off of offsets) {
      const d = new Date(Date.now() + off * 86400_000);
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const human = `${d.getDate()} ${d.toLocaleString("en-IN", { month: "long" })}`;
      for (const r of routes) {
        const res = await f(`${base}/api/trains?from=${r.from}&to=${r.to}&date=${ymd}`);
        const json = (await res.json()) as { trains?: TrainRow[] };
        const trains = json.trains ?? [];
        if (!trains.length) continue;
        trainsSeen = trains;
        for (const t of trains) {
          for (const c of t.classes ?? []) {
            if (c.status !== "AVAILABLE") continue;
            const av = await f(
              `${base}/api/availability?trainNumber=${t.number}&date=${ymd}&from=${r.from}&to=${r.to}&classCode=${c.code}&quota=GN`,
            );
            const avJson = (await av.json()) as { bookable?: boolean; availability?: { status?: string; fare?: number | null } };
            if (avJson.bookable === true) {
              target = {
                from: r.from,
                to: r.to,
                ymd,
                human,
                train: t,
                classCode: c.code,
                fare: avJson.availability?.fare ?? c.fare ?? null,
                status: avJson.availability?.status ?? c.status,
              };
              console.log(`LIVE target: ${r.from}→${r.to} ${human} · ${t.number} ${t.name} · ${c.code} · ${target.status} · ₹${target.fare}`);
              return;
            }
          }
        }
      }
    }
  }

  /* AI Booking do shakal me dikhta hai: home par full-screen thread, search ke baad dock bar. */
  const log = () => {
    const dock = document.querySelector('[data-testid="aib-dock-log"]');
    const thread = document.querySelector(".aib-thread");
    return (dock ?? thread)?.textContent ?? "";
  };
  async function waitLog(re: RegExp, ms = 90_000) {
    await waitFor(() => expect(log()).toMatch(re), { timeout: ms, interval: 150 });
  }
  async function type(text: string) {
    const input = screen.getByLabelText("AI Booking me type karo") as HTMLInputElement;
    fireEvent.change(input, { target: { value: text } });
    await act(async () => {
      fireEvent.submit(input.closest("form") as HTMLFormElement);
    });
  }
  const allMsgsFull = () =>
    [...document.querySelectorAll(".aib-dock-log .aib-dock-msg, .aib-thread .aib-msg")]
      .map((n) => (n.textContent ?? "").slice(0, 300))
      .join(" ¶ ");
  const allMsgs = () =>
    [...document.querySelectorAll(".aib-dock-log .aib-dock-msg, .aib-thread .aib-msg")]
      .map((n) => (n.textContent ?? "").slice(0, 160))
      .join(" ¶ ");
  /** Aakhri AI/you bubble (dono shakal — thread ya dock bar). */
  const lastMsg = () => {
    const nodes = document.querySelectorAll('.aib-dock-log .aib-dock-msg, .aib-thread .aib-msg');
    return nodes.length ? (nodes[nodes.length - 1].textContent ?? "") : "";
  };
  /** Us class ki pehli valid berth (prompt se hi padho — koi invent nahi). */
  const firstBerthFrom = (prompt: string) => {
    const tail = prompt.slice(prompt.toLowerCase().lastIndexOf("berth preference?") + "berth preference?".length);
    const first = tail.split("/")[0].replace(/[^A-Za-z ]/g, "").trim();
    return first || "Lower";
  };

  /** Passenger ke sawaalon ka jawab — jo poochha jaye wahi (berth wahi jo prompt me chalti hai). */
  async function answerPassenger(name: string, age: number, gender: string) {
    await waitFor(() => expect(lastMsg()).toMatch(/ka naam/i), { timeout: 120_000, interval: 150 });
    await type(`${name}, ${age}, ${gender}`);
    console.log(`PASS-SENT: ${name}, ${age}, ${gender}`);
    let last = "";
    let repeats = 0;
    for (let i = 0; i < 10; i += 1) {
      await new Promise((r) => setTimeout(r, 400));
      const msg = lastMsg();
      console.log(`PASS-TURN[${name}]: ${msg.slice(0, 140).replace(/\s+/g, " ")}`);
      if (/berth preference\?/i.test(msg)) {
        await type(firstBerthFrom(msg));
      } else if (/khaana|meal/i.test(msg)) {
        await type("veg");
      } else if (
        /ka naam/i.test(msg) ||
        /details mil gayi|review booking khol|final details|summary ready|sab details theek|edit karna|kya sab details|Continue Booking dabaiye|Haan” boliye|Haan" boliye/i.test(msg)
      ) {
        return;
      } else {
        /* koi note/status line — kuch bhejne ki zaroorat nahi, bas aage badho */
        if (msg === last) repeats += 1;
        if (repeats >= 3) throw new Error(`passenger turns atak gaye — last: ${msg.slice(0, 200)} | thread: ${allMsgs().slice(-900)}`);
      }
      last = lastMsg();
    }
    throw new Error(`passenger 10 turns me complete nahi hua — thread: ${allMsgs().slice(-900)}`);
  }

  it(
    "poori booking: route → train → class → 2 passenger → review → IRCTC handoff (asli data)",
    async () => {
      expect(target, "asli provider se koi bookable train nahi mili (provider chain down?)").toBeTruthy();
      const tg = target as Target;

      /* Vite `define` vitest me nahi aata — build tag global se (app ka code wahi). */
      (globalThis as unknown as { __BUILD_TAG__?: string }).__BUILD_TAG__ = "e2e-live 2026-09-30";
      const { BookingProvider } = await import("../src/booking/context");
      const { App } = await import("../src/App");
      render(
        <BookingProvider>
          <App />
        </BookingProvider>,
      );

      /* AI Booking maujooda chat ke button se khulta hai (wahi user raasta) */
      const openBtn = await screen.findByLabelText("AI Booking", {}, { timeout: 20_000 });
      fireEvent.click(openBtn);

      /* 1 ── journey Hindi (Devanagari) me — direction sahi hona chahiye */
      const fromHuman = tg.from === "LDH" ? "लुधियाना" : tg.from === "ASR" ? "अमृतसर" : "नई दिल्ली";
      const toHuman = tg.to === "NDLS" ? "नई दिल्ली" : tg.to === "DLI" ? "दिल्ली" : "लुधियाना";
      await waitLog(/bata|jaana|kya/i, 20_000);
      await type(`${fromHuman} से ${toHuman} जाना है, ${tg.human}, 2 passengers`);
      await waitLog(/kaunsi train leni hai|koi train nahi mili/i, 180_000);
      /* ulta direction nahi (R4 ka asli bug): AI ne wahi from→to search kiya jo user ne bola —
       * dakshin-proof = app ki apni /api/trains query ke params. */
      const wanted = `from=${tg.from}&to=${tg.to}`;
      expect(appSearchUrls.some((u) => u.includes(wanted)), `search urls: ${appSearchUrls.join(" | ")}`).toBe(true);

      /* 2 ── train (asli list se) */
      await type(tg.train.number);
      await waitLog(/kaunsi class chahiye/i, 180_000);
      console.log("LIVE trains seen:", trainsSeen.length, "· picked", tg.train.number, tg.train.name);

      /* 3 ── class (asli bookable class) */
      await type(tg.classCode);
      await waitLog(/ka naam/i, 180_000);

      /* 4 ── passengers */
      await answerPassenger("Rahul Sharma", 31, "male");
      await answerPassenger("Neha Sharma", 29, "female");

      /* 5 ── review (AI khud kholta hai) */
      try {
        await waitFor(() => expect(screen.getByTestId("aib-summary")).toBeTruthy(), { timeout: 180_000 });
      } catch {
        throw new Error(
          `summary nahi aaya — FULL: ${allMsgsFull().slice(-3000)} | calls: ${calls.slice(-10).join(",")} | err: ${(document.querySelector(".banner.err")?.textContent ?? "none")} | body: ${(document.body.textContent ?? "").slice(-1500)}`,
        );
      }
      const summary = screen.getByTestId("aib-summary").textContent ?? "";
      expect(summary).toContain(tg.train.number);
      expect(summary).toMatch(new RegExp(tg.classCode));
      expect(summary).toMatch(/Rahul Sharma/);
      expect(summary).toMatch(/Neha Sharma/);
      console.log("LIVE summary:", summary.replace(/\s+/g, " ").slice(0, 320));

      /* 6 ── IRCTC handoff: asli Continue Booking → review screen ka asli #irctc-continue click
       * (asli autofill payload banta hai) → dock me honest line */
      sessionStorage.clear();
      await act(async () => {
        fireEvent.click(screen.getByTestId("aib-continue"));
      });
      await waitFor(() => expect(document.getElementById("irctc-continue")).toBeTruthy(), { timeout: 120_000 });
      await waitFor(() => expect(screen.getByTestId("aib-handoff-line")).toBeTruthy(), { timeout: 30_000 });
      console.log("LIVE handoff line:", (screen.getByTestId("aib-handoff-line").textContent ?? "").slice(0, 200));

      /* Asli autofill payload (IRCTC client isi ko uthata hai) — journey + dono passengers */
      const stored = Object.keys(sessionStorage).map((k) => ({ k, v: sessionStorage.getItem(k) ?? "" }));
      const payloadEntry = stored.find((x) => x.v.length > 60 && /railbook|handoff|irctc/i.test(x.k));
      expect(payloadEntry, `handoff payload nahi mila (keys: ${stored.map((s) => s.k).join(",")})`).toBeTruthy();
      const v = payloadEntry?.v ?? "";
      expect(v).toContain(tg.train.number);
      expect(v.toUpperCase()).toContain(tg.classCode.toUpperCase());
      expect(v).toMatch(/Rahul/);
      expect(v).toMatch(/Neha/);
      expect(v).toContain(tg.ymd);
      expect(calls).toContain("/api/trains");
      expect(calls).toContain("/api/availability");
      console.log("LIVE handoff payload bytes:", v.length);

      /* 7 ── general sawaal (chat jaisa): booking flow ke beech me bhi jawab asli model se */
      const before = lastMsg();
      await type("wallet me kitne paise hain?");
      await waitFor(() => expect(brainAsked).toContain("wallet me kitne paise hain?"), { timeout: 300_000, interval: 300 });
      await waitFor(
        () => {
          const msg = lastMsg();
          expect(msg).not.toBe(before);
          expect(msg).not.toMatch(/jawab abhi nahi mil paaya|jawab lene me dikkat/);
          expect(msg.length).toBeGreaterThan(12);
        },
        { timeout: 300_000, interval: 500 },
      );
      const answer = lastMsg();
      console.log("LIVE general Q&A answer:", answer.slice(0, 240).replace(/\s+/g, " "));
      /* wallet ka jawab asli data par (model ne tool use kiya) — koi invented number nahi */
      expect(answer).toMatch(/[\d,]/);
    },
    900_000,
  );
});
