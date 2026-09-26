/* Round-20 (25 Sep, screenshot 3): user: "question ka answer chat form mein padna user ke liye mushkil
 * ho sakta hai better usko thoda attractive banao".
 *
 * Screenshot me text aisa tha (ek hi line, koi newline nahi):
 *   "LDH → ASR, kal 26 Sep, Dopahar 12:00–17:00 window: * 11057 CSMT ASR EXPRESS – 3E AVAILABLE 44 seats
 *    ₹520, dep 12:55 * 11057 CSMT ASR EXPRESS – 2A AVAILABLE 18 seats ₹725, dep 12:55 * … 22 trains check
 *    ki, is window me seat wali 2 trains dikh rahi hain."
 * Aur server ke SEAT block me rows " | " se judi hoti hain.
 *
 * Ye component SIRF PRESENTATION hai — msg.text waisa hi rehta hai (state, copy, AI sab untouched). Text
 * ko rows me todta hai:
 *   • "* 12014 AMRITSAR SHATABDI – CC AVAILABLE 475 seats ₹510, dep 04:55"  → ek sundar row
 *   • "SEAT (15 rows): A | B | C"                                          → teen rows
 *   • bullet na ho to pehle jaisa paragraph (kuch chhupta nahi, kuch invent nahi).
 */
import type { JSX } from "react";

type Row = {
  train: string;
  name: string;
  cls: string;
  status: string;
  count: number | null;
  fare: string | null;
  dep: string | null;
  scale: "seats" | "seat" | null;
};

type Parsed = { head: string[]; rows: Row[]; rest: string[] };

const CLASSES = "1A|2A|3A|3E|SL|CC|2S|EC|EA|FC|2A\\+|GN";
/* Row ka match line/segment ke SHURU me — aage jo bacha (jaise "… 22 trains check ki") wo rest text. */
/* Round-22 (26 Sep, user screenshot: seedha AI seat-answer) — us text me separator EM-DASH (—) hai
 * aur time ke baad "departure" shabd bhi. Dono add kiye (purane –/-/| formats waise hi chalte hain). */
const SEP = "[–\\-—|•:·]"; /* en-dash, hyphen, EM-DASH, pipe, bullet, colon, middle-dot */
const ROW_RE = new RegExp(
  "^(?:\\*|•|\\d+[.)])?\\s*(?<number>\\d{4,5})\\s+(?<name>[^–\\-—|•*·]{2,60}?)\\s*" + SEP + "?\\s*(?<cls>" +
    CLASSES +
    ")(?<clslabel>\\b(?!\\d))\\s*(?:" + SEP + "\\s*)?(?<status>AVAILABLE|RAC|WAITLIST|WL|NOT[ _]?AVAILABLE|N\\/A|REGRET|DEPARTED|CANCELLED)?\\s*(?<count>\\d{1,4})?\\s*(?<scale>seats?)?\\s*(?:" + SEP + "\\s*)?(?<fare>₹\\s?[\\d,]+)?\\s*,?\\s*(?:" + SEP + "\\s*)?(?<dep>(?:dep(?:arture)?\\.?\\s*:?)?\\s*\\d{1,2}:\\d{2}(?:\\s*(?:departure|dep\\.?))?)?",
  "i",
);

function rowOf(seg: string): { row: Row; tail: string } | null {
  const m = ROW_RE.exec(seg.trim());
  if (!m?.groups) return null;
  const g = m.groups as Record<string, string | undefined>;
  const consumed = m[0].length;
  const tail = seg.trim().slice(consumed).replace(/^[\s,;.|–—\-]+/, "").trim();
  const statusRaw = String(g.status ?? "").toUpperCase().replace(/\s+/g, "_");
  const status = statusRaw === "WL" ? "WAITLIST" : statusRaw === "N/A" ? "NOT_AVAILABLE" : statusRaw;
  const dep = g.dep ? (g.dep.match(/\d{1,2}:\d{2}/)?.[0] ?? null) : null;
  /* Ek 4-5 digit number + class code — bina status/count/fare ke bhi row hai (jaise "12926 PASCHIM 3A"). */
  const plausible = Boolean(g.status || g.count || g.fare || g.dep);
  if (!plausible && !/[-–]/.test(seg)) return null;
  return {
    row: {
      train: String(g.number ?? ""),
      name: String(g.name ?? "").trim().replace(/\s+$/, ""),
      cls: String(g.cls ?? "").toUpperCase(),
      status: status || "UNKNOWN",
      count: g.count ? Number(g.count) : null,
      fare: g.fare ? g.fare.replace(/\s+/g, "") : null,
      dep,
      scale: (g.scale?.toLowerCase().startsWith("seat") ? (g.scale.toLowerCase().startsWith("seats") ? "seats" : "seat") : null) as Row["scale"],
    },
    tail,
  };
}

/** Ek line ko segments me todo: "*" bullets, "|" rows, ya poora line. */
function segmentsOf(line: string): string[] {
  const t = line.trim();
  if (!t) return [];
  /* "* a * b * c" — bullet se pehle space; pehla "*" bhi segment se alag karo. */
  if (/\s\*/.test(t) || /^\*/.test(t)) {
    return t
      .split(/\s+(?=\*)/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  /* "SEAT (15 rows): A | B | C" — pipe wale rows. */
  if (/\s\|\s/.test(t) && /(SEAT|rows?|TRAINS?|WL)/i.test(t.split("|")[0])) {
    return t
      .split(/\s*\|\s*/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [t];
}

function parseReply(text: string): Parsed {
  const out: Parsed = { head: [], rows: [], rest: [] };
  const lines = String(text ?? "").split("\n");
  for (const line of lines) {
    for (let seg of segmentsOf(line)) {
      /* "SEAT (15 rows): 12014 …" — lead-in label header chip me, row alag (kuch chhupta nahi). */
      /* Round-26 (user: "trains total 10 hai lekin mere ko 9 show kar rhi"): AI aksar pehli train
       * ko hi intro line me likh deta hai ("… seat wali trains: 19611 All ASR EXP — SL — AVAILABLE
       * 174 seats — ₹150"). Pehle label 40 akshar tak hi match hota tha, isliye wo row head me chali
       * jaati thi aur summary usse ginnti nahi thi (10 trains par "9 me seat"). Ab label 140 tak —
       * row alag ho jaati hai aur count match karta hai. */
      const lab = /^([^:]{2,140}):\s*(?=\d{4,5}\s)/.exec(seg);
      if (lab) {
        if (!out.rows.length && out.head.length < 3) out.head.push(lab[1].trim());
        seg = seg.slice(lab[0].length);
      }
      const r = rowOf(seg);
      if (r) {
        out.rows.push(r.row);
        if (r.tail.length > 3) out.rest.push(r.tail);
        continue;
      }
      const clean = seg.replace(/\*+/g, "").replace(/[:：]\s*$/, (m) => m.trim()).trim();
      if (!out.rows.length && out.head.length < 3 && clean.length <= 140) out.head.push(clean);
      else out.rest.push(clean);
    }
  }
  return out;
}

/** Head text (jaise "Kal 27 Sep ko Amritsar → Ludhiana, Subah (04:00–12:00) window mein SL class") ko
 * 2 chips me baanto: route aur window/class — shabd waise hi, bas padhne me aasan. */
function headChips(head: string[]): string[] {
  const out: string[] = [];
  for (const h of head) {
    const t = h.trim();
    if (!t) continue;
    const arrow = /^(?<route>.*?→\s*[^,]+)\s*,\s*(?<rest>.+)$/.exec(t);
    if (arrow?.groups?.route && arrow.groups.rest) {
      out.push(arrow.groups.route.trim());
      out.push(arrow.groups.rest.trim());
      continue;
    }
    out.push(t);
  }
  return out.slice(0, 3);
}

const statusTone = (s: string) =>
  s === "AVAILABLE" ? "ok" : s === "RAC" ? "rac" : s === "WAITLIST" ? "wl" : "bad";

function statusText(r: Row): string {
  if (r.status === "AVAILABLE") return `AVL ${r.count ?? "—"}`;
  if (r.status === "RAC") return `RAC ${r.count ?? "—"}`;
  if (r.status === "WAITLIST") return `WL ${r.count ?? "—"}`;
  if (r.status === "NOT_AVAILABLE" || r.status === "UNKNOWN") return r.status === "UNKNOWN" ? "status nahi mila" : "N/A";
  if (r.status === "REGRET") return "Regret";
  return r.count ? String(r.count) : r.status;
}

export function ReplyText({ text }: { text: string }): JSX.Element {
  const parsed = parseReply(text);
  if (parsed.rows.length === 0) return <p className="msg-text">{text}</p>;
  return (
    <div className="rp">
      {headChips(parsed.head).length > 0 && (
        <div className="rp-head">
          {headChips(parsed.head).map((h, i) => (
            <span key={i} className="rp-headchip">{h}</span>
          ))}
        </div>
      )}
      {(() => {
        /* Round-22: summary line — sirf usi text ke numbers se (jo dikh raha hai wahi; kuch invent nahi). */
        const seatRows = parsed.rows.filter((r) => r.status === "AVAILABLE" || r.status === "RAC");
        const wlRows = parsed.rows.filter((r) => r.status !== "AVAILABLE" && r.status !== "RAC");
        if (!seatRows.length && !wlRows.length) return null;
        const counts = seatRows.map((r) => r.count).filter((n): n is number => typeof n === "number");
        const fares = parsed.rows
          .map((r) => Number(String(r.fare ?? "").replace(/[^\d]/g, "")))
          .filter((n) => Number.isFinite(n) && n > 0);
        return (
          <div className="rp-sum">
            {/* Round-26: total + seat/WL ka farq saaf — warna "9 me seat" aur 10 rows ka mismatch. */}
            {wlRows.length ? `💺 ${parsed.rows.length} trains: ` : "💺 "}
            {seatRows.length ? `${seatRows.length} me seat${counts.length ? ` (${counts.join(", ")})` : ""}` : "koi seat nahi"}
            {wlRows.length ? ` · ${wlRows.length} WL/N-A` : ""}
            {fares.length > 1 ? ` · fare ₹${Math.min(...fares)}–₹${Math.max(...fares)}` : fares.length === 1 ? ` · fare ₹${fares[0]}` : ""}
          </div>
        );
      })()}
      <div className="rp-rows">
        {parsed.rows.map((r, i) => (
          <div key={i} className={`rp-row ${statusTone(r.status)}`}>
            <div className="rp-l1">
              <span className="rp-no">{r.train}</span>
              {r.name && <span className="rp-name">{r.name}</span>}
            </div>
            <div className="rp-l2">
              <span className="rp-cls">{r.cls}</span>
              <span className={`rp-st ${statusTone(r.status)}`}>{statusText(r)}</span>
              {r.fare && <span className="rp-fare">{r.fare}</span>}
              {r.dep && <span className="rp-dep">🕑 {r.dep}</span>}
            </div>
          </div>
        ))}
      </div>
      {parsed.rest.length > 0 && <p className="rp-tail">{parsed.rest.join(" ")}</p>}
    </div>
  );
}
