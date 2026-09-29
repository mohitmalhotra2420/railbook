/* RailBook — IRCTC language-screen handler (v1.2.4 "prewarm-language").
 *
 * IRCTC (www.irctc.co.in) pehli baar khulne par LANGUAGE SELECTION screen dikhata hai
 * (English / हिंदी / regional). Prewarm flow me yeh screen 30-second countdown ke andar
 * khud handle hoti hai — RailBook me user ne jo "bolchaal ki bhasha" chuni hai uske hisaab se:
 *
 *   English  → English        (IRCTC English)
 *   Hinglish → English        (Hinglish bolne walon ke liye IRCTC English hi sabse safe/consistent)
 *   Hindi    → Hindi          (IRCTC हिंदी)
 *
 * Hard safety: yeh module SIRF language buttons click kar sakta hai — koi aur control nahi.
 * Language screen detect na ho to kuch nahi karta (normal flow chalta rehta hai).
 * Login / OTP / payment controls yahan se touch hi nahi hote (BOOKISH_RE net yahan bhi lagu).
 */
(function (root) {
  "use strict";

  const VERSION = "1.0.0-prewarm";

  /* RailBook bolchaal-bhasha → IRCTC site bhasha. Unknown/empty = English (safe default). */
  function mapLanguage(pref) {
    const p = String(pref == null ? "" : pref).toLowerCase().trim();
    if (p === "hi" || p === "hindi" || p === "hin" || p === "हindi" || p === "हिंदी" || p === "हिन्दी") return "hindi";
    return "english"; /* en, english, hinglish, hing, hng, "" , unknown */
  }

  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

  /* NOTE: Devanagari par JS \b kaam nahi karta (non-word chars) — isliye trailing \b sirf
   * latin alternatives ke baad, Devanagari alternatives bare. */
  const EN_RE = /^(english\b|en\b|angrezi\b|अंग्रेज़ी|अंग्रेजी)/;
  const HI_RE = /^(hindi\b|hi\b|hindī\b|हिंदी|हिन्दी|हindi)/;

  const CLICKABLE = "a, button, [role='button'], [role='menuitem'], [role='radio'], label, span, div, li, p, h3, h4";

  /* LIVE IRCTC (device evidence 23 Sep 2026): language choice ek MODAL DIALOG hai jo booking
   * form KE UPAR khulta hai ("Welcome to IRCTC / कृपया अपनी पसंदीदा भाषा का चयन करें /
   * Please select your preferred language"). Isliye journey form ka hona language screen ko
   * invalidate NAHI karta — dialog/prompt signal + English&Hindi option pair decide karta hai. */
  const DIALOG_SEL = "[role='dialog'], dialog, .p-dialog, .p-overlay-panel, .ui-dialog, [class*='dialog'], [class*='Dialog'], [class*='modal'], [class*='Modal'], [class*='popup'], [class*='Popup'], [class*='overlay'], [class*='Overlay'], [class*='alert'], [class*='Alert']";
  const PROMPT_RE = /(preferred language|पसंदीदा भाषा|भाषा चुनें|चयन करें|select.{0,24}language|choose.{0,24}language)/i;

  function visible(el) {
    try {
      const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      if (r && (r.width < 2 || r.height < 2)) return false;
      const st = el.ownerDocument.defaultView ? el.ownerDocument.defaultView.getComputedStyle(el) : null;
      if (st && (st.visibility === "hidden" || st.display === "none")) return false;
      return true;
    } catch (_) { return true; }
  }

  /* Kya yeh page IRCTC ki language-selection screen/dialog hai?
   * Signal A: page text me "preferred language / पसंदीदा भाषा…" prompt.
   * Signal B: koi dialog/modal container jisme English + Hindi dono options.
   * Booking form ke saath bhi valid (live dialog form ke upar aata hai).
   * Login page (visible password) par kabhi nahi — sealed zone. */
  function detectLanguageScreen(doc) {
    const out = { found: false, english: null, hindi: null, options: [], mode: null };
    try {
      const pwd = doc.querySelector('input[type="password"]');
      if (pwd && visible(pwd)) return out; /* login page — language screen nahi */

      /* innerText browser me; jsdom (tests) me textContent fallback. */
      const bodyText = (doc.body && (doc.body.innerText || doc.body.textContent)) || "";
      const promptHit = PROMPT_RE.test(bodyText);
      const dialogs = [...doc.querySelectorAll(DIALOG_SEL)].filter((d) => visible(d));

      const cands = [];
      const consider = (scope) => {
        for (const el of scope.querySelectorAll(CLICKABLE)) {
          if (!visible(el)) continue;
          if (el.children && el.children.length > 4) continue;
          const t = norm(el.textContent || "") || norm(el.getAttribute && el.getAttribute("aria-label"));
          if (!t || t.length > 30) continue;
          let kind = null;
          if (EN_RE.test(t)) kind = "english";
          else if (HI_RE.test(t)) kind = "hindi";
          if (!kind) continue;
          if (cands.some((c) => c.el.contains(el) || el.contains(c.el))) {
            const i = cands.findIndex((c) => c.el.contains(el) || el.contains(c.el));
            if (i >= 0) cands[i] = { el, kind, text: t };
            continue;
          }
          cands.push({ el, kind, text: t });
        }
      };

      /* Pehle dialog containers ke ANDAR dhundo (live modal). */
      let mode = null;
      for (const d of dialogs) {
        consider(d);
        const en = cands.find((c) => c.kind === "english");
        const hi = cands.find((c) => c.kind === "hindi");
        if (en && hi) { mode = "dialog"; break; }
      }
      /* Phir prompt-text signal: options kahin bhi hon (dialog class names unknown ho sakti hain). */
      if (!mode && promptHit) {
        cands.length = 0;
        consider(doc);
        const en = cands.find((c) => c.kind === "english");
        const hi = cands.find((c) => c.kind === "hindi");
        if (en && hi) mode = "prompt";
      }
      /* Aakhri: koi booking form NAHI hai (pure language landing page) → global pair. */
      if (!mode) {
        const hasForm = doc.querySelector('input[id="origin"], [formcontrolname="origin"], [formcontrolname="passengerName"]');
        if (!hasForm) {
          cands.length = 0;
          consider(doc);
          const en = cands.find((c) => c.kind === "english");
          const hi = cands.find((c) => c.kind === "hindi");
          if (en && hi) mode = "landing";
        }
      }

      if (mode) {
        const en = cands.find((c) => c.kind === "english");
        const hi = cands.find((c) => c.kind === "hindi");
        out.found = true;
        out.mode = mode;
        out.english = en.el;
        out.hindi = hi.el;
        out.options = cands.map((c) => c.text);
      }
    } catch (_) { /* ignore */ }
    return out;
  }

  /* target = "english" | "hindi" (mapLanguage se). Sirf EXACT language control click hota hai. */
  function pickLanguage(doc, pref) {
    const target = mapLanguage(pref);
    const screen = detectLanguageScreen(doc);
    if (!screen.found) return { ok: false, target, clicked: false, reason: "language-screen-not-detected" };
    const el = target === "hindi" ? screen.hindi : screen.english;
    if (!el) return { ok: false, target, clicked: false, reason: "target-option-missing" };
    /* Safety double-check: control text bookish/sensitive na ho (language screen par hota bhi nahi). */
    const t = norm(el.textContent || "");
    if (/\b(login|sign\s*in|otp|pay|payment|submit|captcha|book|search)\b/.test(t)) {
      return { ok: false, target, clicked: false, reason: "guard-refused" };
    }
    try {
      el.click();
    } catch (_) {
      return { ok: false, target, clicked: false, reason: "click-failed" };
    }
    return { ok: true, target, clicked: true, text: t };
  }

  root.RailBookPocLanguage = { VERSION, mapLanguage, detectLanguageScreen, pickLanguage };
})(typeof window !== "undefined" ? window : globalThis);
