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

export type Row = {
  train: string;
  name: string;
  cls: string;
  status: string;
  count: number | null;
  fare: string | null;
  dep: string | null;
  scale: "seats" | "seat" | null;
};

/** Round-29: ek train ke saare class-rows ek card me. Row ka apna status/count/fare waise hi. */
export type TrainRowGroup = { number: string; name: string; rows: Row[] };
/** Concierge ke liye alias — chat card ka class row. */
export type ReplyRow = Row;

/**
 * Round-29 (26 Sep, user screenshot: "22432" do baar, "19804" do baar — same train ki classes alag
 * alag cards me). Pure derived view-model: rows ko trainNumber par group karta hai.
 *   • order wahi — pehli baar jis train ka zikr aaya, uska card wahin (sort/filter nahi).
 *   • har class apna status/count/fare/dep RAKHTI hai — koi merge/average/sum nahi.
 *   • bilkul same record (train+class+status+count+fare+dep) dobara aaye to ek hi baar (blind duplicate
 *     nahi); par alag status/fare wala record chhupta nahi (overwrite bhi nahi).
 *   • input rows mutate nahi hoti (nayi array of groups).
 */
export function groupReplyRowsByTrain(rows: Row[]): TrainRowGroup[] {
  const groups: TrainRowGroup[] = [];
  const at = new Map<string, number>();
  for (const r of rows) {
    const key = r.train;
    let i = at.get(key);
    if (i === undefined) {
      i = groups.length;
      at.set(key, i);
      groups.push({ number: r.train, name: r.name, rows: [] });
    }
    const g = groups[i];
    if (!g.name && r.name) g.name = r.name;
    const dup = g.rows.some(
      (x) =>
        x.cls === r.cls &&
        x.status === r.status &&
        x.count === r.count &&
        (x.fare ?? "") === (r.fare ?? "") &&
        (x.dep ?? "") === (r.dep ?? ""),
    );
    if (dup) continue;
    g.rows.push(r);
  }
  return groups;
}

type Parsed = { head: string[]; rows: Row[]; rest: string[] };

const CLASSES = "1A|2A|3A|3E|SL|CC|2S|EC|EA|FC|2A\\+|GN";
/* Row ka match line/segment ke SHURU me — aage jo bacha (jaise "… 22 trains check ki") wo rest text. */
/* Round-22 (26 Sep, user screenshot: seedha AI seat-answer) — us text me separator EM-DASH (—) hai
 * aur time ke baad "departure" shabd bhi. Dono add kiye (purane –/-/| formats waise hi chalte hain). */
const SEP = "[–\\-—|•:·]"; /* en-dash, hyphen, EM-DASH, pipe, bullet, colon, middle-dot */
const ROW_RE = new RegExp(
  "^(?:\\*|•|\\d+[.)])?\\s*(?<number>\\d{4,5})\\s+(?<name>[^–\\-—|•*·]{2,60}?)\\s*" + SEP + "?\\s*(?<cls>" +
    CLASSES +
    ")(?<clslabel>\\b(?!\\d))\\s*(?:" + SEP + "\\s*)?(?<status>AVAILABLE|AVAIL|AVL|RAC|WAITLIST|WL|NOT[ _]?AVAILABLE|N\\/A|REGRET|DEPARTED|CANCELLED)?\\s*(?<count>\\d{1,4})?\\s*(?<scale>seats?)?\\s*(?:" + SEP + "\\s*)?(?<fare>₹\\s?[\\d,]+)?\\s*,?\\s*(?:" + SEP + "\\s*)?(?<dep>(?:dep(?:arture)?\\.?\\s*:?)?\\s*\\d{1,2}:\\d{2}(?:\\s*(?:departure|dep\\.?))?)?",
  "i",
);

function rowOf(seg: string): { row: Row; tail: string } | null {
  const m = ROW_RE.exec(seg.trim());
  if (!m?.groups) return null;
  const g = m.groups as Record<string, string | undefined>;
  const consumed = m[0].length;
  const source = seg.trim();
  /* Round-29 (user screenshot: "…3A AVL —" ke baad text "ability check karne ke liye journey date
   * chahiye" — beech ke shabd kaat ke adhoora pada tha). Regex line ka naam itna khincha ki wo aadhe
   * shabd par ruk gaya; aisa match row nahi maana jaata — poora text waisa hi rehta hai (kuch chhupta
   * nahi, kuch adhoora nahi). */
  if (/[\p{L}\p{N}]/u.test(source[consumed] ?? "") && /[\p{L}\p{N}]/u.test(source[consumed - 1] ?? "")) return null;
  const tail = seg.trim().slice(consumed).replace(/^[\s,;.|–—\-]+/, "").trim();
  const statusRaw = String(g.status ?? "").toUpperCase().replace(/\s+/g, "_");
  /* Round-27: chat/server ke compact jawab me "AVL"/"AVAIL" likha hota hai (jaise "CC AVL 444 ₹675")
   * — pehle ye row hi nahi banta tha, poora answer plain text ban jaata tha. */
  const status =
    statusRaw === "WL" ? "WAITLIST" : statusRaw === "N/A" ? "NOT_AVAILABLE" : statusRaw === "AVL" || statusRaw === "AVAIL" ? "AVAILABLE" : statusRaw;
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

/* Round-27 (user: "ek hi class dikha raha, jabki same train me aur bhi classes me seat hai"):
 * ab jawab ki ek line me ek train ki SAARI classes hoti hain — "12013 AMRITSAR SHTABDI — CC AVL 444
 * ₹675 · 3A AVL 71 ₹520 · EC AVL 23 ₹1,015 — 06:10 departure". Pehla class ROW_RE se row banta hai;
 * baaki class-chips yahan se alag rows banti hain (wahi train) taaki list kuch chhupaye nahi. */
const CLASS_CHIP_RE = new RegExp(
  "^(?:[·•|,]|—|–|-)?\\s*(?<cls>" +
    CLASSES +
    ")\\b\\s*(?:" +
    SEP +
    "\\s*)?(?<status>AVAILABLE|AVAIL|AVL|RAC|WAITLIST|WL|NOT[ _]?AVAILABLE|N\\/A|REGRET|DEPARTED|CANCELLED)\\b\\s*(?<count>\\d{1,4})?\\s*(?<scale>seats?)?\\s*(?:" +
    SEP +
    "\\s*)?(?<fare>₹\\s?[\\d,]+)?\\s*(?:[·•|,]|—|–|-)?\\s*",
  "i",
);
const DEP_RE = /^(?:dep(?:arture)?\.?\s*:?\s*)?(\d{1,2}:\d{2})(?:\s*(?:departure|dep\.?))?/i;

function extraClassRows(tailRaw: string, base: Row): { rows: Row[]; rest: string } {
  const rows: Row[] = [];
  let rest = tailRaw.trim();
  for (let guard = 0; guard < 12; guard += 1) {
    const m = CLASS_CHIP_RE.exec(rest);
    if (!m?.groups) break;
    const g = m.groups as Record<string, string | undefined>;
    const raw = String(g.status ?? "").toUpperCase();
    const status = raw === "AVL" || raw === "AVAIL" ? "AVAILABLE" : raw === "WL" ? "WAITLIST" : raw;
    rows.push({
      train: base.train,
      name: base.name,
      cls: String(g.cls ?? "").toUpperCase(),
      status,
      count: g.count ? Number(g.count) : null,
      fare: g.fare ? g.fare.replace(/\s+/g, "") : null,
      dep: null,
      scale: g.scale ? (g.scale.toLowerCase().startsWith("seats") ? "seats" : "seat") : null,
    });
    rest = rest.slice(m[0].length).trim();
  }
  if (rows.length) {
    /* Line ke aakhir me departure ho to wo aakhri class ke row par (jaise server bhejta hai). */
    const d = DEP_RE.exec(rest.replace(/^[–—\-·•|,]\s*/, ""));
    if (d) {
      rows[rows.length - 1].dep = d[1];
      rest = rest.replace(/^[–—\-·•|,]\s*/, "").slice(d[0].length).trim();
    }
  }
  return { rows, rest };
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
        /* Round-27: usi train ki baaki classes bhi apni-apni row banti hain (kuch chhupta nahi). */
        const more = extraClassRows(r.tail, r.row);
        if (more.rows.length) {
          out.rows.push(...more.rows);
          if (more.rest.length > 3) out.rest.push(more.rest);
        } else if (r.tail.length > 3) out.rest.push(r.tail);
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

/** Card ka tone = us train ki sabse achhi class (green > blue > amber > red) — rang pehle jaisa. */
function groupTone(rows: Row[]): ReturnType<typeof statusTone> {
  const tones: string[] = rows.map((r) => statusTone(r.status));
  for (const t of ["ok", "rac", "wl", "bad"] as const) if (tones.includes(t)) return t;
  return "bad";
}

/** Tappable = booking ka rasta khulta hai (available/RAC/WL ya status pata nahi). N/A par jhootha button nahi. */
const isTappable = (status: string) => status === "AVAILABLE" || status === "RAC" || status === "WAITLIST" || status === "UNKNOWN";

export function ReplyText({
  text,
  onBook,
}: {
  text: string;
  /** Round-29: class par tap → usi train+class ka passenger form (Concierge deta hai). */
  onBook?: (row: Row, group: TrainRowGroup) => void;
}): JSX.Element {
  const parsed = parseReply(text);
  if (parsed.rows.length === 0) return <p className="msg-text">{text}</p>;
  /* Round-29: display-level grouping — server ka text/rows waisa hi rehta hai, sirf card ek per train. */
  const groups = groupReplyRowsByTrain(parsed.rows);
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
        {groups.map((g) => {
          const tone = groupTone(g.rows);
          return (
            <div key={`${g.number}|${g.name}`} className={`rp-row ${tone}`}>
              <div className="rp-l1">
                <span className="rp-no">{g.number}</span>
                {g.name && <span className="rp-name">{g.name}</span>}
                <span className="rp-gcount">
                  {g.rows.length} class{g.rows.length === 1 ? "" : "es"}
                </span>
              </div>
              <div className="rp-crows">
                {g.rows.map((r, i) => {
                  const t = statusTone(r.status);
                  const body = (
                    <>
                      <span className="rp-cls">{r.cls}</span>
                      <span className={`rp-st ${t}`}>{statusText(r)}</span>
                      {r.fare && <span className="rp-fare">{r.fare}</span>}
                      {r.dep && <span className="rp-dep">🕑 {r.dep}</span>}
                    </>
                  );
                  return onBook && isTappable(r.status) ? (
                    <button
                      key={i}
                      type="button"
                      className={`rp-crow tappable ${t}`}
                      aria-label={`${g.number} ${g.name} ${r.cls} ${statusText(r)} — passenger form kholo`}
                      title={`${g.number} ${r.cls} — passenger form kholo`}
                      onClick={() => onBook(r, g)}
                    >
                      {body}
                      <span className="rp-go">Book</span>
                    </button>
                  ) : (
                    <div key={i} className={`rp-crow ${t}`}>
                      {body}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {parsed.rest.length > 0 && <p className="rp-tail">{parsed.rest.join(" ")}</p>}
    </div>
  );
}
