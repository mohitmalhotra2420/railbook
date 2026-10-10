import { useCallback, useRef, useState } from "react";
import { nativeSpeak } from "../voice/nativeSpeak";
import { useVoiceInput } from "../voice/useVoiceInput";
import { sendAssistantTurn, type AssistantMessage } from "../assistant/client";

/** Conversational assistant. Text and voice share one history. Mic only starts on tap. */
export function Assistant() {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speakReplies, setSpeakReplies] = useState(false);
  const busyRef = useRef(false);

  const speak = useCallback(
    (text: string) => {
      if (!speakReplies) return;
      if (nativeSpeak(text, "hi-IN")) return;
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      }
    },
    [speakReplies],
  );

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      const next: AssistantMessage[] = [...messages, { role: "user", content: text }];
      setMessages(next);
      setInput("");
      try {
        const reply = await sendAssistantTurn(text, messages);
        setMessages((m) => [...m, { role: "assistant", content: reply }]);
        speak(reply);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Kuch galat ho gaya.");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [messages, speak],
  );

  const voice = useVoiceInput(
    (t) => setInput((prev) => (prev ? `${prev} ${t}` : t)),
    (msg) => setError(msg),
    { manualCommit: true, greet: false },
  );

  return (
    <div className="asst-page">
      <header className="asst-head">
        <h1>Railway AI Assistant</h1>
        <label className="asst-tts">
          <input type="checkbox" checked={speakReplies} onChange={(e) => setSpeakReplies(e.target.checked)} />
          Jawab bolo
        </label>
      </header>

      <main className="asst-chat" aria-live="polite">
        {messages.length === 0 && (
          <p className="asst-hint">Jaise: "Amritsar se Delhi jaana hai" — ya mic dabakar bolein.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`asst-msg asst-${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="asst-msg asst-assistant asst-busy">Soch raha hoon…</div>}
        {error && <div className="asst-error" role="alert">{error}</div>}
      </main>

      <form
        className="asst-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <button
          type="button"
          className={`asst-mic ${voice.listening ? "on" : ""}`}
          onClick={() => (voice.listening ? voice.stop() : voice.start())}
          disabled={!voice.supported || busy}
          aria-pressed={voice.listening}
        >
          🎙️ {voice.listening ? "Sun raha hoon" : "Talk to AI"}
        </button>
        <input
          className="asst-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          disabled={busy}
        />
        <button type="submit" className="asst-send" disabled={busy || !input.trim()}>
          Bhejo
        </button>
      </form>
    </div>
  );
}
