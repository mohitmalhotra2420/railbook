import { useState, type FormEvent, type ReactNode } from "react";
import { useVoiceInput } from "../voice/useVoiceInput";

export function fieldPrompt(field: string, rest = ""): ReactNode {
  return (
    <>
      <strong className="vb-field">{field}</strong>
      <strong className="vb-verb"> bhariye</strong>
      {rest ? <span className="vb-rest"> — {rest}</span> : null}
    </>
  );
}

export function VoiceBar({
  prompt,
  onSpeak,
  placeholder = "Boliye ya type kijiye…",
}: {
  prompt: ReactNode;
  onSpeak: (text: string) => void | Promise<void>;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const voice = useVoiceInput((text) => {
    void onSpeak(text.trim());
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (voice.listening) return;
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    void onSpeak(t);
  }

  return (
    <div className="vb">
      <div className={`vb-prompt ${voice.listening ? "live" : ""}`}>{prompt}</div>
      <form className="vb-form" onSubmit={submit}>
        <input
          value={voice.listening && voice.interim ? voice.interim : draft}
          onChange={(e) => {
            if (voice.listening) return;
            setDraft(e.target.value);
          }}
          placeholder={voice.listening ? "Sun raha hoon…" : placeholder}
          aria-label="Voice or type"
          autoComplete="off"
        />
        <button
          type="button"
          className={`vb-mic ${voice.listening ? "live" : ""}`}
          onClick={() => void voice.toggle()}
          aria-label={voice.listening ? "Stop" : "Mic"}
          aria-pressed={voice.listening}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M6 11a6 6 0 0 0 12 0M12 17v4M8 21h8" />
          </svg>
        </button>
        <button type="submit" className="vb-send" disabled={voice.listening} aria-label="Send">
          ➤
        </button>
      </form>
    </div>
  );
}
