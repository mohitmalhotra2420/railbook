export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function formatLongDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatShortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

export function inr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function availabilityLabel(status: string, extra?: { seats?: number; rac?: number; waitlist?: number }): string {
  switch (status) {
    case "AVAILABLE":
      return extra?.seats != null ? `Available · ${extra.seats}` : "Available";
    case "RAC":
      return extra?.rac != null ? `RAC ${extra.rac}` : "RAC";
    case "WAITLIST":
      return extra?.waitlist != null ? `WL ${extra.waitlist}` : "Waitlist";
    case "NOT_AVAILABLE":
      return "Not available";
    default:
      return "Unknown";
  }
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 9);
}
