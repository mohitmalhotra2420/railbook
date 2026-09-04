import { useState, type FormEvent } from "react";

const FEATURES: [string, string][] = [
  ["Smart train search", "Route optimisation"],
  ["Alternative dates", "AI summaries"],
];

function IconCompass() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M15.5 8.5 13.2 13.2 8.5 15.5l2.3-4.7z" strokeLinejoin="round" />
    </svg>
  );
}

function IconBell() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" strokeLinejoin="round" />
      <path d="M10 19a2.2 2.2 0 0 0 4 0" strokeLinecap="round" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden>
      <path d="m4.5 12.5 5 5 10-11" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * "Atlas — coming soon" card (RailCore Atlas jaisa): AI journey intelligence
 * jo launch hote hi RailBook mein aayega. Get notified email local save hota hai.
 */
export function AtlasCard() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
    if (!ok) {
      setErr("Sahi email likho.");
      return;
    }
    try {
      localStorage.setItem(
        "railbookAtlasNotify",
        JSON.stringify({ email: email.trim(), at: new Date().toISOString() }),
      );
    } catch {
      /* private mode — chal jayega bina persist */
    }
    setErr(null);
    setSaved(true);
  }

  return (
    <section className="atlas-card" aria-label="RailBook Atlas coming soon">
      <div className="atlas-top">
        <span className="atlas-icon">
          <IconCompass />
        </span>
        <span className="atlas-pill">COMING SOON</span>
      </div>
      <h2 className="atlas-title">RailBook Atlas</h2>
      <p className="atlas-desc">
        AI-powered journey intelligence jo trains search, rank aur analyse karta hai — alternative
        dates, connecting routes aur optimised plans suggest karta hai, aur simple bhasha mein
        batata hai ki best choice kaunsi hai.
      </p>
      <div className="atlas-grid">
        {FEATURES.flat().map((f) => (
          <span key={f} className="atlas-feat">
            <i className="atlas-check">
              <IconCheck />
            </i>
            {f}
          </span>
        ))}
      </div>
      {!saved ? (
        open ? (
          <form className="atlas-notify" onSubmit={submit}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tumhara@email.com"
              aria-label="Email for Atlas launch notification"
              autoFocus
            />
            <button type="submit" className="atlas-notify-btn">
              Notify me
            </button>
          </form>
        ) : (
          <button type="button" className="atlas-notify-link" onClick={() => setOpen(true)}>
            <IconBell />
            Get notified
          </button>
        )
      ) : (
        <p className="atlas-done">✓ Ho gaya — Atlas launch hote hi sabse pehle pata chalega.</p>
      )}
      {err && <p className="atlas-err">{err}</p>}
    </section>
  );
}
