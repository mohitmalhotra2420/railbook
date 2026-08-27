export type ClassCode = "1A" | "2A" | "3A" | "3E" | "SL" | "CC" | "EC" | "2S" | "EA";

export type AvailabilityStatus =
  | "AVAILABLE"
  | "RAC"
  | "WAITLIST"
  | "NOT_AVAILABLE"
  | "UNKNOWN";

export type BookingStatus =
  | "DRAFT"
  | "PAYMENT_PENDING"
  | "BOOKING_PENDING"
  | "CONFIRMED"
  | "FAILED"
  | "CANCELLED";

export interface Station {
  code: string;
  name: string;
  city: string;
}

export interface ClassAvailability {
  code: ClassCode;
  label: string;
  status: AvailabilityStatus;
  seats?: number;
  rac?: number;
  waitlist?: number;
  fare: number;
  quota?: string;
  date?: string;
}

export interface TrainResult {
  number: string;
  name: string;
  type: string;
  from: Station;
  to: Station;
  date: string;
  departure: string;
  arrival: string;
  arrivalDayOffset: number;
  durationMinutes: number;
  durationLabel: string;
  runsOn: number[];
  classes: ClassAvailability[];
}

export interface SearchQuery {
  from: string;
  to: string;
  date: string;
}

export interface FareBreakdown {
  trainNumber: string;
  date: string;
  classCode: ClassCode;
  passengerCount: number;
  baseFare: number;
  serviceFee: number;
  total: number;
  currency: "INR";
  /** False when RailKit fareLookup did not return a real railway fare. */
  railwayAvailable?: boolean;
}

export interface PassengerInput {
  name: string;
  age: number;
  gender: "MALE" | "FEMALE" | "OTHER";
  berthPreference: string;
}

export interface CreateBookingRequest {
  trainNumber: string;
  date: string;
  from: string;
  to: string;
  classCode: ClassCode;
  seatPreference: string;
  passengers: PassengerInput[];
}

export interface BookingRecord {
  id: string;
  pnr: string | null;
  mock: boolean;
  status: BookingStatus;
  trainNumber: string;
  trainName: string;
  date: string;
  from: Station;
  to: Station;
  departure: string;
  arrival: string;
  classCode: ClassCode;
  seatPreference: string;
  passengers: PassengerInput[];
  fare: FareBreakdown;
  createdAt: string;
  confirmedAt: string | null;
  failureReason: string | null;
}

export interface CancelResult {
  bookingId: string;
  status: "CANCELLED";
  refundAmount: number;
}

export interface RailwayProvider {
  readonly id: string;
  readonly displayName: string;
  readonly mock: boolean;
  searchTrains(query: SearchQuery): Promise<TrainResult[]>;
  getAvailability(
    trainNumber: string,
    date: string,
    from: string,
    to: string,
    classCode: ClassCode,
    quotaCode?: string,
  ): Promise<ClassAvailability>;
  getFare(
    trainNumber: string,
    date: string,
    from: string,
    to: string,
    classCode: ClassCode,
    passengerCount: number,
  ): Promise<FareBreakdown>;
  createBooking(req: CreateBookingRequest): Promise<BookingRecord>;
  confirmBooking(bookingId: string): Promise<BookingRecord>;
  getBooking(idOrPnr: string): Promise<BookingRecord | null>;
  listBookings(): Promise<BookingRecord[]>;
  cancelBooking(bookingId: string): Promise<CancelResult>;
}

export const CLASS_LABELS: Record<ClassCode, string> = {
  "1A": "AC First Class",
  "2A": "AC 2 Tier",
  "3A": "AC 3 Tier",
  "3E": "AC 3 Economy",
  SL: "Sleeper",
  CC: "AC Chair Car",
  EC: "Executive Chair Car",
  "2S": "Second Sitting",
  EA: "Anubhuti Class",
};

export const BERTH_OPTIONS: Record<ClassCode, string[]> = {
  "1A": ["Cabin", "Coupe", "Lower", "Upper"],
  "2A": ["Lower", "Upper", "Side Lower", "Side Upper"],
  "3A": ["Lower", "Middle", "Upper", "Side Lower", "Side Upper"],
  "3E": ["Lower", "Middle", "Upper", "Side Lower", "Side Upper"],
  SL: ["Lower", "Middle", "Upper", "Side Lower", "Side Upper"],
  CC: ["Window", "Aisle"],
  EC: ["Window", "Aisle"],
  "2S": ["Window", "Aisle"],
  EA: ["Window", "Aisle"],
};

export function isBookable(status: AvailabilityStatus): boolean {
  return status === "AVAILABLE" || status === "RAC" || status === "WAITLIST";
}
