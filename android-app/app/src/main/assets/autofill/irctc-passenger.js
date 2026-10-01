/* RailBook Autofill POC — PRIME-NG / ANGULAR PASSENGER-ROW DETECTOR + FILLER (stage 5 + 5C native-select fallback, v0.3.0)
 * LOCAL / POC ONLY. Used ONLY when MODE === "REAL_IRCTC_USER_INITIATED" (content.js); the localhost mocks keep
 * the generic detector (fieldmap.js), so local behaviour is unchanged.
 *
 * APPROVED CONTRACT (all of it enforced here, all of it covered by e2e-primeng.mjs):
 *  1. Deterministic passenger-row mapping — every VISIBLE `formcontrolname="passengerName"` host defines one row;
 *     the row is the TIGHTEST ancestor that also contains the age + gender anchors, shrunk further while it still
 *     holds another passenger-name anchor (so rows can never overlap), then re-expanded by at most 4 levels to the
 *     nearest ancestor that also owns THIS passenger's visible berth anchor (stage 5E — see includeBerth; the
 *     candidate must hold exactly one visible name anchor and one visible berth anchor, so rows can never merge and
 *     the berth anchor is never taken from another passenger or from a page-wide scan). Index = document order.
 *     No text parsing of "Passenger N", no guessing.
 *  2. formcontrolname-FIRST and formcontrolname-ONLY. Anchor names are exact, case-insensitive keys. If an anchor
 *     is absent → that field is NOT FOUND. No label / placeholder / id / column-text matching on the real host.
 *  3. Visible-control requirement — hidden / template / aria-hidden / display:none / visibility:hidden targets are
 *     never used (reported NOT FOUND instead).
 *  4. No fuzzy matching on REAL IRCTC — the only fuzzy-looking regex here is the read-only anchor DUMP filter
 *     (it lists formcontrolname NAMES for the diagnostic; it never picks a fill target).
 *  5. Native name/age filling through the native value setter + input/change/blur events (Angular hears it).
 *     Name and age are the only controls written natively; nothing else is ever written natively.
 *  6. Gender/berth, target 1 (UNCHANGED, tried first) = VISIBLE PrimeNG dropdown interaction only: click the
 *     widget's own visible `.p-dropdown` trigger, resolve THAT widget's panel (aria-controls/aria-owns → panel
 *     inside the widget → newly opened visible panel), click the option whose text (or aria-label) matches
 *     EXACTLY, normalize only whitespace/case.
 *  6b. Gender/berth, target 2 (stage 5C fallback, only when no visible widget exists) = the SAME row's exact
 *     approved anchor (`passengerGender` / `passengerBerthChoice`) when it is a VISIBLE native <select>.
 *     Filled through the HTMLSelectElement value setter + input/change/blur — ZERO clicks on this path.
 *     Hidden / aria-hidden / disabled / template <select>s stay NOT FOUND and are never written. Nationality and
 *     food/meal anchors are not in KEYS and not in ALLOWED_FIELDS, so they can never be targeted.
 *  7. Exact option matching only — no "contains", no fuzzy option picking. For a native <select> the normalized
 *     option TEXT or the exact option VALUE may identify the option (a page may pair value="M" with text "Male").
 *     Option missing → reported, not forced.
 *  8. No hidden select writing — hidden/aria-hidden/detached native <select> mirrors are never written.
 *  9. Post-fill verification (`verifyIrctc`) + unexpected-control-change detection (page-wide value snapshot before
 *     vs after; any control that changed outside the claimed targets is reported as `unexpected` → content.js
 *     raises a STOP banner and refuses to report success).
 * 10. Sensitive guard runs BEFORE detection/fill: credential/OTP/PIN/captcha/payment/login controls are found
 *     first, then never read (see `snapshot`: their value is never touched), never filled, never targeted.
 * 11. Allowed programmatic clicks: ONLY `.p-dropdown` (the widget's own visible trigger) and `li[role="option"]`
 *     inside that widget's own panel. Everything else — buttons, links, submit controls, forms, lookalikes — is
 *     refused by clickAllowed() and recorded in `clickLog` with allowed:false.
 * 12. Never: navigation, network, cookie/token/session access, any form submission, "Add Passenger", Book/Pay/Submit.
 *     This file contains no network, cookie or session code of any kind.
 * 13. Diagnostics (`anchorDiagnostic`) are READ-ONLY and contain anchor NAMES/counts/visibility only — never a
 *     passenger value, credential, OTP, token or cookie. Missing expected anchor → the literal string "NOT FOUND".
 */
(function (root) {
  const FM = () => root.RailBookPocFieldMap;
  const VERSION = "1.3.0";   // v1.2.0: auto-advance — VERIFIED Search + Book Now (navigation only; login/OTP/Pay NEVER)
  /* v0.8.0: refused clicks whose WHY is one of these are CRITICAL (results stage / train-card area —
   * unexpected structure there means "click NOTHING"). All other refusals are benign no-ops. */
  const CRITICAL_CLICK_RE = /^(train-class|train-expand|train-avl-date|train-card-refresh)$/;

  /* ── 1. formcontrolname anchors (exact, case-insensitive). A missing anchor is NOT FOUND — never guessed. ── */
  const KEYS = {
    name: ["passengerName", "passenger_name"],
    age: ["passengerAge", "passenger_age"],
    gender: ["passengerGender", "passenger_gender"],
    berth: ["passengerBerthChoice", "passenger_berth", "berthChoice", "passengerBerth"],
  };
  /* Read-only anchor-dump filter (diagnostic only — never a fill target selector). */
  const PASSENGER_FCN_RE = /passenger|berth|gender|age|name/i;

  const GENDER_OPTIONS = { male: ["Male"], female: ["Female"], transgender: ["Transgender"], other: ["Transgender"] };
  /* IRCTC berth list: No Preference, Lower, Middle, Upper, Side Lower, Side Upper (+ Window Side on some
   * train/class pages). Stage 5K: a payload "Window" / "Window Side" now maps to the real, LIVE-confirmed
   * option "Window Side" (value WS) — but ONLY when that train/class actually offers it; otherwise the control is
   * left untouched and the path is reported as "requested window preference unavailable" (never another berth).
   * Aisle is still not an IRCTC berth — refused as a rule. All previously supported berths are unchanged. */
  const BERTH_OPTIONS = { any: ["No Preference"], "no preference": ["No Preference"], lower: ["Lower"], middle: ["Middle"], upper: ["Upper"], "side lower": ["Side Lower"], "side upper": ["Side Upper"], window: ["Window Side", "WS"], "window side": ["Window Side", "WS"] };
  const WINDOW_PREF_KEYS = new Set(["window", "window side"]);
  const UNSUPPORTED_BERTH = new Set(["aisle", "window/aisle"]);
  /* ── Stage 5J — PASSENGER FOOD / CATERING mapping (additive; verified read-only by the Stage-5I diagnostic) ──
   * Live IRCTC `passengerFoodChoice` options: "Catering Service Option*" = D (the site's own default),
   * Veg = V · Non Veg = N · Jain Meal = J · Veg (Diabetic) = F · Non Veg (Diabetic) = G.
   * Payload label → [option text, option value]. Deliberately NOT mapped yet: any "noFood"/"no food"/"none"
   * value (its IRCTC value was intentionally not read by the diagnostic) — those are refused as a rule, never
   * guessed. An empty/absent food value is never filled, so the site default (D) stays untouched.
   * This anchor is NOT part of KEYS: the four approved fields (name/age/gender/berth) keep their exact handling,
   * and this control can only ever be written by the dedicated food pass below. */
  const FOOD_KEY = "passengerFoodChoice";
  /* ── Round-21 (25 Sep 2026, user: "food wala bhi autofill ho and book only if confirmed berths are allotted
   *    and consider for auto upgradation and mobile and email if user enters") ─────────────────────────────
   * Ye teen naye target-groups ADDITIVE hain — upar wale chaar approved fields (name/age/gender/berth) ka
   * handling bilkul nahi badla:
   *   · CONTACT (page level, sirf passenger row ke BAAHAR): mobile + email — formcontrolname ka narrow
   *     signal (/mobile|phone/ aur /e-?mail/), type bhi match hona chahiye. Anchors exact nahi milte to
   *     NOT FOUND (kabhi guess nahi).
   *   · FLAGS (per passenger checkbox): IRCTC ke do checkbox — "Book only if confirm berths are allotted"
   *     aur "Consider for auto up-gradation". Checkbox ke liye site ka apna label text hi structural signal
   *     hai (naam se pata nahi chalta). Sirf TAB check kiye jaate hain jab payload me sach me true ho —
   *     false/absent par control bilkul nahi chhua jaata (site ka default waisa hi).
   * Koi click nahi (allowed clicks sirf .p-dropdown trigger + li[role=option]) — checkbox native .checked
   * setter + input/change/blur events se likha jaata hai. Sab kuch read-only reporting me aata hai. */
  const CONTACT_KEY = { mobile: /mobile|phone/i, email: /e-?mail/i };
  const FLAG_KEY = {
    bookOnlyIfConfirm: /(confirm.*berth|berth.*confirm|bookonly|book_only)/i,
    autoUpgrade: /(auto ?up-?grad|upgrad)/i,
  };
  const FLAG_LABEL = {
    bookOnlyIfConfirm: /(book\s*only\s*if\s*confirm|confirm\s*berth)/i,
    autoUpgrade: /(auto\s*up[\s-]?grad|consider\s*for\s*auto)/i,
  };
  const FOOD_OPTIONS = Object.freeze({
    "veg": ["Veg", "V"],
    "non veg": ["Non Veg", "N"],
    "jain meal": ["Jain Meal", "J"],
    "veg (diabetic)": ["Veg (Diabetic)", "F"],
    "non veg (diabetic)": ["Non Veg (Diabetic)", "G"],
    /* Round-21: "No Food" ab map hota hai — sirf site ke apne option TEXT se (uska value kabhi read nahi
       hua, isliye guess nahi karte). Option na mile to control waisa hi chhoda jaata hai + report hota hai. */
    "no food": ["No Food"],
    nofood: ["No Food"],
  });
  const FOOD_UNMAPPED = new Set(["none", "no preference", "default", "catering service option"]);
  const SENSITIVE_MARK = "[not-read:sensitive]";

  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  /* The name rule: IRCTC's 16-char letters/spaces shape (digits allowed so the POC's own dummy payload is usable).
   * A value that fails the rule is reported as "not filled (rule)" and is never typed. */
  const NAME_RE = /^[A-Za-z][A-Za-z0-9 .'-]{0,15}$/;
  const AGE_RE = /^[1-9]\d?$|^1[01]\d$|^12[0-5]$/;

  const fcn = (el) => String((el && (el.getAttribute("formcontrolname") || el.getAttribute("ng-reflect-name"))) || "").trim();
  const described = (el) => ({ tag: el.tagName.toLowerCase(), id: el.id || null, name: el.getAttribute && el.getAttribute("name") || null, formcontrolname: fcn(el) || null, type: el.getAttribute && el.getAttribute("type") || null, text: String((el && el.textContent) || "").replace(/\s+/g, " ").trim().slice(0, 80) });

  /* ── 2. Visibility (visible-control requirement) — the control AND every ancestor must be visible ── */
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const doc = el.ownerDocument;
    const win = doc && doc.defaultView;
    const realLayout = !!(win && win.navigator && !/jsdom/i.test(win.navigator.userAgent || ""));
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.tagName === "TEMPLATE" || n.hasAttribute("hidden") || n.getAttribute("aria-hidden") === "true") return false;
      const cls = (n.className && String(n.className)) || "";
      if (/(^|\s)(ng-hide|p-hidden|rb-hidden)(\s|$)/.test(cls)) return false;
      const st = win && win.getComputedStyle ? win.getComputedStyle(n) : null;
      if (st && (st.display === "none" || st.visibility === "hidden")) return false;
      /* real browsers only: zero-layout boxes (detached/hidden) — jsdom has no layout, so it is skipped there */
      if (realLayout && typeof n.offsetParent !== "undefined" && n.offsetParent === null && n !== doc.body && n !== doc.documentElement && st && st.position !== "fixed") return false;
    }
    return true;
  }

  /* ── 3. Sensitive guard — attribute level only, NEVER reads a value. Runs before any detection/fill.
   *     Strictness: the fieldmap rules (unchanged, still used first) + camelCase-aware word matching, so
   *     controls named cardNumber / upiId / otpFc / passengerPin are caught too. Never weaker than fieldmap. ── */
  const FORBIDDEN_WORDS = (() => { try { return (root.RailBookPocConfig && root.RailBookPocConfig.CONFIG.FORBIDDEN_FIELD_WORDS) || []; } catch { return []; } })();
  const FORBIDDEN_RE = FORBIDDEN_WORDS.length
    ? new RegExp("\\b(?:" + FORBIDDEN_WORDS.map((w) => String(w).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s_-]*")).join("|") + ")\\b", "i")
    : null;
  /* camelCase / separators → plain words, so "cardNumber" becomes "card number" and "card" matches. */
  const words = (s) => String(s || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-.:\[\]]+/g, " ");
  function isSensitive(el) {
    try { const fm = FM(); if (fm && fm.isSensitive && fm.isSensitive(el)) return true; } catch { return true; }
    const hay = words([
      el.getAttribute("id"), el.getAttribute("name"), fcn(el), el.getAttribute("type"), el.getAttribute("autocomplete"),
      el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.getAttribute("title"),
    ].filter(Boolean).join(" "));
    if (FORBIDDEN_RE && FORBIDDEN_RE.test(hay)) return true;
    if (/password/i.test(el.getAttribute("type") || "")) return true;
    if (/^(one-time-code|cc-|current-password|new-password|username)/i.test(el.getAttribute("autocomplete") || "")) return true;
    if (el.closest && el.closest("[data-captcha], .captcha, #captcha, form[action*='login' i], form[action*='pay' i]")) return true;
    return false;
  }
  function guardSensitive(doc) {
    const found = [];
    for (const el of doc.querySelectorAll("input, select, textarea")) if (isSensitive(el)) found.push(described(el));
    return found;
  }

  /* ── 4. Anchor lookup (exact) ── */
  const anchorHosts = (scope) => [...scope.querySelectorAll("[formcontrolname], [ng-reflect-name]")];
  function findByKeys(scope, keys) {
    const all = anchorHosts(scope);
    for (const k of keys) { const hit = all.find((el) => fcn(el).toLowerCase() === k.toLowerCase()); if (hit) return hit; }
    return null;
  }
  const anchorsIn = (scope) => [...new Set(anchorHosts(scope).map((el) => fcn(el)).filter(Boolean))];
  const countNameAnchors = (scope) => anchorHosts(scope).filter((el) => KEYS.name.some((k) => fcn(el).toLowerCase() === k.toLowerCase())).length;

  /* ── 4b. STAGE 5E — berth-aware row container (structural, deterministic, no page-wide scan) ──
   * On the live IRCTC DOM the berth anchor can sit in a SIBLING branch of the container that holds
   * passengerName/passengerAge/passengerGender, so the row container used to miss it (row.hasBerth:false while the
   * anchor is visible/enabled). The berth anchor is associated structurally, never by "first berth on the page":
   *   · the candidate container must contain the row's own name anchor (we only ever climb ancestors of it), AND
   *   · it must hold EXACTLY ONE visible passengerName anchor  → two passengers can never be merged, AND
   *   · it must hold EXACTLY ONE visible berth anchor          → the choice is never ambiguous, AND
   *   · the climb is bounded (4 levels, never past <body>) and starts from the already-resolved row container.
   * Hidden / aria-hidden / template rows and rows' anchors do not count as visible, so they can never be adopted.
   * If no such ancestor exists, the row container is returned unchanged (berth stays NOT FOUND — never guessed). ── */
  const visibleNameAnchors = (scope) => anchorHosts(scope).filter((el) => KEYS.name.some((k) => fcn(el).toLowerCase() === k.toLowerCase()) && isVisible(el)).length;
  function visibleBerthAnchor(scope) {
    const hits = anchorHosts(scope).filter((el) => KEYS.berth.some((k) => fcn(el).toLowerCase() === k.toLowerCase()) && isVisible(el));
    return hits.length === 1 ? hits[0] : null;                       // 0 or >1 ⇒ ambiguous ⇒ do not adopt
  }
  function includeBerth(el, doc) {
    if (findByKeys(el, KEYS.berth)) return el;                      // the row's own container already holds it
    let cur = el, steps = 0;
    while (cur && cur.parentElement && steps++ < 4) {
      cur = cur.parentElement;
      if (cur === doc.body || cur === doc.documentElement) break;
      if (!isVisible(cur)) break;
      if (visibleNameAnchors(cur) !== 1) break;                     // another passenger starts here → stop
      if (visibleBerthAnchor(cur)) return cur;                      // nearest exclusive ancestor owning the berth anchor
    }
    return el;
  }

  /* ── 5. Deterministic passenger rows ── */
  function passengerRows(doc) {
    const nameHosts = anchorHosts(doc).filter((el) => KEYS.name.some((k) => fcn(el).toLowerCase() === k.toLowerCase()));
    const rows = [];
    for (const nameHost of nameHosts) {
      if (!isVisible(nameHost)) continue;                            // hidden / template row excluded
      let row = nameHost.parentElement, guard = 0, found = null;
      while (row && guard++ < 12) {
        if (findByKeys(row, KEYS.age) && findByKeys(row, KEYS.gender)) { found = row; break; }
        row = row.parentElement;
      }
      let el = found || nameHost.parentElement;
      if (found) while (el && countNameAnchors(el) > 1) {            // exclusivity: one name anchor per row
        const child = [...el.children].find((c) => c.contains(nameHost));
        if (!child) break;
        el = child;
      }
      el = includeBerth(el, doc);                                    // stage 5E: same passenger's berth anchor included
      rows.push({
        index: rows.length, el, nameHost,
        anchors: anchorsIn(el),
        hasAge: !!findByKeys(el, KEYS.age), hasGender: !!findByKeys(el, KEYS.gender), hasBerth: !!findByKeys(el, KEYS.berth),
      });
    }
    return rows;
  }

  /* ── 6b. STAGE 5J — food/catering target for THIS row (structural + exclusive; never a page-wide scan) ──
   * The control counts only when it is the exact `passengerFoodChoice` anchor, visible, enabled, not sensitive,
   * a <select>, and belongs to THIS passenger's row — either inside the row container, or in a sibling branch
   * reachable by the same bounded upward re-expansion Stage-5E uses for the berth anchor (max 4 levels, upward
   * only, and the ancestor must still hold exactly ONE passenger name anchor == this row's name host).
   * Otherwise it is NOT FOUND for that passenger — the first food control on the page is never borrowed. ── */
  function foodAnchorIn(scope) {
    return anchorHosts(scope).find((el) => fcn(el).toLowerCase() === FOOD_KEY.toLowerCase() && isVisible(el)) || null;
  }
  function foodSelectFor(row, doc) {
    if (!row) return null;
    let host = foodAnchorIn(row.el);
    if (!host) {
      for (let cur = row.el.parentElement, up = 0; cur && up < 4; cur = cur.parentElement, up++) {
        if (countNameAnchors(cur) > 1) break;                       // rows would merge — never guessed
        const cand = foodAnchorIn(cur);
        if (cand && cur.contains(row.nameHost) && countNameAnchors(cur) === 1) { host = cand; break; }
      }
    }
    if (!host) return null;
    const sel = host.tagName === "SELECT" ? host : host.querySelector("select");
    if (!sel || !isVisible(sel) || sel.disabled || isSensitive(sel)) return null;
    return sel;
  }

  /* ── 6c. STAGE 5K — create the passenger rows the payload needs (never duplicates, never a guess) ──
   * The real IRCTC page exposes an “Add Passenger” control. It is used ONLY when the payload has more passengers
   * than the page currently shows, ONLY through the click guard (why: "add-passenger"), and ONLY as many times as
   * rows are missing (hard cap). After every click the rows are re-detected from the DOM, so an existing row is
   * never duplicated. If the control cannot be found/used, the loop stops and the reason is reported — the fill
   * then proceeds for the rows that DO exist and the missing ones are reported as "no passenger row N on page".
   * Nothing booking/payment/sensitive is ever clicked; the control is never borrowed from a payment/login area. ── */
  const MAX_ADD_PASSENGER_CLICKS = 5;
  const ADD_WAIT_MS = 120;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  function addPassengerCandidates(doc) {
    const out = [];
    for (const el of doc.querySelectorAll("button, a, [role='button'], div, span, i, p-button")) {
      if (el.tagName === "SELECT" || el.tagName === "INPUT") continue;
      if (!isVisible(el) || disabledish(el) || isSensitive(el) || inForbiddenArea(el)) continue;
      const text = clickText(el);
      if (text.length > CLICK_TEXT_MAX || BOOKISH_RE.test(text)) continue;
      if (!ADD_PAX_TEXT_RE.test(text)) continue;
      out.push(el);
    }
    /* nested matches collapse to the INNERMOST element carrying the label — a wrapping container is not a control
     * (clicking it would fire nothing on the real page, and its own wording could come from a child button) */
    return out.filter((el) => !out.some((o) => o !== el && el.contains(o)));
  }
  function addPassengerControl(doc, rowList) {
    const cands = addPassengerCandidates(doc);
    if (!cands.length) return { control: null, candidates: 0, reason: "no add-passenger control found on this page" };
    if (cands.length === 1) return { control: cands[0], candidates: 1, reason: null };
    /* several candidates → take the one that belongs to the passenger-rows area, otherwise refuse (never guess) */
    const near = cands.filter((el) => (rowList || []).some((r) => r.el && (r.el.contains(el) || el.contains(r.el) ||
      (r.el.parentElement && (r.el.parentElement.contains(el) || el.contains(r.el.parentElement))) ||
      (el.parentElement && (el.parentElement.contains(r.el) || r.el.contains(el.parentElement))))));
    if (near.length === 1) return { control: near[0], candidates: cands.length, reason: null };
    return { control: null, candidates: cands.length, reason: `ambiguous: ${cands.length} add-passenger controls found — none was clicked` };
  }
  async function ensurePassengerRows(doc, want, opts) {
    const o = opts || {};
    const maxAdds = Math.min(o.maxAdds || MAX_ADD_PASSENGER_CLICKS, Math.max(0, Number(want) - detectIrctc(doc).rows));
    const info = {
      requested: Number(want), rowsBefore: detectIrctc(doc).rows, needsAdd: maxAdds > 0, maxAdds,
      controlFound: false, controlUsed: false, candidates: 0, addsAttempted: 0, addsSucceeded: 0,
      rowsAfterEachAdd: [], rowsAfter: null, stopReason: null, waitMs: o.waitMs || ADD_WAIT_MS,
    };
    for (let i = 0; i < maxAdds; i++) {
      const det = detectIrctc(doc);
      if (det.rows >= info.requested) break;
      const found = addPassengerControl(doc, det.rowList);
      info.candidates = found.candidates;
      if (!found.control) { info.stopReason = found.reason; break; }
      info.controlFound = true;
      if (!clickAllowed(found.control, "add-passenger")) { info.stopReason = "add-passenger click refused by the stage-5K click guard"; break; }
      info.controlUsed = true; info.addsAttempted++;
      /* v1.0.0: live IRCTC renders the new row asynchronously (Angular + validation) — a fixed 120ms
       * poll often missed it and the add stopped after one row. Poll up to ~2.5s for the row count. */
      let after = det;
      for (let w = 0; w < 10; w++) {
        await wait(info.waitMs);
        after = detectIrctc(doc);
        if (after.rows > det.rows) break;
      }
      info.rowsAfterEachAdd.push(after.rows);
      if (after.rows > det.rows) info.addsSucceeded++;
      else { info.stopReason = `click did not create a new passenger row (still ${after.rows}) — no further clicks`; break; }
    }
    info.rowsAfter = detectIrctc(doc).rows;
    if (!info.stopReason && info.rowsAfter < info.requested) info.stopReason = `still short of rows: ${info.rowsAfter}/${info.requested}`;
    return info;
  }

  /* ── 6. Fill targets per row (visible + not sensitive + exact anchor) ── */
  function targetsForRow(row) {
    const out = {};
    const nameHost = row.nameHost;
    const nameInput = nameHost.tagName === "INPUT" ? nameHost : nameHost.querySelector('input[role="combobox"], input.p-autocomplete-input, input.p-inputtext, input:not([type=hidden])');
    out.name = nameInput && isVisible(nameInput) && !isSensitive(nameInput) ? { kind: "native", el: nameInput, host: nameHost } : null;
    const ageHost = findByKeys(row.el, KEYS.age);
    const ageInput = ageHost ? (ageHost.tagName === "INPUT" ? ageHost : ageHost.querySelector('input:not([type=hidden])')) : null;
    out.age = ageInput && isVisible(ageInput) && !isSensitive(ageInput) ? { kind: "native", el: ageInput, host: ageHost } : null;
    for (const key of ["gender", "berth"]) {
      const host = findByKeys(row.el, KEYS[key]);
      if (!host) { out[key] = null; continue; }
      /* 1) PrimeNG widget first (unchanged): a visible .p-dropdown belonging to this exact anchor host. */
      const widget = host.classList && host.classList.contains("p-dropdown") ? host : host.querySelector(".p-dropdown");
      if (widget && isVisible(widget) && !isSensitive(widget)) { out[key] = { kind: "p-dropdown", el: widget, host }; continue; }
      /* 2) Native <select> fallback (stage 5C) — ONLY this row's exact approved anchor, visible, enabled, not
       *    sensitive, and never inside a captcha/login/pay container. Hidden / aria-hidden / template / disabled
       *    selects stay NOT FOUND (never written, never clicked). Nationality & food anchors are not in KEYS. */
      const sel = host.tagName === "SELECT" ? host : host.querySelector("select");
      if (sel && isVisible(sel) && !sel.disabled && !isSensitive(sel)) out[key] = { kind: "select", el: sel, host };
      else out[key] = null;
    }
    return out;
  }

  function detectIrctc(doc) {
    const rowList = passengerRows(doc);
    const found = {};                                                // path → target
    rowList.forEach((row, i) => {
      const t = targetsForRow(row);
      for (const key of ["name", "age", "gender", "berth"]) if (t[key]) found[`passengers.${i}.${key}`] = t[key];
    });
    return { rows: rowList.length, rowList, found, rowAnchors: rowList.map((r) => r.anchors) };
  }

  /* ── 7. Click guard — the ONLY clicks this POC may ever make ──
   * Stage 5K adds exactly two more allowed click kinds, both behind the same explicit REAL approval tap and both
   * strictly validated here: an “Add Passenger” control (to create a missing passenger row) and the exact
   * class control of the EXACT matched train row (train/class selection). Everything else — buttons, links,
   * submit controls, forms, lookalikes, booking/payment wording — is still refused and recorded with allowed:false. */
  const clickLog = [];
  const CLICK_TEXT_MAX = 40;
  const ADD_PAX_TEXT_RE = /^\+?\s*(add\s+(new\s+)?passenger|add\s+psgr|add\s+more\s+passengers?|add\s+another\s+passenger)\b/i;
  const BOOKISH_RE = /\b(book|booking|pay|payment|submit|proceed|continue|login|sign\s?in|otp|pin|captcha|wallet|upi|card|net\s?banking)\b/i;
  /* v1.2.0 AUTO-ADVANCE (user-approved: the "Continue to IRCTC" tap IS the approval). Two
   * NAVIGATION-ONLY steps the app may now do by itself, each behind its own verified gate:
   *   1. "Search Trains" on the journey form  — only when From+To+Date readback-verified;
   *   2. "Book Now" on the matched train card — only when train+class(+date) are selected, so the
   *      user lands on the passenger form (details already filled).
   * Everything past that stays sealed: login, OTP/PIN, CAPTCHA, payment/UPI/card/netbanking, and
   * any submit/proceed/continue control is still refused by HARD_NO_RE + inForbiddenArea + the
   * per-why predicates below. Book Now is a NAVIGATION control, not a booking. */
  const SEARCH_BTN_RE = /^(search(?:\s*trains?)?|find\s*trains?|train\s*search|search\s*for\s*trains)$/;
  const BOOK_NOW_RE = /^book\s*now\b/;
  const HARD_NO_RE = /\b(pay|payment|upi|card|net\s?banking|wallet|otp|pin|captcha|login|sign\s?in|logout|register|submit|proceed|continue|verify)\b/;
  /* v1.1.0 engine — live mobile card keeps the class as a CHIP with its own "Refresh ⟳" control:
   * tapping Refresh fetches availability over the network, and only then the chip can be selected and
   * Book Now turns from pale/disabled to active. Exact refresh wording only (never anything bookish). */
  const REFRESH_TEXT_RE = /^(?:[↻⟳🔄↺]\s*)?(?:refresh|reload|update)\b(?:\s*(?:avl|avail|availability))?(?:\s*[↻⟳🔄↺])?$/i;
  const REFRESH_GLYPH_RE = /^[↻⟳🔄↺\s]+$/;
  /* Every label the control carries must be refresh wording ("Refresh ⟳" / "Refresh availability"); the
   * browser-side clickText joins textContent + aria-label + title, so this is checked label by label. */
  const isRefreshWording = (el) => {
    const parts = [el.textContent || "", el.getAttribute("aria-label") || "", el.getAttribute("title") || ""]
      .map(norm).filter(Boolean);
    if (!parts.length) return false;
    if (!parts.every((p) => p.length <= 30 && (REFRESH_TEXT_RE.test(p) || REFRESH_GLYPH_RE.test(p)))) return false;
    return parts.some((p) => REFRESH_TEXT_RE.test(p));
  };
  const disabledish = (el) => {
    const cls = (el.className && String(el.className)) || "";
    return el.disabled === true || el.getAttribute("aria-disabled") === "true" || /(^|\s)(p-disabled|disabled)(\s|$)/.test(cls);
  };
  const clickText = (el) => norm(`${el.textContent || ""} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""}`);
  function inForbiddenArea(el) {
    if (el.closest("[data-captcha], .captcha, #captcha")) return true;
    for (let cur = el; cur; cur = cur.parentElement) {                    // walk up: any enclosing form target
      if (cur.tagName === "FORM") {
        const action = String(cur.getAttribute("action") || "");
        if (/pay|payment|login|signin|auth|otp|wallet|upi|bank/i.test(action)) return true;
      }
    }
    return false;
  }
  const exactClassText = (text, code) => {
    const t = norm(text), c = norm(code);
    if (!t || !c || t.length > CLICK_TEXT_MAX) return false;
    if (t === c) return true;
    /* bare code at start: "SL", "SL Available 12" */
    if (new RegExp(`^${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(t)) return true;
    /* live IRCTC desktop/filter labels: "Sleeper (SL)", "AC 3 Tier (3A)", "AC 3 Tier ( 3A )" */
    if (new RegExp(`\\(${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`).test(t)) return true;
    /* trailing code after whitespace: "Sleeper SL" (rare) — only when whole text is short */
    if (t.length <= 28 && new RegExp(`(?:^|\\s)${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`).test(t)) return true;
    return false;
  };
  function clickAllowed(el, why, ctx) {
    const doc = el.ownerDocument;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    const cls = (el.className && String(el.className)) || "";
    const text = clickText(el);
    /* stage 5K — “Add Passenger”: only a visible, enabled, non-sensitive control whose OWN wording is an
     * add-passenger label and nothing booking/payment/sensitive. */
    const isAddPax = why === "add-passenger" && tag !== "select" && tag !== "input" && el.isConnected
      && isVisible(el) && !disabledish(el) && !isSensitive(el) && !inForbiddenArea(el) && !BOOKISH_RE.test(text)
      && ADD_PAX_TEXT_RE.test(text);
    /* stage 5K — train/class selection: the clicked control must carry the EXACT requested class code as its own
     * text/label AND live inside the train container that matched the requested train number exactly. */
    const isTrainClass = why === "train-class" && tag !== "select" && tag !== "input" && el.isConnected
      && isVisible(el) && !disabledish(el) && !isSensitive(el) && !inForbiddenArea(el) && !BOOKISH_RE.test(text)
      && !!(ctx && ctx.classCode && ctx.container && ctx.container.contains(el))
      && exactClassText(text, ctx.classCode);
    /* stage 5L.1d — expand a collapsed train row so class tabs (SL/3A/…) mount. Never Book/Pay/login.
     * Must sit inside the matched train container and must NOT look bookish; preferably the header/name area. */
    const isTrainExpand = why === "train-expand" && tag !== "select" && tag !== "input" && tag !== "a"
      && el.isConnected && isVisible(el) && !disabledish(el) && !isSensitive(el) && !inForbiddenArea(el)
      && !BOOKISH_RE.test(text)
      && !!(ctx && ctx.container && ctx.container.contains(el))
      && !exactClassText(text, (ctx && ctx.classCode) || "")  /* don't steal the class tab itself */
      && !/^(1A|2A|3A|3E|CC|EC|SL|2S|EA|FC)\b/i.test(text)  /* never any class-code tab as expand */
      && text.length < 80 && text.length !== 2; /* bare 2-char labels are class codes on IRCTC */
    /* stage 5L.1f — availability DATE tile inside the matched train+class card (e.g. "Sun, 27 Sep" / RAC).
     * Book Now only enables after class tab + a date tile are chosen. Never Book/Pay/login. */
    const isTrainAvl = why === "train-avl-date" && tag !== "input" && tag !== "select" && tag !== "a"
      && el.isConnected && isVisible(el) && !disabledish(el) && !isSensitive(el) && !inForbiddenArea(el)
      && !BOOKISH_RE.test(text)
      && !!(ctx && ctx.container && ctx.container.contains(el))
      && !!(ctx && ctx.isoDate)
      && text.length >= 4 && text.length <= 80
      && !exactClassText(text, (ctx && ctx.classCode) || "")
      && !/^(1A|2A|3A|3E|CC|EC|SL|2S|EA|FC)$/i.test(text);
    /* v1.2.0 — "Search Trains": the form's own submit affordance, and ONLY when the caller has
     * verified From+To+Date by readback (ctx.verified) and the control really sits inside the
     * journey-form scope. Anything pay/login/otp-ish is still refused by HARD_NO_RE. */
    const isAdvanceSearch = why === "journey-advance-search" && tag !== "select" && tag !== "input" && el.isConnected
      && isVisible(el) && !disabledish(el) && !isSensitive(el) && !inForbiddenArea(el)
      && !!(ctx && ctx.scope && ctx.scope.contains(el) && ctx.verified === true)
      /* v1.2.0: one auto-Search per control — a second fill pass on the same page must not
       * re-trigger the search (the element is marked after the first approved click). */
      && el.getAttribute("data-rb-advance-search") !== "1"
      && text.length <= 30
      && SEARCH_BTN_RE.test(text) && !HARD_NO_RE.test(text) && !BOOKISH_RE.test(text)
      && !(el.closest && el.closest("[formcontrolname='passengerName'], [formcontrolname='passengerBerthChoice']"));
    /* v1.1.0 engine — the class chip's own "Refresh ⟳" inside the EXACT matched train card.
     * Network-read only: it fetches that class's availability so the chip can be selected and Book Now
     * can enable. Same shape as every other allowed click (exact train container + exact class code),
     * one shot per control, and never anything pay/login/bookish. */
    const isTrainCardRefresh = why === "train-card-refresh" && tag !== "select" && tag !== "input"
      && el.isConnected && isVisible(el) && !disabledish(el) && !isSensitive(el) && !inForbiddenArea(el)
      && !!(ctx && ctx.container && ctx.container.contains(el) && ctx.classCode)
      && el.getAttribute("data-rb-advance-refresh") !== "1"
      && text.length <= 30 && isRefreshWording(el) && !HARD_NO_RE.test(text) && !BOOKISH_RE.test(text)
      && !exactClassText(text, (ctx && ctx.classCode) || "");
    /* v1.2.0 — "Book Now" inside the EXACT matched train card (navigation → passenger form).
     * Requires the class chip to be selected (ctx.classSelected) AND the control to be a real
     * enabled button — never a link, never an input, never anything with pay/login/otp wording. */
    const isTrainBookNow = why === "train-book-now" && tag === "button" && el.isConnected
      && isVisible(el) && !disabledish(el) && !isSensitive(el) && !inForbiddenArea(el)
      && !!(ctx && ctx.container && ctx.container.contains(el) && ctx.classSelected === true)
      /* v1.2.0: one auto-Book-Now per control. */
      && el.getAttribute("data-rb-advance-book") !== "1"
      && text.length <= 40 && BOOK_NOW_RE.test(text) && !HARD_NO_RE.test(text);
    if (isAddPax || isTrainClass || isTrainExpand || isTrainAvl || isAdvanceSearch || isTrainBookNow || isTrainCardRefresh) {
      /* v1.2.0/v1.2.1: stamp the auto-advance controls so a repeat fill pass cannot click them again. */
      try {
        if (isAdvanceSearch) el.setAttribute("data-rb-advance-search", "1");
        if (isTrainBookNow) el.setAttribute("data-rb-advance-book", "1");
        if (isTrainCardRefresh) el.setAttribute("data-rb-advance-refresh", "1");
      } catch { /* */ }
      clickLog.push({ allowed: true, why, ...described(el), cls: cls || null });
      if (doc && doc.defaultView) {
        try {
          el.dispatchEvent(new doc.defaultView.MouseEvent("mousedown", { bubbles: true, cancelable: true, view: doc.defaultView }));
          el.dispatchEvent(new doc.defaultView.MouseEvent("mouseup", { bubbles: true, cancelable: true, view: doc.defaultView }));
        } catch { /* */ }
        el.dispatchEvent(new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true, view: doc.defaultView }));
      }
      return true;
    }
    if (why === "add-passenger" || why === "train-class" || why === "train-expand" || why === "train-avl-date"
        || why === "train-card-refresh"
        || why === "journey-advance-search" || why === "train-book-now") {
      clickLog.push({ allowed: false, why, ...described(el), cls: cls || null, refusedBy: "stage-5K/5L click predicate" });
      return false;
    }
    /* stage 5M (v0.6.0) — live NGeT's CUSTOM class trigger ("All Classes" / "All Quotas" row) and its
     * option list. Open: the element's OWN text must equal the expected trigger label exactly, be a
     * small visible non-sensitive control not nested in a clickable. Option: a visible listbox row
     * carrying the EXACT requested class code. Never a Book/Search/Pay/login control. */
    /* v0.8.0/v0.9.0 (device evidence v0.7.0 + v0.8.0): the live "All Classes" trigger click was
     * refused because (1) clickText() merges aria-label/title so an exact-equality test broke,
     * (2) a role="button" parent is NORMAL for a PrimeNG dropdown trigger, (3) the real clickable
     * is often the BUTTON wrapper of a span-based trigger. Fix: check textContent AND aria-label
     * separately (trailing caret symbols like "⌄" ignored), exclude only real <button>/<a>
     * ancestors — and allow a button candidate that WRAPS an element whose own text IS the exact
     * trigger label. The refusal REASON is captured (classTriggerEval.rsn) so the refusal log
     * tells the native status line exactly why. */
    let classTriggerEval = null;
    const isOpenClassTrigger = (() => {
      const want = ctx && ctx.triggerText ? norm(ctx.triggerText) : "";
      const tail = (s) => s.replace(/[^a-z0-9]+$/g, "");
      const own = norm(textOf(el));
      const ariaL = norm(String(el.getAttribute("aria-label") || ""));
      const merged = norm(clickText(el));
      const textOk = !!want && (tail(own) === want || tail(ariaL) === want || tail(merged) === want);
      const clickableAncestor = el.parentElement && el.parentElement.closest("button, a");
      const wrapsExact = (tag === "button") && textOk &&
        [...el.querySelectorAll("*")].some((d) => norm(textOf(d)) === want);
      let ok = !!want
        && (tag === "div" || tag === "span" || tag === "button" || tag === "label")
        && el.isConnected && isVisible(el) && !disabledish(el) && !isSensitive(el) && !inForbiddenArea(el)
        && !BOOKISH_RE.test(text)
        && el.children.length <= 10
        && !el.closest("[formcontrolname=passengerName], [formcontrolname=passengerBerthChoice]")
        && textOk
        && (!clickableAncestor || wrapsExact);
      let rsn = "ok";
      if (!ok) {
        if (!want) rsn = "no-trigger-text-ctx";
        else if (!(tag === "div" || tag === "span" || tag === "button" || tag === "label")) rsn = "tag:" + tag;
        else if (!el.isConnected || !isVisible(el)) rsn = "not-visible";
        else if (disabledish(el)) rsn = "disabled";
        else if (isSensitive(el)) rsn = "sensitive";
        else if (inForbiddenArea(el)) rsn = "forbidden-area";
        else if (BOOKISH_RE.test(text)) rsn = "bookish:" + String(text).slice(0, 20);
        else if (el.children.length > 10) rsn = "too-many-children";
        else if (!textOk) rsn = "label-mismatch(own:" + own.slice(0, 24) + ")";
        else if (clickableAncestor && !wrapsExact) rsn = "nested-in-" + (clickableAncestor.tagName || "").toLowerCase();
      }
      classTriggerEval = { ok, rsn };
      return ok;
    })();
    const isClassOpt = why === "class-option"
      && el.tagName === "LI"
      && el.isConnected && isVisible(el) && !isSensitive(el) && !inForbiddenArea(el)
      && !BOOKISH_RE.test(text)
      && !!(el.closest("ul[role='listbox'], [role='listbox'], .p-dropdown-panel, [class*='dropdown-panel'], .p-overlay"))
      && !!(ctx && ctx.classCode) && classOptionMatch(text, ctx.classCode);
    if (isOpenClassTrigger || isClassOpt) {
      clickLog.push({ allowed: true, why, ...described(el), cls: cls || null });
      if (doc && doc.defaultView) {
        try {
          el.dispatchEvent(new doc.defaultView.MouseEvent("mousedown", { bubbles: true, cancelable: true, view: doc.defaultView }));
          el.dispatchEvent(new doc.defaultView.MouseEvent("mouseup", { bubbles: true, cancelable: true, view: doc.defaultView }));
          el.dispatchEvent(new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true, view: doc.defaultView }));
        } catch { /* */ }
      }
      return true;
    }
    if (why === "class-trigger-open" || why === "class-option") {
      clickLog.push({ allowed: false, why, ...described(el), cls: cls || null, refusedBy: "stage-5M class-trigger predicate" + (why === "class-trigger-open" && classTriggerEval && classTriggerEval.rsn !== "ok" ? " · " + classTriggerEval.rsn : "") });
      return false;
    }
    /* stage 5L — station autocomplete option: ONLY a visible li[role=option] inside an autocomplete/listbox
     * panel. Never a Search/Book/Pay/login control. Used solely to confirm a From/To station the user already
     * approved in the payload (after the native input was typed). */
    /* Live IRCTC (gist + NGeT mobile): ul[role=listbox] > li > span — the LI often has NO role="option".
     * Also accept [role=option] anywhere inside an autocomplete/listbox panel, and a SPAN/DIV inside such an LI. */
    const inAcPanel = !!(el.closest && el.closest(
      ".p-autocomplete-panel, [class*='autocomplete-panel'], [class*='ui-autocomplete-panel'], ul[role='listbox'], [role='listbox'], .p-overlay, .ng-dropdown-panel"
    ));
    const acRole = (el.getAttribute("role") || "").toLowerCase();
    const parentLi = tag !== "li" && el.closest ? el.closest("li") : null;
    const isAcLi = tag === "li" && inAcPanel;
    const isAcRoleOpt = acRole === "option" && inAcPanel;
    const isAcInner = parentLi && inAcPanel && (tag === "span" || tag === "div" || tag === "p")
      && isVisible(parentLi);
    const isAcOption = why === "autocomplete-option"
      && el.isConnected && isVisible(el) && !isSensitive(el) && !inForbiddenArea(el) && !BOOKISH_RE.test(text)
      && tag !== "input" && tag !== "select" && tag !== "button" && tag !== "a"
      && (isAcLi || isAcRoleOpt || isAcInner)
      && text.length >= 2 && text.length < 120;
    if (isAcOption) {
      /* Prefer clicking the LI (IRCTC binds on the row); if we matched an inner span, click its LI. */
      const target = (isAcInner && parentLi) ? parentLi : el;
      clickLog.push({ allowed: true, why, ...described(target), cls: (target.className && String(target.className)) || null });
      if (doc && doc.defaultView) target.dispatchEvent(new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true, view: doc.defaultView }));
      return true;
    }
    if (why === "autocomplete-option") {
      clickLog.push({ allowed: false, why, ...described(el), cls: cls || null, refusedBy: "stage-5L autocomplete-option predicate" });
      return false;
    }
    /* stage 5L.1b — p-calendar only: open trigger, month next/prev, and a single day cell.
     * Host must be the journey date control (p-calendar / #jDate / journeyDate). Never Search/Book. */
    const calHost = ctx && ctx.host;
    const inCalHost = !!(calHost && calHost.contains && calHost.contains(el));
    const inDatepicker = !!(el.closest && el.closest(".p-datepicker, .ui-datepicker, [class*='datepicker']"));
    /* Mobile NGeT often has NO separate trigger — tapping the date <input> opens p-datepicker. */
    const isCalOpen = why === "calendar-open" && inCalHost && el.isConnected && isVisible(el) && !isSensitive(el) && !inForbiddenArea(el) && !BOOKISH_RE.test(text)
      && tag !== "select" && tag !== "a"
      && (
        tag === "input"
        || tag === "button"
        || tag === "span" || tag === "div" || tag === "i" || tag === "p-calendar"
        || /(datepicker-trigger|calendar-button|p-calendar|pi-calendar|datepicker-icon)/i.test(cls + " " + tag + " " + (el.getAttribute("class") || ""))
        || !!(el.closest && el.closest(".p-datepicker-trigger, .p-calendar, p-calendar, #jDate"))
      );
    const isCalNav = why === "calendar-nav" && inDatepicker && el.isConnected && isVisible(el) && !isSensitive(el) && !BOOKISH_RE.test(text)
      && tag !== "input" && /datepicker-next|datepicker-prev|ui-datepicker-next|ui-datepicker-prev/i.test(cls + " " + (el.getAttribute("class") || "") + " " + (el.getAttribute("aria-label") || ""));
    const isCalDay = why === "calendar-day" && inDatepicker && el.isConnected && isVisible(el) && !isSensitive(el) && !inForbiddenArea(el) && !BOOKISH_RE.test(text)
      && tag !== "input" && tag !== "select" && tag !== "button" && tag !== "a"
      && !!(ctx && ctx.day)
      && (String(el.textContent || "").trim() === String(ctx.day) || String(el.textContent || "").trim() === String(ctx.day).padStart(2, "0")
          || (el.getAttribute("data-date") || "").includes(String(ctx.iso || "")));
    if (isCalOpen || isCalNav || isCalDay) {
      clickLog.push({ allowed: true, why, ...described(el), cls: cls || null });
      if (doc && doc.defaultView) el.dispatchEvent(new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true, view: doc.defaultView }));
      return true;
    }
    if (why === "calendar-open" || why === "calendar-nav" || why === "calendar-day") {
      clickLog.push({ allowed: false, why, ...described(el), cls: cls || null, refusedBy: "stage-5L.1b calendar predicate" });
      return false;
    }
    /* A trigger must be a VISIBLE .p-dropdown widget that belongs to a formcontrolname anchor host —
     * a bare <div class="p-dropdown"> lookalike, or one outside a passenger field, is never clickable. */
    const isTrigger = why === "dropdown-open"
      && tag === "div" && el.classList && el.classList.contains("p-dropdown")
      && isVisible(el) && !!(el.closest("[formcontrolname], [ng-reflect-name]"));
    const isOption = why === "dropdown-option"
      && el.tagName === "LI" && el.getAttribute("role") === "option"
      && isVisible(el) && !!el.closest(".p-dropdown-panel, [class*='dropdown-panel']");
    const forbiddenTag = tag === "button" || tag === "a" || tag === "form" || tag === "input" || tag === "select";
    const forbidden = forbiddenTag || /submit|button|image|reset/.test(type) || (!!el.closest("button, a, [type=submit], [type=button], [type=image], [type=reset], form[action*='login' i], form[action*='pay' i]") && !isTrigger && !isOption) || !el.isConnected;
    if (forbidden || !(isTrigger || isOption)) {
      clickLog.push({ allowed: false, why, ...described(el), cls: (el.className && String(el.className)) || null });
      return false;
    }
    clickLog.push({ allowed: true, why, ...described(el), cls: (el.className && String(el.className)) || null });
    if (doc && doc.defaultView) el.dispatchEvent(new doc.defaultView.MouseEvent("click", { bubbles: true, cancelable: true, view: doc.defaultView }));
    return true;
  }

  /* ── 8. Native fill (native setter → Angular hears input/change/blur) ── */
  function setNative(el, value, opts) {
    opts = opts || {};
    const win = el.ownerDocument.defaultView;
    const proto = el.tagName === "TEXTAREA" ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, String(value)); else el.value = String(value);
    try {
      el.dispatchEvent(new win.InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertReplacementText", data: String(value) }));
    } catch {
      el.dispatchEvent(new win.Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new win.Event("change", { bubbles: true }));
    /* Station autocomplete: blur closes the listbox before we can pick → Angular leaves From/To
     * "unselected" and Search Trains stays dead. Passenger name/age still blur by default. */
    if (opts.blur !== false) {
      try { el.dispatchEvent(new win.Event("blur", { bubbles: true })); } catch { /* */ }
    }
    el.classList.add("filled");
  }

  /* stage 5C — native <select> (HTMLSelectElement) — exact option match, zero clicks */
  function selectOptions(sel) { return sel && sel.options ? [...sel.options] : []; }
  function matchSelectOption(sel, wanted) {
    const want = (Array.isArray(wanted) ? wanted : [wanted]).map(norm);
    /* EXACT match on the normalized option text or on the option value — never a substring / fuzzy match. */
    return selectOptions(sel).find((o) => want.includes(norm(o.text)) || want.includes(norm(o.value))) || null;
  }
  function selectedOptionText(sel) {
    const o = sel && sel.options && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null;
    return o ? String(o.text || "").trim() : "";
  }
  function setNativeSelect(sel, wanted) {
    const opt = matchSelectOption(sel, wanted);
    if (!opt) {
      const offered = selectOptions(sel).map((o) => String(o.text || "").trim()).filter(Boolean);
      return { ok: false, reason: `option not present on this <select> (need exactly: ${[].concat(wanted).join("/")}); it offers: ${offered.join(", ") || "none"}` };
    }
    const win = sel.ownerDocument.defaultView;
    const desc = win.HTMLSelectElement.prototype ? Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype, "value") : null;
    if (desc && desc.set) desc.set.call(sel, opt.value); else sel.value = opt.value;   // HTMLSelectElement-safe setter
    if (sel.selectedIndex !== opt.index) sel.selectedIndex = opt.index;                 // the EXACT matched option, even if two options share a value
    sel.dispatchEvent(new win.Event("input", { bubbles: true }));
    sel.dispatchEvent(new win.Event("change", { bubbles: true }));
    sel.dispatchEvent(new win.Event("blur", { bubbles: true }));
    sel.classList.add("filled");
    return { ok: true, option: String(opt.text || "").trim(), select: true };
  }

  /* ── 9. PrimeNG dropdown interaction (visible widget → own panel → exact option) ── */
  const dropdownLabel = (widget) => { const lbl = widget.querySelector(".p-dropdown-label, [class*='dropdown-label'], .p-inputtext"); return norm(lbl ? lbl.textContent : ""); };
  const visiblePanels = (doc) => [...doc.querySelectorAll(".p-dropdown-panel, [class*='dropdown-panel'], .p-overlay-panel, [class*='overlay-panel'], [role='listbox'], ul[role='listbox']")].filter(isVisible);
  function closeWidget(widget) {
    const doc = widget.ownerDocument;
    try { doc.dispatchEvent(new doc.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch { /* keyboard unsupported — panel closes on the site's own logic */ }
  }
  function panelForWidget(widget, freshlyOpened) {
    const doc = widget.ownerDocument;
    const ids = [widget.getAttribute("aria-controls"), widget.getAttribute("aria-owns")];
    for (const probe of widget.querySelectorAll("[aria-controls], [aria-owns]")) { ids.push(probe.getAttribute("aria-controls"), probe.getAttribute("aria-owns")); }
    for (const id of ids.filter(Boolean)) { const el = doc.getElementById(id); if (el && isVisible(el)) return el; }
    const inside = widget.querySelector(".p-dropdown-panel, [class*='dropdown-panel']");
    if (inside && isVisible(inside)) return inside;
    if (freshlyOpened.length) return freshlyOpened[freshlyOpened.length - 1];
    return null;
  }
  function pickDropdown(widget, wantedTexts) {
    const doc = widget.ownerDocument;
    const before = new Set(visiblePanels(doc));
    if (!clickAllowed(widget, "dropdown-open")) return { ok: false, reason: "trigger click refused (only a visible .p-dropdown trigger may be clicked)" };
    const fresh = visiblePanels(doc).filter((p) => !before.has(p));
    const panel = panelForWidget(widget, fresh);
    if (!panel) { closeWidget(widget); return { ok: false, reason: "dropdown panel did not open (nothing clicked)" }; }
    const options = [...panel.querySelectorAll('li[role="option"], .p-dropdown-item')].filter((li) => li.tagName === "LI" && isVisible(li));
    const wanted = wantedTexts.map(norm);
    const opt = options.find((li) => wanted.includes(norm(li.textContent)) || wanted.includes(norm(li.getAttribute("aria-label"))));
    if (!opt) {
      const offered = options.map((o) => norm(o.textContent)).filter(Boolean);
      closeWidget(widget);
      return { ok: false, reason: `option not present (need exactly: ${wantedTexts.join("/")}); page offers: ${offered.join(", ") || "none"}`, offered };
    }
    if (!clickAllowed(opt, "dropdown-option")) { closeWidget(widget); return { ok: false, reason: "option click refused" }; }
    widget.classList.add("filled");
    return { ok: true, option: norm(opt.textContent) };
  }

  /* ── 10. Value mapping + validation (exact, no invention) ── */
  function mapValue(key, value) {
    if (key === "name") { const v = String(value == null ? "" : value).trim(); return NAME_RE.test(v) ? { ok: true, value: v } : { ok: false, reason: "name must be 1–16 chars, letters/spaces start (IRCTC rule)" }; }
    if (key === "age") { const s = String(value == null ? "" : value).trim(); const n = Number(value); return Number.isInteger(n) && n >= 1 && n <= 125 && AGE_RE.test(s) ? { ok: true, value: s } : { ok: false, reason: "age must be 1–125" }; }
    if (key === "gender") { const o = GENDER_OPTIONS[norm(value)]; return o ? { ok: true, value: o } : { ok: false, reason: `gender "${value}" is not an IRCTC option (Male/Female/Transgender)` }; }
    if (key === "berth") {
      const n = norm(value);
      if (UNSUPPORTED_BERTH.has(n)) return { ok: false, reason: `berth "${value}" is not an IRCTC option (No Preference/Lower/Middle/Upper/Side Lower/Side Upper/Window Side)` };
      const o = BERTH_OPTIONS[n];
      /* Stage 5K: window preferences carry a flag so the fill path can report “requested window preference
       * unavailable” (leaving the control untouched) instead of failing/forcing another berth. */
      return o ? { ok: true, value: o, windowPreference: WINDOW_PREF_KEYS.has(n) } : { ok: false, reason: `berth "${value}" not mappable` };
    }
    /* Stage 5J — food/catering: payload label → [option text, option value] on passengerFoodChoice. */
    if (key === "food") {
      const n = norm(value);
      if (!n) return { ok: false, reason: "empty food value — the site default (Catering Service Option) is left unchanged" };
      if (FOOD_UNMAPPED.has(n)) return { ok: false, reason: `food "${value}" is not mapped yet (its IRCTC value was deliberately not read by the diagnostic)` };
      const o = FOOD_OPTIONS[n];
      return o ? { ok: true, value: o, foodCode: o[1] } : { ok: false, reason: `food "${value}" is not a mapped IRCTC option (Veg/Non Veg/Jain Meal/Veg (Diabetic)/Non Veg (Diabetic))` };
    }
    return { ok: false, reason: "unknown key" };
  }

  /* ── 10b. Round-21 — contact (mobile/email) anchors: page-level inputs, passenger rows ke bahar. ── */
  function contactAnchor(doc, which) {
    const wanted = CONTACT_KEY[which];
    const rows = passengerRows(doc).map((r) => r.el);
    const cands = [...doc.querySelectorAll('input[formcontrolname], input[formControlName]')].filter((el) => {
      const fcnv = String(fcn(el));
      if (!wanted.test(fcnv)) return false;
      if (!isVisible(el)) return false;
      if (isSensitive(el)) return false;                       // credential/OTP/payment jaisa kuch bhi nahi
      if (rows.some((r) => r && r.contains(el))) return false;  // passenger row ka apna field nahi
      const type = String(el.getAttribute("type") || "text").toLowerCase();
      if (!["text", "tel", "email", "number", ""].includes(type)) return false;
      return true;
    });
    return cands.length === 1 ? cands[0] : (cands.length ? null : null);  // ambiguous (0 ya 2+) → NOT FOUND
  }

  /* ── 10c. Round-21 — per-passenger flags (checkbox): row ke andar, label/formcontrolname ka narrow signal. ── */
  function flagAnchors(doc) {
    const out = [];
    for (const el of doc.querySelectorAll('input[type="checkbox"]')) {
      if (!isVisible(el) || isSensitive(el)) continue;
      if (el.closest("template, [hidden], [aria-hidden='true']")) continue;
      const hay = `${labelTextOf(el)} ${String(fcn(el))}`;
      for (const key of Object.keys(FLAG_KEY)) {
        if (FLAG_KEY[key].test(String(fcn(el))) || FLAG_LABEL[key].test(hay)) { out.push({ key, el, pidx: rowIndexOfEl(doc, el) }); break; }
      }
    }
    return out;
  }
  /* Round-21b: IRCTC par ye checkbox kabhi passenger row ke andar, kabhi uske **neeche ki apni row/section**
   * me hote hain. Pehle exact row match; warna shared anchor (exactly 1 = sabke liye ek hi control) ya
   * DOM order match (anchors ki ginti == passengers ki ginti). Ambiguous (2 anchors, 3 pax) par NOT FOUND. */
  function pickFlagTarget(flags, key, index, paxCount) {
    const exact = flags.find((f) => f.key === key && f.pidx === index);
    if (exact) return exact;
    const shared = flags.filter((f) => f.key === key && f.pidx == null);
    if (shared.length === 1) return shared[0];
    if (shared.length > 1 && shared.length === paxCount) return shared[index];
    return null;
  }
  function el0Owner() { return (typeof window !== "undefined" ? window : globalThis); }
  function rowIndexOfEl(doc, el) {
    const rows = passengerRows(doc);
    for (let i = 0; i < rows.length; i += 1) if (rows[i].el && rows[i].el.contains(el)) return i;
    return null;
  }
  function labelTextOf(el) {
    const doc = el.ownerDocument;
    const lbl = (el.id && doc.querySelector(`label[for="${el.id}"]`)) || el.closest("label");
    let t = lbl ? String(lbl.textContent || "") : "";
    if (!t) {
      const td = el.closest("td, .p-field, div");
      t = td ? String(td.textContent || "") : "";
    }
    return t.replace(/\s+/g, " ").trim().slice(0, 160);
  }

  /* ── 11. Snapshot / unexpected-change detection. Sensitive controls are NEVER read (marker only). ── */
  function snapshot(doc) {
    const m = new Map();
    for (const el of doc.querySelectorAll("input, select, textarea")) {
      if (isSensitive(el)) { m.set(el, SENSITIVE_MARK); continue; }
      m.set(el, el.type === "checkbox" || el.type === "radio" ? String(el.checked) : String(el.value == null ? "" : el.value));
    }
    for (const w of doc.querySelectorAll(".p-dropdown")) {
      if (isSensitive(w)) { m.set(w, SENSITIVE_MARK); continue; }
      m.set(w, dropdownLabel(w));
    }
    return m;
  }
  const EL_REF = typeof Symbol === "function" ? Symbol("elementRef") : "__elementRef";   // never serialized (JSON ignores symbol keys)
  function diffSnapshot(before, after, claimed) {
    const changed = [];
    for (const [el, v0] of before) {
      if (v0 === SENSITIVE_MARK) continue;                            // never inspected
      const v1 = after.get(el);
      /* v0.7.0: carry old→new values so the bridge/app can show WHY something changed
       * (Angular model-sync of hidden fields is common on live IRCTC). */
      if (v1 !== undefined && v1 !== v0 && !claimed.has(el)) changed.push({ ...described(el), cls: (el.className && String(el.className)) || null, value0: String(v0).slice(0, 60), value1: String(v1).slice(0, 60), [EL_REF]: el });
    }
    return changed;
  }

  /* ── 12. Fill ── */
  async function fillIrctc(doc, payload) {
    clickLog.length = 0;
    const sensitive = guardSensitive(doc);                            // req 7: BEFORE any detection/fill
    const { rows: rowCount, rowList, found, rowAnchors } = detectIrctc(doc);
    /* Stage 5L: on the INITIAL search form there are no passenger rows. Delegate to fillJourneySearch so
     * From/To/Date/Class are filled. When passenger rows ARE present, keep the exclusive passenger path
     * (journey fields stay read-only on the passenger page — unchanged). */
    if (rowCount === 0) {
      const jsDet = detectJourneySearch(doc);
      /* Stage 5M (v0.6.0): results page — approved payload's train number is visible with class tabs.
       * Select the EXACT train's class chip (approved Continue = approval). Never Book/Pay. */
      const trainNum = String((payload && payload.journey && payload.journey.trainNumber) || "").trim();
      const resultsHits = trainNum ? exactTrainHits(doc, trainNum) : [];
      if (resultsHits.length && payload && payload.journey && payload.journey.classCode) {
        const before = snapshot(doc);
        const sel = await selectTrainAndClass(doc, payload.journey, { approved: true });
        const wrapped = wrapResultsClassResult(doc, payload, sel, before);
        /* v1.2.0 AUTO-BOOK-NOW — after the diff, only on a verified train/class selection. This just
         * opens the passenger form; login/OTP/payment stay with the user. */
        const advBook = await maybeAutoBookNow(doc, payload, sel);
        wrapped.advanceBook = advBook;
        /* The wrap above snapshotted clickLog BEFORE this click — refresh the click views so the
         * Book Now tap is visible to the bridge banner/native status + diagnostics. */
        wrapped.clicks = [...clickLog];
        wrapped.forbiddenClicks = clickLog.filter((c) => !c.allowed);
        wrapped.criticalClicks = clickLog.filter((c) => !c.allowed && CRITICAL_CLICK_RE.test(String(c.why || "")));
        const tail = ` · Book Now ${advBook.clicked ? "AUTO-TAPPED (" + String(advBook.text || "Book Now") + ") → passenger form" : "not-clicked: " + String(advBook.reason || "").slice(0, 70)}`;
        wrapped.reason = String(wrapped.reason || "") + tail;
        return wrapped;
      }
      if (jsDet.hasSearchForm) return await fillJourneySearch(doc, payload);
    }
    const before = snapshot(doc);
    const claimed = new Set();
    const filled = [], notFound = [], failed = [], skippedRule = [];
    /* Stage 5K diagnostics: requested vs available passenger rows, and the exact option matched for berth/food. */
    const optionMatches = [];
    const requestedPassengerRows = (payload && payload.passengers ? payload.passengers.length : 0);
    (payload.passengers || []).forEach((p, i) => {
      for (const key of ["name", "age", "gender", "berth"]) {
        const path = `passengers.${i}.${key}`;
        const t = found[path];
        if (!t) { notFound.push(i >= rowCount ? `${path} (no passenger row ${i + 1} on page)` : path); continue; }
        const mv = mapValue(key, p ? p[key] : undefined);
        if (!mv.ok) { skippedRule.push(`${path}: ${mv.reason}`); continue; }
        try {
          if (t.kind === "native") { setNative(t.el, mv.value); claimed.add(t.el); filled.push(path); }
          else if (t.kind === "select") {
            /* stage 5C: visible native <select> — no clicks at all, HTMLSelectElement-safe setter, exact option */
            const r = setNativeSelect(t.el, mv.value);
            if (r.ok) {
              claimed.add(t.el); filled.push(path);
              if (key === "berth" || key === "food") optionMatches.push({ path, key, requested: p ? p[key] : undefined, matched: r.option, matchedValue: String(t.el.value || ""), ok: true });
            } else if (key === "berth" && mv.windowPreference) {
              /* stage 5K: a window request that this train/class does not offer → leave the control as it is and
               * report it; another berth (Lower/Middle/Upper…) is NEVER chosen instead. */
              const offered = selectOptions(t.el).map((o) => String(o.text || "").trim()).filter(Boolean);
              notFound.push(`${path}: requested window preference unavailable — this train/class offers: ${offered.join(", ") || "none"}`);
              optionMatches.push({ path, key, requested: p ? p[key] : undefined, ok: false, reason: "requested window preference unavailable", offered });
            } else {
              failed.push(`${path}: ${r.reason}`);
              if (key === "berth" || key === "food") optionMatches.push({ path, key, requested: p ? p[key] : undefined, ok: false, reason: r.reason });
            }
          }
          else if (t.kind === "p-dropdown") {
            const r = pickDropdown(t.el, mv.value);
            if (r.ok) {
              claimed.add(t.el); for (const sel of t.host.querySelectorAll("select")) claimed.add(sel); filled.push(path);
              if (key === "berth" || key === "food") optionMatches.push({ path, key, requested: p ? p[key] : undefined, matched: r.option, ok: true });
            } else if (key === "berth" && mv.windowPreference) {
              /* stage 5K: PrimeNG dropdown that has no Window Side option → reported, control untouched, and no
               * other berth (Lower/Middle/Upper…) is ever picked instead. */
              const offered = (r.offered || []).map(String);
              notFound.push(`${path}: requested window preference unavailable — this dropdown offers: ${offered.join(", ") || "no Window Side option"}`);
              optionMatches.push({ path, key, requested: p ? p[key] : undefined, ok: false, reason: "requested window preference unavailable", offered });
            } else {
              failed.push(`${path}: ${r.reason}`);
              if (key === "berth" || key === "food") optionMatches.push({ path, key, requested: p ? p[key] : undefined, ok: false, reason: r.reason, offered: r.offered || null });
            }
          } else failed.push(`${path}: unsupported target kind`);
        } catch (e) { failed.push(`${path}: ${String((e && e.message) || e).slice(0, 80)}`); }
      }
      /* ── Stage 5J: food/catering (additive pass — the four fields above are untouched) ──
       * Runs ONLY when the payload actually asks for a food value: an empty/absent value leaves the site's
       * default "Catering Service Option" (D) exactly as it is. The option is written only if THIS passenger's
       * row really offers it — otherwise the path is reported under notFound (never forced, never guessed). */
      {
        const path = `passengers.${i}.food`;
        const mv = mapValue("food", p ? p.food : undefined);
        if (mv.ok) {
          if (i >= rowCount) notFound.push(`${path} (no passenger row ${i + 1} on page)`);
          else {
            const sel = foodSelectFor(rowList[i], doc);
            if (!sel) notFound.push(`${path}: no ${FOOD_KEY} select offered inside passenger row ${i + 1}`);
            else {
              const r = setNativeSelect(sel, mv.value);              // EXACT option only (text or value), zero clicks
              if (r.ok) {
                claimed.add(sel); filled.push(path);
                optionMatches.push({ path, key: "food", requested: p ? p.food : undefined, matched: r.option, matchedValue: String(sel.value || ""), ok: true });
              } else {
                notFound.push(`${path}: ${r.reason}`);
                optionMatches.push({ path, key: "food", requested: p ? p.food : undefined, ok: false, reason: r.reason });
              }
            }
          }
        } else if (p && String(p.food == null ? "" : p.food).trim()) {
          skippedRule.push(`${path}: ${mv.reason}`);                 // e.g. "noFood" — refused as a rule, never guessed
        }
      }
    });
    /* ── Round-21: contact (mobile/email) — page level, passenger rows ke bahar. Sirf jab user ne diya ho. ── */
    const contactIn = (payload && payload.contact) || {};
    for (const which of ["mobile", "email"]) {
      const value = String(contactIn[which] == null ? "" : contactIn[which]).trim();
      if (!value) continue;                                    // khaali → site ka apna field waisa hi
      const path = `contact.${which}`;
      const el = contactAnchor(doc, which);
      if (!el) { notFound.push(`${path}: no visible ${which} input outside the passenger rows (formcontrolname ${which}-anchor NOT matched)`); continue; }
      try {
        setNative(el, value);
        claimed.add(el);
        const readback = String(el.value == null ? "" : el.value);
        if (readback === value) { filled.push(path); optionMatches.push({ path, key: which, ok: true }); }
        else { failed.push(`${path}: readback mismatch`); optionMatches.push({ path, key: which, ok: false, reason: "readback mismatch" }); }
      } catch (e) { failed.push(`${path}: ${String((e && e.message) || e).slice(0, 60)}`); }
    }

    /* ── Round-21: per-passenger IRCTC checkboxes — sirf TRUE par check (false/absent par kuch nahi chhua). ── */
    const flags = flagAnchors(doc);
    (payload.passengers || []).forEach((p, i) => {
      for (const key of ["bookOnlyIfConfirm", "autoUpgrade"]) {
        if (!p || p[key] !== true) continue;
        const path = `passengers.${i}.${key}`;
        const t = pickFlagTarget(flags, key, i, (payload.passengers || []).length);
        if (!t) { notFound.push(`${path}: ${key} checkbox is page par nahi mila (label/formcontrolname signal match nahi hua)`); continue; }
        try {
          if (t.el.checked === true) { filled.push(path); optionMatches.push({ path, key, ok: true, note: "already checked" }); continue; }
          t.el.checked = true;
          const win = doc.defaultView || (el0Owner(t.el));
          t.el.dispatchEvent(new (win.Event || Event)("input", { bubbles: true }));
          t.el.dispatchEvent(new (win.Event || Event)("change", { bubbles: true }));
          claimed.add(t.el);
          if (t.el.checked === true) { filled.push(path); optionMatches.push({ path, key, ok: true }); }
          else { failed.push(`${path}: checkbox did not stay checked`); optionMatches.push({ path, key, ok: false, reason: "checkbox did not stay checked" }); }
        } catch (e) { failed.push(`${path}: ${String((e && e.message) || e).slice(0, 60)}`); }
      }
    });

    const after = snapshot(doc);
    const unexpected = diffSnapshot(before, after, claimed);
    const forbiddenClicks = clickLog.filter((c) => !c.allowed);
    const changedOutsideRows = unexpected.filter((u) => !rowList.some((r) => r.el && u[EL_REF] && r.el.contains(u[EL_REF])));
    return {
      version: VERSION, rows: rowCount, rowAnchors, sensitiveCount: sensitive.length,
      requestedPassengerRows, rowsAvailable: rowCount, rowsMissing: Math.max(0, requestedPassengerRows - rowCount),
      detected: Object.keys(found), filled, notFound, failed, skippedRule, optionMatches,
      unexpected, changedOutsideRows, clicks: [...clickLog], forbiddenClicks,
      criticalClicks: clickLog.filter((c) => !c.allowed && CRITICAL_CLICK_RE.test(String(c.why || ""))),
      journeyNote: "journey fields are read-only on the IRCTC passenger page — not targeted",
    };
  }

  /* ── 13. Verify (pass/fail + exact mismatching paths; REAL mode redacts values) ── */
  function verifyIrctc(doc, payload, opts) {
    const redact = !!(opts && opts.redact);
    const { found } = detectIrctc(doc);
    /* Stage 5J: rows are only needed for the (conditional) food check — payloads without a food value verify
     * exactly as before (same checked count, same mismatches). */
    const foodRows = passengerRows(doc);
    const mismatches = []; let checked = 0;
    (payload.passengers || []).forEach((p, i) => {
      for (const key of ["name", "age", "gender", "berth"]) {
        const path = `passengers.${i}.${key}`; const t = found[path]; const mv = mapValue(key, p ? p[key] : undefined);
        if (!mv.ok) continue;                                         // unsupported values were deliberately never typed
        checked++;
        if (!t) { mismatches.push(redact ? { path, expected: "(not logged)", actual: "(not logged)", redacted: true } : { path, expected: Array.isArray(mv.value) ? mv.value[0] : mv.value, actual: "(field not found)" }); continue; }
        let actual;
        if (t.kind === "native") actual = String(t.el.value || "");
        else if (t.kind === "select") actual = selectedOptionText(t.el);   // the SELECTED OPTION TEXT (never .value alone)
        else actual = dropdownLabel(t.el);
        const wanted = Array.isArray(mv.value) ? mv.value.map(norm) : [norm(mv.value)];
        const ok = key === "age" ? Number(actual) === Number(mv.value)
          : t.kind === "select" ? (wanted.includes(norm(actual)) || wanted.includes(norm(t.el.value)))
          : Array.isArray(mv.value) ? mv.value.map(norm).includes(norm(actual)) : norm(actual) === norm(mv.value);
        if (!ok) mismatches.push(redact ? { path, expected: "(not logged)", actual: "(not logged)", redacted: true } : { path, expected: Array.isArray(mv.value) ? mv.value[0] : mv.value, actual: actual || "(empty)" });
      }
      /* ── Stage 5J: food/catering verification (only when the payload asks for a food value) ── */
      const fv = mapValue("food", p ? p.food : undefined);
      if (fv.ok) {
        const path = `passengers.${i}.food`; checked++;
        const sel = foodSelectFor(foodRows[i], doc);
        if (!sel) mismatches.push(redact ? { path, expected: "(not logged)", actual: "(not logged)", redacted: true } : { path, expected: `${fv.value[0]} = ${fv.foodCode}`, actual: "(field not found)" });
        else {
          const actualText = selectedOptionText(sel), actualValue = String(sel.value || "");
          const ok = norm(actualValue) === norm(fv.foodCode) || norm(actualText) === norm(fv.value[0]);
          if (!ok) mismatches.push(redact ? { path, expected: "(not logged)", actual: "(not logged)", redacted: true } : { path, expected: `${fv.value[0]} = ${fv.foodCode}`, actual: actualText || "(empty)" });
        }
      }
    });
    return { pass: mismatches.length === 0, mismatches, mismatchPaths: mismatches.map((m) => m.path), checked, redacted: redact };
  }

  /* ── 15. STAGE 5K — select the EXACT train + class (user-initiated, never approximate) ────────────────────
   * Read-only discovery first: the page is scanned for the EXACT train number of the RailBook journey; only
   * containers that contain that number as their own token are considered (never “the first train”, never a
   * nearest/approximate match). If the row shows a date it must equal the journey date. Inside the single matched
   * container the requested class code must appear EXACTLY as its own label; only then is that one control
   * clicked — through the click guard (why: "train-class"). Anything ambiguous or missing → nothing is clicked
   * and the reason is reported. No submit/book/pay control can ever satisfy these predicates, and this module
   * contains no navigation/network code (the click is dispatched on the site's own control, exactly like the
   * dropdown trigger; the site itself decides what happens next — the passenger page then re-detects normally). ── */
  const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const trainNumRe = (n) => new RegExp(`(?:^|[^0-9])${escRe(n)}(?:[^0-9]|$)`);
  const textOf = (el) => String((el && el.textContent) || "").replace(/\s+/g, " ").trim();
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function datesInText(text) {
    const out = [];
    const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    let m;
    const reDmy = /(?:^|[^0-9])(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[^0-9]|$)/g;
    while ((m = reDmy.exec(text))) out.push(iso(m[3], m[2], m[1]));
    const reYmd = /(?:^|[^0-9])(\d{4})-(\d{2})-(\d{2})(?:[^0-9]|$)/g;
    while ((m = reYmd.exec(text))) out.push(iso(m[1], m[2], m[3]));
    const reDMon = /(?:^|[^0-9])(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})(?:[^0-9]|$)/g;
    while ((m = reDMon.exec(text))) { const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mo) out.push(iso(m[3], mo, m[1])); }
    return [...new Set(out)];
  }
  function exactTrainHits(doc, trainNumber) {
    const re = trainNumRe(String(trainNumber));
    const hits = [...doc.querySelectorAll("*")].filter((el) => el.children.length <= 6 && isVisible(el) && re.test(textOf(el)));
    return hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));   // most specific hits only
  }
  function classControlsIn(container, classCode) {
    const out = [];
    /* Live IRCTC mobile train card exposes classes as tabs (role=tab / p-tab / short "SL"/"3A" labels),
     * not only plain buttons. Scan those too — still exact class code text only. */
    for (const el of container.querySelectorAll("button, a, [role='button'], [role='tab'], li[role='tab'], .p-tabview-nav-link, .p-ripple, span, div, td, label, li")) {
      if (!isVisible(el) || disabledish(el) || isSensitive(el) || inForbiddenArea(el)) continue;
      const text = clickText(el);
      if (BOOKISH_RE.test(text)) continue;
      if (!exactClassText(text, classCode)) continue;
      out.push(el);
    }
    /* INNERMOST only: clicking a wrapper would do nothing on the real page */
    return out.filter((el) => !out.some((o) => o !== el && el.contains(o)));
  }
  /* When the train card is collapsed, class tabs are often not in the DOM yet. Tap a non-bookish
   * header/control inside the matched container to expand, then re-scan. Never Book/Pay. */
  async function expandTrainContainer(container, classCode) {
    if (!container) return { ok: false, reason: "no container" };
    if (classControlsIn(container, classCode).length) return { ok: true, already: true };
    /* Never treat another class tab (SL/3A/CC/…) as an expand control — only the requested class may be clicked later. */
    const ANY_CLASS_TAB_RE = /^(1A|2A|3A|3E|CC|EC|SL|2S|EA|FC|FC\b|EV|VC|VS|EA)$/i;
    const looksLikeClassTab = (text) => {
      const t = norm(text);
      if (!t || t.length > 24) return false;
      if (ANY_CLASS_TAB_RE.test(t)) return true;
      /* "SL Available 12" / "CC WL 5" style labels on already-visible class buttons */
      if (/^(1A|2A|3A|3E|CC|EC|SL|2S|EA|FC)\b/i.test(t)) return true;
      return false;
    };
    const candidates = [];
    /* Prefer explicit expand/chevron/availability affordances, then the train header block. */
    for (const el of container.querySelectorAll("button, a, [role='button'], span, div, i")) {
      if (!isVisible(el) || disabledish(el) || isSensitive(el) || inForbiddenArea(el)) continue;
      const text = clickText(el);
      if (BOOKISH_RE.test(text)) continue;
      if (exactClassText(text, classCode)) continue;
      if (looksLikeClassTab(text)) continue; /* never click SL when we wanted CC, etc. */
      const cls = `${el.className || ""} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("data-cls") || ""}`;
      if (/\bclsbtn\b|data-cls|class-btn|avl-class/i.test(cls)) continue;
      const score =
        (/expand|chevron|arrow|toggle|availability|check\s*avl|show\s*avl|fa-chevron|pi-chevron/i.test(cls + " " + text) ? 30 : 0)
        + (/tinfo|train|header|tname|tno/i.test(cls) ? 10 : 0)
        + (el.tagName === "BUTTON" ? 2 : 0)
        + (text.length >= 6 && text.length <= 40 ? 5 : 0); /* prefer header-ish text, not 2-letter tabs */
      if (score <= 0 && text.length > 40) continue;
      if (score <= 0 && text.length <= 3) continue; /* bare short labels are usually class codes */
      candidates.push({ el, score: score || 1 });
    }
    candidates.sort((a, b) => b.score - a.score);
    for (const { el } of candidates.slice(0, 6)) {
      if (!clickAllowed(el, "train-expand", { container, classCode })) continue;
      /* v0.9.0 (device evidence v0.8.0: user test 17:07 — "pehle refresh karne padta hai fir class
       * show hoti hai"): the per-card "Refresh" button fetches availability over the NETWORK and the
       * class tabs (SL/3A/…) only mount ~2s later. Wait for a refresh-style click; plain expand/
       * chevron clicks stay fast. */
      const clickedText = norm(clickText(el));
      await sleepMs(/refresh|avail/i.test(clickedText) ? 2800 : 350);
      if (classControlsIn(container, classCode).length) return { ok: true, expanded: true };
    }
    /* Last resort: click the container shell itself if it is a non-bookish div (card body). */
    if (container.tagName && !BOOKISH_RE.test(clickText(container))
        && clickAllowed(container, "train-expand", { container, classCode })) {
      await sleepMs(350);
      if (classControlsIn(container, classCode).length) return { ok: true, expanded: true, shell: true };
    }
    return { ok: false, reason: "could not expand train card to reveal class tabs" };
  }
  async function selectTrainAndClass(doc, journey, opts) {
    const o = opts || {};
    const requested = {
      trainNumber: String((journey && journey.trainNumber) || "").trim(),
      date: String((journey && journey.date) || "").trim(),
      classCode: String((journey && journey.classCode) || "").trim().toUpperCase(),
    };
    const info = {
      requested, approved: o.approved === true, clicksAllowed: 0,
      trainNumberHits: 0, containers: 0, container: null,
      dateOnRow: null, dateMatched: null,
      classControlsFound: 0, classControlText: null, classSelected: false,
      rowsAfter: null, verdict: null, reason: null,
      note: "exact train number + exact class code only · no approximate/nearest match · no booking/payment control can satisfy the guard",
    };
    if (!info.approved) { info.verdict = "NOT_APPROVED"; info.reason = "explicit “Continue / Approve” tap is required before anything is clicked"; return info; }
    if (!requested.trainNumber || !requested.classCode) { info.verdict = "BAD_REQUEST"; info.reason = "journey.trainNumber / journey.classCode missing in the payload"; return info; }
    clickLog.length = 0;
    const hits = exactTrainHits(doc, requested.trainNumber);
    info.trainNumberHits = hits.length;
    if (!hits.length) { info.verdict = "TRAIN_NOT_FOUND_ON_PAGE"; info.reason = `train ${requested.trainNumber} is not present on this page — nothing was selected`; info.clicksAllowed = clickLog.filter((c) => c.allowed).length; return info; }
    const containers = [];
    for (const hit of hits) {
      let cont = null;
      /* Walk further up — live mobile cards nest class tabs several levels above the train-number node. */
      for (let cur = hit, up = 0; cur && up < 12; cur = cur.parentElement, up++) {
        if (classControlsIn(cur, requested.classCode).length) { cont = cur; break; }
      }
      /* If no class yet, still pick a sensible card-sized ancestor (has train number + some structure). */
      if (!cont) {
        for (let cur = hit, up = 0; cur && up < 12; cur = cur.parentElement, up++) {
          const t = textOf(cur);
          if (trainNumRe(requested.trainNumber).test(t) && cur.querySelectorAll("button, [role='tab'], [role='button'], a").length >= 1) {
            cont = cur; break;
          }
        }
      }
      const chosen = cont || hit.parentElement || hit;
      if (!containsNode(containers, chosen)) containers.push(chosen);
    }
    info.containers = containers.length;
    if (containers.length > 1) { info.verdict = "TRAIN_MATCH_AMBIGUOUS"; info.reason = `${containers.length} different containers show train ${requested.trainNumber} — nothing was selected`; info.clicksAllowed = clickLog.filter((c) => c.allowed).length; return info; }
    const container = containers[0];
    const ccls = (container.className && String(container.className)) || "";
    info.container = { tag: container.tagName.toLowerCase(), id: container.id || null, cls: ccls || null, trainNumberTextSeen: true };
    if (!container.contains(hits[0])) { info.verdict = "CONTAINER_MISMATCH"; info.reason = "internal check failed — the matched train row is not inside the candidate container"; return info; }
    const text = textOf(container);
    const dates = datesInText(text);
    info.dateOnRow = dates.length ? dates.join(", ") : null;
    info.dateMatched = dates.length ? dates.includes(requested.date) : null;
    if (dates.length && !dates.includes(requested.date)) {
      info.verdict = "DATE_MISMATCH";
      info.reason = `this page shows ${dates.join(", ")} for train ${requested.trainNumber}, but the RailBook journey date is ${requested.date} — nothing was selected`;
      return info;
    }
    /* page-level guard: if this page states a journey date and it is NOT ours, nothing is selected (never a
     * different day's list). Rows that carry their own date were already checked above. */
    const pageDates = datesInText(textOf(doc.body));
    info.pageDates = pageDates;
    if (pageDates.length && !pageDates.includes(requested.date)) {
      info.verdict = "DATE_NOT_ON_PAGE";
      info.reason = `this page shows ${pageDates.join(", ")} but the RailBook journey date is ${requested.date} — nothing was selected`;
      return info;
    }
    let ctrls = classControlsIn(container, requested.classCode);
    let ctlScope = container;   /* v1.0.0: the scope that actually contains the class control (card, or an
                                  * ancestor if the control mounted outside the first-picked container) */
    info.classControlsFound = ctrls.length;
    info.expanded = false;
    /* Expand ONLY when the card shows ZERO class tabs of any kind (collapsed live IRCTC card).
     * If other classes are already visible (e.g. SL present, CC requested) → do not click anything;
     * report CLASS_NOT_FOUND (never substitute another class). */
    const cardHasAnyClassTab = () => {
      const codes = ["1A","2A","3A","3E","CC","EC","SL","2S","EA","FC"];
      for (const c of codes) if (classControlsIn(container, c).length) return true;
      if (container.parentElement) {
        for (const c of codes) if (classControlsIn(container.parentElement, c).length) return true;
      }
      return false;
    };
    if (!ctrls.length && !cardHasAnyClassTab()) {
      const exp = await expandTrainContainer(container, requested.classCode);
      info.expanded = !!(exp && (exp.expanded || exp.already));
      info.expandReason = exp && exp.reason || null;
      ctrls = classControlsIn(container, requested.classCode);
      info.classControlsFound = ctrls.length;
      if (!ctrls.length && container.parentElement) {
        const parent = container.parentElement;
        const exp2 = await expandTrainContainer(parent, requested.classCode);
        if (exp2 && exp2.expanded) info.expanded = true;
        const upCtrls = classControlsIn(parent, requested.classCode);
        if (upCtrls.length) { ctrls = upCtrls; ctlScope = parent; info.classControlsFound = ctrls.length; }
      }
    }
    if (!ctrls.length) {
      info.verdict = "CLASS_NOT_FOUND_ON_TRAIN";
      info.reason = `train ${requested.trainNumber} does not expose class ${requested.classCode} on this page${info.expanded ? " (card expanded, still missing)" : cardHasAnyClassTab() ? " (other classes visible — not substituted)" : " (card may be collapsed)"} — nothing was selected · open the train row so the ${requested.classCode} tab is visible, then retry Select train + class`;
      info.clicksAllowed = clickLog.filter((c) => c.allowed).length;
      return info;
    }
    if (ctrls.length > 1) { info.verdict = "CLASS_MATCH_AMBIGUOUS"; info.reason = `${ctrls.length} controls inside that train show class ${requested.classCode} — nothing was selected`; return info; }
    let ctl = ctrls[0];
    /* v1.1.0 engine (device evidence 22 Sep: collapsed card "AC Chair car (CC) Refresh ⟳" + pale
     * Book Now): the chip must be REFRESHED first (availability is fetched over the network), then
     * tapped — only after that Book Now turns active. Refresh is skipped when Book Now is already
     * enabled (nothing to fetch), and it is a one-shot, guarded, non-bookish click. */
    info.refresh = { clicked: false, text: null, reason: null };
    {
      const bnReady = () => {
        try { return findBookNowButton(doc, requested.trainNumber, requested.classCode).ok === true; }
        catch { return false; }
      };
      /* v1.3.0 re-open guard: the app was closed and reopened with the class already chosen on the
       * site (chip highlighted). Tapping it again could TOGGLE it off, so we trust the site's own
       * state — and only for the exact class chip we already verified by text. */
      info.chipAlreadySelected = looksSelected(ctl);
      const rr = info.chipAlreadySelected
        ? { ok: false, reason: "chip site par pehle se selected hai — refresh ki zarurat nahi" }
        : findClassRefreshControl(ctlScope, ctl, requested.classCode);
      if (!rr.ok) {
        info.refresh.reason = rr.reason;
      } else if (bnReady()) {
        info.refresh.reason = "Book Now pehle se enabled — refresh ki zarurat nahi";
      } else if (clickAllowed(rr.el, "train-card-refresh", { container: rr.scope, classCode: requested.classCode })) {
        info.refresh.clicked = true;
        info.refresh.text = clickText(rr.el).slice(0, 30);
        await wait(Math.max(800, Math.min(6000, Number(o.refreshWaitMs || 1800))));
        /* v1.2.0: the refresh (and the availability fetch it triggers) can re-render the card. Re-locate
         * the chip — same scope when it survived, otherwise freshly from the train number — and poll a
         * little, because the site swaps the DOM asynchronously. Detached elements are never clicked. */
        const relocate = () => {
          if (ctlScope && ctlScope.isConnected) {
            const c = classControlsIn(ctlScope, requested.classCode);
            if (c.length === 1) return { ok: true, control: c[0], scope: ctlScope };
            if (c.length > 1) return { ok: false, ambiguous: c.length };
          }
          const fresh = refindTrainCard(doc, requested.trainNumber, requested.classCode);
          if (fresh.ok) return { ok: true, control: fresh.control, scope: fresh.scope, rescouted: true };
          return { ok: false };
        };
        let loc = relocate();
        for (let w = 0; !loc.ok && !loc.ambiguous && w < 8; w++) { await wait(400); loc = relocate(); }
        if (loc.ambiguous) {
          info.verdict = "CLASS_MATCH_AMBIGUOUS";
          info.reason = `${loc.ambiguous} controls inside that train show class ${requested.classCode} after refresh — nothing was selected`;
          return info;
        }
        if (loc.ok) {
          ctl = loc.control;
          ctlScope = loc.scope;
          info.classControlFresh = true;
          info.classControlRescouted = !!loc.rescouted;   /* true = card was re-rendered by the site */
        }
      } else {
        const lastR = [...clickLog].reverse().find((c) => c.allowed === false && c.why === "train-card-refresh");
        info.refresh.reason = "class refresh guard ne refuse kiya" + (lastR && lastR.refusedBy ? " · " + String(lastR.refusedBy) : "");
      }
    }
    info.classControlText = clickText(ctl);
    info.classControl = described(ctl);
    if (info.chipAlreadySelected) {
      /* No click: the site already has exactly this class chosen (verified by text above). */
      info.classSelected = true;
      info.classSelectedVia = "site-state";
      info.classSelectSkipped = "chip pehle se selected thi — dobara tap nahi kiya (taaki toggle off na ho)";
    } else {
      if (typeof o.onBeforeClick === "function") { try { o.onBeforeClick(info); } catch { /* diagnostics only */ } }
      if (!clickAllowed(ctl, "train-class", { classCode: requested.classCode, container: ctlScope })) {
        info.verdict = "CLASS_CONTROL_REFUSED_BY_GUARD";
        info.reason = "the class control did not satisfy the stage-5K click guard — nothing was selected";
        return info;
      }
      info.classSelected = true;
      info.classSelectedVia = "click";
    }
    /* Live IRCTC: Book Now stays dim until an availability DATE tile under the class is tapped
     * (e.g. "Sun, 27 Sep" · RAC/AVAILABLE). Never click Book/Pay — only the date tile. */
    await wait(o.waitMs || 350);
    info.avlDateSelected = false;
    info.avlDateText = null;
    if (requested.date) {
      /* v1.0.0 (device evidence v0.9.0): the date tile may live OUTSIDE the first-picked container
       * (header-row container vs card body) and may RE-RENDER after the class tab click. Search
       * the class-control scope first, then one ancestor level — excluding tiles that belong to a
       * DIFFERENT train card — and retry once after a short wait. */
      /* v1.1.0 engine (device evidence 22 Sep: live collapsed card keeps the date tiles BELOW the
       * class-chip row, i.e. 2+ levels above the chip's own block): walk a few ancestors instead of
       * just one parent, so the tile is found. Tiles of OTHER trains are still excluded via
       * excludeOtherTrains, and every click still goes through the same guard. */
      const avlScopes = [];
      const pushScope = (sc) => {
        if (!sc || !sc.querySelectorAll || !sc.isConnected || avlScopes.includes(sc)) return;
        avlScopes.push(sc);
      };
      pushScope(ctlScope);
      for (let cur = ctlScope.parentElement, up = 0; cur && cur !== doc.body && up < 4; cur = cur.parentElement, up++) {
        if (cur.tagName === "BODY" || cur.tagName === "HTML") break;
        pushScope(cur);
      }
      /* v1.2.0: the chip tap can re-render the card too — include the freshly re-derived card, so the
       * date tiles of the NEW DOM are found (detached subtrees are skipped by isConnected). */
      const freshCard = refindTrainCard(doc, requested.trainNumber, requested.classCode);
      if (freshCard.ok) pushScope(freshCard.scope);
      const findAvl = () => {
        for (let i = 0; i < avlScopes.length; i++) {
          const sc = avlScopes[i];
          const t = findAvailabilityDateTile(sc, requested.date, i === 0 ? null : requested.trainNumber);
          if (t) return { tile: t, scope: sc };
        }
        return null;
      };
      let avlHit = findAvl();
      for (let w = 0; !avlHit && w < 4; w++) { await wait(700); avlHit = findAvl(); }
      if (avlHit) {
        const avl = avlHit.tile;
        if (looksSelected(avl)) {
          /* v1.3.0: this date tile is already the chosen one on the site — tapping again could deselect. */
          info.avlDateSelected = true;
          info.avlDateText = clickText(avl).slice(0, 60);
          info.avlDateVia = "site-state";
          info.avlDateSkipped = "date tile pehle se selected thi — dobara tap nahi kiya";
        } else if (clickAllowed(avl, "train-avl-date", { container: avlHit.scope, classCode: requested.classCode, isoDate: requested.date })) {
          info.avlDateSelected = true;
          info.avlDateText = clickText(avl).slice(0, 60);
          await wait(200);
        } else {
          const lastR = [...clickLog].reverse().find((c) => c.allowed === false && c.why === "train-avl-date");
          info.avlDateReason = "availability date tile refused by guard" + (lastR && lastR.refusedBy ? " · " + String(lastR.refusedBy) : "");
        }
      } else {
        info.avlDateReason = "no availability date tile matching journey date inside the train card (user can tap the " + String(requested.date).slice(8, 10) + " date tile)";
      }
    }
    info.clicksAllowed = clickLog.filter((c) => c.allowed).length;
    await wait(o.waitMs || 200);
    info.rowsAfter = detectIrctc(doc).rows;
    info.verdict = "TRAIN_CLASS_SELECTED";
    const stateNote = [
      info.classSelectSkipped ? `class: ${info.classSelectSkipped}` : "",
      info.avlDateSkipped ? `date: ${info.avlDateSkipped}` : "",
    ].filter(Boolean).join(" · ");
    const refreshNote = info.refresh && info.refresh.clicked
      ? ` · class chip pehle refresh ki (${info.refresh.text || "refresh"})`
      : (info.refresh && info.refresh.reason ? ` · class refresh: ${String(info.refresh.reason).slice(0, 80)}` : "");
    const avlNote = info.avlDateSelected
      ? ` · availability date tapped (${info.avlDateText})`
      : (info.avlDateReason ? ` · avl date not auto-tapped: ${info.avlDateReason}` : "");
    const ctlDesc = info.classControl
      ? info.classControl.tag + (info.classControl.id ? "#" + info.classControl.id : "")
        + (info.classControl.cls && String(info.classControl.cls) !== "null" ? "." + String(info.classControl.cls).trim().split(/\s+/)[0] : "")
        + ` "${String(info.classControlText || "").slice(0, 30)}"`
      : "n/a";
    info.reason = `exact match selected: train ${requested.trainNumber} · class ${requested.classCode} via ${ctlDesc}${info.classSelectedVia === "site-state" ? " (site par pehle se selected)" : ""}${stateNote ? " · " + stateNote : ""}${refreshNote}${info.dateMatched === true ? ` · date ${requested.date} confirmed on the row` : " · no date shown on the row (list is date-filtered by the site)"}${avlNote} · Pay NEVER clicked (login/OTP/payment user ke paas)`;
    return info;
  }
  /* ───────────────────────── v1.2.0 AUTO-ADVANCE HELPERS ─────────────────────────
   * Two navigation-only steps behind explicit, verified gates. Both return the element + scope so
   * clickAllowed() can re-check everything (nothing here clicks by itself). */
  function commonAncestor(els) {
    if (!els || !els.length) return null;
    let a = els[0];
    while (a && !els.every((x) => a.contains(x))) a = a.parentElement;
    return a;
  }
  /* The journey form's own "Search Trains" control — exact wording, inside the form scope,
   * visible, enabled, non-sensitive, no pay/login/otp wording. Ambiguous → nothing clicked. */
  function findSearchButton(doc, det) {
    const hosts = (det && det.hosts) || {};
    const anchors = [hosts.from, hosts.to, hosts.date].filter(Boolean);
    if (anchors.length < 2) return { ok: false, reason: "journey form anchors (from/to) nahi mile — Search nahi dabaya" };
    let scope = null;
    try { scope = anchors[0].closest && anchors[0].closest("form"); } catch { /* */ }
    if (!scope) scope = commonAncestor(anchors);
    if (!scope || !scope.querySelectorAll) return { ok: false, reason: "journey form container nahi mila — Search nahi dabaya" };
    const cands = [];
    for (const el of scope.querySelectorAll("button, [role='button'], input[type='submit'], input[type='button']")) {
      if (!isVisible(el) || disabledish(el) || isSensitive(el) || inForbiddenArea(el)) continue;
      const t = clickText(el);
      if (t.length > 30 || !SEARCH_BTN_RE.test(t) || HARD_NO_RE.test(t) || BOOKISH_RE.test(t)) continue;
      if (el.closest && el.closest("[formcontrolname='passengerName'], [formcontrolname='passengerBerthChoice']")) continue;
      cands.push(el);
    }
    if (!cands.length) return { ok: false, reason: "journey form me enabled “Search Trains” control nahi mila" };
    if (cands.length > 1) return { ok: false, reason: `ambiguous: ${cands.length} Search-jaisi controls mile — koi click nahi kiya` };
    return { ok: true, el: cands[0], scope };
  }
  /* v1.3.0 engine — is this control (or its immediate wrapper) already in a CHOSEN state on the site?
   * Used for the re-open case: an already-selected class chip / already-highlighted date tile must NOT
   * be tapped again (a second tap can toggle it back OFF). Token-level class match only, never substring. */
  const looksSelected = (el) => {
    if (!el) return false;
    const SEL_TOKEN_RE = /(^|[\s-])(active|selected|sel|highlighted|current|checked|chosen|p-highlight)([\s-]|$)/i;
    try {
      for (const attr of ["aria-selected", "aria-checked", "aria-pressed", "aria-current"]) {
        const v = el.getAttribute && el.getAttribute(attr);
        if (v === "true" || (attr === "aria-current" && v && v !== "false")) return true;
      }
    } catch { /* */ }
    try {
      for (let cur = el, up = 0; cur && up < 2; cur = cur.parentElement, up++) {
        const raw = cur.className;
        const cls = String((raw && raw.baseVal != null) ? raw.baseVal : (raw || ""));
        if (SEL_TOKEN_RE.test(cls)) return true;
        for (const attr of ["data-state", "data-selected", "data-active"]) {
          const v = cur.getAttribute && cur.getAttribute(attr);
          if (v === "true" || v === "selected" || v === "active") return true;
        }
      }
    } catch { /* */ }
    return false;
  };
  /* v1.2.0 engine — after the chip's Refresh, the live SPA often REPLACES the whole train card with
   * fresh DOM nodes. The previously located chip/scope are then DETACHED, and clicking them would do
   * nothing. Re-derive the card + the exact class chip straight from the train number in the live DOM.
   * Same strictness as before: smallest ancestor that holds EXACTLY ONE chip with that class code. */
  function refindTrainCard(doc, trainNumber, classCode) {
    const num = String(trainNumber || "").trim();
    const code = String(classCode || "").trim().toUpperCase();
    if (!num || !code || !doc || !doc.body) return { ok: false };
    let hits = [];
    try { hits = exactTrainHits(doc, num); } catch { return { ok: false }; }
    for (const hit of hits) {
      for (let cur = hit, up = 0; cur && cur !== doc.body && up < 14; cur = cur.parentElement, up++) {
        let found = [];
        try { found = classControlsIn(cur, code); } catch { found = []; }
        if (found.length === 1 && found[0].isConnected) return { ok: true, scope: cur, control: found[0] };
        if (found.length > 1) break; /* wider scope can only add more matches — try the next hit */
      }
    }
    return { ok: false };
  }
  /* v1.1.0 engine — the class chip's own "Refresh ⟳" control (live collapsed mobile card:
   * "AC Chair car (CC)   Refresh ⟳"). Walks up from the exact class chip to the smallest ancestor that
   * holds a refresh-ish control, and returns it ONLY when it is unique in that scope. Never a class tab,
   * never anything bookish/pay/login. Ambiguity → ok:false (nothing clicked). */
  function findClassRefreshControl(scope, classControl, classCode) {
    if (!scope || !scope.querySelectorAll) return { ok: false, reason: "class chip ka scope nahi mila" };
    if (!classControl) return { ok: false, reason: "requested class chip nahi mili — refresh nahi dabaya" };
    const codes = ["1A", "2A", "3A", "3E", "CC", "EC", "SL", "2S", "EA", "FC", "EV", "VC"];
    /* All refresh-ish controls + all class chips in this scope, in DOM order. */
    const all = [...scope.querySelectorAll("*")];
    const idx = new Map(all.map((el, i) => [el, i]));
    const refreshCands = [...scope.querySelectorAll("button, [role='button'], span, i, a, div")]
      .filter((el) => isVisible(el) && !disabledish(el) && !isSensitive(el) && !inForbiddenArea(el)
        && !BOOKISH_RE.test(clickText(el))
        && !exactClassText(clickText(el), classCode)
        && el.getAttribute("data-rb-advance-refresh") !== "1"
        && isRefreshWording(el));
    if (!refreshCands.length) return { ok: false, reason: "class chip ke saath koi “Refresh ⟳” control nahi mila" };
    /* Chip elements per class code (innermost, so a wrapper cannot win the ownership vote). */
    const chips = [];
    for (const c of codes) {
      for (const el of classControlsIn(scope, c)) chips.push({ code: c, el });
    }
    if (!chips.length) return { ok: false, reason: "scope me koi class chip nahi mili" };
    /* v1.3.0 — OWNERSHIP VOTE (fix for the flat row "CC ⟳  EC ⟳"): each refresh control belongs to the
     * class chip it is NEAREST to in document order. Only controls that belong to the requested class
     * are eligible; if that still leaves 0 or 2+, nothing is clicked. */
    const nearestChipFor = (rEl) => {
      const ri = idx.get(rEl);
      if (ri == null) return null;
      let best = null;
      for (const ch of chips) {
        const ci = idx.get(ch.el);
        if (ci == null) continue;
        const d = Math.abs(ri - ci);
        if (!best || d < best.d) best = { d, code: ch.code, el: ch.el, ci };
      }
      return best;
    };
    const mine = refreshCands.filter((rEl) => {
      const owner = nearestChipFor(rEl);
      return !!owner && owner.code === classCode;
    });
    if (!mine.length) {
      const owners = [...new Set(refreshCands.map((rEl) => (nearestChipFor(rEl) || {}).code).filter(Boolean))];
      return { ok: false, reason: `refresh control mila par wo ${owners.join("/") || "kisi aur"} class ke saath laga hai (aapki class ${classCode}) — koi click nahi kiya` };
    }
    if (mine.length > 1) {
      /* Two ⟳ right next to our chip → cannot prove which one is ours → click nothing. */
      return { ok: false, reason: `${mine.length} refresh controls aapki class ke paas mile — kaun sa ${classCode} ka hai yeh confirm nahi hua, koi click nahi kiya (manual tap karein)` };
    }
    const el = mine[0];
    /* Keep the innermost node (a wrapper click would fire nothing on the live page). */
    const inner = [el, ...el.querySelectorAll("button, span, i")]
      .filter((x) => isRefreshWording(x) && x.getAttribute("data-rb-advance-refresh") !== "1");
    const target = inner.length ? inner[inner.length - 1] : el;
    return { ok: true, el: target, scope, owner: classCode };
  }
  /* The "Book Now" control inside the card of the EXACT payload train (class chip must be there).
   * This only NAVIGATES to the passenger form — the site's own booking/payment steps stay untouched. */
  function findBookNowButton(doc, trainNumber, classCode) {
    const num = String(trainNumber || "").trim();
    if (!num) return { ok: false, reason: "payload me train number nahi — Book Now nahi dabaya" };
    const hits = exactTrainHits(doc, num);
    if (!hits.length) return { ok: false, reason: `train ${num} is page par nahi hai — Book Now nahi dabaya` };
    const cards = [];
    for (const hit of hits) {
      for (let cur = hit; cur && cur !== doc.body; cur = cur.parentElement) {
        if (!cur.querySelectorAll) continue;
        const btns = [...cur.querySelectorAll("button, [role='button'], input[type='button']")]
          .filter((el) => isVisible(el) && !disabledish(el) && !isSensitive(el) && !inForbiddenArea(el)
            && clickText(el).length <= 40 && BOOK_NOW_RE.test(clickText(el)) && !HARD_NO_RE.test(clickText(el)));
        if (!btns.length) continue;
        if (classCode) {
          const hasClass = [...cur.querySelectorAll("button, [role='button'], a, span, div, td, li")]
            .some((el) => isVisible(el) && exactClassText(clickText(el), classCode));
          if (!hasClass) continue;
        }
        cards.push({ scope: cur, btns });
        break;
      }
    }
    const uniq = [...new Set(cards.map((c) => c.scope))];
    if (!uniq.length) return { ok: false, reason: `train ${num} ke card me enabled “Book Now” nahi mila (pehle class + date select hona chahiye)` };
    if (uniq.length > 1) return { ok: false, reason: `${uniq.length} cards me train ${num} + Book Now mile — koi click nahi kiya` };
    if (cards[0].btns.length > 1) return { ok: false, reason: `ambiguous: card me ${cards[0].btns.length} “Book Now” controls — koi click nahi kiya` };
    return { ok: true, el: cards[0].btns[0], container: cards[0].scope };
  }
  /* Results stage: tap Book Now ONLY after the verified train/class(/date) selection, so the user
   * lands on the passenger form. Runs AFTER the diff snapshot, so the SPA re-render is not reported
   * as an "unexpected change" (which would look like site tampering). */
  async function maybeAutoBookNow(doc, payload, sel) {
    const j = (payload && payload.journey) || {};
    if (j.autoAdvance === false) return { clicked: false, reason: "auto-advance payload me off hai" };
    if (!sel || sel.verdict !== "TRAIN_CLASS_SELECTED") return { clicked: false, reason: `train/class select nahi hua (${(sel && sel.verdict) || "?"})` };
    if (sel.classSelected !== true) return { clicked: false, reason: "class chip select nahi hui" };
    /* v1.2.1: the live card keeps Book Now pale/disabled until the refreshed availability lands, so
     * poll for an ENABLED control (bounded) instead of giving up after one look. */
    const t0 = Date.now();
    const maxWait = Math.max(0, Math.min(20000, Number(j.bookNowWaitMs != null ? j.bookNowWaitMs : 9000)));
    let bn = findBookNowButton(doc, j.trainNumber, j.classCode);
    let bnReason = bn.reason;
    while (!bn.ok && Date.now() - t0 < maxWait) {
      await wait(600);
      bn = findBookNowButton(doc, j.trainNumber, j.classCode);
      if (!bn.ok) bnReason = bn.reason;
    }
    const waitedMs = Date.now() - t0;
    if (!bn.ok) return { clicked: false, reason: `${bnReason} (${Math.round(waitedMs / 1000)}s wait ke baad bhi enabled nahi hua)`, waitedMs };
    if (!clickAllowed(bn.el, "train-book-now", { container: bn.container, classSelected: true })) {
      return { clicked: false, reason: "Book Now click guard ne refuse kiya", waitedMs };
    }
    const text = String(clickText(bn.el)).slice(0, 40);
    /* Verify the site really moved us (SPA swaps the results DOM for the passenger form). A click the
     * site silently ignored must NOT be reported as "passenger form khul gaya". */
    let pathBefore = "";
    try { pathBefore = String(doc.defaultView && doc.defaultView.location && doc.defaultView.location.pathname || ""); } catch { /* */ }
    const rowsBefore = detectIrctc(doc).rows;
    await wait(900);
    let verified = false;
    const tv = Date.now();
    while (Date.now() - tv < 4500) {
      try { if (!bn.el.isConnected) { verified = true; break; } } catch { /* */ }
      try { if (detectIrctc(doc).rows > rowsBefore) { verified = true; break; } } catch { /* */ }
      try { if (String(doc.defaultView && doc.defaultView.location && doc.defaultView.location.pathname || "") !== pathBefore) { verified = true; break; } } catch { /* */ }
      await wait(500);
    }
    return { clicked: true, text, verified, waitedMs, verifiedReason: verified ? null : "click ke baad page nahi badla (site ne rok diya ho sakta hai)" };
  }

  /* Find a visible availability/date cell for the journey ISO date inside the train card. */
  function findAvailabilityDateTile(container, isoDate, excludeOtherTrains) {
    if (!container || !isoDate) return null;
    const parts = isoToDmyParts(isoDate);
    if (!parts) return null;
    const dayNum = String(Number(parts.d));
    const monIdx = Number(parts.mo);
    const monNames = ["", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const mon = monNames[monIdx] || "";
    const monFull = ["","january","february","march","april","may","june","july","august","september","october","november","december"][monIdx] || "";
    const y = parts.y;
    let candidates = []; /* v1.1.0 engine: re-filtered below (was const → TypeError, whole fill crashed) */
    for (const el of container.querySelectorAll("button, a, [role='button'], div, span, li, td, label")) {
      if (!isVisible(el) || disabledish(el) || isSensitive(el) || inForbiddenArea(el)) continue;
      const text = clickText(el);
      if (!text || text.length < 4 || text.length > 80) continue;
      if (BOOKISH_RE.test(text)) continue;
      if (exactClassText(text, "SL") || exactClassText(text, "3A") || exactClassText(text, "2A") || exactClassText(text, "CC")) continue;
      const nt = norm(text);
      /* Must look like a date tile: has day number + month, or ISO, and often AVAIL/RAC/WL/CURR */
      const hasDay = new RegExp(`(?:^|[^0-9])${dayNum}(?:[^0-9]|$)`).test(nt);
      const hasMon = (mon && nt.includes(mon)) || (monFull && nt.includes(monFull));
      const hasIso = nt.includes(norm(`${parts.d}/${parts.mo}/${parts.y}`)) || nt.includes(norm(isoDate)) || nt.includes(norm(`${parts.d}-${parts.mo}-${parts.y}`));
      /* v1.0.0: live tiles sometimes concatenate "Sep"+"RAC" without a space. clickText() is
       * already lowercased, so split on the RAW text's case boundary first, then lowercase. */
      const avlProbe = String(el.textContent || "").replace(/([a-z])\s*([A-Z])/g, "$1 $2").toLowerCase();
      const hasAvlWord = /\b(avail|available|rac|wl|waitlist|wait|curr|gnwl|tqwl)\b/i.test(avlProbe);
      const cls = `${el.className || ""} ${el.id || ""}`;
      const looksAvlChrome = /avl|availability|date-tile|journey-date|travel-date/i.test(cls);
      /* Live IRCTC date tiles always show RAC/AVAILABLE/WL (or similar). Pure "22-09-2026" row metadata
       * must NOT be auto-clicked — that broke mock tests (extra train-avl-date) and can mis-click headers. */
      if (!hasAvlWord && !looksAvlChrome) continue;
      if (!((hasDay && hasMon) || hasIso)) continue;
      let score = (hasDay && hasMon ? 10 : 0) + (hasIso ? 10 : 0) + (hasAvlWord ? 25 : 0) + (looksAvlChrome ? 15 : 0);
      score += Math.max(0, 30 - Math.min(30, text.length));
      candidates.push({ el, score, text });
    }
    if (excludeOtherTrains) {
      /* When searching an ancestor scope, a tile that sits inside a DIFFERENT train card (one whose
       * text carries another 4-6 digit train number) must never be clicked. */
      candidates = candidates.filter((cand) => {
        let cur = cand.el;
        while (cur && container.contains(cur) && cur !== container) {
          const nums = String(textOf(cur)).match(/[1-9]\d{3,5}/g) || [];
          if (nums.length && !nums.includes(String(excludeOtherTrains))) return false;
          cur = cur.parentElement;
        }
        return true;
      });
      if (!candidates.length) return null;
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    /* INNERMOST among top scorers — v1.1.0 engine fix: this filter used to keep the OUTERMOST node
     * (the wrapper whose only job is to hold the tile), so the site's tile handler never fired and
     * Book Now stayed pale. Now the deepest node that still carries the whole tile text wins; a click
     * there bubbles up into the tile's own handler. */
    const top = candidates.filter((c) => c.score >= candidates[0].score - 5);
    const inner = top.map((c) => c.el).filter((el) => !top.some((o) => o.el !== el && el.contains(o.el)));
    return (inner[0] || top[top.length - 1].el);
  }
  function containsNode(list, node) { return list.some((n) => n === node || n.contains(node) || node.contains(n)); }

  /* ── 14. READ-ONLY anchor diagnostic: NAMES / COUNTS only — never a value, never a credential. ── */
  function anchorDiagnostic(doc) {
    const rows = passengerRows(doc);
    const all = anchorHosts(doc);
    const seen = new Map();
    for (const el of all.filter((e) => PASSENGER_FCN_RE.test(fcn(e)))) {
      const k = fcn(el);
      const e = seen.get(k) || { formcontrolname: k, count: 0, visible: 0, tags: new Set(), sensitive: false };
      e.count++; if (isVisible(el)) e.visible++; e.tags.add(el.tagName.toLowerCase()); if (isSensitive(el)) e.sensitive = true;
      seen.set(k, e);
    }
    const live = [...seen.keys()];
    const expected = {};
    for (const [k, keys] of Object.entries(KEYS)) expected[k] = keys.find((key) => live.some((s) => s.toLowerCase() === key.toLowerCase())) || "NOT FOUND";
    return {
      version: VERSION,
      url: doc.location ? doc.location.pathname : null,
      visiblePassengerRows: rows.length,
      rows: rows.map((r, i) => ({ row: i + 1, anchors: r.anchors, hasAge: r.hasAge, hasGender: r.hasGender, hasBerth: r.hasBerth })),
      anchors: [...seen.values()].map((e) => ({ formcontrolname: e.formcontrolname, count: e.count, visible: e.visible, tags: [...e.tags], sensitive: e.sensitive })),
      expectedAnchors: expected,
      dropdownWidgetsVisible: [...doc.querySelectorAll(".p-dropdown")].filter(isVisible).length,
      dropdownPanelsOpen: visiblePanels(doc).length,
      sensitiveControlsSeen: guardSensitive(doc).length,
      note: "anchor names/counts only — no passenger values, credentials, OTP, PIN, tokens or cookies are read or logged",
    };
  }


  /* ── 16. STAGE 5L — INITIAL TRAIN SEARCH (From / To / Date / Class) ───────────────────────────────────────
   * Live IRCTC NGeT home / booking form (NOT the passenger page). Public, documented anchors only:
   *   #origin       / p-autocomplete#origin        → From station (p-autocomplete input)
   *   #destination  / p-autocomplete#destination   → To station
   *   #jDate        / p-calendar#jDate             → Journey date (typed as DD/MM/YYYY live; DD-MM-YYYY only if control asks)
   *   #journeyClass / [formcontrolname=journeyClass] → Class (p-dropdown or native <select>)
   *   #quota        / [formcontrolname=quota]      → Quota (OPTIONAL — filled ONLY when payload.journey.quota
   *                                                   is an explicit non-empty string; never defaulted to GN)
   * Detection is id/formcontrolname-FIRST. No label/placeholder fuzzy matching. No train-number input on this
   * stage (IRCTC searches by From/To/date/class, then the USER picks train 12014 + class on the list).
   * NEVER clicks Search / Book / Pay / login / CAPTCHA / OTP. Runs ONLY when detectIrctc() finds 0 passenger
   * rows, so the existing passenger + Stage-5J food path is byte-stable when those anchors are present. ── */

  const JOURNEY_SEARCH_IDS = Object.freeze({
    from: ["origin"],
    to: ["destination"],
    date: ["jDate", "journeyDate", "dateOfJourney"],
    classCode: ["journeyClass", "journeyClassCode", "travelClass"],
    quota: ["quota", "journeyQuota"],
  });
  const JOURNEY_SEARCH_FCN = Object.freeze({
    from: ["origin", "fromStation", "source", "boardingStation"],
    to: ["destination", "toStation", "dest", "destinationStation"],
    date: ["jDate", "journeyDate", "dateOfJourney", "doj"],
    classCode: ["journeyClass", "classCode", "travelClass", "reservedClassCode"],
    quota: ["quota", "journeyQuota", "reservationQuota"],
  });
  const CLASS_CODE_RE = (code) => {
    const c = String(code || "").trim().toUpperCase();
    if (!c) return null;
    const esc = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^A-Z0-9])${esc}(?:[^A-Z0-9]|$)`, "i");
  };

  function hostByIdOrFcn(doc, ids, fcns) {
    for (const id of ids || []) {
      const el = doc.getElementById(id);
      if (el && isVisible(el) && !isSensitive(el)) return el;
    }
    const all = anchorHosts(doc);
    for (const want of fcns || []) {
      const hit = all.find((el) => fcn(el).toLowerCase() === String(want).toLowerCase() && isVisible(el) && !isSensitive(el));
      if (hit) return hit;
    }
    return null;
  }
  function inputInside(host) {
    if (!host) return null;
    if (host.tagName === "INPUT" || host.tagName === "TEXTAREA") return isVisible(host) && !isSensitive(host) ? host : null;
    const inp = host.querySelector('input[role="combobox"], input.p-autocomplete-input, input.p-inputtext, input:not([type=hidden]):not([type=submit]):not([type=button])');
    return inp && isVisible(inp) && !isSensitive(inp) ? inp : null;
  }
  function dropdownInside(host) {
    if (!host) return null;
    if (host.classList && host.classList.contains("p-dropdown") && isVisible(host) && !isSensitive(host)) return host;
    const w = host.querySelector(".p-dropdown");
    return w && isVisible(w) && !isSensitive(w) ? w : null;
  }
  function selectInside(host) {
    if (!host) return null;
    if (host.tagName === "SELECT") return isVisible(host) && !host.disabled && !isSensitive(host) ? host : null;
    const sel = host.querySelector("select");
    return sel && isVisible(sel) && !sel.disabled && !isSensitive(sel) ? sel : null;
  }
  function isoToDmyParts(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
    return m ? { y: m[1], mo: m[2], d: m[3] } : null;
  }
  /* Live IRCTC NGeT (mobile + desktop) shows placeholder DD/MM/YYYY and keeps today's
   * date until Angular receives the SAME slash format. Hyphen DD-MM-YYYY can paint the
   * input briefly but leave the FormControl on the default day → Search stays dead /
   * list is for the wrong date. Prefer slashes; only use hyphens when the control itself
   * asks for them. */
  function formatJourneyDateForControl(el, iso) {
    const parts = isoToDmyParts(iso);
    if (!parts) return "";
    const ph = norm((el && el.getAttribute && el.getAttribute("placeholder")) || "");
    const cur = String((el && el.value) || "");
    const wantsHyphen = /dd-mm-yyyy/.test(ph) || (/^\d{2}-\d{2}-\d{4}$/.test(cur) && !/\//.test(cur));
    if (wantsHyphen) return `${parts.d}-${parts.mo}-${parts.y}`;
    return `${parts.d}/${parts.mo}/${parts.y}`;
  }
  function isoToDmy(iso) {
    /* backward-compatible default = live IRCTC slash form */
    const parts = isoToDmyParts(iso);
    return parts ? `${parts.d}/${parts.mo}/${parts.y}` : "";
  }
  function dateReadback(el) {
    return String((el && el.value) || "").trim();
  }
  function dateReadbackMatches(el, formatted) {
    const got = dateReadback(el).replace(/[./]/g, "-");
    const want = String(formatted || "").trim().replace(/[./]/g, "-");
    return !!(want && got === want);
  }
  function sleepMs(ms) {
    return new Promise((resolve) => {
      const w = (typeof root !== "undefined" && root.setTimeout) ? root : (typeof window !== "undefined" ? window : globalThis);
      w.setTimeout(resolve, ms);
    });
  }
  async function waitUntil(pred, maxMs, stepMs) {
    const step = stepMs || 40;
    const budget = maxMs || 600;
    const t0 = Date.now();
    while (Date.now() - t0 < budget) {
      try { const v = pred(); if (v) return v; } catch { /* */ }
      await sleepMs(step);
    }
    try { return pred() || null; } catch { return null; }
  }
  function fireDateEvents(el, formatted, kind) {
    const win = el.ownerDocument.defaultView;
    try {
      el.dispatchEvent(new win.InputEvent("input", {
        bubbles: true, cancelable: true,
        inputType: kind || "insertReplacementText",
        data: formatted == null ? null : String(formatted),
      }));
    } catch {
      el.dispatchEvent(new win.Event("input", { bubbles: true }));
    }
    try { el.dispatchEvent(new win.KeyboardEvent("keyup", { bubbles: true, key: "Unidentified" })); } catch { /* */ }
    el.dispatchEvent(new win.Event("change", { bubbles: true }));
  }
  function setInputString(el, text) {
    const win = el.ownerDocument.defaultView;
    const proto = win.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, text); else el.value = text;
    try { el.setAttribute("value", text); } catch { /* */ }
  }
  /* Direct write — do NOT clear-first. Clearing makes Angular mark the control invalid and
   * Search Trains goes dead even when the later write is rejected and today is restored. */
  function writeDateValue(el, formatted) {
    setInputString(el, formatted);
    fireDateEvents(el, formatted, "insertReplacementText");
    try { el.dispatchEvent(new el.ownerDocument.defaultView.Event("blur", { bubbles: true })); } catch { /* */ }
  }
  /* Char-by-char typing — some Angular/PrimeNG builds only parse on insertText per key. */
  function typeDateValue(el, formatted) {
    const win = el.ownerDocument.defaultView;
    setInputString(el, "");
    try {
      el.dispatchEvent(new win.InputEvent("input", { bubbles: true, cancelable: true, inputType: "deleteContentBackward", data: null }));
    } catch { el.dispatchEvent(new win.Event("input", { bubbles: true })); }
    let acc = "";
    for (const ch of String(formatted)) {
      acc += ch;
      setInputString(el, acc);
      try {
        el.dispatchEvent(new win.InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: ch }));
      } catch { el.dispatchEvent(new win.Event("input", { bubbles: true })); }
      try {
        el.dispatchEvent(new win.KeyboardEvent("keydown", { bubbles: true, key: ch, keyCode: ch.charCodeAt(0) }));
        el.dispatchEvent(new win.KeyboardEvent("keypress", { bubbles: true, key: ch, keyCode: ch.charCodeAt(0) }));
        el.dispatchEvent(new win.KeyboardEvent("keyup", { bubbles: true, key: ch, keyCode: ch.charCodeAt(0) }));
      } catch { /* */ }
    }
    el.dispatchEvent(new win.Event("change", { bubbles: true }));
    try { el.dispatchEvent(new win.Event("blur", { bubbles: true })); } catch { /* */ }
  }
  function visibleDatepickerPanels(doc) {
    return [...doc.querySelectorAll(
      ".p-datepicker, .ui-datepicker, .p-datepicker-calendar-container, [class*='datepicker-calendar'], .p-datepicker-group, div.p-datepicker"
    )].filter(isVisible);
  }
  /* p-datepicker day cell — open via date INPUT (mobile) or icon; wait briefly for panel; never Search/Book. */
  async function pickCalendarDay(host, el, iso) {
    const parts = isoToDmyParts(iso);
    if (!parts) return { ok: false, reason: "no iso" };
    const doc = (host && host.ownerDocument) || (el && el.ownerDocument);
    if (!doc) return { ok: false, reason: "no document" };
    const h = host || (el && el.closest && (el.closest("p-calendar, #jDate, [formcontrolname='journeyDate'], [formcontrolname='jDate'], [formcontrolname=journeyDate]") || el.parentElement));
    if (!h) return { ok: false, reason: "no host" };
    const dayNum = String(Number(parts.d));
    const yNum = Number(parts.y), moNum = Number(parts.mo);
    const isoHyphen = `${parts.y}-${parts.mo}-${parts.d}`;
    const isoSlash = `${parts.d}/${parts.mo}/${parts.y}`;

    let opened = false;
    const tryOpen = (node) => {
      if (!node || !isVisible(node)) return false;
      return clickAllowed(node, "calendar-open", { host: h });
    };
    /* 1) the date input itself (live mobile IRCTC) */
    if (el && tryOpen(el)) opened = true;
    /* 2) known trigger selectors inside the host */
    if (!opened) {
      const triggers = [
        ...h.querySelectorAll(".p-datepicker-trigger, button.p-datepicker-trigger, .p-calendar-button, button.p-button, .pi-calendar, .p-datepicker-icon, span.p-button-icon, .ui-datepicker-trigger"),
      ];
      for (const t of triggers) {
        const clickEl = (t.closest && (t.closest("button, .p-datepicker-trigger, [class*='datepicker-trigger'], a") || t)) || t;
        if (tryOpen(clickEl)) { opened = true; break; }
      }
    }
    /* 3) the host / p-calendar shell */
    if (!opened && tryOpen(h)) opened = true;

    const panel = await waitUntil(() => {
      const ps = visibleDatepickerPanels(doc);
      return ps.length ? ps[ps.length - 1] : null;
    }, opened ? 900 : 200, 40);

    if (!panel) return { ok: false, reason: opened ? "datepicker panel did not open after input/trigger tap" : "no datepicker trigger/panel (input open attempted)" };

    const monthNameToIndex = (txt) => {
      const m = norm(txt);
      const names = ["january","february","march","april","may","june","july","august","september","october","november","december"];
      for (let i = 0; i < 12; i++) if (m.includes(names[i]) || m.includes(names[i].slice(0, 3))) return i + 1;
      const n = Number((m.match(/\b(1[0-2]|0?[1-9])\b/) || [])[1]);
      return n || 0;
    };
    const readPanelYearMonth = () => {
      const yEl = panel.querySelector(".p-datepicker-year, .ui-datepicker-year, select.p-datepicker-year, .p-datepicker-title .p-datepicker-year");
      const mEl = panel.querySelector(".p-datepicker-month, .ui-datepicker-month, select.p-datepicker-month, .p-datepicker-title .p-datepicker-month");
      let y = yEl ? Number(String(yEl.value || yEl.textContent || "").replace(/[^0-9]/g, "").slice(0, 4)) : 0;
      let mo = 0;
      if (mEl) {
        if (mEl.tagName === "SELECT") {
          const v = Number(mEl.value);
          mo = (v >= 0 && v <= 11) ? v + 1 : v;
        } else mo = monthNameToIndex(mEl.textContent || "");
      }
      if (!y || !mo) {
        const title = panel.querySelector(".p-datepicker-title, .ui-datepicker-title, .p-datepicker-header");
        const t = title ? title.textContent || "" : panel.textContent || "";
        const ym = t.match(/(20\d{2})/);
        if (ym) y = Number(ym[1]);
        if (!mo) mo = monthNameToIndex(t);
      }
      return { y, mo };
    };
    for (let step = 0; step < 14; step++) {
      const { y, mo } = readPanelYearMonth();
      if (y && mo && y === yNum && mo === moNum) break;
      if (!y || !mo) break;
      const before = y * 12 + mo, want = yNum * 12 + moNum;
      const next = panel.querySelector(".p-datepicker-next, .ui-datepicker-next, button.p-datepicker-next, [class*='datepicker-next']");
      const prev = panel.querySelector(".p-datepicker-prev, .ui-datepicker-prev, button.p-datepicker-prev, [class*='datepicker-prev']");
      const nav = before < want ? next : prev;
      if (!nav || !clickAllowed(nav, "calendar-nav", { host: h })) break;
      await sleepMs(60);
    }

    const cells = [...panel.querySelectorAll(
      "td:not(.p-datepicker-other-month):not(.ui-datepicker-other-month) span, td:not(.p-datepicker-other-month) > a, td span.p-datepicker-day, td[data-date], .p-datepicker-calendar td span, td"
    )].filter(isVisible);

    let dayEl = null;
    for (const c of cells) {
      const dd = (c.getAttribute && c.getAttribute("data-date")) || (c.parentElement && c.parentElement.getAttribute && c.parentElement.getAttribute("data-date")) || "";
      const aria = `${(c.getAttribute && c.getAttribute("aria-label")) || ""} ${(c.parentElement && c.parentElement.getAttribute && c.parentElement.getAttribute("aria-label")) || ""}`;
      if (dd && (dd === isoHyphen || dd.startsWith(isoHyphen) || dd.includes(isoSlash))) { dayEl = c; break; }
      if (aria && (aria.includes(isoHyphen) || aria.includes(isoSlash) || (aria.includes(parts.y) && aria.includes(String(Number(parts.mo))) && new RegExp(`\\b${dayNum}\\b`).test(aria)))) { dayEl = c; break; }
    }
    if (!dayEl) {
      const candidates = cells.filter((c) => {
        const t = String(c.textContent || "").trim();
        if (t !== dayNum && t !== parts.d) return false;
        const td = c.tagName === "TD" ? c : (c.closest && c.closest("td"));
        if (!td) return false;
        const cls = `${td.className || ""} ${c.className || ""}`;
        if (/other-month|p-disabled|disabled|ui-state-disabled/i.test(cls)) return false;
        return true;
      });
      if (candidates.length === 1) dayEl = candidates[0];
      else if (candidates.length > 1) dayEl = candidates[0];
    }
    if (!dayEl) return { ok: false, reason: `day ${dayNum} not found in open datepicker for ${isoHyphen}` };
    if (!clickAllowed(dayEl, "calendar-day", { host: h, iso: isoHyphen, day: dayNum })) {
      return { ok: false, reason: "calendar day click refused by guard" };
    }
    await sleepMs(80);
    return { ok: true, day: dayNum, method: "datepicker-day" };
  }
  async function setNativeDate(el, iso, host) {
    const formatted = formatJourneyDateForControl(el, iso);
    const prior = dateReadback(el);
    if (!formatted) return { ok: false, reason: "invalid iso", written: "", readback: prior, restored: null };
    const finishOk = (method, cal) => {
      el.classList.add("filled");
      return { ok: true, written: formatted, readback: dateReadback(el), method, calendar: cal || null, stuckOnDefault: false, prior };
    };
    const fail = (reason, cal, method) => {
      /* Restore prior (usually today) so Search Trains is not left with an invalid/half-written control. */
      if (prior && !dateReadbackMatches(el, prior)) {
        try { setInputString(el, prior); fireDateEvents(el, prior, "insertReplacementText"); } catch { /* */ }
      }
      return {
        ok: false,
        written: formatted,
        readback: dateReadback(el),
        method: method || "failed",
        calendar: cal || null,
        stuckOnDefault: true,
        restored: prior || null,
        reason,
      };
    };

    /* A) direct write (no clear-first) */
    writeDateValue(el, formatted);
    await sleepMs(30);
    if (dateReadbackMatches(el, formatted)) return finishOk("native-events");

    /* B) char-by-char type */
    typeDateValue(el, formatted);
    await sleepMs(40);
    if (dateReadbackMatches(el, formatted)) return finishOk("typed-events");

    /* C) open p-datepicker (input tap on mobile) and click the day cell */
    const calHost = host || (el.closest && (el.closest("p-calendar, #jDate, [formcontrolname='journeyDate'], [formcontrolname=journeyDate], [formcontrolname='jDate']") || el.parentElement));
    const cal = await pickCalendarDay(calHost, el, iso);
    await sleepMs(60);
    if (dateReadbackMatches(el, formatted)) return finishOk(cal.ok ? "datepicker-day" : "native-after-cal", cal);
    /* Some builds write a different separator after day-pick — accept equivalent readback. */
    if (cal.ok && dateReadbackMatches(el, formatted.replace(/\//g, "-"))) return finishOk("datepicker-day-hyphen", cal);
    if (cal.ok) {
      /* Day was clicked; re-assert formatted string once more. */
      writeDateValue(el, formatted);
      await sleepMs(30);
      if (dateReadbackMatches(el, formatted)) return finishOk("datepicker+native", cal);
      /* Day click may have bound Angular even if input text lags — trust calendar only if readback changed from prior. */
      const now = dateReadback(el);
      if (now && now !== prior && /27|target/i.test(now + formatted) || (now && isoToDmyParts(iso) && now.indexOf(String(Number(isoToDmyParts(iso).d))) >= 0 && now !== prior)) {
        el.classList.add("filled");
        return { ok: true, written: formatted, readback: now, method: "datepicker-day-readback", calendar: cal, stuckOnDefault: false, prior };
      }
    }
    return fail(cal && cal.reason ? cal.reason : "Angular kept the default date after write/type/calendar", cal, "unbound");
  }
  function stationNeedles(name, code) {
    const out = [];
    const c = String(code || "").trim().toUpperCase();
    const n = String(name || "").trim();
    if (c) out.push(c);
    if (n) out.push(n);
    if (c && n) {
      out.push(
        `${n} - ${c}`,
        `${n} (${c})`,
        `${c} - ${n}`,
        /* Live IRCTC mobile labels look like: "AMRITSAR JN - ASR (AMRITSAR)" / "DEHRADUN - DDN" */
        `${n.toUpperCase()} - ${c}`,
        `${n.toUpperCase()} - ${c} (${n.toUpperCase()})`,
      );
    }
    return out.filter(Boolean);
  }
  function optionTextMatches(text, needles) {
    const t = norm(text);
    if (!t) return false;
    for (const raw of needles) {
      const n = norm(raw);
      if (!n) continue;
      if (t === n) return true;
      /* station codes are short tokens — require a word-ish boundary so "ASR" does not match inside another word */
      if (/^[a-z0-9]{2,6}$/i.test(String(raw).trim()) && new RegExp(`(?:^|[^a-z0-9])${String(raw).trim().replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}(?:[^a-z0-9]|$)`, "i").test(t)) return true;
      if (n.length >= 4 && t.includes(n)) return true;
    }
    return false;
  }
  function classNeedles(code) {
    const c = String(code || "").trim().toUpperCase();
    if (!c) return [];
    return [c, `(${c})`, ` ${c} `, `${c} -`, `- ${c}`];
  }
  /* Quota codes on IRCTC often show as words (GENERAL/TATKAL) while the payload carries GN/TQ.
   * Class codes usually appear as the two-letter token itself inside a longer label. */
  const QUOTA_ALIASES = Object.freeze({
    GN: ["GN", "GENERAL", "GENERAL QUOTA"],
    TQ: ["TQ", "TATKAL", "TATKAL QUOTA"],
    PT: ["PT", "PREMIUM TATKAL"],
    LD: ["LD", "LADIES", "LADIES QUOTA"],
    SS: ["SS", "LOWER BERTH", "SENIOR CITIZEN"],
    HP: ["HP", "DIVYANG", "HANDICAPPED"],
  });
  function classOptionMatch(text, code, dataValue) {
    const t = norm(text);
    const c = String(code || "").trim().toUpperCase();
    const dv = norm(dataValue);
    if (!c) return false;
    if (dv && (dv === norm(c) || dv === c.toLowerCase())) return true;
    if (t === norm(c)) return true;
    const aliases = QUOTA_ALIASES[c];
    if (aliases && aliases.some((a) => t === norm(a) || dv === norm(a))) return true;
    const re = CLASS_CODE_RE(c);
    return !!(t && re && re.test(text));
  }
  function listboxPanelSelector() {
    return [
      ".p-autocomplete-panel",
      "[class*='autocomplete-panel']",
      "[class*='ui-autocomplete-items']",
      "[class*='ui-autocomplete-panel']",
      "ul[role='listbox']",
      "[role='listbox']",
      ".p-overlay:not(.p-datepicker)",
      "cdk-overlay-pane .p-autocomplete-items",
      "cdk-overlay-pane ul",
      ".p-autocomplete-items",
    ].join(", ");
  }
  function panelIsOpen(p) {
    if (!p || p.hidden) return false;
    const st = (p.getAttribute("style") || "").toLowerCase();
    if (/display\s*:\s*none/.test(st) || /visibility\s*:\s*hidden/.test(st)) return false;
    try {
      if (isVisible(p)) return true;
      if (p.offsetParent != null) return true;
      if (p.getClientRects && p.getClientRects().length > 0) return true;
    } catch { /* */ }
    return false;
  }
  /* Panels linked to THIS station input only — never the other field's leftover overlay (live bug: To clicked From's ASR). */
  function panelsForStationInput(doc, inputEl) {
    const all = [...doc.querySelectorAll(listboxPanelSelector())].filter(panelIsOpen);
    if (!inputEl) return all;
    const scoped = [];
    const acId = inputEl.getAttribute("aria-controls");
    if (acId) {
      const byId = doc.getElementById(acId);
      if (byId && panelIsOpen(byId)) scoped.push(byId);
    }
    /* Prefer the p-autocomplete custom element / #origin|#destination — NOT the inner
     * span.p-autocomplete (that would miss the sibling listbox panel used by IRCTC + our mock). */
    const host = inputEl.closest
      ? (inputEl.closest("p-autocomplete, #origin, #destination, [formcontrolname='origin'], [formcontrolname='destination'], [formcontrolname=origin], [formcontrolname=destination]")
         || inputEl.closest(".p-autocomplete")
         || inputEl.parentElement)
      : inputEl.parentElement;
    if (host) {
      for (const p of host.querySelectorAll(listboxPanelSelector())) if (panelIsOpen(p)) scoped.push(p);
      /* sibling panel next to the host (common IRCTC layout) */
      let sib = host.nextElementSibling;
      for (let i = 0; sib && i < 3; sib = sib.nextElementSibling, i++) {
        if (panelIsOpen(sib) && /listbox|autocomplete|overlay/i.test(`${sib.className || ""} ${sib.getAttribute("role") || ""} ${sib.id || ""}`)) scoped.push(sib);
        for (const p of (sib.querySelectorAll ? sib.querySelectorAll(listboxPanelSelector()) : [])) if (panelIsOpen(p)) scoped.push(p);
      }
    }
    if (scoped.length) return [...new Set(scoped)];
    /* v0.8.0 SAFE single-panel fallback: live NGeT sometimes renders the autocomplete listbox in a
     * BODY-LEVEL portal (invisible to the host-relative scan above). If EXACTLY ONE listbox panel is
     * open on the whole page, it must be this field's — take it. Two or more open panels → still []
     * (that is the old bug where To clicked From's row; prefer empty → wait/retry). */
    if (all.length === 1) return [all[0]];
    return [];
  }
  function visibleListboxOptions(doc, inputEl) {
    const panels = panelsForStationInput(doc, inputEl);
    const out = [];
    const seen = new Set();
    const push = (el) => {
      if (!el || seen.has(el) || isSensitive(el)) return;
      const t = String(el.textContent || "").trim();
      if (!t) return;
      if (!isVisible(el) && !(el.getClientRects && el.getClientRects().length)) return;
      seen.add(el);
      out.push(el);
    };
    for (const p of panels) {
      for (const li of p.querySelectorAll('li[role="option"], li, [role="option"]')) push(li);
      for (const sp of p.querySelectorAll("li > span, li > div, .p-autocomplete-item, .ui-autocomplete-list-item")) {
        const row = sp.closest ? (sp.closest("li") || sp) : sp;
        push(row);
      }
    }
    return out;
  }
  function dismissStationPanels(doc, exceptInput) {
    /* Escape closes PrimeNG overlays without wiping input values. */
    try {
      doc.dispatchEvent(new doc.defaultView.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    } catch { /* */ }
    const keep = exceptInput ? new Set(panelsForStationInput(doc, exceptInput)) : new Set();
    /* v1.1.0: hide the OUTERMOST wrapper of each open panel (walk up single-child wrappers, stop at
     * <body>). Earlier we set display:none on the inner <ul> as well — when the site later re-showed its
     * wrapper the list stayed invisible (raw code in From, empty To list = device screenshot 20:03). */
    const panelRootOf = (el) => {
      let root = el;
      try {
        while (root.parentElement && root.parentElement.tagName !== "BODY" && root.parentElement.children && root.parentElement.children.length === 1) root = root.parentElement;
      } catch { /* */ }
      return root;
    };
    const roots = new Set();
    for (const p of doc.querySelectorAll(listboxPanelSelector())) {
      let kept = false;
      for (const k of keep) { if (k === p || (p.contains && p.contains(k))) { kept = true; break; } }
      if (kept) continue;
      const idc = `${p.className || ""} ${p.id || ""} ${p.getAttribute("role") || ""}`;
      if (!/autocomplete|listbox|overlay|p-autocomplete|ui-autocomplete/i.test(idc)) continue;
      roots.add(panelRootOf(p));
    }
    for (const root of roots) {
      const idc = `${root.className || ""} ${root.id || ""} ${root.getAttribute && root.getAttribute("role") || ""}`;
      /* Only hide clearly-open autocomplete/listbox chrome — never random page widgets. */
      if (!/autocomplete|listbox|overlay|p-autocomplete|ui-autocomplete/i.test(idc) && root === doc.body) continue;
      try {
        /* Only style.display — do NOT set the HTML hidden attribute. Live IRCTC / PrimeNG reopen
         * overlays by toggling display; a stuck hidden=true leaves a station input with no list. */
        if (root.style) root.style.display = "none";
      } catch { /* */ }
    }
  }
  function clickStationOption(el) {
    const doc = el.ownerDocument;
    const win = doc.defaultView;
    try {
      el.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true, cancelable: true, view: win }));
      el.dispatchEvent(new win.MouseEvent("mouseup", { bubbles: true, cancelable: true, view: win }));
    } catch { /* */ }
    if (!clickAllowed(el, "autocomplete-option")) return false;
    return true;
  }
  function stationOptionScore(label, code, name, needles) {
    const t = norm(label);
    if (!t || !optionTextMatches(label, needles)) return -1;
    const c = norm(code);
    const n = norm(name);
    let score = t.length;
    /* Strong boost when the station CODE appears as its own token (DDN not DDNA). */
    if (c && new RegExp(`(?:^|[^a-z0-9])${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`).test(t)) score += 100;
    if (n && n.length >= 4 && t.includes(n)) score += 40;
    /* Prefer classic IRCTC "NAME - CODE" shape */
    if (c && t.includes(c) && /-/.test(label)) score += 20;
    return score;
  }
  function pickAutocompleteOption(doc, needles, opts) {
    opts = opts || {};
    const inputEl = opts.inputEl || null;
    const code = opts.code || "";
    const name = opts.name || "";
    const optsLis = visibleListboxOptions(doc, inputEl);
    if (!optsLis.length) return { ok: false, reason: "no autocomplete options visible for this field (typed value left — user can tap the suggestion)" };
    let hit = null, hitScore = -1;
    for (const li of optsLis) {
      const label = li.textContent || li.getAttribute("aria-label") || "";
      const score = stationOptionScore(label, code, name, needles);
      if (score > hitScore) { hit = li; hitScore = score; }
    }
    if (!hit || hitScore < 0) {
      const offered = optsLis.slice(0, 8).map((o) => norm(o.textContent)).filter(Boolean);
      return { ok: false, reason: `station option not in THIS field's list (need ${code || name || needles[0]}); visible: ${offered.join(", ") || "none"}`, offered };
    }
    /* Require code token when we have a code — blocks picking From's ASR while filling To. */
    if (code && hitScore < 100) {
      const offered = optsLis.slice(0, 8).map((o) => norm(o.textContent)).filter(Boolean);
      return { ok: false, reason: `no option with code ${code} in this field's list; visible: ${offered.join(", ") || "none"}`, offered };
    }
    if (!clickStationOption(hit)) return { ok: false, reason: "station option click refused by the stage-5L guard" };
    return { ok: true, option: norm(hit.textContent), offeredCount: optsLis.length, score: hitScore };
  }
  async function waitForStationOptions(doc, needles, maxMs, inputEl, code) {
    const budget = maxMs || 1400;
    const t0 = Date.now();
    let tick = 0;
    while (Date.now() - t0 < budget) {
      const optsLis = visibleListboxOptions(doc, inputEl);
      if (optsLis.length) {
        const hit = optsLis.find((li) => stationOptionScore(li.textContent || "", code || "", "", needles) >= (code ? 100 : 0));
        if (hit) return optsLis;
        /* options visible but not yet matching — keep waiting briefly */
        if (!code) return optsLis;
      }
      /* Periodically re-nudge the combobox so slow mobile IRCTC opens the list. */
      if (inputEl && tick % 4 === 3) {
        try {
          const win = doc.defaultView;
          inputEl.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, view: win }));
          inputEl.dispatchEvent(new win.Event("input", { bubbles: true }));
        } catch { /* */ }
      }
      tick++;
      await sleepMs(50);
    }
    const optsLis = visibleListboxOptions(doc, inputEl);
    if (!optsLis.length) return null;
    const hit = optsLis.find((li) => stationOptionScore(li.textContent || "", code || "", "", needles) >= (code ? 100 : 0));
    return hit ? optsLis : (code ? null : optsLis);
  }
  function stationLooksSelected(el, code, name) {
    const v = norm(String((el && el.value) || ""));
    if (!v) return false;
    const c = norm(code);
    const n = norm(name);
    if (c && v === c) return false; /* still bare code — not the full IRCTC label */
    if (c && v.includes(c) && v.length > c.length + 2) return true;
    if (n && n.length >= 4 && v.includes(n)) return true;
    if (/-/.test(v) && c && v.includes(c)) return true;
    return false;
  }
  async function pickClassControl(host, code) {
    const widget = dropdownInside(host);
    if (widget) {
      /* Reuse the existing exact-option PrimeNG path; also accept options whose text carries the class code. */
      const wanted = [String(code).toUpperCase()];
      /* First try exact code; pickDropdown does exact norm match on option text — also try richer labels via a
       * one-shot scan of the panel after open. */
      const doc = host.ownerDocument;
      const before = new Set(visiblePanels(doc));
      if (!clickAllowed(widget, "dropdown-open")) return { ok: false, reason: "class dropdown trigger click refused" };
      const fresh = visiblePanels(doc).filter((p) => !before.has(p));
      const panel = panelForWidget(widget, fresh);
      if (!panel) { closeWidget(widget); return { ok: false, reason: "class dropdown panel did not open" }; }
      const options = [...panel.querySelectorAll('li[role="option"], .p-dropdown-item')].filter((li) => li.tagName === "LI" && isVisible(li));
      const opt = options.find((li) => classOptionMatch(li.textContent || li.getAttribute("aria-label") || "", code, li.getAttribute("data-value") || li.dataset && li.dataset.value));
      if (!opt) {
        const offered = options.map((o) => norm(o.textContent)).filter(Boolean);
        closeWidget(widget);
        return { ok: false, reason: `option ${code} not present on this dropdown; offers: ${offered.join(", ") || "none"}`, offered };
      }
      if (!clickAllowed(opt, "dropdown-option")) { closeWidget(widget); return { ok: false, reason: "class option click refused" }; }
      widget.classList.add("filled");
      return { ok: true, option: norm(opt.textContent), kind: "p-dropdown" };
    }
    const sel = selectInside(host);
    if (sel) {
      const opt = selectOptions(sel).find((o) => classOptionMatch(o.text || "", code, o.value) || norm(o.value) === norm(code));
      if (!opt) {
        const offered = selectOptions(sel).map((o) => String(o.text || "").trim()).filter(Boolean);
        return { ok: false, reason: `option ${code} not present on this <select>; offers: ${offered.join(", ") || "none"}` };
      }
      const r = setNativeSelect(sel, [opt.text, opt.value, String(code).toUpperCase()]);
      return r.ok ? { ok: true, option: r.option, kind: "select" } : r;
    }
    /* Stage 5M (v0.6.0): custom trigger — e.g. live NGeT's "All Classes" row uses markup that is neither
     * .p-dropdown nor <select>. Click the trigger (host or a small parent), wait for a panel, pick the
     * exact class option from it. */
    return pickCustomClassTrigger(host, code);
  }

  async function pickCustomClassTrigger(host, code) {
    const doc = host.ownerDocument;
    const win = doc.defaultView;
    const esc = () => { try { doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch { /* */ } };
    const triggerText = norm(textOf(host));
    if (!triggerText) return { ok: false, reason: "class trigger has no readable label" };
    /* Snapshot BEFORE the click — clickAllowed dispatches the mousedown that opens the panel. */
    const beforeB = new Set(visiblePanels(doc));
    const beforeLB = new Set([...doc.querySelectorAll("ul[role='listbox'], [role='listbox']")].filter(isVisible));
    const findPanel = () => {
      const fresh = visiblePanels(doc).filter((p) => !beforeB.has(p));
      if (fresh.length) return fresh[fresh.length - 1];
      const freshLB = [...doc.querySelectorAll("ul[role='listbox'], [role='listbox']")].filter((p) => isVisible(p) && !beforeLB.has(p));
      return freshLB.length ? freshLB[freshLB.length - 1] : null;
    };
    /* v0.8.0 node-walk: the trigger's OWN element may be refusal-locked (nested in a clickable)
     * while the clickable ANCESTOR holds the handler — walk up (max 4 nodes), guarded per node,
     * pointer events dispatched, 3-phase panel wait. v0.9.0 (device evidence v0.8.0: "offers: none"):
     * once a panel appears, POLL for its options — live dropdowns render the shell before the rows. */
    let node = host;
    let clicked = 0;
    for (let i = 0; node && node !== doc.body && i < 4; i++) {
      if (node.childElementCount > 12) { node = node.parentElement; continue; }
      if (!clickAllowed(node, "class-trigger-open", { triggerText })) { node = node.parentElement; continue; }
      clicked++;
      try {
        if (win && win.PointerEvent) {
          node.dispatchEvent(new win.PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
          node.dispatchEvent(new win.PointerEvent("pointerup", { bubbles: true, cancelable: true }));
        }
      } catch { /* */ }
      let panel = null;
      /* v1.2.5: live NGeT overlay panels kabhi-kabhi 2-3s late render hote hain — poll budget badhaya. */
      for (const ms of [700, 500, 500, 800, 800]) {
        await wait(ms);
        panel = findPanel();
        if (panel) break;
      }
      if (panel) {
        let opts = [...panel.querySelectorAll('li[role="option"], .p-dropdown-item, li')]
          .filter((li) => li.tagName === "LI" && isVisible(li) && !isSensitive(li));
        for (const ms of [700, 800, 800]) {
          if (opts.length) break;
          await wait(ms);
          opts = [...panel.querySelectorAll('li[role="option"], .p-dropdown-item, li')]
            .filter((li) => li.tagName === "LI" && isVisible(li) && !isSensitive(li));
        }
        const opt = opts.find((li) => classOptionMatch(li.textContent || "", code, (li.getAttribute("data-value") || (li.dataset && li.dataset.value)) || ""));
        if (opt) {
          if (!clickAllowed(opt, "class-option", { classCode: code })) { esc(); return { ok: false, reason: "class option click refused by the stage-5M guard" }; }
          await wait(500);
          if (host.classList) host.classList.add("filled");
          return { ok: true, option: norm(opt.textContent), kind: "custom-trigger", triggerText: String(textOf(host) || "").slice(0, 40) };
        }
        const offered = opts.map((o) => norm(o.textContent)).filter(Boolean);
        esc();
        return { ok: false, reason: `option ${code} not present on this dropdown; offers: ${offered.join(", ") || "none"}`, offered };
      }
      esc();
      node = node.parentElement;
    }
    const lastRefusal = [...clickLog].reverse().find((c) => c.allowed === false && c.why === "class-trigger-open");
    if (clicked === 0) {
      return { ok: false, reason: "class trigger click refused by the stage-5M guard — tap it manually" + (lastRefusal && lastRefusal.refusedBy ? " · " + String(lastRefusal.refusedBy) : "") };
    }
    return { ok: false, reason: "class trigger opened but no option panel appeared — tap it manually" };
  }

  /* Stage 5M (v0.6.0): wrap selectTrainAndClass's verdict in the standard fill result shape the
   * bridge banner / page-tracking expect. Results page = same SPA path as search, so stage is
   * "results-class" (its own pageKey). Nothing here ever clicks Book/Search/Pay. */
  function wrapResultsClassResult(doc, payload, info, before) {
    /* selectTrainAndClass already ran (it owns the clickLog + its own guards); diff against the
     * pre-click snapshot (passed in) so any unexpected value change is still caught. */
    const after = snapshot(doc);
    const claimed = new Set();
    const classCode = String((payload && payload.journey && payload.journey.classCode) || "").trim().toUpperCase();
    const filled = [];
    const notFound = [];
    const optionMatches = [];
    if (info.verdict === "TRAIN_CLASS_SELECTED") {
      filled.push("journey.trainRow", "journey.classChip");
      if (info.avlDateSelected) filled.push("journey.availabilityDate");
      optionMatches.push({ path: "journey.classChip", key: "classChip", requested: classCode, matched: String(info.classControlText || "").slice(0, 60), ok: true });
      if (info.avlDateSelected) optionMatches.push({ path: "journey.availabilityDate", key: "availabilityDate", requested: String((payload.journey && payload.journey.date) || ""), matched: String(info.avlDateText || "").slice(0, 40), ok: true });
    } else {
      notFound.push(`journey.classChip: ${info.verdict || "not-selected"} — ${String(info.reason || "no reason").slice(0, 160)}`);
      optionMatches.push({ path: "journey.classChip", key: "classChip", requested: classCode, ok: false, reason: String(info.reason || info.verdict).slice(0, 200) });
    }
    const unexpected = diffSnapshot(before, after, claimed);
    return {
      version: VERSION,
      stage: "results-class",
      rows: 0,
      rowAnchors: [],
      sensitiveCount: guardSensitive(doc).length,
      requestedPassengerRows: (payload && payload.passengers ? payload.passengers.length : 0),
      rowsAvailable: 0,
      rowsMissing: 0,
      detected: ["journey.classChip"],
      filled,
      notFound,
      failed: [],
      skippedRule: [],
      optionMatches,
      unexpected,
      changedOutsideRows: unexpected,
      clicks: [...clickLog],
      forbiddenClicks: clickLog.filter((c) => !c.allowed),
      criticalClicks: clickLog.filter((c) => !c.allowed && CRITICAL_CLICK_RE.test(String(c.why || ""))),
      journeyNote: `stage 5M irctc ${VERSION}: results page — ${info.verdict}: ${String(info.reason || "").slice(0, 200)}`,
      trainClass: info,
    };
  }

  function detectJourneySearch(doc) {
    const found = {};
    const hosts = {};
    const meta = { stage: "journey-search", anchors: {} };
    for (const key of ["from", "to", "date", "classCode", "quota"]) {
      let host = hostByIdOrFcn(doc, JOURNEY_SEARCH_IDS[key], JOURNEY_SEARCH_FCN[key]);
      /* Mobile IRCTC sometimes omits id=journeyClass and only shows a p-dropdown whose
       * visible label is "All Classes" / "GENERAL". Fall back to that structural match —
       * still no fuzzy passenger matching; only the known search-form chrome. */
      if (!host && (key === "classCode" || key === "quota")) {
        const labelRe = key === "classCode"
          ? /\b(all\s*classes?|journey\s*class|travel\s*class|class)\b/i
          : /\b(general|quota|tatkal)\b/i;
        for (const w of doc.querySelectorAll(".p-dropdown, p-dropdown, [formcontrolname]")) {
          if (!isVisible(w) || isSensitive(w)) continue;
          const txt = norm(`${w.textContent || ""} ${w.getAttribute("aria-label") || ""} ${fcn(w)}`);
          const fc = fcn(w).toLowerCase();
          if (key === "classCode" && (fc === "journeyclass" || fc === "classcode" || fc === "travelclass")) { host = w; break; }
          if (key === "quota" && (fc === "quota" || fc === "journeyquota")) { host = w; break; }
          if (labelRe.test(txt) && (w.classList && w.classList.contains("p-dropdown") || w.querySelector && w.querySelector(".p-dropdown") || w.tagName === "P-DROPDOWN" || fcn(w))) {
            /* avoid grabbing passenger/berth dropdowns — search form only (no passengerName nearby) */
            if (w.closest && w.closest("[formcontrolname=passengerName], [formcontrolname=passengerBerthChoice]")) continue;
            host = w.classList && w.classList.contains("p-dropdown") ? w : (w.querySelector && w.querySelector(".p-dropdown")) || w;
            break;
          }
        }
        /* Stage 5M (v0.6.0): live NGeT's class row may use custom markup — neither .p-dropdown nor
         * [formcontrolname]. Detect it by its distinctive default label "All Classes" (quota: "All
         * Quotas"). Take the innermost visible match so the click lands on the trigger itself. */
        if (!host) {
          const want = key === "classCode" ? ["all classes"] : ["all quotas"];
          let best = null;
          for (const el of doc.querySelectorAll("div, button, span, [role='button'], li, a")) {
            if (!isVisible(el) || isSensitive(el) || el.children.length > 10) continue;
            if (!want.includes(norm(el.textContent || ""))) continue;
            if (el.closest && el.closest("[formcontrolname=passengerName], [formcontrolname=passengerBerthChoice]")) continue;
            if (!best || el.children.length < best.children.length) best = el;
          }
          if (best) host = best;
        }
      }
      meta.anchors[key] = host ? { id: host.id || null, formcontrolname: fcn(host) || null, tag: host.tagName.toLowerCase() } : "NOT FOUND";
      if (!host) continue;
      hosts[key] = host;
      if (key === "from" || key === "to" || key === "date") {
        const inp = inputInside(host);
        if (inp) found[`journey.${key === "classCode" ? "classCode" : key}`] = { kind: "native", el: inp, host, key };
      } else if (key === "classCode" || key === "quota") {
        const widget = dropdownInside(host) || (host.classList && host.classList.contains("p-dropdown") ? host : null);
        if (widget) found[`journey.${key}`] = { kind: "p-dropdown", el: widget, host, key };
        else {
          const sel = selectInside(host);
          if (sel) found[`journey.${key}`] = { kind: "select", el: sel, host, key };
          /* Stage 5M (v0.6.0): custom trigger (e.g. live NGeT's "All Classes" row) — no
           * p-dropdown/<select> inside; pickClassControl's custom-trigger path opens it and
           * picks the exact class option from the panel. */
          else found[`journey.${key}`] = { kind: "custom", el: host, host, key };
        }
      }
    }
    /* Normalize keys: journey.from / journey.to / journey.date / journey.classCode / journey.quota */
    const normalized = {};
    for (const [path, t] of Object.entries(found)) normalized[path] = t;
    return {
      stage: "journey-search",
      found: normalized,
      hosts,
      meta,
      detected: Object.keys(normalized),
      hasSearchForm: !!(normalized["journey.from"] || normalized["journey.to"] || normalized["journey.date"] || normalized["journey.classCode"]),
    };
  }

  async function fillJourneySearch(doc, payload) {
    clickLog.length = 0;
    const sensitive = guardSensitive(doc);
    const det = detectJourneySearch(doc);
    const before = snapshot(doc);
    const claimed = new Set();
    const filled = [], notFound = [], failed = [], skippedRule = [];
    const optionMatches = [];
    const j = (payload && payload.journey) || {};
    const wantQuota = j.quota != null && String(j.quota).trim() !== "";
    /* v1.2.0: the "Continue to IRCTC" tap = approval; auto-advance is ON unless the payload says off. */
    const autoAdvance = j.autoAdvance !== false;

    const plan = [
      { path: "journey.from", key: "from", name: j.from, code: j.fromCode },
      { path: "journey.to", key: "to", name: j.to, code: j.toCode },
      { path: "journey.date", key: "date", iso: j.date },
      { path: "journey.classCode", key: "classCode", code: j.classCode },
    ];
    if (wantQuota) plan.push({ path: "journey.quota", key: "quota", code: String(j.quota).trim().toUpperCase() });

    for (const step of plan) {
      const t = det.found[step.path];
      if (!t) { notFound.push(step.path); continue; }
      try {
        if (step.key === "from" || step.key === "to") {
          const needles = stationNeedles(step.name, step.code);
          if (!needles.length) { skippedRule.push(`${step.path}: empty station value`); continue; }
          const code = String(step.code || "").trim().toUpperCase();
          const name = String(step.name || "").trim();
          /* Type CODE first (IRCTC resolves codes fastest). Full "NAME - CODE" is applied by picking the list option. */
          const typed = code || name;
          const win = t.el.ownerDocument.defaultView;
          claimed.add(t.el);
          /* Open + focus the combobox the way a user would (click/focus), then type char-by-char so
           * p-autocomplete's filter runs. Never blur before pick — blur closes the list and Search dies. */
          try {
            t.el.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true, cancelable: true, view: win }));
            t.el.dispatchEvent(new win.MouseEvent("mouseup", { bubbles: true, cancelable: true, view: win }));
            t.el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, view: win }));
            t.el.dispatchEvent(new win.FocusEvent("focus", { bubbles: true }));
          } catch {
            try { t.el.dispatchEvent(new win.Event("focus", { bubbles: true })); } catch { /* */ }
          }
          /* v1.1.0: clear EVERY leftover autocomplete panel BEFORE typing this field. Keeping this
           * field's panel (old call) kept the PREVIOUS field's list open (From's ASR survived into the To
           * step) and the single-open-panel fallback then handed the wrong list to this field — which is
           * why To failed whenever From's own pick had been swallowed. */
          dismissStationPanels(doc, null);
          /* Clear then type each character (insertText) — bulk set often skips the suggestion fetch on live NGeT. */
          try {
            const proto = win.HTMLInputElement.prototype;
            const desc = Object.getOwnPropertyDescriptor(proto, "value");
            if (desc && desc.set) desc.set.call(t.el, ""); else t.el.value = "";
            t.el.dispatchEvent(new win.Event("input", { bubbles: true }));
          } catch { /* */ }
          let acc = "";
          for (const ch of String(typed)) {
            acc += ch;
            try {
              const proto = win.HTMLInputElement.prototype;
              const desc = Object.getOwnPropertyDescriptor(proto, "value");
              if (desc && desc.set) desc.set.call(t.el, acc); else t.el.value = acc;
              t.el.dispatchEvent(new win.InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: ch }));
            } catch {
              setNative(t.el, acc, { blur: false });
            }
            await sleepMs(40);
          }
          t.el.classList.add("filled");
          await sleepMs(80);
          /* Wait until THIS field's listbox options appear (network-backed on live IRCTC).
           * v0.6.0: 1400ms was too tight — To-station pick failed on device while From succeeded. */
          await waitForStationOptions(doc, needles, 2800, t.el, code);
          let pick = pickAutocompleteOption(doc, needles, { inputEl: t.el, code, name });
          if (!pick.ok) {
            await sleepMs(400);
            await waitForStationOptions(doc, needles, 1500, t.el, code);
            pick = pickAutocompleteOption(doc, needles, { inputEl: t.el, code, name });
          }
          if (!pick.ok && name && name.length >= 3) {
            /* Fallback: type station NAME if code did not open a usable list. */
            try {
              const proto = win.HTMLInputElement.prototype;
              const desc = Object.getOwnPropertyDescriptor(proto, "value");
              if (desc && desc.set) desc.set.call(t.el, ""); else t.el.value = "";
              t.el.dispatchEvent(new win.Event("input", { bubbles: true }));
              let a2 = "";
              for (const ch of name.slice(0, 16)) {
                a2 += ch;
                if (desc && desc.set) desc.set.call(t.el, a2); else t.el.value = a2;
                try { t.el.dispatchEvent(new win.InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: ch })); }
                catch { t.el.dispatchEvent(new win.Event("input", { bubbles: true })); }
                await sleepMs(35);
              }
            } catch { setNative(t.el, name, { blur: false }); }
            await waitForStationOptions(doc, needles, 2400, t.el, code);
            pick = pickAutocompleteOption(doc, needles, { inputEl: t.el, code, name });
          }
          /* v1.1.0: do NOT close THIS field's panel after a registered click — the click may still be
           * swallowed by the site (raw code left) and the retry below must re-pick from the SAME list.
           * Only the OTHER field's leftover overlay is closed. Own panel is closed after success. */
          if (pick.ok) {
            await sleepMs(120);
            dismissStationPanels(doc, t.el);
          }
          /* v1.1.0 station-pick-retry (device screenshot 20:03 — input stayed raw "ASR"):
           * the live site sometimes SWALLOWS the first option click (its Angular handler is not bound
           * yet) and the box keeps the bare code. Re-open THIS field's list and re-pick; trust ONLY the
           * readback. A raw code that never became a full label is a FAILURE — never reported as filled.
           * 3 attempts = 1 initial + 2 retries. */
          const STATION_ATTEMPTS = 3;
          let selected = stationLooksSelected(t.el, code, name);
          let attempts = 1;
          while (attempts < STATION_ATTEMPTS && !(pick.ok && selected)) {
            attempts += 1;
            /* Re-open + focus without blurring (blur closes the list and kills Search). */
            try {
              t.el.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true, cancelable: true, view: win }));
              t.el.dispatchEvent(new win.MouseEvent("mouseup", { bubbles: true, cancelable: true, view: win }));
              t.el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, view: win }));
              t.el.dispatchEvent(new win.FocusEvent("focus", { bubbles: true }));
            } catch { /* */ }
            /* Re-type the code char-by-char so the autocomplete re-queries (bulk set skips the fetch). */
            try {
              const p2 = win.HTMLInputElement.prototype;
              const d2 = Object.getOwnPropertyDescriptor(p2, "value");
              if (d2 && d2.set) d2.set.call(t.el, ""); else t.el.value = "";
              t.el.dispatchEvent(new win.Event("input", { bubbles: true }));
              await sleepMs(120 + attempts * 90);
              let acc2 = "";
              for (const ch of String(typed)) {
                acc2 += ch;
                if (d2 && d2.set) d2.set.call(t.el, acc2); else t.el.value = acc2;
                try { t.el.dispatchEvent(new win.InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: ch })); }
                catch { t.el.dispatchEvent(new win.Event("input", { bubbles: true })); }
                await sleepMs(40);
              }
            } catch { setNative(t.el, typed, { blur: false }); }
            dismissStationPanels(doc, t.el);
            await waitForStationOptions(doc, needles, 1200 + attempts * 700, t.el, code);
            pick = pickAutocompleteOption(doc, needles, { inputEl: t.el, code, name });
            selected = stationLooksSelected(t.el, code, name);
            if (!pick.ok && name && name.length >= 3) {
              /* Still nothing listed → try the station NAME once (same fallback as attempt 1). */
              try {
                const p3 = win.HTMLInputElement.prototype;
                const d3 = Object.getOwnPropertyDescriptor(p3, "value");
                if (d3 && d3.set) d3.set.call(t.el, ""); else t.el.value = "";
                t.el.dispatchEvent(new win.Event("input", { bubbles: true }));
                let a3 = "";
                for (const ch of name.slice(0, 16)) {
                  a3 += ch;
                  if (d3 && d3.set) d3.set.call(t.el, a3); else t.el.value = a3;
                  try { t.el.dispatchEvent(new win.InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: ch })); }
                  catch { t.el.dispatchEvent(new win.Event("input", { bubbles: true })); }
                  await sleepMs(35);
                }
              } catch { /* */ }
              await waitForStationOptions(doc, needles, 1500, t.el, code);
              pick = pickAutocompleteOption(doc, needles, { inputEl: t.el, code, name });
              selected = stationLooksSelected(t.el, code, name);
            }
          }
          if (pick.ok && selected) {
            await sleepMs(120);
            dismissStationPanels(doc, null);
            optionMatches.push({ path: step.path, key: step.key, requested: typed, matched: pick.option, ok: true, attempts, inputValue: String(t.el.value || "").slice(0, 80) });
            filled.push(step.path);
          } else {
            /* NOT filled — a bare code left in the box must never count as a successful fill (v1.1.0). */
            const why = pick.ok
              ? `clicked "${pick.option}" but input still "${String(t.el.value || "").slice(0, 40)}"`
              : (pick.reason || "no autocomplete option found");
            optionMatches.push({ path: step.path, key: step.key, requested: typed, matched: pick.option || null, ok: false, attempts, offered: pick.offered || null, reason: `${why} after ${attempts} attempt(s) — tap the station suggestion once`, inputValue: String(t.el.value || "").slice(0, 80) });
            failed.push(`${step.path}: ${why} after ${attempts} attempt(s) — tap the station suggestion once`);
          }
        } else if (step.key === "date") {
          if (!isoToDmyParts(step.iso)) { skippedRule.push(`${step.path}: invalid ISO date`); continue; }
          const dr = await setNativeDate(t.el, step.iso, t.host);
          if (!dr || !dr.ok) {
            const restoreNote = dr && dr.restored ? ` · restored "${dr.restored}" so Search stays usable` : "";
            failed.push(`${step.path}: could not bind date (payload ${step.iso} → wrote ${dr && dr.written || "?"} · input now "${dr && dr.readback || ""}" · ${dr && dr.calendar && dr.calendar.reason || dr && dr.reason || "unconfirmed"}${restoreNote})`);
            optionMatches.push({ path: step.path, key: step.key, requested: step.iso, written: dr && dr.written || null, readback: dr && dr.readback || null, ok: false, method: dr && dr.method || null, reason: dr && dr.reason || "bind failed", restored: dr && dr.restored || null });
            if (dr && (dr.written || dr.restored)) claimed.add(t.el);
            continue;
          }
          claimed.add(t.el);
          filled.push(step.path);
          optionMatches.push({ path: step.path, key: step.key, requested: step.iso, written: dr.written, readback: dr.readback, ok: true, method: dr.method, stuckOnDefault: !!dr.stuckOnDefault });
        } else if (step.key === "classCode" || step.key === "quota") {
          const code = String(step.code || "").trim().toUpperCase();
          if (!code) { skippedRule.push(`${step.path}: empty value`); continue; }
          if (step.key === "classCode") {
            const r = await pickClassControl(t.host, code);
            if (r.ok) {
              claimed.add(t.el);
              if (t.host) claimed.add(t.host);
              for (const sel of (t.host || t.el).querySelectorAll ? (t.host || t.el).querySelectorAll("select") : []) claimed.add(sel);
              /* v0.7.0: if the trigger sits inside a .p-dropdown, picking an option legitimately
               * updates the dropdown's label — that is OUR change, not an "unexpected" one. */
              const scopeEl = t.host || t.el;
              try {
                const pdAnc = scopeEl.closest ? scopeEl.closest(".p-dropdown") : null;
                if (pdAnc) claimed.add(pdAnc);
                for (const pd2 of scopeEl.querySelectorAll(".p-dropdown")) claimed.add(pd2);
              } catch { /* */ }
              filled.push(step.path);
              optionMatches.push({ path: step.path, key: step.key, requested: code, matched: r.option, ok: true });
            } else {
              failed.push(`${step.path}: ${r.reason}`);
              optionMatches.push({ path: step.path, key: step.key, requested: code, ok: false, reason: r.reason, offered: r.offered || null });
            }
          } else {
            /* quota — only when explicitly in payload; same dropdown/select machinery as class */
            const r = await pickClassControl(t.host, code);
            if (r.ok) {
              claimed.add(t.el);
              filled.push(step.path);
              optionMatches.push({ path: step.path, key: step.key, requested: code, matched: r.option, ok: true });
            } else {
              failed.push(`${step.path}: ${r.reason}`);
              optionMatches.push({ path: step.path, key: step.key, requested: code, ok: false, reason: r.reason });
            }
          }
        }
      } catch (e) {
        failed.push(`${step.path}: ${String((e && e.message) || e).slice(0, 80)}`);
      }
    }

    /* Quota host may exist on the page but payload has no quota → report as skipped (not filled, not failed). */
    if (!wantQuota && det.found["journey.quota"]) {
      skippedRule.push("journey.quota: not in approved payload — left unchanged (never defaulted)");
    }

    const after = snapshot(doc);
    const unexpected = diffSnapshot(before, after, claimed);
    const forbiddenClicks = clickLog.filter((c) => !c.allowed);
    /* v1.2.0 AUTO-SEARCH — after the diff (so the site's own re-render is not flagged as an
     * unexpected change). Gate: From + To + Date must be READBACK-VERIFIED; a half-filled form is
     * never searched. Class is reported but not required (the results card selects it exactly). */
    let advanceSearch = { clicked: false, reason: "auto-advance payload me off hai" };
    if (autoAdvance) {
      const okOf = (k) => { const m = optionMatches.find((x) => x.key === k); return !!(m && m.ok); };
      const missing = ["from", "to", "date"].filter((k) => !okOf(k));
      if (missing.length) {
        advanceSearch = { clicked: false, reason: `journey ${missing.join(", ")} verified nahi hua — Search khud nahi dabaya` };
      } else {
        const sb = findSearchButton(doc, det);
        if (sb.ok && clickAllowed(sb.el, "journey-advance-search", { scope: sb.scope, verified: true })) {
          advanceSearch = { clicked: true, text: String(clickText(sb.el)).slice(0, 30) };
          await sleepMs(600);
        } else {
          advanceSearch = { clicked: false, reason: sb.reason || "Search click guard ne refuse kiya" };
        }
      }
    }
    return {
      version: VERSION,
      stage: "journey-search",
      rows: 0,
      rowAnchors: [],
      sensitiveCount: sensitive.length,
      requestedPassengerRows: (payload && payload.passengers ? payload.passengers.length : 0),
      rowsAvailable: 0,
      rowsMissing: 0,
      detected: det.detected,
      filled,
      notFound,
      failed,
      skippedRule,
      optionMatches,
      unexpected,
      changedOutsideRows: unexpected,
      clicks: [...clickLog],
      forbiddenClicks,
      criticalClicks: clickLog.filter((c) => !c.allowed && CRITICAL_CLICK_RE.test(String(c.why || ""))),
      journeyNote: `stage 5L.2 irctc ${VERSION}: From/To/Date/Class — search=${advanceSearch.clicked ? "AUTO-CLICKED (" + String(advanceSearch.text || "Search") + ")" : "not-clicked: " + String(advanceSearch.reason || "").slice(0, 60)} · Pay/Login NEVER · payload.date=${String(j.date || "").trim() || "∅"} · dateWrite=${(optionMatches.find((m) => m.key === "date") || {}).written || "—"} · readback=${(optionMatches.find((m) => m.key === "date") || {}).readback || "—"} · fromPick=${(() => { const m = optionMatches.find((x) => x.key === "from"); return m ? (m.ok ? "ok:"+String(m.matched||"").slice(0,40) : "fail:"+String(m.reason||"").slice(0,50))+(m.attempts>1?("(x"+m.attempts+")"):"") : "—"; })()} · toPick=${(() => { const m = optionMatches.find((x) => x.key === "to"); return m ? (m.ok ? "ok:"+String(m.matched||"").slice(0,40) : "fail:"+String(m.reason||"").slice(0,50))+(m.attempts>1?("(x"+m.attempts+")"):"") : "—"; })()}`,
      journeySearch: det.meta,
      advanceSearch,
    };
  }

  root.RailBookPocIrctc = { VERSION, detectIrctc, pickFlagTarget, fillIrctc, contactAnchor, flagAnchors, verifyIrctc, anchorDiagnostic, guardSensitive, snapshot, clickLog, KEYS, mapValue, passengerRows, clickAllowed, FOOD_KEY, FOOD_OPTIONS, foodSelectFor, ensurePassengerRows, addPassengerControl, selectTrainAndClass, detectJourneySearch, fillJourneySearch, JOURNEY_SEARCH_IDS };
})(typeof window !== "undefined" ? window : globalThis);
