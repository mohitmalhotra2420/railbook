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
const ROW_RE = new RegExp(
  "^(?:\\*|•|\\d+[.)])?\\s*(?<number>\\d{4,5})\\s+(?<name>[^–\\-|•*·]{2,60}?)\\s*[–\\-|•:·]?\\s*(?<cls>" +
    CLASSES +
    ")(?<clslabel>\\b(?!\\d))\\s*(?:[–\\-|•:·]\\s*)?(?<status>AVAILABLE|RAC|WAITLIST|WL|NOT[ _]?AVAILABLE|N\\/A|REGRET|DEPARTED|CANCELLED)?\\s*(?<count>\\d{1,4})?\\s*(?<scale>seats?)?\\s*(?<fare>₹\\s?[\\d,]+)?\\s*,?\\s*(?<dep>(?:dep(?:arture)?\\.?\\s*:?)?\\s*\\d{1,2}:\\d{2})?",
  "i",
);

function rowOf(seg: string): { row: Row; tail: string } | null {
  const m = ROW_RE.exec(seg.trim());
  if (!m?.groups) return null;
  const g = m.groups as Record<string, string | undefined>;
  const consumed = m[0].length;
  const tail = seg.trim().slice(consumed).replace(/^[\s,;.|–-]+/, "").trim();
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
      const lab = /^([^:]{2,40}):\s*(?=\d{4,5}\s)/.exec(seg);
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
      {parsed.head.length > 0 && (
        <div className="rp-head">
          {parsed.head.map((h, i) => (
            <span key={i} className="rp-headchip">{h}</span>
          ))}
        </div>
      )}
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
