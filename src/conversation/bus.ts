const EVENT = "railbook:say";

export function emitUtterance(text: string): void {
  const t = text.trim();
  if (!t || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: t }));
}

export function onUtterance(fn: (text: string) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (ev: Event) => {
    const text = (ev as CustomEvent<string>).detail;
    if (typeof text === "string" && text.trim()) fn(text.trim());
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

export function looksLikeChatQuery(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return (
    /\b(live status|running status|pnr|cancelled|cancel list|wallet|meri booking|meri ticket|kitna fare|kitna padega|samajh nahi|ab kya|kaise book|help|madad|platform|delay|late hai|kahan hai|seat(?:s)?\s*(?:hai|hain|available|batao|bata|btana|btao|bta|dikhao|check|status)|availability|avl)\b/.test(
      t,
    ) ||
    /कहां है|कहाँ है|किराया|रद्द|समझ नहीं|सीट/.test(text) ||
    (/\b\d{5}\b/.test(t) && /\bseats?\b/.test(t))
  );
}
