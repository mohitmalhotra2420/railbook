export type ClassCode = "1A" | "2A" | "3A" | "3E" | "SL" | "CC" | "EC" | "2S" | "EA";

export type AvailabilityStatus =
  | "AVAILABLE"
  | "RAC"
  | "WAITLIST"
  | "NOT_AVAILABLE"
  | "UNKNOWN";

export type FlowState =
  | "SEARCHING"
  | "RESULTS_FOUND"
  | "TRAIN_SELECTED"
  | "CLASS_SELECTED"
  | "PASSENGERS_PENDING"
  | "FARE_REVIEW"
  | "PAYMENT_PENDING"
  | "BOOKING_PENDING"
  | "CONFIRMED"
  | "FAILED"
  | "CANCELLED";

export type Screen =
  | "home"
  | "results"
  | "class"
  | "seat"
  | "passengers"
  | "review"
  | "status"
  | "bookings"
  | "wallet"
  | "travellers"
  | "tools";

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
  source?: string;
  fareSource?: string;
  /** Round-18m: web cache 24h+ purana — "last known" (⚠). */
  stale?: boolean;
  /** Round-18m-26: provider timestamp (ISO) — "X din pehle ka data". */
  updatedAt?: string;
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
  haltVerified?: boolean;
}

export interface Recommendation {
  trainNumber: string;
  kind: string;
  label: string;
  reason: string;
}

/** Round-20 (25 Sep, user: "passenger form IRCTC ke according — insurance/payment chhod kar").
 *  IRCTC ke passenger details wale fields: naam, umar, gender, berth, khaana (catering), ID proof,
 *  "confirm berth mile to hi book karo" aur auto up-gradation. Insurance/payment yahan nahi. */
export interface Passenger {
  id: string;
  name: string;
  age: string;
  gender: "" | "MALE" | "FEMALE" | "OTHER";
  berthPreference: string;
  /** IRCTC food choice — sirf jab train me pantry/catering ho (server probed, real). */
  foodChoice?: "" | "VEG" | "NON_VEG" | "NO_FOOD";
  /** Optional ID proof (IRCTC jaisa) — sirf yaad rakhne ke liye, verify hum nahi karte. */
  idType?: string;
  idNumber?: string;
  /** IRCTC checkbox: "Book only if confirm berths are allotted". */
  bookOnlyIfConfirm?: boolean;
  /** IRCTC checkbox: auto up-gradation. */
  autoUpgrade?: boolean;
}

/** Round-20: IRCTC ke "Contact Details" (mobile/email) — booking ke saath save, insurance/payment nahi. */
export interface ContactDetails {
  mobile: string;
  email: string;
  /** IRCTC jaisa: journey updates isi number par. */
  whatsappOptIn?: boolean;
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
}

export interface BookingRecord {
  id: string;
  pnr: string | null;
  mock: boolean;
  status: "DRAFT" | "PAYMENT_PENDING" | "BOOKING_PENDING" | "CONFIRMED" | "FAILED" | "CANCELLED";
  trainNumber: string;
  trainName: string;
  date: string;
  from: Station;
  to: Station;
  departure: string;
  arrival: string;
  classCode: ClassCode;
  seatPreference: string;
  passengers: {
    name: string;
    age: number;
    gender: "MALE" | "FEMALE" | "OTHER";
    berthPreference: string;
  }[];
  fare: FareBreakdown;
  createdAt: string;
  confirmedAt: string | null;
  failureReason: string | null;
}

export interface WalletState {
  balance: number;
  currency: "INR";
  transactions: {
    id: string;
    type: "CREDIT" | "DEBIT";
    amount: number;
    note: string;
    at: string;
  }[];
}

export interface Meta {
  provider: { id: string; name: string; mock: boolean };
  serviceFee: number;
}

export function isBookable(status: AvailabilityStatus): boolean {
  return status === "AVAILABLE" || status === "RAC" || status === "WAITLIST";
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

export const BERTH_BY_CLASS: Record<ClassCode, string[]> = {
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
