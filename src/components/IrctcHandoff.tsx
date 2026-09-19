/* Review screen add-on: "Continue to IRCTC" (ADDITIVE — the existing booking summary and the
 * "Confirm Booking" action above stay exactly as they are; this card only adds an optional,
 * user-initiated handoff).
 *
 * On an explicit click only: build the local payload → keep it for the authorised autofill
 * component → open the official IRCTC page in a new tab. Nothing is filled, clicked, submitted or
 * paid here; login/OTP/CAPTCHA/payment and the final booking action stay with the user on IRCTC.
 */
import { useMemo, useState } from "react";
import type { HandoffInput } from "../irctc/handoff";
import { buildHandoffPayload, openIrctcInNewTab, storeHandoff } from "../irctc/handoff";

export function IrctcHandoff(props: HandoffInput) {
  const built = useMemo(() => buildHandoffPayload(props), [props]);
  const [status, setStatus] = useState<string | null>(null);

  const onContinue = () => {
    const res = buildHandoffPayload(props);
    if (!res.ok) {
      setStatus(`Handoff abhi nahi bana sakte — ${res.errors[0]}`);
      return;
    }
    const bridge = storeHandoff(res.payload);
    const opened = openIrctcInNewTab();
    setStatus(
      opened
        ? bridge.stored
          ? "IRCTC naye tab me khul gaya. Login, OTP, CAPTCHA, payment aur final booking IRCTC par aap hi karenge — yahan se kuch submit nahi hota."
          : "IRCTC naye tab me khul gaya. (Local handoff store nahi ho paaya — autofill component ke bina bhi booking poori tarah manual hai.)"
        : "Browser ne naya tab rok diya — phir se “Continue to IRCTC” dabaiye.",
    );
  };

  return (
    <section className="list-card" id="irctc-handoff" aria-label="Continue to IRCTC (optional)" style={{ marginTop: 12 }}>
      <div className="muted">Continue to IRCTC (optional)</div>
      <div style={{ marginTop: 6 }}>
        Aap wahi journey IRCTC par le ja sakte hain. RailBook sirf ek <b>local handoff payload</b> banata hai aur
        official IRCTC page <b>naye tab</b> me kholta hai — booking wahin, apne haath se.
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
      {built.ok && (
        <details style={{ marginTop: 10 }}>
          <summary className="muted">Payload preview (sirf journey + non-sensitive passenger fields)</summary>
          <pre id="irctc-payload-preview" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12 }}>
            {JSON.stringify(built.payload, null, 2)}
          </pre>
        </details>
      )}
      <div className="muted" id="irctc-handoff-note" style={{ marginTop: 8, fontSize: 12 }}>
        Kuch bhi auto-submit nahi hota · login/OTP/CAPTCHA/payment RailBook ke paas nahi aate · koi credential,
        cookie ya session token collect nahi hota.
      </div>
    </section>
  );
}
