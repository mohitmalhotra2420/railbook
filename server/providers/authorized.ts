import type {
  BookingRecord,
  CancelResult,
  ClassAvailability,
  ClassCode,
  CreateBookingRequest,
  FareBreakdown,
  RailwayProvider,
  SearchQuery,
  TrainResult,
} from "./types.js";
import { env } from "../env.js";

/**
 * Adapter for a licensed / authorized railway provider.
 * Only this file needs to change when a real provider is connected.
 * Credentials stay on the server (RAILWAY_API_KEY / RAILWAY_API_SECRET).
 */
export class AuthorizedRailwayProvider implements RailwayProvider {
  readonly id = "authorized";
  readonly displayName = "Authorized Railway Provider";
  readonly mock = false;

  private requireConfigured(): never {
    throw Object.assign(
      new Error(
        "No authorized railway provider is configured. Set RAILWAY_PROVIDER, RAILWAY_API_BASE_URL and RAILWAY_API_KEY on the server.",
      ),
      { status: 501 },
    );
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${env.railwayApiKey}`,
      "Content-Type": "application/json",
    };
  }

  async searchTrains(_query: SearchQuery): Promise<TrainResult[]> {
    if (!env.railwayApiBaseUrl || !env.railwayApiKey) this.requireConfigured();
    const url = new URL("/search", env.railwayApiBaseUrl);
    url.searchParams.set("from", _query.from);
    url.searchParams.set("to", _query.to);
    url.searchParams.set("date", _query.date);
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      throw Object.assign(new Error("Provider search failed."), {
        status: 502,
      });
    }
    return (await res.json()) as TrainResult[];
  }

  async getAvailability(): Promise<ClassAvailability> {
    this.requireConfigured();
  }

  async getFare(): Promise<FareBreakdown> {
    this.requireConfigured();
  }

  async createBooking(_req: CreateBookingRequest): Promise<BookingRecord> {
    this.requireConfigured();
  }

  async confirmBooking(_bookingId: string): Promise<BookingRecord> {
    this.requireConfigured();
  }

  async getBooking(_idOrPnr: string): Promise<BookingRecord | null> {
    this.requireConfigured();
  }

  async listBookings(): Promise<BookingRecord[]> {
    this.requireConfigured();
  }

  async cancelBooking(_bookingId: string): Promise<CancelResult> {
    this.requireConfigured();
  }
}
