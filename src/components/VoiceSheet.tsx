/* VoiceSheet — "bolke poochna" wala screen (24 Sep 2026).
 *
 * User (ConfirmTkt ka "Listening" screenshot bhej kar): "Yeh screenshot mein dekho bolne wala esa
 * banaya ConfirmTkt ne — hum bhi esa kuch bolne wala show karein?"
 *
 * Isliye: neeche se aane wala sheet — jo bhi bola wo live likha jata hai (transcript), saath me
 * quick chips (Confirmed / AC / Alternatives), bada mic, keyboard button (type karo) aur ✕.
 * Bhejna manual hai: OK dabane par hi jata hai (auto-send band — user ne pehle aisa hi kaha tha).
 * Koi AI/server/API change nahi — ye sirf UI hai (jo pehle se maujood voice input ko dikhata hai).
 */
export interface VoiceSuggestion {
  id: string;
  label: string;
  text: string;
}

export function VoiceSheet({
  open,
  listening,
  interim,
  level,
  status,
  suggestions,
  onOk,
  onCancel,
  onType,
  onPick,
}: {
  open: boolean;
  listening: boolean;
  interim: string;
  level: number;
  status: string;
  suggestions: VoiceSuggestion[];
  onOk: () => void;
  onCancel: () => void;
  onType: () => void;
  onPick: (text: string) => void;
}) {
  if (!open) return null;
  const ready = Boolean(interim.trim());
  const scale = 1 + Math.min(Math.max(level, 0), 1) * 0.22;
  return (
    <div className="vs-scrim" onClick={onCancel} role="presentation">
      <div className="vs-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Bolkar poochho">
        <div className="vs-head">
          <span className="vs-brand">RailBook</span>
          <span className="vs-live">{listening ? "Listening…" : ready ? "Sun liya" : "Mic band"}</span>
          <button type="button" className="vs-x" onClick={onCancel} aria-label="Band karo">
            ✕
          </button>
        </div>

        <div className="vs-sugg">
          {suggestions.map((s) => (
            <button key={s.id} type="button" className="vs-chip" onClick={() => onPick(s.text)}>
              {s.label}
            </button>
          ))}
        </div>

        <div className={`vs-transcript ${interim.trim() ? "" : "empty"}`} aria-live="polite">
          {interim.trim() ? interim : "… bolo — jaise “Ludhiana se Delhi 2A me seat hai?” ya “sabse sasti train”"}
        </div>

        <div className="vs-micwrap">
          <span className={`vs-ring ${listening ? "live" : ""}`} style={{ transform: `scale(${scale})` }} aria-hidden />
          <button
            type="button"
            className={`vs-mic ${listening ? "live" : ""}`}
            onClick={ready ? onOk : undefined}
            aria-label={ready ? "OK — bhejo" : "Sun raha hoon"}
          >
            {ready ? (
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l5 5L20 7" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M6 11a6 6 0 0 0 12 0M12 17v4M8 21h8" />
              </svg>
            )}
          </button>
        </div>

        <div className="vs-state">{ready ? "OK ✓ dabao — bhejne ke liye" : status}</div>

        <div className="vs-actions">
          <button type="button" className="vs-key" onClick={onType} title="Type karo" aria-label="Type karo">
            ✍️ Type
          </button>
          <button type="button" className="vs-ok" onClick={onOk} disabled={!ready}>
            OK ✓ Bhejo
          </button>
          <button type="button" className="vs-close" onClick={onCancel} title="Band karo" aria-label="Band karo">
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
