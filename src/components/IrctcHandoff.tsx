/* Review screen add-on: "Continue to IRCTC" (ADDITIVE — the existing booking summary and the
 * "Confirm Booking" action above stay exactly as they are; this card only adds an optional,
 * user-initiated handoff).
 *
 * On an explicit click only: build the local payload → keep it for the authorised autofill
 * component (Chrome extension / RailBook app) → open official IRCTC (app intent on Android when
 * possible, else website tab) → summary clipboard par chali jaati hai (best-effort).
 *
 * Round-23 (26 Sep, user): review page par SIRF ye Continue button chahiye — booking summary,
 * wallet, copy journey+passenger summary aur neeche ka Confirm Booking sab hata diye.
 * Nothing is filled, clicked, submitted or paid here; login/OTP/CAPTCHA/payment and the final
 * booking action stay with the user on IRCTC.
 *
 * Website-only honesty: a normal browser page cannot write into the official IRCTC Android app
 * or into www.irctc.co.in without an installed assist client (extension or RailBook WebView app).
 */
import { useMemo, useState } from "react";
import type { HandoffInput } from "../irctc/handoff";
import {
  buildHandoffPayload,
  copyHandoffSummary,
  openIrctcHandoff,
  openIrctcInNewTab,
  storeHandoff,
} from "../irctc/handoff";

/* Round-28 (user: "user ko inform karo ki aapki details automatically fill ho jayengi IRCTC pe,
 * dobara daalne ki zaroorat nahi"): RailBook app ke andar chal rahe hain ya normal browser — us hisaab
 * se EK honest line (jhooth nahi: app me hi auto-fill hota hai, bare browser me nahi). */
export function isRailBookAppContext(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { RailBookNative?: unknown; RailBookVoice?: unknown; __railbookAppCapture?: boolean };
  return Boolean(w.RailBookNative || w.RailBookVoice || w.__railbookAppCapture);
}

export function autoFillNotice(inApp: boolean): string {
  return inApp
    ? "IRCTC khulte hi aapki journey + passenger details khud bhar jaayengi — wahan dobara daalne ki zaroorat nahi. Sirf login/OTP/payment aap karenge (security)."
    : "RailBook app (Android) me ye details IRCTC par khud bhar jaati hain — browser me summary clipboard se paste kar sakte ho. Login/OTP/payment hamesha aap hi.";
}

export function IrctcHandoff(props: HandoffInput) {
  const built = useMemo(() => buildHandoffPayload(props), [props]);
  const [status, setStatus] = useState<string | null>(null);
  const inApp = useMemo(() => isRailBookAppContext(), []);

  const onContinue = () => {
    const res = buildHandoffPayload(props);
    if (!res.ok) {
      setStatus(`Handoff abhi nahi bana sakte — ${res.errors[0]}`);
      return;
    }
    const bridge = storeHandoff(res.payload, res.payloadLegacy);
    /* Open FIRST (sync, user-gesture) so popup blockers and unit tests see window.open immediately. */
    const open = openIrctcHandoff();
    void openIrctcInNewTab; /* legacy export kept available */

    /* Clipboard is best-effort and must not delay the open. */
    void copyHandoffSummary(res.payload).then((copyOk) => {
      const copyBit = copyOk
        ? "Journey + passenger summary clipboard pe copy ho gaya — IRCTC me jaldi paste/type kar sakte ho."
        : "Neeche summary se copy kar lo (clipboard block ho to).";
      if (!open.opened) {
        setStatus(`Browser ne IRCTC open nahi kiya — phir se “Continue to IRCTC” dabaiye. ${copyBit}`);
        return;
      }
      if (open.via === "android-app-intent") {
        setStatus(
          `Android pe IRCTC Rail Connect app open karne ki koshish ho rahi hai (installed ho to app, warna website). ` +
            `${copyBit} ` +
            `Important: official IRCTC app ke andar RailBook fields auto-fill nahi ho sakti — OS security. ` +
            `Auto-fill ke liye Chrome extension (desktop) ya RailBook app (WebView) chahiye. ` +
            `Login / OTP / Pay IRCTC par aap hi.`,
        );
        return;
      }
      setStatus(
        bridge.stored
          ? `IRCTC khul gaya (${open.via}). ${copyBit} ` +
            `Extension installed ho to fields auto-fill ho sakti hain; warna summary se type karo. ` +
            `Login, OTP, CAPTCHA, payment aur final booking IRCTC par aap hi — yahan se kuch submit nahi hota.`
          : `IRCTC khul gaya. ${copyBit} Local store nahi ho paaya — booking manual hai.`,
      );
    });

    /* Immediate status (before clipboard resolves) so UI + tests see feedback without waiting. */
    if (!open.opened) {
      setStatus("Browser ne IRCTC open nahi kiya — phir se “Continue to IRCTC” dabaiye. Neeche summary se copy kar lo.");
    } else if (open.via === "android-app-intent") {
      setStatus(
        "Android pe IRCTC Rail Connect app open karne ki koshish · Login / OTP / Pay IRCTC par aap hi. " +
          "Official app me website se auto-fill nahi ho sakti — summary copy use karo ya RailBook app / extension.",
      );
    } else {
      setStatus(
        bridge.stored
          ? "IRCTC khul gaya. Login, OTP, CAPTCHA, payment aur final booking IRCTC par aap hi karenge — yahan se kuch submit nahi hota. Summary neeche / clipboard."
          : "IRCTC khul gaya. (Local handoff store nahi ho paaya — booking manual hai.)",
      );
    }
  };

  return (
    /* Round-24 (user): "journey summary dikhe aur uske NEECHE Continue to IRCTC — uske elawa us page
     * pe kuch mat rakhna." Isliye yahan koi heading/paragraph/note nahi — sirf button (+ click ke baad
     * ka honest status, aur payload ban na paaye to ek error line). */
    <section className="list-card" id="irctc-handoff" aria-label="Continue to IRCTC" style={{ marginTop: 12 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <button
          className="btn navy"
          id="irctc-continue"
          type="button"
          onClick={onContinue}
          disabled={!built.ok}
          aria-describedby="irctc-handoff-status"
          title="Kuch bhi auto-submit nahi hota · login / OTP / CAPTCHA / payment RailBook ke paas nahi aate"
        >
          Continue to IRCTC
        </button>
      </div>
      {!built.ok && (
        <div className="banner err" style={{ marginTop: 10 }}>
          Handoff abhi nahi bana sakte: {built.errors[0]}
        </div>
      )}
      {/* Round-28: auto-fill assurance — button ke neeche wahi honest line (app vs browser). */}
      <div className="cta-note" id="irctc-autofill-note" style={{ marginTop: 10, marginBottom: 0 }}>
        <span aria-hidden>✅</span>
        <span>{autoFillNotice(inApp)}</span>
      </div>
      {status && (
        <div className="muted" id="irctc-handoff-status" role="status" style={{ marginTop: 8 }}>
          {status}
        </div>
      )}
      {/* Round-23 (user): copy button/copy-ready summary/payload preview UI se hata diye — click par
          summary phir bhi clipboard par jaati hai (best-effort) taaki IRCTC me paste karne me aasani ho.
          Round-24 (user): koi extra note bhi nahi — honest baat button ke title + click ke status me hai. */}
    </section>
  );
}
