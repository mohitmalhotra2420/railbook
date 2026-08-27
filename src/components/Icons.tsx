import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const s = { width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const IconBack = (p: P) => (
  <svg viewBox="0 0 24 24" {...s} {...p}><path d="M15 19 8 12l7-7" /></svg>
);
export const IconSwap = (p: P) => (
  <svg viewBox="0 0 24 24" {...s} {...p}><path d="M7 7h11M16 4l3 3-3 3M17 17H6M8 14l-3 3 3 3" /></svg>
);
export const IconCal = (p: P) => (
  <svg viewBox="0 0 24 24" {...s} {...p}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
);
export const IconUser = (p: P) => (
  <svg viewBox="0 0 24 24" {...s} {...p}><circle cx="12" cy="8" r="3.2"/><path d="M5 19c1.4-3 4-4.5 7-4.5S17.6 16 19 19"/></svg>
);
export const IconWallet = (p: P) => (
  <svg viewBox="0 0 24 24" {...s} {...p}><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M16 12h5v4h-5a2 2 0 1 1 0-4Z"/></svg>
);
export const IconTicket = (p: P) => (
  <svg viewBox="0 0 24 24" {...s} {...p}><path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 1 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 1 0 0-4V8Z"/></svg>
);
export const IconChevron = (p: P) => (
  <svg viewBox="0 0 24 24" {...s} {...p}><path d="m9 6 6 6-6 6"/></svg>
);
export const IconStar = (p: P) => (
  <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor" {...p}><path d="m12 3 2.4 5.7 6.2.6-4.7 4.1 1.4 6.1L12 16.8 6.7 19.5l1.4-6.1L3.4 9.3l6.2-.6z"/></svg>
);
export const IconClose = (p: P) => (
  <svg viewBox="0 0 24 24" {...s} {...p}><path d="M6 6l12 12M18 6 6 18"/></svg>
);
