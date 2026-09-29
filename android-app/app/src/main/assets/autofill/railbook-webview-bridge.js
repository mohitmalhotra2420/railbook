/* RailBook WebView bridge — NO Chrome extension.
 * Runs inside the RailBook Android/iOS WebView on https://www.irctc.co.in only.
 *
 * Flow the passenger sees:
 *   1. Open RailBook app → enter From/To/Date/Class + passengers (same as web).
 *   2. Tap “Continue to IRCTC” → app opens IRCTC inside the WebView and injects this bridge
 *      WITH the approved payload (Continue tap = explicit approval).
 *   3. Bridge fills journey + passenger fields via the same engines as the POC
 *      (fieldmap.js + irctc-passenger.js). NEVER Search / Book / Pay / login / OTP / CAPTCHA.
 *   4. Passenger verifies, logs in, searches, books, pays on IRCTC themselves.
 *
 * Hosted only as an app asset — never as a public bookmarklet that auto-runs on bare IRCTC.
 */
(function (root) {
  "use strict";

  const BRIDGE_VERSION = "0.9.0-prewarm";   // v1.2.4: language-screen auto-pick + prewarm step events (login-reached)
  const IRCTC_HOST = "www.irctc.co.in";
  const STORAGE_MEM_KEY = "__railbookWebViewPayload";
  const APPROVAL_MEM_KEY = "__railbookWebViewApproval";
  const APPROVAL_MAX_MS = 15 * 60 * 1000;

  const FORBIDDEN_CLICK_RE =
    /\b(search|book|pay|payment|login|sign\s*in|otp|captcha|submit|confirm\s*payment|upi|wallet|netbanking)\b/i;
  /* v1.2.0: the ONLY two bookish-looking, explicitly approved clicks — both navigation-only and both
   * behind engine predicates (verified journey for Search; verified train+class selection for Book Now).
   * Everything else that looked bookish still trips the hard-stop net below. */
  const APPROVED_ADVANCE_WHYS = new Set(["journey-advance-search", "train-book-now"]);

  function hostOk() {
    try {
      return String(location.hostname || "").toLowerCase() === IRCTC_HOST &&
        String(location.protocol || "") === "https:";
    } catch (_) {
      return false;
    }
  }

  /* Round-28 (user screenshot 1: "yeh black wala handoff details user ko nhi dikhni chahiye, backend pe
   * rakho"). Pehle poora diagnostic box (Detected/Filled/read-only notes) page par ek bade black panel me
   * dikhta tha. Ab:
   *   • saara detail backend ko jaata hai (native status bar + log + fill-result event) — kuch chhupta nahi,
   *   • page par sirf EK chhoti one-line pill (4-6s me khud hat jaati hai), aur wahi text native Toast
   *     me bhi jaata hai ("ui-notice") taaki user ko dobara daalne ki zaroorat na pade — sirf pata chale.
   * STOP/reject jaise serious message pill me thoda lambe waqt tak rehte hain (par details phir bhi nahi). */
  function paxFilledNow(filled) {
    return (filled || []).some(function (f) { return String(f).indexOf("passengers.") === 0; });
  }

  let __noticeTimer = null;
  let __noticeDetails = [];

  function postNotice(text, opts) {
    const o = opts || {};
    try {
      __noticeDetails.push(String(text).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
      postNative({ type: "ui-notice", text: o.toastText || String(text).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(), toast: o.toast !== false });
    } catch (_) { /* ignore */ }
    return pill(o.pillText || text, o.ms || (o.sticky ? 12000 : 6000));
  }

  function pill(html, ms) {
    try {
      let el = document.getElementById("railbook-webview-banner");
      if (!el) {
        el = document.createElement("div");
        el.id = "railbook-webview-banner";
        el.setAttribute("role", "status");
        el.style.cssText =
          "position:fixed;z-index:2147483646;left:10px;right:10px;bottom:10px;pointer-events:none;" +
          "background:rgba(15,23,42,.92);color:#e2e8f0;font:12.5px/1.4 system-ui,sans-serif;padding:9px 12px;" +
          "border-radius:999px;box-shadow:0 6px 22px rgba(0,0,0,.35);border:1px solid #334155;text-align:center;";
        (document.body || document.documentElement).appendChild(el);
      }
      el.innerHTML = html;
      el.style.display = "block";
      if (__noticeTimer) clearTimeout(__noticeTimer);
      __noticeTimer = setTimeout(function () {
        try { el.style.display = "none"; } catch (_) {}
      }, ms);
    } catch (_) { /* ignore */ }
  }

  /** Purana naam — ab sirf one-line pill (koi details list nahi). Diagnostic text backend jaata hai. */
  function banner(html, opts) {
    return postNotice(html, opts);
  }

  function li(arr) {
    return arr && arr.length ? arr.join(", ") : "—";
  }

  /* v0.6.0 (Stage 5M): current page STAGE on the IRCTC SPA. IRCTC mobile web reuses the SAME
   * pathname for journey-search → results → passenger, so stage comes from DOM shape, not URL.
   * Stage names double as pageKey prefixes (see runFillOnce / pathWatch). */
  function detectCurrentStageName() {
    try {
      const doc = document;
      if (doc.querySelector('[formcontrolname="passengerName"], [formcontrolname="passenger_name"]')) return "passenger";
      const btns = doc.querySelectorAll("button, [role='button'], a");
      for (const el of btns) {
        const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        if (!r || r.width < 2) continue;
        const t = (el.textContent || "").trim().toLowerCase();
        /* v1.2.0: live results cards print the fare inside the button ("book now ₹330") — the old
         * exact match missed it, so the stage looked like "other" and the whole results-class fill was
         * skipped (class chip + availability date + Book Now never ran). Prefix match, same intent. */
        if (/^book(\s*now)?\b/.test(t)) return "results-class";
      }
      const o = doc.querySelector('input[id="origin"], [formcontrolname="origin"], input[id="destination"], [formcontrolname="destination"]');
      if (o) {
        const r = o.getBoundingClientRect ? o.getBoundingClientRect() : null;
        if (!r || r.width > 2) return "journey-search";
      }
      return "other";
    } catch (_) { return "other"; }
  }

  /* v1.2.4 PREWARM: IRCTC login page detector. Pehchan = visible username/userid + password
   * controls (IRCTC ke login form ke formcontrolname/id). Yeh page prewarm ka ENDPOINT hai —
   * yahan se aage (login/OTP/pay) sab user khud, hard policy. */
  function detectLoginPage(doc) {
    try {
      const pwd = doc.querySelector('input[type="password"]');
      if (!pwd) return false;
      const r = pwd.getBoundingClientRect ? pwd.getBoundingClientRect() : null;
      if (r && r.width < 2) return false;
      const uid = doc.querySelector(
        '[formcontrolname="userid"], [formcontrolname="userName"], input[id="userid"], input[name="userid"], input[id="username"], input[name="username"], input[autocomplete="username"]'
      );
      return !!uid;
    } catch (_) { return false; }
  }
  let loginReported = false;

  function approvalFresh(token, payload) {
    if (!token || token.consumed === true || token.v !== 1) return false;
    if (token.source !== "railbook-app-continue") return false;
    const at = Number(token.at) || 0;
    if (!at || Date.now() - at > APPROVAL_MAX_MS) return false;
    if (token.createdAt && payload && payload.createdAt &&
        String(token.createdAt) !== String(payload.createdAt)) return false;
    return true;
  }

  /* v0.7.0 — PROPORTIONAL response to unexpected value changes. The live Angular site
   * legitimately model-syncs hidden fields / checkboxes / dropdown labels right after our
   * writes (device test v0.6.0 showed this killing the whole flow + consuming the token,
   * so the results page and passenger page never got a fill). Hard-stop ONLY when the
   * changed control looks sensitive (auth / PII / payment); everything else is reported as
   * information and the approval stays live for the next page. v0.8.0 adds: refused clicks
   * (engine tried, guard said NO, NOTHING clicked) are NOT incidents either — except on the
   * results stage (train card area), where unexpected structure means "click nothing". */
  const UNEXPECTED_HARD_RE = /password|passwd|otp|one-time|cvv|card|upi|netbanking|wallet|username|login|signin|email|mobile|phone|aadhaar|bank/i;
  function isUnexpectedHard(u) {
    try {
      if (u && u.tag === "input" && u.type === "password") return true;
      const hay = [u.id, u.name, u.formcontrolname, u.type, u.text, u.tag].filter(Boolean).join(" ");
      return UNEXPECTED_HARD_RE.test(hay);
    } catch (_) { return true; } /* unknown shape → safe default: treat as hard */
  }
  const CRITICAL_CLICK_WHY_RE = /^(train-class|train-expand|train-avl-date|train-card-refresh)$/;

  function postNative(msg) {
    try {
      if (root.RailBookNative && typeof root.RailBookNative.onBridgeEvent === "function") {
        root.RailBookNative.onBridgeEvent(JSON.stringify(msg));
      }
    } catch (_) { /* ignore */ }
    try {
      root.postMessage(JSON.stringify(msg), "*");
    } catch (_) { /* ignore */ }
  }

  function getEngines() {
    const FM = root.RailBookPocFieldMap;
    const IR = root.RailBookPocIrctc;
    return { FM, IR };
  }

  function validateOrNull(raw) {
    const { FM } = getEngines();
    if (!FM || typeof FM.validatePayload !== "function") return { ok: false, errors: ["fieldmap missing"] };
    return FM.validatePayload(raw);
  }

  /**
   * App calls this once after Continue to IRCTC (explicit user gesture).
   * payloadJson: handoff-shaped object or JSON string (kind railbook-autofill-test).
   */
  function setApprovedPayload(payloadJson, meta) {
    if (!hostOk()) {
      return { ok: false, error: "bridge only runs on https://www.irctc.co.in" };
    }
    let raw = payloadJson;
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch (e) {
        return { ok: false, error: "payload JSON parse failed" };
      }
    }
    const v = validateOrNull(raw);
    if (!v.ok) {
      postNative({ type: "payload-rejected", errors: v.errors });
      banner("RailBook: details IRCTC par bhej nahi paaye — RailBook me dobara Continue to IRCTC dabaiye.", {
        pillText: "⚠️ Handoff fail — RailBook me dobara Continue dabaiye (" + li(v.errors) + ")",
        sticky: true,
      });
      return { ok: false, errors: v.errors };
    }
    const approval = {
      v: 1,
      at: Date.now(),
      createdAt: String(v.payload.createdAt || ""),
      source: "railbook-app-continue",
      consumed: false,
      filledPages: [],
      app: (meta && meta.app) || "railbook-android",
    };
    try {
      root[STORAGE_MEM_KEY] = v.payload;
      root[APPROVAL_MEM_KEY] = approval;
      /* sessionStorage backup inside the WebView only (same tab). No cookies, no network. */
      try {
        sessionStorage.setItem(STORAGE_MEM_KEY, JSON.stringify(v.payload));
        sessionStorage.setItem(APPROVAL_MEM_KEY, JSON.stringify(approval));
      } catch (_) { /* private mode */ }
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
    postNative({
      type: "payload-accepted",
      passengers: v.payload.passengers.length,
      journeyDate: v.payload.journey.date,
      bridge: BRIDGE_VERSION,
    });
    banner(
      "✅ Aapki details IRCTC par khud bhar rahi hain — " + v.payload.passengers.length + " passenger · " +
      v.payload.journey.date + ". Yahan dobara kuch daalne ki zaroorat nahi (login/OTP/payment aap hi).",
      { pillText: "✅ Details khud bhar rahi hain… (" + v.payload.passengers.length + " pax · " + v.payload.journey.date + ")" }
    );
    scheduleAutoFill();
    return { ok: true, passengers: v.payload.passengers.length };
  }

  function loadStored() {
    let payload = root[STORAGE_MEM_KEY];
    let token = root[APPROVAL_MEM_KEY];
    if (!payload || !token) {
      try {
        const p = sessionStorage.getItem(STORAGE_MEM_KEY);
        const t = sessionStorage.getItem(APPROVAL_MEM_KEY);
        if (p) payload = JSON.parse(p);
        if (t) token = JSON.parse(t);
        if (payload) root[STORAGE_MEM_KEY] = payload;
        if (token) root[APPROVAL_MEM_KEY] = token;
      } catch (_) { /* ignore */ }
    }
    return { payload, token };
  }

  function markPageFilled(pageKey, paxFilled) {
    const { token } = loadStored();
    if (!token) return;
    const pages = Array.isArray(token.filledPages) ? token.filledPages.slice() : [];
    if (!pages.includes(pageKey)) pages.push(pageKey);
    token.filledPages = pages.slice(-12);
    token.lastFillPage = location.pathname;
    token.lastFillAt = Date.now();
    if (paxFilled) {
      token.consumed = true;
      token.consumedAt = Date.now();
      token.consumedReason = "passenger-fields-filled";
    }
    root[APPROVAL_MEM_KEY] = token;
    try { sessionStorage.setItem(APPROVAL_MEM_KEY, JSON.stringify(token)); } catch (_) {}
  }

  /* v1.2.1: one fill at a time. The stage watcher can re-arm (results → passenger) while the previous
   * run is still awaiting the site's availability / Book-Now reaction; two overlapping runs share the
   * same DOM + click log and used to misfire or drop the next stage entirely. */
  let runInFlight = false;
  async function runFillOnce() {
    if (runInFlight) return { ok: false, reason: "run-in-flight" };
    runInFlight = true;
    try {
      return await runFillOnceInner();
    } finally {
      runInFlight = false;
    }
  }

  async function runFillOnceInner() {
    if (!hostOk()) return { ok: false, reason: "bad-host" };
    const { FM, IR } = getEngines();
    if (!FM || !IR) return { ok: false, reason: "engines-missing" };

    const { payload, token } = loadStored();
    if (!payload) return { ok: false, reason: "no-payload" };
    if (!approvalFresh(token, payload)) {
      return {
        ok: false,
        reason: !token ? "no-approval" : token.consumed ? "consumed" : "stale",
      };
    }
    /* v1.2.4 PREWARM — IRCTC ki language-selection screen sabse pehle handle hoti hai
     * (journey fill se pehle). Target language native pref se aati hai (__railbookLangPref,
     * ya payload.appLanguage): English/Hinglish → English · Hindi → Hindi.
     * Sirf language control click hota hai — click guard yahan bhi lagu. */
    const LG = root.RailBookPocLanguage;
    if (LG && typeof LG.detectLanguageScreen === "function") {
      const scr = LG.detectLanguageScreen(document);
      if (scr.found) {
        const pref = root.__railbookLangPref || (payload && payload.appLanguage) || "";
        const pick = LG.pickLanguage(document, pref);
        postNative({
          type: "prewarm-step", step: "language", target: pick.target,
          clicked: pick.clicked === true, reason: pick.reason || null, text: pick.text || null,
        });
        /* v1.2.5: live IRCTC me language dialog booking form KE UPAR aata hai — form ka partial
         * fill pehle hi "filled" mark ho chuka ho sakta hai. Dialog band hone ke baad journey fill
         * dobara chale, isliye is pathname ke filled-marks reset karo. */
        if (pick.clicked === true) {
          const st = loadStored();
          if (st.token && Array.isArray(st.token.filledPages)) {
            st.token.filledPages = st.token.filledPages.filter((k) => !String(k).startsWith(location.pathname + "::"));
            root[APPROVAL_MEM_KEY] = st.token;
            try { sessionStorage.setItem(APPROVAL_MEM_KEY, JSON.stringify(st.token)); } catch (_) { /* */ }
          }
        }
        return { ok: true, reason: "language-selected", stage: "language", langPick: pick };
      }
    }
    /* v1.2.4 PREWARM — login page = prewarm ka endpoint. Fill/click kuch nahi; user khud
     * login karega (sealed zone). Native ko "login-reached" batao taaki countdown reveal ho. */
    if (detectLoginPage(document)) {
      if (!loginReported) {
        loginReported = true;
        postNative({ type: "prewarm-step", step: "login-reached" });
      }
      return { ok: false, reason: "login-page-awaiting-user", stage: "login" };
    }

    const pagesDone = Array.isArray(token.filledPages) ? token.filledPages : [];
    /* v0.6.0 (Stage 5M): IRCTC SPA reuses the same pathname for search → results → passenger, so
     * skip per STAGE (pageKey prefix), not per pathname. Passenger keeps its historic "form"
     * prefix (the engine's passenger result carries no stage field). Unknown stages keep the old
     * conservative whole-pathname behaviour. */
    const stageNow = detectCurrentStageName();
    const stagePrefix = stageNow === "passenger" ? "form" : stageNow;
    const alreadyFilled = stageNow === "other"
      ? pagesDone.some((k) => String(k).startsWith(location.pathname + "::"))
      : pagesDone.some((k) => String(k).startsWith(location.pathname + "::" + stagePrefix));
    if (alreadyFilled) return { ok: false, reason: "page-already-filled" };

    /* Passenger rows (same as extension path) — skip on journey search. */
    let passengerAdd = null;
    const want = (payload.passengers || []).length;
    const have = IR.detectIrctc(document).rows;
    const onJourneySearch =
      have === 0 && IR.detectJourneySearch && IR.detectJourneySearch(document).hasSearchForm;
    if (onJourneySearch) {
      passengerAdd = {
        requested: want, rowsBefore: 0, rowsAfter: 0, needsAdd: false,
        stopReason: "journey-search stage — passenger rows later", stage: "journey-search",
      };
    } else if (want > have && IR.ensurePassengerRows) {
      passengerAdd = await IR.ensurePassengerRows(document, want, {});
    }

    const res = await Promise.resolve(IR.fillIrctc(document, payload));
    if (passengerAdd) res.passengerAdd = passengerAdd;

    /* v0.7.0/v0.8.0 — proportional safety (device evidence v0.6.0 + v0.7.0):
     * HARD STOP only for (a) sensitive-control value changes, (b) refused clicks on the
     * RESULTS stage (train card area), or (c) forbidden clicks that actually happened.
     * Non-sensitive site-side changes and form-stage click refusals = information only —
     * the approval stays live so the next page (results chip / passenger) still gets filled. */
    const unexpectedAll = res.unexpected || [];
    const forbiddenAll = res.forbiddenClicks || [];
    const criticalClicks = res.criticalClicks || forbiddenAll.filter((c) => CRITICAL_CLICK_WHY_RE.test(String((c && c.why) || "")));
    const hardU = unexpectedAll.filter(isUnexpectedHard);
    if (hardU.length || criticalClicks.length) {
      const detail = (hardU.length ? hardU : criticalClicks.map((f) => ({ tag: "click", text: f.why || "" })))
        .slice(0, 3)
        .map((u) => u.tag + (u.id ? "#" + u.id : "") + (u.text ? " “" + String(u.text).slice(0, 30) + "”" : ""))
        .join(" · ");
      banner("Autofill ruk gaya (safety) — RailBook me dobara Continue to IRCTC dabaiye.", {
        pillText: "⚠️ Autofill ruk gaya — RailBook me dobara Continue dabaiye",
        sticky: true,
      });
      try { console.warn("[RailBook] fill stopped (unexpected change):", detail || "forbidden click"); } catch (_) {}
      postNative({
        type: "fill-stopped-unexpected",
        forbidden: criticalClicks.length,
        hard: hardU.slice(0, 3).map((u) => ({ tag: u.tag, id: u.id || null, name: u.name || null, text: String(u.text || "").slice(0, 40), v0: String(u.value0 || "").slice(0, 30), v1: String(u.value1 || "").slice(0, 30) })),
      });
      token.consumed = true;
      token.consumedReason = "unexpected-change";
      root[APPROVAL_MEM_KEY] = token;
      try { sessionStorage.setItem(APPROVAL_MEM_KEY, JSON.stringify(token)); } catch (_) {}
      return { ok: false, reason: "unexpected-change", res };
    }

    if (!res.detected || !res.detected.length) {
      return { ok: false, reason: "no-fields-yet", res };
    }

    /* Belt: refuse if click log somehow named a forbidden control (defense in depth). */
    const badClicks = (res.clicks || []).filter(
      (c) => c && c.allowed && !APPROVED_ADVANCE_WHYS.has(String(c.why || ""))
        && FORBIDDEN_CLICK_RE.test(String(c.why || c.name || c.text || ""))
    );
    if (badClicks.length) {
      banner("Autofill ruk gaya (safety) — RailBook me dobara Continue to IRCTC dabaiye.", {
        pillText: "⚠️ Autofill ruk gaya — RailBook me dobara Continue dabaiye",
        sticky: true,
      });
      try { console.warn("[RailBook] forbidden click attempted — flow stopped"); } catch (_) {}
      postNative({ type: "fill-stopped-forbidden-click" });
      return { ok: false, reason: "forbidden-click", res };
    }

    /* v1.2.0: the two verified navigation-only auto steps (Search Trains / Book Now). Reported in the
     * banner + native status line; both are ALLOWED clicks (never refusals), and the reason is shown
     * honestly when the gate did not pass. */
    const advanceClicks = (res.clicks || []).filter(
      (c) => c && c.allowed && (c.why === "journey-advance-search" || c.why === "train-book-now")
    );
    const advanceLines = [
      advanceClicks.some((c) => c.why === "journey-advance-search")
        ? '<span style="color:#86efac">✓ Search khud chala — train list khul gayi</span>' : "",
      advanceClicks.some((c) => c.why === "train-card-refresh")
        ? '<span style="color:#86efac">✓ Class chip pehle refresh hui (Refresh ⟳) — phir chip tap → Book Now active</span>' : "",
      (res.advanceBook && res.advanceBook.clicked && res.advanceBook.verified !== false)
        ? '<span style="color:#86efac">✓ Book Now khud tap hua → passenger form (login/OTP/Pay aap)</span>' : "",
      (res.advanceBook && res.advanceBook.clicked && res.advanceBook.verified === false)
        ? '<span style="color:#fbbf24">⚠ Book Now tap kiya par passenger form khula nahi — ek baar manual check karein</span>' : "",
      (res.advanceSearch && !res.advanceSearch.clicked)
        ? '<span style="color:#94a3b8">Search auto nahi chala: ' + String(res.advanceSearch.reason || "").slice(0, 80) + "</span>" : "",
      (res.advanceBook && !res.advanceBook.clicked)
        ? '<span style="color:#94a3b8">Book Now auto nahi daba: ' + String(res.advanceBook.reason || "").slice(0, 80) + "</span>" : "",
    ].filter(Boolean).join("<br>");

    /* Round-21b (25 Sep, user: "RailBook me dikh raha tha par IRCTC me nahi — kuch bhi fake nahi"):
     * Agar RailBook ke form me Food choice thi par IRCTC ke booking page par wo option hi maujood nahi
     * (kuch trains/classes me IRCTC khud nahi deta), to ye saaf-saaf batao — chup-chaap skip nahi. */
    const foodMiss = (res.notFound || []).some((n) => /passengers\.\d+\.food/.test(String(n)));

    const filled = res.filled || [];
    const fillStage = filled.length
      ? (res.failed?.length || res.notFound?.length || res.skippedRule?.length
        ? "webview-auto-fill-with-skips"
        : "webview-auto-fill-completed")
      : "webview-auto-fill-nothing-written";

    /* Round-28: page par sirf ek chhoti line; poori diagnostic list native ko (postNative niche). */
    const filledOnPax = fillStage.indexOf("passenger") === 0 || paxFilledNow(filled);
    banner(
      filledOnPax
        ? "✅ Aapki details IRCTC par bhar di gayi hain — yahan dobara kuch daalne ki zaroorat nahi. Sirf login/OTP/payment aap karenge."
        : filled.length
          ? "RailBook: " + filled.length + " field auto-fill ho gayi — aap aage badh sakte hain."
          : "RailBook: is page par abhi koi field nahi mili — aap aage badhiye, next page par khud bharega.",
      {
        pillText: filledOnPax
          ? "✅ Details bhar di gayi hain — dobara daalne ki zaroorat nahi"
          : "RailBook: " + filled.length + " field auto-fill ✓",
        toastText: filledOnPax
          ? "✅ Aapki details IRCTC par bhar di gayi hain — yahan dobara kuch daalne ki zaroorat nahi. Sirf login/OTP/payment aap karenge."
          : "RailBook: " + filled.length + " field auto-fill ho gayi.",
      }
    );

    const pageKey = location.pathname + "::" + (res.stage || "form");
    const paxFilled = filled.some((f) => String(f).startsWith("passengers."));
    /* v0.6.0: the results card may still be rendering when the first fill pass runs — if nothing
     * was written on a results-class page, leave it unmarked so the stage watcher can retry. */
    if (!(filled.length === 0 && res.stage === "results-class")) markPageFilled(pageKey, paxFilled);

    postNative({
      type: "fill-result",
      ok: filled.length > 0,
      fillStage,
      filledCount: filled.length,
      path: location.pathname,
      stage: res.stage || null,
      bridge: BRIDGE_VERSION,
      irVersion: IR.VERSION || null,
      /* v0.7.0/v0.8.0: native status line diagnostics. */
      /* v1.1.0: station steps now report honestly (raw code = failure), so two station entries alone
       * could push the class/date diagnostics out of the native status line. Keep 4. */
      failed: (res.failed || []).slice(0, 4),
      notFound: (res.notFound || []).slice(0, 2),
      siteChanges: unexpectedAll.length,
      refusedClicks: forbiddenAll.length,
      /* v1.2.0: verified auto-advance outcome (search → train list, book → passenger form).
       * v1.2.1: + class-chip refresh (Refresh ⟳) that must run before the chip tap on the live card. */
      advance: {
        search: res.advanceSearch || null,
        book: res.advanceBook || null,
        refresh: (res.trainClass && res.trainClass.refresh) || null,
      },
      /* v1.2.0: MainActivity already mirrors the consume on this flag — it was simply never sent. */
      paxFilled: paxFilled === true,
    });

    return { ok: filled.length > 0, reason: fillStage, res, pageKey, paxFilled };
  }

  let sched = { started: false, done: false, attempts: 0, waits: 0, timer: null, pathWatch: null };

  function scheduleAutoFill() {
    if (!hostOk()) return;
    if (sched.timer) { clearTimeout(sched.timer); sched.timer = null; }
    sched.done = false;
    sched.attempts = 0;
    sched.waits = 0;
    sched.started = true;

    const tryFill = async () => {
      sched.timer = null;
      if (sched.done) return;
      sched.attempts += 1;
      const stageBefore = detectCurrentStageName();
      try {
        const out = await runFillOnce();
        /* v1.2.1: the page can advance WHILE a run is in flight (the app taps Book Now itself, so the
         * results card becomes the passenger form mid-run). Such a run belongs to the old stage — re-arm
         * for the new one instead of stopping, otherwise the passenger fill would never happen. */
        const stageAfter = detectCurrentStageName();
        if (stageAfter !== stageBefore) {
          sched.done = false;
          sched.attempts = 0;
          sched.waits = 0;
          if (sched.timer) clearTimeout(sched.timer);
          sched.timer = setTimeout(tryFill, 600);
          return;
        }
        /* v1.2.1: an in-flight overlap is not a failure and must not eat the retry budget. */
        if (!out.ok && out.reason === "run-in-flight") {
          sched.attempts = Math.max(0, sched.attempts - 1);
          sched.waits += 1;
          if (sched.waits < 80) { sched.timer = setTimeout(tryFill, 700); return; }
        }
        if (!out.ok && out.reason === "no-fields-yet" && sched.attempts < 16) {
          sched.timer = setTimeout(tryFill, 700);
          return;
        }
        /* v0.6.0 (Stage 5M): results card still rendering → retry a few times. The train card's
         * class tabs appear a beat after "Book Now"; only the results-class stage retries here. */
        if (!out.ok && out.reason === "webview-auto-fill-nothing-written" &&
            out.res && out.res.stage === "results-class" && sched.attempts < 8) {
          sched.timer = setTimeout(tryFill, 1200);
          return;
        }
        if (!out.ok && (out.reason === "no-payload" || out.reason === "no-approval") && sched.attempts < 10) {
          sched.timer = setTimeout(tryFill, 600);
          return;
        }
        if (out.reason === "page-already-filled" || out.reason === "consumed" || out.reason === "stale") {
          sched.done = true;
          return;
        }
        if (out.reason && out.reason !== "no-fields-yet") {
          sched.done = true;
        }
      } catch (e) {
        postNative({ type: "fill-exception", err: String(e && e.message || e).slice(0, 80) });
        sched.done = true;
      }
    };

    sched.timer = setTimeout(tryFill, 500);

    if (!sched.pathWatch) {
      let lastKey = null;
      sched.pathWatch = setInterval(() => {
        const { payload, token } = loadStored();
        if (!approvalFresh(token, payload)) return;
        /* v0.6.0 (Stage 5M): watch PATHNAME + STAGE — IRCTC SPA keeps the same pathname when the
         * results card (or the passenger form) replaces the search form, so pathname alone never
         * re-arms the fill on the results page. */
        const stageNow = detectCurrentStageName();
        const watchKey = location.pathname + "::" + stageNow;
        if (watchKey === lastKey) return;
        lastKey = watchKey;
        const pagesDone = Array.isArray(token.filledPages) ? token.filledPages : [];
        const stagePrefix = stageNow === "passenger" ? "form" : stageNow;
        const doneAlready = stageNow === "other"
          ? pagesDone.some((k) => String(k).startsWith(location.pathname + "::"))
          : pagesDone.some((k) => String(k).startsWith(location.pathname + "::" + stagePrefix));
        if (doneAlready) return;
        sched.done = false;
        sched.attempts = 0;
        if (sched.timer) clearTimeout(sched.timer);
        sched.timer = setTimeout(tryFill, 800);
        try { if (sched.timer && typeof sched.timer.unref === "function") sched.timer.unref(); } catch (_) {}
      }, 1000);
      try { if (typeof sched.pathWatch.unref === "function") sched.pathWatch.unref(); } catch (_) {}
    }
    try { if (sched.timer && typeof sched.timer.unref === "function") sched.timer.unref(); } catch (_) {}
  }

  function stopSchedulers() {
    sched.done = true;
    if (sched.timer) { clearTimeout(sched.timer); sched.timer = null; }
    if (sched.pathWatch) { clearInterval(sched.pathWatch); sched.pathWatch = null; }
  }

  /** Native may call after onPageFinished. */
  function onPageReady() {
    if (!hostOk()) return { ok: false, error: "bad-host" };
    const { payload, token } = loadStored();
    if (payload && approvalFresh(token, payload)) {
      scheduleAutoFill();
      return { ok: true, scheduled: true };
    }
    return { ok: true, scheduled: false, reason: "no-fresh-approval" };
  }

  function status() {
    const { payload, token } = loadStored();
    const { IR, FM } = getEngines();
    return {
      bridge: BRIDGE_VERSION,
      host: hostOk(),
      hasPayload: !!payload,
      approvalFresh: approvalFresh(token, payload),
      path: location.pathname,
      irVersion: IR && IR.VERSION,
      fieldmap: !!FM,
    };
  }

  function clearHandoff() {
    try {
      delete root[STORAGE_MEM_KEY];
      delete root[APPROVAL_MEM_KEY];
      sessionStorage.removeItem(STORAGE_MEM_KEY);
      sessionStorage.removeItem(APPROVAL_MEM_KEY);
    } catch (_) {}
    stopSchedulers();
    postNative({ type: "handoff-cleared" });
    return { ok: true };
  }

  root.RailBookWebViewBridge = {
    VERSION: BRIDGE_VERSION,
    setApprovedPayload,
    onPageReady,
    scheduleAutoFill,
    runFillOnce,
    status,
    clearHandoff,
    stopSchedulers,
    hostOk,
    /* test helpers */
    _loadStored: loadStored,
    _approvalFresh: approvalFresh,
  };

  postNative({ type: "bridge-ready", bridge: BRIDGE_VERSION, host: hostOk() });
})(typeof window !== "undefined" ? window : globalThis);
