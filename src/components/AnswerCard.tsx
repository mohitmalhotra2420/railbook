import { type ReactNode } from "react";

/* ── Round-47 (28 Sep 2026): chat ka lamba prose jawab padhne-layak sections me ─────────────────────
 * User (screenshot): "etna lamba chat padhna kitna mushkil ho rha, thoda attractive banao… response ko
 * clear cards, larger text, spacing, status chip aur timetable sections me divide kiya jaaye."
 *
 * Ye PURE presentational hai — text waisa hi rehta hai (server/AI/API kuch nahi badla). Sirf usi text
 * ko padhne-layak hisson me baanta jaata hai:
 *   1. status chips   — jo baat text me sach me likhi hai (stale / delay / scheduled / live …)
 *   2. headline       — pehla jumla, bada aur bold
 *   3. timetable card — arrival/departure waqt (agar text me hai) ek chhote board ki tarah
 *   4. body           — baaki jumle, aaram se padhne layak spacing ke saath
 *   5. source footer  — "Source: …" chhota, muted
 * Chips/sections sirf tab bante hain jab unka data text me maujood ho — kuch bhi invent nahi hota.
 */

export type AnswerTone = "ok" | "warn" | "info" | "muted";

export type AnswerChip = { text: string; tone: AnswerTone };

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");

/** Text me sach me jo likha hai usse chips — koi andaza nahi, sirf pattern-match. */
export function answerChips(text: string): AnswerChip[] {
  const t = String(text ?? "");
  const out: AnswerChip[] = [];
  const add = (text2: string, tone: AnswerTone) => {
    if (!out.some((c) => c.text === text2)) out.push({ text: text2, tone });
  };

  const delay = /delay\s*[:=]?\s*(\d{1,3})\s*(?:min|minute|m\b)/i.exec(t);
  if (delay) add(Number(delay[1]) > 0 ? `DELAY ${delay[1]} MIN` : "ON TIME · DELAY 0", Number(delay[1]) > 0 ? "warn" : "ok");
  if (/\bon time\b|time par|samay par/i.test(t) && !delay) add("ON TIME", "ok");
  if (/journey completed|run poori ho chuki|poori ho chuki hai|pahunch chuki hai/i.test(t)) add("RUN COMPLETE", "ok");
  if (/hasn'?t started|not started|start nahi hua|starts at/i.test(t)) add("RUN SHURU NAHI HUA", "muted");
  if (/stale|update purana|purana update/i.test(t)) add("UPDATE STALE", "warn");
  if (/\bcancel(?:led|led)\b/i.test(t)) add("CANCELLED", "warn");
  if (/timetable ke hisaab se|scheduled|schedule se/i.test(t)) add("SCHEDULED", "info");
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(t);
  const dm = new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS.join("|")})[a-z]*\\s+(20\\d{2})\\b`, "i").exec(t);
  if (dm) add(`${dm[1]} ${dm[2][0].toUpperCase()}${dm[2].slice(1, 3)} ${dm[3]}`, "info");
  else if (iso) add(iso[0], "info");
  if (/\blive\b|abhi/i.test(t) && !/stale/i.test(t)) add("LIVE", "info");
  if (/\bWL\s*\d+|waitlist/i.test(t)) add("WAITLIST", "warn");
  if (/\bAVAILABLE\b|\bAVL\b|\bRAC\b/i.test(t)) add("SEAT AVAILABLE", "ok");
  return out.slice(0, 4);
}

export type AnswerTime = { label: string; value: string; day?: string };

/** Text me arrival/departure waqt ho to timetable ramke — sirf jo likha hai. */
export function answerTimes(text: string): AnswerTime[] {
  const t = String(text ?? "");
  const out: AnswerTime[] = [];
  const push = (label: string, value: string, day?: string) => {
    if (!out.some((x) => x.label === label && x.value === value)) out.push({ label, value, day });
  };
  /* Model kabhi "arrival **20:16**" jaisa markdown likh deta hai — beech ke markers chhod do. */
  for (const m of t.matchAll(/\b(arrival|arr|aarti|pahunchne ka samay)\s*[:=]?[\s*_"'’`]*?(\d{1,2}:\d{2})/gi)) push("Arrival", m[2]);
  for (const m of t.matchAll(/\b(departure|dep|prasthan)\s*[:=]?[\s*_"'’`]*?(\d{1,2}:\d{2})/gi)) push("Departure", m[2]);
  for (const m of t.matchAll(/\b(\d{1,2}:\d{2})\s*(?:par|baje)?\s*(?:se\s*)?(nikalti|chalti|pahunchti|arrive|departs|departure)/gi)) push("Departure", m[1]);
  return out.slice(0, 4);
}

/** Text me station (naam + code) ho to board ka header — sirf jo likha hai.
 *  Do shakal: "Ludhiana Jn (LDH)" aur "Ludhiana Jn LDH par" (model dono likhta hai). */
export function answerStation(text: string): { name: string; code: string } | null {
  const t = String(text ?? "");
  const m = /([A-Z][A-Za-z.'’\-]*(?:\s+[A-Z][A-Za-z.'’\-]*){0,3})\s*(?:Jn\.?|Junction)?\s*\(([A-Z]{2,5})\)/.exec(t);
  if (m) return { name: m[1].trim(), code: m[2] };
  const m2 = /([A-Z][A-Za-z.'’\-]*(?:\s+[A-Z][A-Za-z.'’\-]*){0,3})\s+([A-Z]{2,5})\s+(?:par|pe|pr)\b/.exec(t);
  if (m2) return { name: m2[1].trim(), code: m2[2] };
  return null;
}

/* Steps line (⚙️ …) aur source line alag kar do — steps chips me, source footer me. */
function splitMeta(text: string): { steps: string[]; source: string | null; body: string } {
  const steps: string[] = [];
  let source: string | null = null;
  const lines = String(text ?? "").split("\n");
  const bodyLines: string[] = [];
  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;
    if (/^[⚙🔎🛠]/.test(l)) {
      steps.push(l.replace(/^[⚙🔎🛠️\s]+/, ""));
      continue;
    }
    const src = /^\(?\s*source\s*:\s*(.+?)\)?\.?$/i.exec(l);
    if (src) {
      source = src[1].replace(/\.$/, "");
      continue;
    }
    bodyLines.push(l);
  }
  /* Source kabhi jumle ke saath hi chipka hota hai ("…departure 20:19. (Source: confirmtkt.com…)")
   * — usse alag kar ke footer me bhejo (text waisa hi rehta hai). */
  let body = bodyLines.join("\n");
  if (!source) {
    const inline = /\(?\s*Source\s*:\s*([^)]+?)\s*\)?\.?\s*$/i.exec(body);
    if (inline) {
      source = inline[1].replace(/\.$/, "");
      body = body.slice(0, inline.index).trim();
    }
  }
  return { steps, source, body };
}

/** Jumlon me tod (line breaks pehle, phir ". " par) — waqt (20:16) kabhi nahi tootta. */
function sentences(text: string): string[] {
  const out: string[] = [];
  for (const line of String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean)) {
    const parts = line.split(/(?<=[.!?])\s+(?=[A-Z0-9\u0900-\u097F₹])/g);
    for (const p of parts.map((x) => x.trim()).filter(Boolean)) out.push(p);
  }
  return out;
}

/** ── Pipe-table helpers (screenshot fix 2 Oct): “| Train | Status | …” wali lines table me ─────
 * Model alternative trains ka jawab kabhi markdown pipe-table ke roop me bhej deta hai:
 *   **Alternative trains (3A) for 5Oct, LDH → JP** | Train | 3A Status | …
 *   • | 12414 | WL4 | – | 4 | 1020 | 22:55 | 09:30 |
 * Ye plain text me pipe ke saath padhna mushkil hai — isliye yahan hi table me badal dete hain.
 * Sirf presentation — text waisa hi rehta hai, kuch invent nahi. */
function isTableLine(s: string): boolean {
  const t = s.trim();
  return t.includes("|") && (t.match(/\|/g)?.length ?? 0) >= 2 && /Train|Status|Fare|Departure|Arrival|3A|SL| Seats/i.test(t);
}
function parsePipeCells(line: string): string[] {
  return line
    .split("|")
    .map((c) => c.replace(/^\s*[\*•\-]+\s*/, "").replace(/\*\*/g, "").trim())
    .filter((c) => c.length > 0);
}
function extractPipeTables(body: string): { head: string[]; tables: string[][][]; rest: string } {
  const lines = String(body ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const tables: string[][][] = [];
  let cur: string[][] = [];
  const restLines: string[] = [];
  let head: string[] = [];
  let tableStarted = false;
  for (const ln of lines) {
    const cells = parsePipeCells(ln);
    const looksTable = isTableLine(ln) && cells.length >= 3;
    if (looksTable) {
      tableStarted = true;
      if (cells.every((c) => /^[\-:\s]+$/.test(c))) continue;
      cur.push(cells);
    } else {
      if (tableStarted && cur.length) {
        if (ln.startsWith("•") && ln.includes("|")) {
          const c2 = parsePipeCells(ln);
          if (c2.length >= 3) { cur.push(c2); continue; }
        }
        if (cur.length >= 2) tables.push(cur);
        else restLines.push(cur.flat().join(" | "));
        cur = [];
        tableStarted = false;
      }
      if (!tableStarted && /\*\*.*Alternative trains.*\*\*/i.test(ln)) {
        head.push(ln.replace(/\*\*/g, "").trim());
      } else {
        restLines.push(ln);
      }
    }
  }
  if (cur.length >= 2) tables.push(cur);
  else if (cur.length) restLines.push(cur.flat().join(" | "));
  return { head, tables, rest: restLines.join("\n") };
}
function PipeTable({ rows }: { rows: string[][] }): JSX.Element {
  if (!rows.length) return <></>;
  const header = rows[0];
  const body = rows.slice(1);
  return (
    <div className="ac-tablewrap">
      <table className="ac-table">
        <thead>
          <tr>{header.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Body me numbers/waqt highlight — padhne me aankh ruk jaaye. Text waisa hi rehta hai. */
function highlight(text: string): ReactNode[] {
  /* Model kabhi **bold** likh deta hai — wo asterisk user ko dikhne nahi chahiye (R47: usko
   * highlight me badal do, warna jaisa hai waisa hi). */
  const re = /(\*\*[^*\n]{1,40}\*\*|\b\d{1,2}:\d{2}\b|\b20\d{2}-\d{2}-\d{2}\b|\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+20\d{2}\b|₹\s?\d[\d,]*|\b\d+\s?(?:min|seat|seats|minute|minute|hours?|h\b))/gi;
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) nodes.push(text.slice(last, i));
    nodes.push(
      <span key={`${i}-${m[0]}`} className="ac-hl">
        {m[0].startsWith("**") ? m[0].replace(/^\*\*|\*\*$/g, "") : m[0]}
      </span>,
    );
    last = i + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function AnswerCard({ text }: { text: string }): JSX.Element {
  const { steps, source, body } = splitMeta(text);
  // Pipe-table wale hisse ko pehle alag karo — baaki body se headline/bullets
  const { head: pipeHead, tables, rest: pipeRest } = extractPipeTables(body);
  const effectiveBody = tables.length ? pipeRest : body;
  const chips = answerChips(effectiveBody);
  const times = answerTimes(effectiveBody);
  const station = answerStation(effectiveBody);
  const sents = sentences(effectiveBody);
  /* Pehla jumla headline — bas wahi, kuch chhupta nahi (baaki sentences body me). */
  const head = sents[0] ?? effectiveBody;
  const rest = sents.slice(1);
  const stationInHead = station ? new RegExp(`\\b${station.code}\\b`).test(head) : false;

  return (
    <div className="ac">
      {steps.length > 0 && (
        <div className="ac-steps">
          {steps.map((s, i) => (
            <span key={i} className="ac-stepchip">
              <span className="ac-stepdot" aria-hidden>⚙️</span>
              {s}
            </span>
          ))}
        </div>
      )}
      {chips.length > 0 && (
        <div className="ac-chips">
          {chips.map((c) => (
            <span key={c.text} className={`ac-chip ${c.tone}`}>
              {c.text}
            </span>
          ))}
        </div>
      )}
      <p className="ac-head">{highlight(head)}</p>
      {/* Pipe-table title (jaise “Alternative trains (3A) for 5Oct…”) */}
      {pipeHead.length > 0 && (
        <div className="ac-pipehead">
          {pipeHead.map((h, i) => (
            <div key={i} className="ac-pipehead-item">{highlight(h)}</div>
          ))}
        </div>
      )}
      {tables.map((rows, idx) => (
        <PipeTable key={idx} rows={rows} />
      ))}
      {times.length > 0 && (
        <div className="ac-board">
          {station && (
            <div className="ac-board-top">
              <span className="ac-board-code">{station.code}</span>
              <span className="ac-board-name">{station.name}</span>
            </div>
          )}
          <div className="ac-times">
            {times.map((t) => (
              <div key={`${t.label}-${t.value}`} className={`ac-time ${t.label === "Arrival" ? "arr" : "dep"}`}>
                <span className="ac-time-l">{t.label}</span>
                <span className="ac-time-v">{t.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* ── Round-57 (user: "automatically UI table form mein yan bullet form mein aaye") ──────────
       * Prose jawab ab deewar nahi — bullets. "Label: baaki baat" wale jumle bullets ban jaate hain
       * (jaise ChatGPT ke "Main Base: … / Flavor Profile: …"), baaki jumle bhi bullet rows me. Text
       * waisa hi rehta hai — sirf padhne-layak baant diya jaata hai. */}
      {rest.length > 0 && (
        <ul className="ac-bullets ac-bulletlist">
          {rest.map((s, i) => {
            const labelled = /^([A-Z][A-Za-z0-9 /&'’\-]{1,28}):\s+(?=\S)/.exec(s);
            return (
              <li key={i}>
                <span className="ac-bdot" aria-hidden />
                <span>{labelled ? <><strong>{labelled[1]}:</strong> {highlight(s.slice(labelled[0].length))}</> : highlight(s)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {source && (
        <div className="ac-src">
          <span className="ac-src-k">Source</span> {source}
        </div>
      )}
    </div>
  );
}
