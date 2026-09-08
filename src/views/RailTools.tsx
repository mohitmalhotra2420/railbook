import { useState } from "react";
import { api } from "../api";
import { Shell } from "../components/Shell";
import { todayYmd } from "../format";

type Tab = "live" | "board" | "pnr" | "cancelled" | "history";

export function RailTools() {
  const [tab, setTab] = useState<Tab>("live");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState<string>("");

  const [trainNo, setTrainNo] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [stn, setStn] = useState("LDH");
  const [pnr, setPnr] = useState("");

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setBody("");
    try {
      setBody(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : "RailKit data nahi mili. Invent nahi karunga.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="RailKit tools" back>
      <main className="page">
        <p className="lede">
          Live status (aaj ya pichhle dinon ke runs), station board, PNR, cancelled trains, station-wise history — railway APIs se. Seats IRCTC snapshot nahi ho sakte.
        </p>
        <div className="inline-chips" style={{ margin: "12px 0" }}>
          {(
            [
              ["live", "Live train"],
              ["board", "Station board"],
              ["pnr", "PNR"],
              ["cancelled", "Cancelled"],
              ["history", "History"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={tab === id ? "on" : ""} onClick={() => { setTab(id); setBody(""); setError(null); }}>
              {label}
            </button>
          ))}
        </div>

        {tab === "live" && (
          <section className="widget">
            <div className="field">
              <label>Train number</label>
              <div className="control">
                <input value={trainNo} onChange={(e) => setTrainNo(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="12014" />
              </div>
            </div>
            <div className="field">
              <label>Run start date (aaj / kal / parson / pehle ka bhi)</label>
              <div className="control">
                <input type="date" value={date} max={todayYmd()} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            <button
              className="btn navy"
              disabled={busy || trainNo.length !== 5}
              onClick={() =>
                void run(async () => {
                  /* Round-16p-2: date (start date of the run) ab bheji jaati hai —
                   * kal/parson/pehle ke runs ka live/completed status. */
                  const res = await api.liveTrain(trainNo, date && date !== todayYmd() ? date : undefined);
                  const l = res.live as typeof res.live & { journeyDate?: string | null; runState?: string | null };
                  const runLine = l.journeyDate ? `Run start date: ${l.journeyDate}${l.runState === "completed" ? " (journey complete)" : l.runState === "not_started" ? " (abhi chali nahi)" : ""}\n` : "";
                  return `${l.trainNumber} ${l.trainName}\n${runLine}${l.status}\nCurrent: ${l.currentStation ?? "—"}\nNext: ${l.runState === "completed" ? "—" : l.nextStation ?? "—"}\nDelay: ${l.delayMinutes ?? "—"}${l.lastUpdatedAt ? `\nUpdated: ${l.lastUpdatedAt}` : ""}`;
                })
              }
            >
              Track
            </button>
          </section>
        )}

        {tab === "board" && (
          <section className="widget">
            <div className="field">
              <label>Station code</label>
              <div className="control">
                <input value={stn} onChange={(e) => setStn(e.target.value.toUpperCase().slice(0, 5))} placeholder="LDH" />
              </div>
            </div>
            <button
              className="btn navy"
              disabled={busy || stn.length < 2}
              onClick={() =>
                void run(async () => {
                  const res = await api.stationBoard(stn, 2);
                  const lines = res.board.trains.slice(0, 20).map(
                    (t) =>
                      `${t.trainNo} ${t.trainName} · PF ${t.platform ?? "—"} · arr ${t.arrival ?? "—"} dep ${t.departure ?? "—"}`,
                  );
                  return `${res.board.summary ?? `${stn} board`}\nTotal ${res.board.total}\n\n${lines.join("\n") || "No trains in window."}`;
                })
              }
            >
              Show board
            </button>
          </section>
        )}

        {tab === "pnr" && (
          <section className="widget">
            <div className="field">
              <label>10-digit PNR</label>
              <div className="control">
                <input value={pnr} onChange={(e) => setPnr(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="5827194603" />
              </div>
            </div>
            <button
              className="btn navy"
              disabled={busy || pnr.length !== 10}
              onClick={() =>
                void run(async () => {
                  const res = await api.pnrLookup(pnr);
                  const data = res.pnr.data as
                    | {
                        train?: { name?: string; number?: string };
                        journey?: { source?: { name?: string }; destination?: { name?: string }; class?: string };
                        passengers?: { current?: { details?: string } }[];
                      }
                    | undefined;
                  if (!data) return `PNR ${res.pnr.pnr} — provider ne detail nahi di. Invent nahi karunga.`;
                  const pax = (data.passengers ?? [])
                    .map((p, i) => `P${i + 1}: ${p.current?.details ?? "—"}`)
                    .join("\n");
                  return `PNR ${res.pnr.pnr}\n${data.train?.number ?? ""} ${data.train?.name ?? ""}\n${data.journey?.source?.name ?? "—"} → ${data.journey?.destination?.name ?? "—"}\nClass ${data.journey?.class ?? "—"}\n${pax}`;
                })
              }
            >
              Check PNR
            </button>
          </section>
        )}

        {tab === "cancelled" && (
          <section className="widget">
            <button
              className="btn navy"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const res = await api.cancelled();
                  const full = (res.cancelled.fully ?? [])
                    .slice(0, 15)
                    .map((t) => `${t.trainNo ?? "—"} ${t.trainName ?? ""}`.trim());
                  const part = (res.cancelled.partial ?? [])
                    .slice(0, 15)
                    .map((t) => `${t.trainNo ?? "—"} ${t.trainName ?? ""}`.trim());
                  return `Fully cancelled: ${res.cancelled.fully?.length ?? 0}\n${full.join("\n") || "—"}\n\nPartial: ${res.cancelled.partial?.length ?? 0}\n${part.join("\n") || "—"}`;
                })
              }
            >
              Load cancelled trains
            </button>
          </section>
        )}

        {tab === "history" && (
          <section className="widget">
            <div className="field">
              <label>Train number</label>
              <div className="control">
                <input value={trainNo} onChange={(e) => setTrainNo(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="12014" />
              </div>
            </div>
            <div className="field">
              <label>Completed journey date</label>
              <div className="control">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            <button
              className="btn navy"
              disabled={busy || trainNo.length !== 5}
              onClick={() =>
                void run(async () => {
                  const res = await api.trainHistory(trainNo, date);
                  const h = res.history as typeof res.history & { runState?: string; status?: string | null; stops: { done?: boolean }[] };
                  const stops = res.history.stops
                    .slice(0, 30)
                    .map((s, i) => `${s.code} ${s.name}  arr ${s.arrival ?? "—"}  dep ${s.departure ?? "—"}${s.delay != null ? `  delay ${s.delay}m` : ""}${h.stops[i]?.done === false ? "  (pending)" : ""}`);
                  const head = h.runState === "completed" ? "journey complete" : h.runState === "running" ? "abhi bhi chal rahi" : h.status ?? "";
                  return `${h.trainNumber} ${h.trainName} · run ${h.date}${head ? ` · ${head}` : ""}\n\n${stops.join("\n") || "No history record."}`;
                })
              }
            >
              Load history
            </button>
          </section>
        )}

        {busy && <p className="lede">Railway data laa raha hoon…</p>}
        {error && <div className="banner err">{error}</div>}
        {body && (
          <pre className="lede" style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>
            {body}
          </pre>
        )}
      </main>
    </Shell>
  );
}
