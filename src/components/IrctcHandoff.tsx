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

export function IrctcHandoff(props: HandoffInput) {
  const built = useMemo(() => buildHandoffPayload(props), [props]);
  const [status, setStatus] = useState<string | null>(null);

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
    <section className="list-card" id="irctc-handoff" aria-label="Continue to IRCTC" style={{ marginTop: 12 }}>
      <div className="muted">IRCTC par booking</div>
      <div style={{ marginTop: 6 }}>
        Aap wahi journey IRCTC par le ja sakte hain. <b>Continue</b> pe: official IRCTC khulta hai
        (Android pe Rail Connect app try, warna website) aur passenger details wahan auto-fill ke liye
        taiyaar rehti hain. Booking wahin, apne haath se.
      </div>
      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        <button
          className="btn navy"
          id="irctc-continue"
          type="button"
          onClick={onContinue}
          disabled={!built.ok}
          aria-describedby="irctc-handoff-note"
        >
          Continue to IRCTC
        </button>
      </div>
      {!built.ok && (
        <div className="banner err" style={{ marginTop: 10 }}>
          Handoff abhi nahi bana sakte: {built.errors[0]}
        </div>
      )}
      {status && (
        <div className="muted" id="irctc-handoff-status" role="status" style={{ marginTop: 8 }}>
          {status}
        </div>
      )}
      {/* Round-23 (user): "copy journey + passenger summary user ko nahi dikhna chahiye" — copy button,
          copy-ready summary aur technical payload preview UI se hata diye. Click par summary phir bhi
          clipboard par jaati hai (best-effort) taaki IRCTC me type/paste karne me aasani ho. */}
      <div className="muted" id="irctc-handoff-note" style={{ marginTop: 8, fontSize: 12 }}>
        Kuch bhi auto-submit nahi hota · login / OTP / CAPTCHA / payment RailBook ke paas nahi aate.
      </div>
    </section>
  );
}
