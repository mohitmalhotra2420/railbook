/* RailBook — seat-board LIVE patch (v1.2.8), runs ONLY inside the RailBook WebView app.
 *
 * Problem (device feedback 23 Sep): journey-list/seat-board kuch trains par frozen
 * "Seat data provider se nahi aayi · check karo" dikhati hai, jabki TrainBoard cards unka
 * FRESH AVL dikhate hain. Server plan-time probe (railyatri/confirmtkt/erail) kabhi-kabhi
 * kuch trains par fail ho jata hai; cards live retry karte hain isliye unme data aa jata hai.
 * Yeh patch app ke ANDAR se har aisi row ko site ke apne live `/api/availability`
 * (wahi endpoint jo cards use karte hain) se fresh chips de deta hai — web redeploy nahi chahiye.
 *
 * v1.2.8 fixes (device round 2):
 *  - fetch fail (cold-start/503/network) par row AB permanent mark nahi hoti — agle sweep me
 *    dobara try hota hai (max 10 tries/row). v1.2.7 me pehla fail hi row ko maar deta tha.
 *  - "Koi class data nahi" rows bhi cover (probed-but-empty → live data aa sakta hai).
 *  - Selector fallbacks: deployed DOM ke class-names ke saath loose matching.
 *  - Chips deployed site ke exact markup se (jx-cchip jx-cchip-{ok|wl|bad|muted}) taaki
 *    site ka apna CSS style kare — bilkul cards/probed rows jaisi chips.
 *
 * Safety: READ-ONLY — sirf unprobed/empty rows ke "nahi aayi" button ko chips se replace;
 * koi click/submit nahi; login/payment touch nahi; data site ke apne API se (kabhi invent nahi:
 * fetch fail → row jaisi thi waisi, retry baad me).
 */
(function (root) {
  "use strict";

  var VERSION = "1.2.1-seatboard-stale-refresh";
  var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  var MAGIC_UNPROBED = "Seat data provider se nahi aayi";
  var MAGIC_EMPTY = "Koi class data nahi";
  var sweeps = 0;
  var MAX_SWEEPS = 100;          /* ~5 min tak (3s interval) — cold-start cover */
  var PER_SWEEP = 6;
  var MAX_TRIES_PER_ROW = 10;    /* ek train ka API 10 baar fail ho to chhodo (honest) */
  /* 23 Sep 2026 (user: "kuch data stale aa raha, live nahi"): jo row purani chips
   * dikha rahi hai ("X ghante/din pehle ka data" / "purana data"), usko bhi fresh
   * per-train board se replace karte hain — sirf khaali rows ko nahi. */
  var STALE_TAGS = ["pehle ka data", "purana data"];
  var EMPTY_RETRY_AFTER_SWEEPS = 4; /* "empty" result par row permanent band nahi —
                                     * 4 sweep ke baad dobara poochho (server redeploy /
                                     *  cache warm hone par data aa sakta hai). */
  var HINTS = "SL,3A,2A,1A,CC,2S,3E"; /* retry attempt par class hints (server discovery
                                       * fail ho to bhi probe chale — memory me enumerate) */
  var timer = null;
  var tries = {};                /* trainNo -> fail count */
  var emptyAt = {};              /* trainNo -> sweep jis par empty mila tha */
  var running = false;           /* ek waqt me ek hi sweep (overlap na ho) */

  function hostOk() {
    try {
      var h = String(location.hostname || "").toLowerCase();
      return h.indexOf("railbook") === 0 || h.indexOf("localhost") === 0 || h.indexOf("127.0.0.1") === 0;
    } catch (_) { return false; }
  }

  function postNative(msg) {
    try {
      if (root.RailBookNative && typeof root.RailBookNative.onBridgeEvent === "function") {
        root.RailBookNative.onBridgeEvent(JSON.stringify(msg));
      }
    } catch (_) { /* ignore */ }
  }

  function parseQuery(doc) {
    /* "Direct trains LDH→BEAS" section title se from/to codes (deployed markup). */
    var els = doc.querySelectorAll("div, h1, h2, h3, h4, span");
    var from = null, to = null;
    for (var i = 0; i < els.length; i++) {
      var t = String(els[i].textContent || "");
      if (t.length > 60) continue;
      var m = t.match(/Direct trains\s+([A-Z0-9]{1,6})\s*(?:→|->|⇒)\s*([A-Z0-9]{1,6})/i);
      if (m) { from = m[1].toUpperCase(); to = m[2].toUpperCase(); break; }
    }
    /* date pill: "24 Sep" jaisa .jx-pill */
    var date = null;
    var pills = doc.querySelectorAll(".jx-pill");
    for (var p = 0; p < pills.length; p++) {
      var pt = String(pills[p].textContent || "").trim();
      var dm = pt.match(/^(\d{1,2})\s+([A-Za-z]{3})$/);
      if (dm) {
        var mon = MONTHS[dm[2].toLowerCase()];
        if (mon != null) {
          var day = Number(dm[1]);
          var now = new Date();
          var year = now.getFullYear();
          var cand = new Date(year, mon, day);
          if (cand.getTime() < now.getTime() - 86400000) year += 1;
          date = year + "-" + String(mon + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
          break;
        }
      }
    }
    return { from: from, to: to, date: date };
  }

  /* ── deployed Un() mapping ka mirror — status → {text, tone} ─────────────── */
  function mapClass(c) {
    var code = c.code || c.classCode || "";
    var s = String(c.status || "");
    if (!code || s === "UNKNOWN") return null;
    var text, tone;
    if (s === "AVAILABLE") { text = code + " AVL" + (c.seats != null ? " " + c.seats : ""); tone = "ok"; }
    else if (s === "RAC") { text = code + " RAC" + (c.rac != null ? " " + c.rac : ""); tone = "ok"; }
    else if (s === "WAITLIST" && c.betterWl) { text = code + " WL " + (c.waitlist != null ? c.waitlist : "?") + " — better chance"; tone = "wl"; }
    else if (s === "WAITLIST") { text = code + " WL" + (c.waitlist != null ? " " + c.waitlist : ""); tone = "wl"; }
    else if (c.note && String(c.note).toLowerCase().indexOf("cancel") >= 0) { text = code + " Train Cancelled"; tone = "bad"; }
    else if (s === "NOT_AVAILABLE" || s === "REGRET") { text = code + " Not available"; tone = "bad"; }
    else { text = code + " " + s; tone = "muted"; }
    if (c.fare != null && c.fare > 0) text += " · ₹" + c.fare;
    return { text: esc(text), tone: tone };
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* deployed markup ke exact spans — site ka CSS (jx-cchip-*) khud style karega */
  function chipsInner(classes) {
    var out = [];
    for (var i = 0; i < classes.length && out.length < 6; i++) {
      var m = mapClass(classes[i] || {});
      if (m) out.push('<span class="jx-cchip jx-cchip-' + m.tone + '">' + m.text + "</span>");
    }
    return out.join("");
  }

  async function fetchBoard(no, q, attempt) {
    /* attempt>1 par class hints bhejo — server discovery fail ho to bhi probed rows
     * aayen. Note: hints sirf candidates hain; data har class ka live API se aata hai. */
    var hint = attempt && attempt > 1 ? "&classes=" + encodeURIComponent(HINTS) : "";
    var url = "/api/availability?trainNumber=" + encodeURIComponent(no) +
      "&date=" + encodeURIComponent(q.date || "") +
      "&from=" + encodeURIComponent(q.from || "") +
      "&to=" + encodeURIComponent(q.to || "") + "&quota=GN" + hint;
    var doFetch = root.fetch ? root.fetch.bind(root) : null;
    if (!doFetch) throw new Error("no-fetch");
    var res = await doFetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error("http " + res.status);
    var j = await res.json();
    return {
      classes: (j && Array.isArray(j.classes)) ? j.classes : [],
      note: (j && typeof j.note === "string") ? j.note : null,
    };
  }

  function trainNoOf(row) {
    var noEl = row.querySelector(".jx-no");
    var no = noEl ? String(noEl.textContent || "").trim() : "";
    if (/^\d{4,5}$/.test(no)) return no;
    var m = String(row.textContent || "").match(/\b(\d{5})\b/);
    return m ? m[1] : null;
  }

  function rowsToPatch(doc) {
    var out = [];
    var rows = doc.querySelectorAll(".jx-sb-row");
    if (!rows.length) {
      /* fallback: koi bhi container jo magic-text button rakhta ho */
      var btns = doc.querySelectorAll("button");
      var seen = {};
      for (var b = 0; b < btns.length; b++) {
        var bt = String(btns[b].textContent || "");
        if (bt.indexOf(MAGIC_UNPROBED) !== 0 && bt.indexOf(MAGIC_EMPTY) !== 0) continue;
        var anc = btns[b];
        for (var up = 0; up < 5 && anc && anc.parentElement; up++) anc = anc.parentElement;
        var key = anc ? (anc.getAttribute("data-rblive") || bt + b) : String(b);
        if (seen[key]) continue;
        seen[key] = 1;
        out.push({ row: anc || btns[b], btn: btns[b] });
      }
    } else {
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var btn = row.querySelector("button.jx-linkbtn") || row.querySelector("button.jx-sub");
        if (btn) {
          var txt = String(btn.textContent || "");
          if (txt.indexOf(MAGIC_UNPROBED) === 0 || txt.indexOf(MAGIC_EMPTY) === 0) out.push({ row: row, btn: btn });
          continue;
        }
        /* chips wali row: purani (stale) ho to fresh data se replace karni hai */
        var chipsEl = row.querySelector(".jx-classes-chips") || row.querySelector(".jx-lrow-chips");
        if (!chipsEl) continue;
        var ct = String(chipsEl.textContent || "");
        var isStale = false;
        for (var st = 0; st < STALE_TAGS.length; st++) if (ct.indexOf(STALE_TAGS[st]) >= 0) isStale = true;
        if (!isStale) continue;
        out.push({ row: row, replaceEl: chipsEl, stale: true });
      }
    }
    /* filter: done / empty-retry / too many fails */
    var live = [];
    for (var k = 0; k < out.length; k++) {
      var no = trainNoOf(out[k].row);
      if (!no) continue;
      var mark = out[k].row.getAttribute("data-rblive");
      if (mark === "1" && !out[k].stale) continue;      /* data mil gaya */
      if (mark === "note") continue;                    /* honest note laga hai */
      if (out[k].stale && mark && mark.indexOf("stale-ok") === 0) continue; /* refresh ho chuki */
      if (mark === "empty" && (sweeps - (emptyAt[no] || 0)) < EMPTY_RETRY_AFTER_SWEEPS) continue;
      if ((tries[no] || 0) >= MAX_TRIES_PER_ROW) continue;
      out[k].no = no;
      live.push(out[k]);
    }
    return live;
  }

  async function runSweep() {
    if (!hostOk()) return { patched: 0, reason: "bad-host" };
    var doc = root.document;
    sweeps += 1;
    var q = parseQuery(doc);
    if (!q.from || !q.to || !q.date) return { patched: 0, failed: 0, reason: "query-not-found", sweep: sweeps };
    var targets = rowsToPatch(doc).slice(0, PER_SWEEP);
    var patched = 0, failed = 0;
    /* Chhota pool (2) — sweep 3s me khatam ho, server ko 42 parallel calls na jayen. */
    var idx = 0;
    async function worker() {
      while (idx < targets.length) {
        var t = targets[idx++];
        try {
          var out = await fetchBoard(t.no, q, tries[t.no] || 1);
          var inner = chipsInner(out.classes);
          if (!inner) {
            /* API theek chala par data khaali — note ho to wahi dikhao (MEMU/unreserved),
             * warna honest empty-mark (4 sweep baad dobara try hoga). */
            if (out.note) {
              t.btn.textContent = out.note;
              t.btn.removeAttribute && t.btn.removeAttribute("style");
              t.row.setAttribute("data-rblive", "note");
            } else {
              emptyAt[t.no] = sweeps;
              t.row.setAttribute("data-rblive", "empty");
            }
            continue;
          }
          var div = doc.createElement("div");
          div.className = "jx-classes-chips";
          div.innerHTML = inner;
          if (t.replaceEl) {
            /* stale row → poori chips list fresh se badal do */
            t.replaceEl.replaceWith(div);
            t.row.setAttribute("data-rblive", t.stale ? "stale-ok" : "1");
            patched += 1;
            continue;
          }
          t.btn.replaceWith(div);
          t.row.setAttribute("data-rblive", "1");
          patched += 1;
        } catch (_) {
          /* fetch fail (cold-start/503/network) → mark NAHI; agle sweep retry */
          tries[t.no] = (tries[t.no] || 0) + 1;
          failed += 1;
        }
      }
    }
    await Promise.all([worker(), worker()]);
    if (patched > 0) postNative({ type: "seatboard-live", patched: patched, failed: failed, sweep: sweeps });
    return { patched: patched, failed: failed, query: q, sweep: sweeps };
  }

  function start() {
    if (!hostOk()) return { ok: false };
    if (timer) return { ok: true, already: true };
    var kick = function () {
      if (sweeps >= MAX_SWEEPS) { if (timer) { clearInterval(timer); timer = null; } return; }
      if (running) return; /* pichla sweep abhi chal raha hai */
      running = true;
      runSweep().catch(function () { /* sweep-level error → agla sweep retry */ })
        .then(function () { running = false; });
    };
    setTimeout(kick, 600);
    timer = setInterval(kick, 3000);
    return { ok: true, version: VERSION };
  }

  root.RailBookSeatboardLive = { VERSION: VERSION, start: start, runSweep: runSweep, parseQuery: parseQuery, mapClass: mapClass };
})(typeof window !== "undefined" ? window : globalThis);
