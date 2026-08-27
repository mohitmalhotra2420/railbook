import type { ReactNode } from "react";
import { useBooking } from "../booking/context";
import { IconBack } from "./Icons";

const STEPS = ["home", "results", "class", "seat", "passengers", "review", "status"] as const;

export function Shell({
  title,
  back,
  children,
  right,
}: {
  title?: string;
  back?: boolean;
  children: ReactNode;
  right?: ReactNode;
}) {
  const { back: goBack, meta, state } = useBooking();
  const idx = STEPS.indexOf(state.screen as (typeof STEPS)[number]);
  const showProgress = idx >= 0 && state.screen !== "home" && !["bookings", "wallet", "travellers"].includes(state.screen);

  return (
    <>
      <header className="topbar">
        {back ? (
          <button className="icon-btn" aria-label="Back" onClick={goBack}>
            <IconBack />
          </button>
        ) : (
          <div className="brand">
            <img src="/logo.png" alt="" />
            RailBook
          </div>
        )}
        {back && <div style={{ fontWeight: 600 }}>{title}</div>}
        <div className="spacer" />
        {meta?.provider.mock && <span className="demo-chip">Demo</span>}
        {right}
      </header>
      {showProgress && (
        <div className="progress" aria-hidden>
          {STEPS.slice(1).map((s, i) => (
            <i key={s} className={i <= idx - 1 ? "on" : ""} />
          ))}
        </div>
      )}
      {children}
    </>
  );
}
