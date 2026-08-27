import { TRAINS, type TrainDef } from "../data/catalog.js";
import { getStation } from "../data/stations.js";
import { env } from "../env.js";
import {
  durationLabel,
  hash32,
  minutesOf,
  uid,
  weekday,
} from "../util.js";
import {
  BERTH_OPTIONS,
  CLASS_LABELS,
  isBookable,
  type AvailabilityStatus,
  type BookingRecord,
  type CancelResult,
  type ClassAvailability,
  type ClassCode,
  type CreateBookingRequest,
  type FareBreakdown,
  type RailwayProvider,
  type SearchQuery,
  type TrainResult,
} from "./types.js";

const bookings = new Map<string, BookingRecord>();

function runsOn(train: TrainDef, date: string): boolean {
  if (!train.days.length) return true;
  return train.days.includes(weekday(date));
}

function segmentScale(train: TrainDef, fromIdx: number, toIdx: number): number {
  const full = train.stops.length - 1;
  const span = Math.max(1, toIdx - fromIdx);
  return Math.min(1, 0.45 + (span / full) * 0.55);
}

function availabilityFor(
  trainNumber: string,
  date: string,
  classCode: ClassCode,
): { status: AvailabilityStatus; seats?: number; rac?: number; waitlist?: number } {
  const h = hash32(`${trainNumber}|${date}|${classCode}`);
  const bucket = h % 20;
  // Deterministic mix so date changes actually change inventory.
  if (bucket === 0) return { status: "NOT_AVAILABLE" };
  if (bucket === 1) return { status: "UNKNOWN" };
  if (bucket <= 3) return { status: "WAITLIST", waitlist: (h % 28) + 1 };
  if (bucket <= 5) return { status: "RAC", rac: (h % 8) + 1 };
  return { status: "AVAILABLE", seats: (h % 72) + 4 };
}

function classRow(
  train: TrainDef,
  date: string,
  classCode: ClassCode,
  scale: number,
): ClassAvailability {
  const fare = Math.round((train.baseFare[classCode] ?? 500) * scale);
  const inv = availabilityFor(train.number, date, classCode);
  return {
    code: classCode,
    label: CLASS_LABELS[classCode],
    fare,
    ...inv,
  };
}

function toResult(
  train: TrainDef,
  date: string,
  fromCode: string,
  toCode: string,
): TrainResult | null {
  if (!runsOn(train, date)) return null;
  const fromIdx = train.stops.findIndex((s) => s.code === fromCode);
  const toIdx = train.stops.findIndex((s) => s.code === toCode);
  if (fromIdx < 0 || toIdx < 0 || fromIdx >= toIdx) return null;

  const fromStop = train.stops[fromIdx];
  const toStop = train.stops[toIdx];
  const dep = fromStop.departure ?? fromStop.arrival;
  const arr = toStop.arrival ?? toStop.departure;
  if (!dep || !arr) return null;

  const from = getStation(fromCode);
  const to = getStation(toCode);
  if (!from || !to) return null;

  const daySpan = toStop.day - fromStop.day;
  const mins = daySpan * 24 * 60 + minutesOf(arr) - minutesOf(dep);
  const scale = segmentScale(train, fromIdx, toIdx);

  return {
    number: train.number,
    name: train.name,
    type: train.type,
    from,
    to,
    date,
    departure: dep,
    arrival: arr,
    arrivalDayOffset: daySpan,
    durationMinutes: mins,
    durationLabel: durationLabel(mins),
    runsOn: train.days.length ? train.days : [0, 1, 2, 3, 4, 5, 6],
    classes: train.classes.map((c) => classRow(train, date, c, scale)),
  };
}

function findTrain(number: string): TrainDef | undefined {
  return TRAINS.find((t) => t.number === number);
}

function findResult(
  number: string,
  date: string,
  from: string,
  to: string,
): TrainResult | null {
  const train = findTrain(number);
  if (!train) return null;
  return toResult(train, date, from.toUpperCase(), to.toUpperCase());
}

export class MockRailwayProvider implements RailwayProvider {
  readonly id = "mock";
  readonly displayName = "Mock Railway Provider";
  readonly mock = true;
  forceFail: boolean;

  constructor(forceFail = env.mockForceFail) {
    this.forceFail = forceFail;
  }

  async searchTrains(query: SearchQuery): Promise<TrainResult[]> {
    const from = query.from.toUpperCase();
    const to = query.to.toUpperCase();
    if (from === to) return [];
    const results: TrainResult[] = [];
    for (const train of TRAINS) {
      const row = toResult(train, query.date, from, to);
      if (row) results.push(row);
    }
    results.sort((a, b) => a.departure.localeCompare(b.departure));
    return results;
  }

  async getAvailability(
    trainNumber: string,
    date: string,
    from: string,
    to: string,
    classCode: ClassCode,
    _quotaCode?: string,
  ): Promise<ClassAvailability> {
    const result = findResult(trainNumber, date, from, to);
    const found = result?.classes.find((c) => c.code === classCode);
    if (found) return found;
    return {
      code: classCode,
      label: CLASS_LABELS[classCode],
      status: "NOT_AVAILABLE",
      fare: 0,
    };
  }

  async getFare(
    trainNumber: string,
    date: string,
    from: string,
    to: string,
    classCode: ClassCode,
    passengerCount: number,
  ): Promise<FareBreakdown> {
    const avail = await this.getAvailability(
      trainNumber,
      date,
      from,
      to,
      classCode,
    );
    const count = Math.max(1, passengerCount);
    const baseFare = avail.fare * count;
    const serviceFee = env.serviceFee * count;
    return {
      trainNumber,
      date,
      classCode,
      passengerCount: count,
      baseFare,
      serviceFee,
      total: baseFare + serviceFee,
      currency: "INR",
    };
  }

  async createBooking(req: CreateBookingRequest): Promise<BookingRecord> {
    const result = findResult(req.trainNumber, req.date, req.from, req.to);
    if (!result) {
      throw Object.assign(new Error("Train is not available for this date."), {
        status: 409,
      });
    }
    const klass = result.classes.find((c) => c.code === req.classCode);
    if (!klass || !isBookable(klass.status)) {
      throw Object.assign(new Error("This option is no longer available."), {
        status: 409,
        code: "UNAVAILABLE",
      });
    }
    const allowed = BERTH_OPTIONS[req.classCode] ?? [];
    if (!allowed.includes(req.seatPreference)) {
      throw Object.assign(new Error("Please reselect your seat."), {
        status: 400,
      });
    }
    if (!req.passengers.length) {
      throw Object.assign(new Error("At least one passenger is required."), {
        status: 400,
      });
    }

    const fare = await this.getFare(
      req.trainNumber,
      req.date,
      req.from,
      req.to,
      req.classCode,
      req.passengers.length,
    );

    const record: BookingRecord = {
      id: uid("RB"),
      pnr: null,
      mock: true,
      status: "DRAFT",
      trainNumber: result.number,
      trainName: result.name,
      date: req.date,
      from: result.from,
      to: result.to,
      departure: result.departure,
      arrival: result.arrival,
      classCode: req.classCode,
      seatPreference: req.seatPreference,
      passengers: req.passengers,
      fare,
      createdAt: new Date().toISOString(),
      confirmedAt: null,
      failureReason: null,
    };
    bookings.set(record.id, record);
    return record;
  }

  async confirmBooking(bookingId: string): Promise<BookingRecord> {
    const rec = bookings.get(bookingId);
    if (!rec) {
      throw Object.assign(new Error("Booking not found."), { status: 404 });
    }
    if (rec.status === "CONFIRMED") return rec;
    if (rec.status === "CANCELLED") {
      throw Object.assign(new Error("Booking is cancelled."), { status: 409 });
    }

    rec.status = "BOOKING_PENDING";

    if (this.forceFail) {
      rec.status = "FAILED";
      rec.failureReason = "Provider declined the booking (mock failure).";
      rec.pnr = null;
      return rec;
    }

    const avail = await this.getAvailability(
      rec.trainNumber,
      rec.date,
      rec.from.code,
      rec.to.code,
      rec.classCode,
    );
    if (!isBookable(avail.status)) {
      rec.status = "FAILED";
      rec.failureReason = "This option is no longer available.";
      rec.pnr = null;
      return rec;
    }

    // Honest mock PNR — never looks like a real IRCTC PNR.
    rec.pnr = `MOCK${String(hash32(rec.id)).padStart(7, "0").slice(0, 7)}`;
    rec.status = "CONFIRMED";
    rec.confirmedAt = new Date().toISOString();
    rec.failureReason = null;
    return rec;
  }

  async getBooking(idOrPnr: string): Promise<BookingRecord | null> {
    const direct = bookings.get(idOrPnr);
    if (direct) return direct;
    for (const rec of bookings.values()) {
      if (rec.pnr && rec.pnr === idOrPnr) return rec;
    }
    return null;
  }

  async listBookings(): Promise<BookingRecord[]> {
    return [...bookings.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async cancelBooking(bookingId: string): Promise<CancelResult> {
    const rec = bookings.get(bookingId);
    if (!rec) {
      throw Object.assign(new Error("Booking not found."), { status: 404 });
    }
    if (rec.status !== "CONFIRMED") {
      throw Object.assign(new Error("Only confirmed bookings can be cancelled."), {
        status: 409,
      });
    }
    rec.status = "CANCELLED";
    return {
      bookingId,
      status: "CANCELLED",
      refundAmount: rec.fare.total,
    };
  }
}

/** Test helper — wipe in-memory bookings. */
export function resetMockBookings(): void {
  bookings.clear();
}
