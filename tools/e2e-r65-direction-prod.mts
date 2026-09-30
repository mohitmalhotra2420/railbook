#!/usr/bin/env npx tsx
/* ══ R65 check: route direction (Hindi) — aur usi direction par PROD se asli trains ═══════════════════
 * User (30 Sep): "लुधियाना से नई दिल्ली जाना है" par AI ne route ULTA kaha (New Delhi se Ludhiana).
 * Ye check do cheezein karta hai:
 *   1) flow engine (wahi code jo deployed bundle me hai) Hindi route ko SAHI direction me set karta hai,
 *   2) usi from→to par PROD APIs se asli trains aati hain (koi mock nahi).
 *
 * Chalane ka tarika:  npx tsx tools/e2e-r65-direction-prod.mts
 * Base badalna ho:    RAILBOOK_BASE=https://railbook-gegs.onrender.com npx tsx tools/e2e-r65-direction-prod.mts
 * ══════════════════════════════════════════════════════════════════════════════════════════════════ */
import { aiBookingStart, aiBookingTurn, type AiBookingState } from "../src/ai/aiBookingFlow";

const BASE = process.env.RAILBOOK_BASE ?? "https://railbook-gegs.onrender.com";
const NOW = new Date();
let pass = 0;
let fail = 0;
function check(ok: boolean, label: string, extra = "") {
  if (ok) {
    pass += 1;
    console.log(`   ✅ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail += 1;
    console.log(`   ❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const step = (s: AiBookingState, t: string) => {
  const r = aiBookingTurn(s, t, { now: NOW });
  console.log(`\nUSER: ${t}\nAI  : ${r.say.join(" | ")}`);
  return r;
};

console.log(`\n── R65 · direction check (base: ${BASE}) ──`);
let s = aiBookingStart(NOW).state;

/* 1 ── Hindi route pehla message me hi sahi direction */
const t1 = step(s, "लुधियाना से नई दिल्ली जाना है");
s = t1.state;
check(s.from?.code === "LDH", "from = LDH (Ludhiana)", `mila: ${s.from?.code ?? "-"}`);
check(s.to?.code === "NDLS", "to = NDLS (New Delhi)", `mila: ${s.to?.code ?? "-"}`);
check(s.pendingCity === null, "city ka bekaar sawaal nahi (NDLS saaf tha)");

/* 2 ── date + pax, phir route dobara batao (correction) → naya pair + fresh search */
const t2 = step(s, "1 October, 2 log");
s = t2.state;
check(s.date != null && s.pax === 2, "date + 2 passengers note hue", `${s.date ?? "-"} · pax ${s.pax ?? "-"}`);
const t3 = step(s, "पर मैंने तो बोला नई दिल्ली से लुधियाना जाना है ना");
s = t3.state;
check(s.from?.code === "NDLS" && s.to?.code === "LDH", "correction par naya pair (NDLS→LDH)", `${s.from?.code}→${s.to?.code}`);
const search = t3.actions.find((a) => a.type === "SEARCH") as { from?: { code: string }; to?: { code: string }; date?: string } | undefined;
check(Boolean(search), "fresh search action aaya");
check(search?.from?.code === "NDLS" && search?.to?.code === "LDH", "search bhi sahi direction me", search ? `${search.from?.code}→${search.to?.code}` : "—");

/* 3 ── usi direction par PROD APIs se asli trains (koi mock nahi) */
const ymd = new Date(Date.now() + 12 * 86400_000).toISOString().slice(0, 10);
console.log(`\n── PROD /api/trains?from=LDH&to=NDLS&date=${ymd} ──`);
try {
  const res = await fetch(`${BASE}/api/trains?from=LDH&to=NDLS&date=${ymd}`);
  const json = (await res.json()) as { trains?: { number: string; name: string; from?: { code?: string }; to?: { code?: string } }[] };
  const trains = json.trains ?? [];
  check(res.status === 200, "prod trains API 200", `status ${res.status}`);
  check(trains.length > 0, "prod se asli trains mili", `${trains.length} trains`);
  const wrongWay = trains.filter((t) => t.from?.code === "NDLS" || t.to?.code === "LDH");
  check(wrongWay.length === 0, "list ki direction bhi sahi (koi ulta train nahi)", wrongWay.length ? `${wrongWay.length} ulti rows` : "0");
  if (trains[0]) console.log(`   pehli train: ${trains[0].number} ${trains[0].name} (${trains[0].from?.code}→${trains[0].to?.code})`);
} catch (err) {
  check(false, "prod trains API reachable", String(err).slice(0, 90));
}

console.log(`\n═══ RESULT: ${pass}/${pass + fail} checks pass ═══`);
process.exit(fail ? 1 : 0);
