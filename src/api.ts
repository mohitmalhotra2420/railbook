import type { DialogSlot, KnownSlots, NluResult } from "./ai/nlu";
import type {
  BookingRecord,
  ClassAvailability,
  ClassCode,
  FareBreakdown,
  Meta,
  Recommendation,
  Station,
  TrainResult,
  WalletState,
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) {
    const err = new Error(data.error ?? `Request failed (${res.status})`) as Error & {
      status: number;
      code?: string;
      body: unknown;
    };
    err.status = res.status;
    err.code = data.code;
    err.body = data;
    throw err;
  }
  return data;
}

export interface AdminModel {
  id: string;
  name: string;
  provider: string | null;
  description: string | null;
  contextLength: number | null;
  inputPricing: string;
  outputPricing: string;
  capabilities: string[];
  modalities: string[];
  suitable: boolean;
}

export interface AdminModelCatalog {
  endpoint: string;
  fetchedAt: string | null;
  models: AdminModel[];
  suitable: AdminModel[];
  selectedId: string | null;
  selectedSource: "env" | "auto" | "none";
  fallbackIds?: string[];
  error: string | null;
}

export interface NvidiaAdminModel {
  id: string;
  name: string;
  provider: string | null;
  kind: string;
  capabilities: string[];
  contextLength: number | null;
  suitable: boolean;
}

export interface NvidiaAdminCatalog {
  connected: boolean;
  status: string;
  label: string;
  modelsAvailable: number;
  suitableCount: number;
  endpoint: string;
  fetchedAt: string | null;
  error: string | null;
  models: NvidiaAdminModel[];
}

export const api = {
  adminModels: (refresh = false) =>
    request<AdminModelCatalog>(`/api/admin/models${refresh ? "?refresh=1" : ""}`),
  refreshAdminModels: () =>
    request<AdminModelCatalog>("/api/admin/models/refresh", { method: "POST" }),
  nvidiaModels: (refresh = false) =>
    request<NvidiaAdminCatalog>(`/api/admin/nvidia${refresh ? "?refresh=1" : ""}`),
  refreshNvidiaModels: () =>
    request<NvidiaAdminCatalog>("/api/admin/nvidia/refresh", { method: "POST" }),
  understand: (body: { text: string; lastAsked?: DialogSlot; known?: KnownSlots; now?: string; lastFactTrain?: string }) =>
    request<{
      nlu: NluResult;
      source: "ai" | "nlu";
      provider?: "nvidia" | null;
      missingFields: string[];
      modelUsed?: string | null;
      latencyMs?: number;
      failureReason?: string | null;
      groundedReply?: string | null;
      groundedTrain?: string | null;
    }>("/api/understand", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  agent: (body: unknown) =>
    request<{
      nlu: NluResult;
      source: "ai" | "nlu";
      context: unknown;
      tool: string | null;
      toolOk: boolean | null;
      reply: string | null;
      interrupt: boolean;
      resumeAsk: DialogSlot | null;
      resumeText: string | null;
      confirmBook: false;
      missingFields: string[];
      modelUsed?: string | null;
      latencyMs?: number;
      failureReason?: string | null;
    }>("/api/agent", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  liveTrain: (number: string, date?: string) =>
    request<{ live: { trainNumber: string; trainName: string; status: string; delayMinutes: number | null; lastUpdatedAt?: string | null; currentStation: string | null; nextStation: string | null } }>(
      `/api/live?number=${encodeURIComponent(number)}${date ? `&date=${encodeURIComponent(date)}` : ""}`,
    ),
  trainSchedule: (number: string) =>
    request<{
      schedule: {
        trainNumber: string;
        trainName: string;
        stops?: { code: string; name: string; arrival: string; departure: string; day?: string }[];
      };
    }>(`/api/schedule?number=${encodeURIComponent(number)}`),
  trainHistory: (number: string, date: string) =>
    request<{
      history: {
        trainNumber: string;
        trainName: string;
        date: string;
        stops: { code: string; name: string; arrival: string | null; departure: string | null; delay: number | null }[];
      };
    }>(`/api/history?number=${encodeURIComponent(number)}&date=${encodeURIComponent(date)}`),
  stationBoard: (code: string, hours = 2) =>
    request<{
      board: {
        summary: string | null;
        total: number;
        trains: {
          trainNo: string;
          trainName: string;
          platform: string | null;
          source: string | null;
          dest: string | null;
          arrival: string | null;
          departure: string | null;
          delay: number | null;
          cancelled: boolean | null;
        }[];
      };
    }>(`/api/station-board?code=${encodeURIComponent(code)}&hours=${hours}`),
  cancelled: () =>
    request<{
      cancelled: {
        fully: { trainNo?: string; trainName?: string }[];
        partial: { trainNo?: string; trainName?: string }[];
      };
    }>("/api/cancelled"),
  pnrLookup: (pnr: string) =>
    request<{ pnr: { pnr: string; data?: unknown; booking?: unknown } }>(`/api/pnr/${encodeURIComponent(pnr)}`),
  meta: () => request<Meta>("/api/meta"),
  stations: (q = "") =>
    request<{ stations: Station[]; needChoice?: boolean; city?: string; provider?: string }>(
      `/api/stations?q=${encodeURIComponent(q)}`,
    ),
  search: (from: string, to: string, date: string) =>
    request<{
      trains: TrainResult[];
      recommendations: Recommendation[];
      empty: boolean;
    }>(
      `/api/trains?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&date=${encodeURIComponent(date)}`,
    ),
  availability: (
    trainNumber: string,
    date: string,
    from: string,
    to: string,
    classCode: ClassCode,
  ) =>
    request<{ availability: ClassAvailability; bookable: boolean }>(
      `/api/availability?trainNumber=${trainNumber}&date=${date}&from=${from}&to=${to}&classCode=${classCode}`,
    ),
  classBoard: (trainNumber: string, date: string, from: string, to: string, quota = "GN", hintClasses: string[] = []) =>
    request<{ classes: ClassAvailability[]; source?: string }>(
      `/api/availability?trainNumber=${encodeURIComponent(trainNumber)}&date=${encodeURIComponent(date)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&quota=${encodeURIComponent(quota)}${
        hintClasses.length ? `&classes=${encodeURIComponent(hintClasses.join(","))}` : ""
      }`,
    ),
  fare: (
    trainNumber: string,
    date: string,
    from: string,
    to: string,
    classCode: ClassCode,
    passengers: number,
  ) =>
    request<{ fare: FareBreakdown }>(
      `/api/fare?trainNumber=${trainNumber}&date=${date}&from=${from}&to=${to}&classCode=${classCode}&passengers=${passengers}`,
    ),
  wallet: () => request<{ wallet: WalletState }>("/api/wallet"),
  addMoney: (amount: number) =>
    request<{ wallet: WalletState }>("/api/wallet/add", {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),
  createBooking: (body: unknown) =>
    request<{ booking: BookingRecord }>("/api/bookings", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  confirmBooking: (id: string) =>
    request<{ booking: BookingRecord; wallet: WalletState }>(
      `/api/bookings/${id}/confirm`,
      { method: "POST" },
    ),
  getBooking: (id: string) =>
    request<{ booking: BookingRecord }>(`/api/bookings/${id}`),
  listBookings: () => request<{ bookings: BookingRecord[] }>("/api/bookings"),
  cancelBooking: (id: string) =>
    request<{ result: { refundAmount: number }; wallet: WalletState }>(
      `/api/bookings/${id}/cancel`,
      { method: "POST" },
    ),
};
