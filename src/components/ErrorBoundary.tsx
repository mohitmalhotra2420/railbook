/* ══ ROUND-58 (29 Sep 2026, user screenshots 22:28/22:29) ══════════════════════════════════════════
 * User: "Yeh pehle ese search krta hai fir results page blank aa rha".
 *
 * Wajah: ek card render karte waqt ReferenceError (R57 me `onOpenPlanPage` BlockView ke props se
 * destructure hona reh gaya tha) — React ne poora tree unmount kar diya, screen par sirf khaali
 * cream page bacha. Ek chhoti UI galti = poori chat gayab. Ye dobara kabhi na ho.
 *
 * Ab har jagah boundary:
 *   • App ke top par   → chat/app kabhi khaali nahi hoga (kuch bhi toote to card + "Dobara try").
 *   • Har block/message ke around → ek kharab card sirf apni jagah "yeh card nahi khul paya" dikhata
 *     hai; baaki jawab, baaki messages, composer — sab chalta rehta hai.
 * Jhooth nahi bolta: jo hua wahi likhta hai (chhota technical hint) — file/line user ke saamne nahi.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Chhota label jaise "jawab" / "card" — fallback line me dikhta hai. */
  what?: string;
  /** Boundary ke andar kuch badla ho (naya message aaya) to reset — warna purana error chipka rehta. */
  resetKey?: string | number;
  compact?: boolean;
};

type State = { err: string | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(e: unknown): State {
    return { err: e instanceof Error ? e.message : String(e) };
  }

  componentDidCatch(e: Error, info: ErrorInfo): void {
    /* Console me poora stack — debugging ke liye; user ko sirf saaf line dikhti hai. */
    // eslint-disable-next-line no-console
    console.error("[RailBook] render error:", e, info?.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.err && this.props.resetKey !== prev.resetKey) this.setState({ err: null });
  }

  render(): ReactNode {
    if (!this.state.err) return this.props.children;
    const what = this.props.what ?? "yeh hissa";
    return (
      <div className={`eb-card${this.props.compact ? " eb-compact" : ""}`} role="alert">
        <div className="eb-title">⚠️ {what} dikha nahi paaya</div>
        <div className="eb-body">
          Screen khaali chhodne ke bajaye ye bata raha hoon — baaki chat chalu hai. Neeche se dobara koshish karo,
          ya sawaal phir se bhejo (data wahi live rahega).
        </div>
        <div className="eb-actions">
          <button type="button" className="eb-btn" onClick={() => this.setState({ err: null })}>
            ↻ Dobara try
          </button>
          <button type="button" className="eb-btn ghost" onClick={() => window.location.reload()}>
            Poora page refresh
          </button>
        </div>
        <div className="eb-hint">technical: {this.state.err.slice(0, 120)}</div>
      </div>
    );
  }
}
