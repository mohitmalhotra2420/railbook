/* RailBook Autofill POC — shared pure logic (no chrome.* here). LOCAL TEST ONLY.
 * Loaded by content.js (via manifest) and by the headless E2E (via window.eval).
 *
 *  - validatePayload(): strict schema; rejects sensitive/unknown keys, bad dates, unsupported classes, <1 passenger.
 *  - detectFields(): robust field discovery — works on the simple mock (data-rb) AND the "IRCTC-like" mock
 *    (different ids/names/labels/DOM) using: data-rb → id/name tokens → <label for> text → wrapping <label> →
 *    aria-label → placeholder → nearest table-cell / row label. Passenger fields are scoped to their block
 *    (fieldset/legend "Passenger N" or a trailing index in id/name).
 *  - fillFields() / verifyFields(): never submit; verification compares DOM values vs expected payload.
 *  - Explicitly NEVER touches inputs that look like credentials/otp/pin/captcha/payment. */
(function (root) {
  const BUILTIN_SENSITIVE = /\b(password|passwd|pwd|pin|otp|cvv|cvc|card|upi|vpa|login|user\s*name|username|userid|user\s*id|token|secret|session|cookie|csrf|captcha|nlpanswer|netbanking|wallet|aadhaar|aadhar|pan)\b/i;
  /* Stage 3: forbidden words also come from config.js (single source of truth); union of both. */
  const cfgWords = (root.RailBookPocConfig && root.RailBookPocConfig.CONFIG.FORBIDDEN_FIELD_WORDS) || [];
  const SENSITIVE_RE = cfgWords.length
    ? new RegExp(`\\b(?:${[...new Set([...cfgWords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*")), BUILTIN_SENSITIVE.source.slice(3, -3)])].join("|")})\\b`, "i")
    : BUILTIN_SENSITIVE;
  const SUPPORTED_CLASSES = new Set(["1A", "2A", "3A", "3E", "CC", "EC", "SL", "2S", "EA", "FC"]);
  /* Round-21 (25 Sep 2026): "contact" (mobile/email — sirf jab user ne bhara ho) top-level approved key,
   aur per-passenger "bookOnlyIfConfirm"/"autoUpgrade" approved flags. Purana payload (bina in keys ke)
   bilkul waise hi chalta rehta hai — output me sirf wahi keys aati hain jo payload me thi. */
  const ALLOWED_TOP = new Set(["kind", "version", "test", "createdAt", "journey", "passengers", "contact"]);
  const ALLOWED_CONTACT = new Set(["mobile", "email"]);
  const ALLOWED_JOURNEY = new Set(["from", "fromCode", "to", "toCode", "date", "trainNumber", "classCode", "quota"]); /* quota optional — filled on initial search ONLY when explicitly present */
  /* Stage 5J: "food" is an approved passenger key (passenger food/catering preference). It is validated and carried
   * through the payload, but the LOCAL_MOCK detectors/fillers below still cover name/age/gender/berth only — the
   * mock pages have no catering control, so mock behaviour is unchanged (expectedPaths is unchanged). */
  const ALLOWED_PAX = new Set(["name", "age", "gender", "berth", "food", "bookOnlyIfConfirm", "autoUpgrade"]);

  function validatePayload(p) {
    const errors = [];
    if (!p || typeof p !== "object") return { ok: false, errors: ["payload not an object"], payload: null };
    if (p.kind !== "railbook-autofill-test") errors.push("kind must be railbook-autofill-test");
    if (p.test !== true) errors.push("test flag must be true");
    for (const k of Object.keys(p)) if (!ALLOWED_TOP.has(k)) errors.push(`unexpected top-level key: ${k}`);
    const raw = JSON.stringify(p);
    const sens = raw.match(SENSITIVE_RE);
    if (sens) errors.push(`forbidden sensitive field/word: ${sens[0]}`);
    const j = p.journey && typeof p.journey === "object" ? p.journey : null;
    if (!j) errors.push("journey missing");
    else {
      for (const k of Object.keys(j)) if (!ALLOWED_JOURNEY.has(k)) errors.push(`unexpected journey key: ${k}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(j.date || ""))) errors.push("invalid date (expected YYYY-MM-DD)");
      else {
        const [y, m, d] = String(j.date).split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) errors.push("invalid date (not a real calendar date)");
      }
      if (!/^\d{4,6}$/.test(String(j.trainNumber || ""))) errors.push("invalid train number");
      if (!SUPPORTED_CLASSES.has(String(j.classCode || "").toUpperCase())) errors.push(`unsupported class: ${j.classCode}`);
      if (!String(j.from || "").trim() || !String(j.to || "").trim()) errors.push("from/to missing");
    }
    const pax = Array.isArray(p.passengers) ? p.passengers : null;
    if (!pax || pax.length < 1) errors.push("missing passenger (need at least 1)");
    else if (pax.length > 6) errors.push("too many passengers (max 6)");
    else
      pax.forEach((x, i) => {
        if (!x || typeof x !== "object") { errors.push(`passenger ${i + 1} invalid`); return; }
        for (const k of Object.keys(x)) if (!ALLOWED_PAX.has(k)) errors.push(`unexpected passenger key: ${k}`);
        if (!String(x.name || "").trim()) errors.push(`passenger ${i + 1}: name missing`);
        const age = Number(x.age);
        if (!(age >= 1 && age <= 120)) errors.push(`passenger ${i + 1}: invalid age`);
        if (!/^(male|female|transgender|other)$/i.test(String(x.gender || ""))) errors.push(`passenger ${i + 1}: invalid gender`);
        if (x.food != null && typeof x.food !== "string") errors.push(`passenger ${i + 1}: food must be a text value`);
        else if (String(x.food || "").length > 40) errors.push(`passenger ${i + 1}: food value too long`);
        for (const flag of ["bookOnlyIfConfirm", "autoUpgrade"]) {
          if (x[flag] != null && typeof x[flag] !== "boolean") errors.push(`passenger ${i + 1}: ${flag} must be true/false`);
        }
      });
    /* Round-21 — contact block (optional). Sirf tab bheja jaata hai jab user ne mobile/email bhara ho. */
    let contactOut = null;
    if (p.contact != null) {
      if (typeof p.contact !== "object") errors.push("contact must be an object");
      else {
        for (const k of Object.keys(p.contact)) if (!ALLOWED_CONTACT.has(k)) errors.push(`unexpected contact key: ${k}`);
        const mob = String(p.contact.mobile == null ? "" : p.contact.mobile).trim();
        const mail = String(p.contact.email == null ? "" : p.contact.email).trim();
        if (mob && !/^\d{10}$/.test(mob)) errors.push("contact mobile must be a 10 digit number");
        if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) errors.push("contact email looks invalid");
        if (mail.length > 60) errors.push("contact email too long");
        if (mob || mail) contactOut = { ...(mob ? { mobile: mob } : {}), ...(mail ? { email: mail } : {}) };
      }
    }
    if (errors.length) return { ok: false, errors, payload: null };
    return {
      ok: true,
      errors: [],
      payload: {
        kind: p.kind, version: (Number(p.version) === 2 ? 2 : 1), test: true, createdAt: String(p.createdAt || new Date().toISOString()),
        journey: { from: String(j.from).trim(), fromCode: String(j.fromCode || "").toUpperCase(), to: String(j.to).trim(), toCode: String(j.toCode || "").toUpperCase(), date: String(j.date), trainNumber: String(j.trainNumber), classCode: String(j.classCode).toUpperCase(), ...(j.quota != null && String(j.quota).trim() !== "" ? { quota: String(j.quota).trim().toUpperCase().slice(0, 8) } : {}) },
        passengers: pax.map((x) => ({
          name: String(x.name).trim().slice(0, 60), age: Number(x.age), gender: String(x.gender), berth: String(x.berth || "Any"), food: String(x.food == null ? "" : x.food).trim().slice(0, 40),
          /* sirf tab jab sach me true ho — warna key hi nahi (purana shape exactly wahi rehta hai) */
          ...(x.bookOnlyIfConfirm === true ? { bookOnlyIfConfirm: true } : {}),
          ...(x.autoUpgrade === true ? { autoUpgrade: true } : {}),
        })),
        ...(contactOut ? { contact: contactOut } : {}),
      },
    };
  }

  /* ── field detection ── */
  const norm = (s) => String(s || "").toLowerCase().replace(/[_\-\s*:]+/g, " ").trim();
  const cssEsc = (s) => String(s).replace(/["\\]/g, "\\$&"); // CSS.escape missing in jsdom
  function labelTextFor(el) {
    const doc = el.ownerDocument;
    const parts = [];
    if (el.id) { const l = doc.querySelector(`label[for="${cssEsc(el.id)}"]`); if (l) parts.push(l.textContent); }
    const wrap = el.closest("label"); if (wrap) parts.push(wrap.textContent);
    if (el.getAttribute("aria-label")) parts.push(el.getAttribute("aria-label"));
    if (el.getAttribute("placeholder")) parts.push(el.getAttribute("placeholder"));
    const col = el.closest(".col, .field, .form-group, div");
    if (col) { const l = col.querySelector("label"); if (l && !l.contains(el)) parts.push(l.textContent); }
    const td = el.closest("td");
    if (td) { const prev = td.previousElementSibling; if (prev && /td|th/i.test(prev.tagName)) parts.push(prev.textContent); }
    /* Preceding sibling <label> (no for=, no wrapper) — common in plain forms. */
    let sib = el.previousElementSibling;
    for (let i = 0; sib && i < 2; i++, sib = sib.previousElementSibling) { if (sib.tagName === "LABEL") { parts.push(sib.textContent); break; } if (/INPUT|SELECT|TEXTAREA/.test(sib.tagName)) break; }
    return norm(parts.join(" | "));
  }
  const camel = (x) => String(x || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2");
  const idName = (el) => norm(`${camel(el.id)} ${camel(el.getAttribute("name"))}`);
  function passengerIndexOf(el) {
    const fs = el.closest("fieldset, .pax, .passenger, [data-pax]");
    if (fs) {
      if (fs.hasAttribute("data-pax")) return Number(fs.getAttribute("data-pax"));
      const lg = fs.querySelector("legend, h3, h4");
      const m = lg && /passenger\s*(\d+)/i.exec(lg.textContent || "");
      if (m) return Number(m[1]) - 1;
    }
    const m2 = /(\d+)\s*$/.exec(`${el.id || ""}`) || /(\d+)\s*$/.exec(`${el.getAttribute("name") || ""}`);
    if (m2) return Number(m2[1]) - 1;
    return null;
  }
  const isSensitive = (el) =>
    SENSITIVE_RE.test(`${el.id} ${el.getAttribute("name")} ${el.getAttribute("type")} ${el.getAttribute("autocomplete")} ${labelTextFor(el)}`) ||
    /password/i.test(el.getAttribute("type") || "") ||
    /^(one-time-code|cc-|current-password|new-password|username)/i.test(el.getAttribute("autocomplete") || "") ||
    !!el.closest("[data-captcha], .captcha, #captcha, form[action*='login' i], form[action*='pay' i]");

  const JOURNEY_RULES = [
    ["journey.from", /\b(from|boarding|source|src|origin)\b/],
    ["journey.to", /\b(to|destination|dst|dest|arrival station)\b/],
    ["journey.date", /\b(date|journey ?dt|jd|doj|travel date)\b/],
    ["journey.trainNumber", /\b(train ?(no|number|num)|trainno)\b/],
    ["journey.classCode", /\b(class|travel ?class|coach class)\b/],
    /* Round-21: contact block (page level) — mobile + email. */
    ["contact.mobile", /\b(mobile|mobile ?number|phone|contact ?(no|number))\b/],
    ["contact.email", /\b(e-?mail|email ?(id|address))\b/],
  ];
  const PAX_RULES = [
    ["name", /\b(name|passenger ?name|psgn ?name|p name|psgr name)\b/],
    ["age", /\b(age)\b/],
    ["gender", /\b(gender|sex)\b/],
    ["berth", /\b(berth|seat pref|preference|choice)\b/],
    /* Round-21: per-passenger food/catering choice (select). */
    ["food", /\b(food|meal|catering)\b/],
  ];

  function detectFields(doc) {
    const found = {}; // path → element (or radiogroup container)
    const seen = new Set();
    const candidates = [...doc.querySelectorAll("input, select, textarea, [role=radiogroup]")].filter((el) => {
      const t = (el.getAttribute("type") || "").toLowerCase();
      if (["hidden", "submit", "button", "reset", "image", "file", "checkbox"].includes(t)) return false;
      if (el.tagName === "INPUT" && t === "radio") return false; // handled via radiogroup/name
      return true;
    });
    // radio groups by name (when no explicit role=radiogroup)
    const radioNames = new Set([...doc.querySelectorAll('input[type="radio"]')].map((r) => r.getAttribute("name")).filter(Boolean));
    for (const n of radioNames) {
      const first = doc.querySelector(`input[type="radio"][name="${cssEsc(n)}"]`);
      const grp = first.closest("[role=radiogroup]") || first.closest(".radios") || first.parentElement?.parentElement;
      if (grp && !candidates.includes(grp)) candidates.push(grp);
    }
    for (const el of candidates) {
      if (isSensitive(el)) continue; // never touch credential/otp/captcha/payment-looking controls
      // 1) explicit data-rb (simple mock)
      const drb = el.getAttribute("data-rb");
      if (drb && !found[drb]) { found[drb] = el; seen.add(el); continue; }
      const hay = `${idName(el)} | ${labelTextFor(el)}`;
      const radioHay = el.matches("[role=radiogroup], .radios") ? `${hay} | ${norm(el.querySelector("input")?.getAttribute("name"))}` : hay;
      const pidx = passengerIndexOf(el);
      let path = null;
      if (pidx != null) {
        for (const [key, re] of PAX_RULES) if (re.test(radioHay)) { path = `passengers.${pidx}.${key}`; break; }
      }
      if (!path && !/passenger|psgn|pax/.test(radioHay)) {
        for (const [key, re] of JOURNEY_RULES) if (re.test(hay)) { path = key; break; }
      }
      if (path && !found[path]) { found[path] = el; seen.add(el); }
    }
    return found;
  }

  /* ── value adapters ── */
  const GENDER_MAP = { male: ["male", "m"], female: ["female", "f"], transgender: ["transgender", "t", "other", "o"], other: ["other", "o", "transgender", "t"] };
  /* Round-21: payload food label → accepted option texts on the site. "No Food" is matched by the site's own
   * option TEXT only (its value was never read) — option na mile to control chhoda jaata hai (report hota hai). */
  const FOOD_MAP = {
    veg: ["veg", "veg meal", "vegetarian"],
    "non veg": ["non veg", "non-veg", "non veg meal", "nonveg"],
    "no food": ["no food", "nofood"],
  };
  const BERTH_MAP = { any: ["any", "no preference", "np", ""], lower: ["lower", "lb"], middle: ["middle", "mb"], upper: ["upper", "ub"], "side lower": ["side lower", "sl"], "side upper": ["side upper", "su"], window: ["window", "window side", "ws"], aisle: ["aisle", "as"] };
  function pickOption(sel, want, aliases) {
    const w = norm(want);
    const alts = [w, ...(aliases[w] || [])];
    const opts = [...sel.options];
    return opts.find((o) => alts.includes(norm(o.value))) || opts.find((o) => alts.includes(norm(o.text))) || opts.find((o) => alts.some((a) => a && norm(o.text).includes(a))) || opts.find((o) => w && norm(o.text).includes(w)) || null;
  }
  function dateForInput(el, iso) {
    if (el.getAttribute("type") === "date") return iso;
    const ph = norm(el.getAttribute("placeholder"));
    const [y, m, d] = iso.split("-");
    if (/dd mm yyyy/.test(ph) || /dd\/mm\/yyyy/.test(ph)) return `${d}-${m}-${y}`;
    if (/mm dd yyyy/.test(ph)) return `${m}-${d}-${y}`;
    return iso;
  }
  function setValue(el, path, value) {
    if (value == null || value === "") return false;
    const key = path.split(".").pop();
    if (el.matches("[role=radiogroup], .radios")) {
      const radios = [...el.querySelectorAll('input[type="radio"]')];
      const alts = [norm(value), ...(GENDER_MAP[norm(value)] || [])];
      const r = radios.find((x) => alts.includes(norm(x.value))) || radios.find((x) => alts.includes(norm(x.closest("label")?.textContent)));
      if (!r) return false;
      r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); el.classList.add("filled"); return true;
    }
    if (el.tagName === "SELECT") {
      /* Round-21: food/catering — exact option text/value match (never a fuzzy guess). */
      const opt = key === "food" ? pickOption(el, value, FOOD_MAP) : key === "gender" ? pickOption(el, value, GENDER_MAP) : key === "berth" ? pickOption(el, value, BERTH_MAP) : key === "classCode" ? ([...el.options].find((o) => norm(o.value) === norm(value)) || [...el.options].find((o) => new RegExp(`\\(${value}\\)`, "i").test(o.text))) : pickOption(el, value, {});
      if (!opt) return false;
      el.value = opt.value;
    } else {
      el.value = key === "date" ? dateForInput(el, String(value)) : String(value);
    }
    el.classList.add("filled");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  function readValue(el, path) {
    const key = path.split(".").pop();
    if (el.matches("[role=radiogroup], .radios")) {
      const r = [...el.querySelectorAll('input[type="radio"]')].find((x) => x.checked);
      if (!r) return "";
      const lbl = norm(r.closest("label")?.textContent);
      return lbl || norm(r.value);
    }
    if (el.tagName === "SELECT") {
      const o = el.options[el.selectedIndex];
      if (!o || !o.value) return "";
      if (key === "classCode") { const m = /\(([A-Z0-9]{2})\)/.exec(o.text); return (m ? m[1] : o.value).toUpperCase(); }
      return norm(o.text) || norm(o.value);
    }
    if (key === "date") { const v = String(el.value || ""); const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v); return m ? `${m[3]}-${m[2]}-${m[1]}` : v; }
    return String(el.value || "");
  }
  const getByPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  /* ── Round-21: per-passenger IRCTC checkboxes (book only if confirm berths / consider for auto up-gradation).
   * Ye do controls sirf TAB likhe jaate hain jab payload me sach me true ho; label text structural signal hai
   * (checkbox ke liye label hi IRCTC ka apna signal hai), value kabhi guess nahi hoti. ── */
  const FLAG_RULES = [
    ["bookOnlyIfConfirm", /(book\s*only\s*if\s*confirm|confirm\s*berth)/i],
    ["autoUpgrade", /(auto\s*up[\s-]?grad|consider\s*for\s*auto)/i],
  ];
  function flagTargets(doc) {
    const out = [];
    for (const el of doc.querySelectorAll('input[type="checkbox"]')) {
      if (isSensitive(el)) continue;
      if (!isVisibleish(el)) continue;
      const hay = `${labelTextFor(el)} ${el.id || ""} ${el.getAttribute("name") || ""} ${el.getAttribute("formcontrolname") || ""}`;
      for (const [key, re] of FLAG_RULES) {
        if (re.test(hay)) { out.push({ key, el, pidx: passengerIndexOf(el) }); break; }
      }
    }
    return out;
  }
  function isVisibleish(el) {
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.closest("[hidden], template, [aria-hidden='true']")) return false;
    return true;
  }
  function fillFlags(doc, payload, filled, notFound, failed) {
    const targets = flagTargets(doc);
    if (!targets.length) return;
    const pax = payload.passengers || [];
    pax.forEach((p, i) => {
      for (const [key, pathKey] of [["bookOnlyIfConfirm", "bookOnlyIfConfirm"], ["autoUpgrade", "autoUpgrade"]]) {
        if (p && p[key] === true) {
          const t = targets.find((x) => x.key === key && (x.pidx === i || (x.pidx == null && pax.length === 1)));
          if (!t) { notFound.push(`passengers.${i}.${pathKey}`); continue; }
          try {
            if (t.el.checked === true) { filled.push(`passengers.${i}.${pathKey}`); continue; }
            t.el.checked = true;
            t.el.dispatchEvent(new Event("input", { bubbles: true }));
            t.el.dispatchEvent(new Event("change", { bubbles: true }));
            t.el.dispatchEvent(new Event("blur", { bubbles: true }));
            t.el.classList.add("filled");
            (t.el.checked ? filled : failed).push(`passengers.${i}.${pathKey}`);
          } catch (e) { failed.push(`passengers.${i}.${pathKey}: ${String((e && e.message) || e).slice(0, 60)}`); }
        }
      }
    });
  }
  function expectedPaths(payload) {
    const out = ["journey.from", "journey.to", "journey.date", "journey.trainNumber", "journey.classCode"];
    payload.passengers.forEach((p, i) => {
      out.push(`passengers.${i}.name`, `passengers.${i}.age`, `passengers.${i}.gender`, `passengers.${i}.berth`);
      /* Round-21: sirf tab jab payload me sach me bheja gaya ho (purana behaviour unchanged). */
      if (p && p.food) out.push(`passengers.${i}.food`);
      if (p && p.bookOnlyIfConfirm === true) out.push(`passengers.${i}.bookOnlyIfConfirm`);
      if (p && p.autoUpgrade === true) out.push(`passengers.${i}.autoUpgrade`);
    });
    const c = payload.contact || {};
    if (c.mobile) out.push("contact.mobile");
    if (c.email) out.push("contact.email");
    return out;
  }
  function fillFields(doc, payload) {
    const detected = detectFields(doc);
    const want = expectedPaths(payload);
    const filled = [], notFound = [], failed = [];
    for (const path of want) {
      /* flags alag pass me likhe jaate hain (checkbox ka apna native setter + label signal) */
      if (/\.(bookOnlyIfConfirm|autoUpgrade)$/.test(path)) continue;
      const el = detected[path];
      if (!el) { notFound.push(path); continue; }
      (setValue(el, path, getByPath(payload, path)) ? filled : failed).push(path);
    }
    /* Round-21: per-passenger checkboxes (sirf jab true ho) + unhone kabhi bhi kisi aur control ko chhua nahi. */
    fillFlags(doc, payload, filled, notFound, failed);
    return { detected: Object.keys(detected), filled, notFound, failed };
  }
  function eq(path, actual, expected) {
    const key = path.split(".").pop();
    const a = norm(actual), e = norm(expected);
    if (key === "gender") return a === e || (GENDER_MAP[e] || []).includes(a);
    if (key === "berth") return a === e || (BERTH_MAP[e] || []).includes(a) || (e === "any" && a === "");
    if (key === "classCode") return String(actual).toUpperCase() === String(expected).toUpperCase();
    if (key === "age") return Number(actual) === Number(expected);
    return a === e;
  }
  function verifyFields(doc, payload) {
    const detected = detectFields(doc);
    const mismatches = [];
    for (const path of expectedPaths(payload)) {
      const el = detected[path];
      const expected = getByPath(payload, path);
      if (!el) { mismatches.push({ path, expected, actual: "(field not found)" }); continue; }
      const actual = readValue(el, path);
      if (!eq(path, actual, expected)) mismatches.push({ path, expected, actual });
    }
    return { pass: mismatches.length === 0, mismatches, checked: expectedPaths(payload).length };
  }

  /* Diagnostics: how many form controls were skipped because they look sensitive (never read/filled). */
  function skippedSensitiveCount(doc) {
    return [...doc.querySelectorAll("input, select, textarea")].filter((el) => { try { return isSensitive(el); } catch { return false; } }).length;
  }
  root.RailBookPocFieldMap = { validatePayload, detectFields, fillFields, verifyFields, expectedPaths, skippedSensitiveCount, isSensitive, SENSITIVE_RE, flagTargets, FOOD_MAP, ALLOWED_CONTACT };
})(typeof window !== "undefined" ? window : globalThis);
