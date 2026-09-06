import { newId, todayYmd } from "../format";
import type {
  BookingRecord,
  ClassAvailability,
  FlowState,
  Passenger,
  Recommendation,
  Screen,
  Station,
  TrainResult,
} from "../types";
import { BERTH_BY_CLASS, isBookable } from "../types";
import { isAllowedGender, sanitizePassengerAge, sanitizePassengerName } from "../voice/passengerSpeech";

export const DATE_CHANGE_NOTICE =
  "Please reselect your train and class (कृपया दोबारा ट्रेन और क्लास चुनें)";
export const SEAT_RESELECT_NOTICE =
  "Please reselect your seat (कृपया दोबारा सीट चुनें)";
export const UNAVAILABLE_NOTICE = "This option is no longer available.";

export interface BookingSnapshot {
  flow: FlowState;
  screen: Screen;
  from: Station | null;
  to: Station | null;
  date: string;
  /** True after the user (or NLU) explicitly chose a travel date. */
  dateProvided: boolean;
  passengerCount: number;
  /** True after the user (or NLU) explicitly chose ticket count. */
  paxProvided: boolean;
  trains: TrainResult[];
  recommendations: Recommendation[];
  searching: boolean;
  selectedTrain: TrainResult | null;
  selectedClass: ClassAvailability | null;
  seatPreference: string;
  passengers: Passenger[];
  notice: string | null;
  error: string | null;
  booking: BookingRecord | null;
  emptyMessage: string | null;
  previewFare: { baseFare: number; serviceFee: number; total: number; railwayAvailable?: boolean } | null;
  /** Bumped on cancel-to-home so Concierge drops the old chat thread. */
  sessionId: number;
}

export type BookingAction =
  | { type: "SET_FROM"; station: Station | null }
  | { type: "SET_TO"; station: Station | null }
  | { type: "SWAP_ENDS" }
  | { type: "SET_DATE"; date: string }
  | { type: "SET_PASSENGER_COUNT"; count: number }
  /* Round-8: "nayi baat/reset" — poora journey context clear (session/wallet
   * context ke bahar hain, waise bhi preserve hote hain). */
  | { type: "RESET_JOURNEY" }
  | { type: "SEARCH_START"; date?: string }
  | {
      type: "SEARCH_SUCCESS";
      trains: TrainResult[];
      recommendations: Recommendation[];
    }
  | { type: "SEARCH_EMPTY"; date: string }
  | { type: "SEARCH_ERROR"; error: string }
  | { type: "SELECT_TRAIN"; train: TrainResult }
  | { type: "SELECT_TRAIN_AND_CLASS"; train: TrainResult; klass: ClassAvailability }
  | { type: "PATCH_TRAIN"; trainNumber: string; classes: ClassAvailability[] }
  | { type: "SELECT_CLASS"; klass: ClassAvailability }
  | { type: "SELECT_SEAT"; seat: string }
  | { type: "SET_PASSENGERS"; passengers: Passenger[] }
  | { type: "ADD_PASSENGER" }
  | { type: "REMOVE_PASSENGER"; id: string }
  | { type: "UPDATE_PASSENGER"; id: string; patch: Partial<Passenger> }
  | { type: "GO_REVIEW"; fare: { baseFare: number; serviceFee: number; total: number } }
  | { type: "SET_BOOKING"; booking: BookingRecord }
  | { type: "SET_FLOW"; flow: FlowState }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "CLEAR_NOTICE" }
  | { type: "UNAVAILABLE" }
  | { type: "GO"; screen: Screen }
  | { type: "BACK" }
  | { type: "NEW_BOOKING" }
  | { type: "CANCEL_HOME" }
  | { type: "HYDRATE"; snapshot: BookingSnapshot };

export function blankPassenger(seat = ""): Passenger {
  return {
    id: newId(),
    name: "",
    age: "",
    gender: "",
    berthPreference: seat,
  };
}

export function initialBooking(date: string): BookingSnapshot {
  return {
    flow: "SEARCHING",
    screen: "home",
    from: null,
    to: null,
    date,
    dateProvided: false,
    passengerCount: 1,
    paxProvided: false,
    trains: [],
    recommendations: [],
    searching: false,
    selectedTrain: null,
    selectedClass: null,
    seatPreference: "",
    passengers: [blankPassenger()],
    notice: null,
    error: null,
    booking: null,
    emptyMessage: null,
    previewFare: null,
    sessionId: 0,
  };
}

function clearDownstream(
  state: BookingSnapshot,
  level: "date" | "train" | "class",
): Partial<BookingSnapshot> {
  if (level === "date") {
    return {
      trains: [],
      recommendations: [],
      selectedTrain: null,
      selectedClass: null,
      seatPreference: "",
      booking: null,
      emptyMessage: null,
      previewFare: null,
      passengers: state.passengers.map((p) => ({ ...p, berthPreference: "" })),
    };
  }
  if (level === "train") {
    return {
      selectedClass: null,
      seatPreference: "",
      booking: null,
      previewFare: null,
      passengers: state.passengers.map((p) => ({ ...p, berthPreference: "" })),
    };
  }
  return {
    seatPreference: "",
    booking: null,
    previewFare: null,
    passengers: state.passengers.map((p) => ({ ...p, berthPreference: "" })),
  };
}

const FLOW_SCREENS: Screen[] = [
  "home",
  "results",
  "class",
  "seat",
  "passengers",
  "review",
  "status",
];

export function bookingReducer(
  state: BookingSnapshot,
  action: BookingAction,
): BookingSnapshot {
  switch (action.type) {
    case "HYDRATE":
      return action.snapshot;
    case "RESET_JOURNEY":
      return { ...initialBooking(""), sessionId: state.sessionId };
    case "SET_FROM":
      return { ...state, from: action.station, error: null };
    case "SET_TO":
      return { ...state, to: action.station, error: null };
    case "SWAP_ENDS":
      return { ...state, from: state.to, to: state.from };
    case "SET_DATE": {
      if (action.date === state.date) return { ...state, dateProvided: true };
      const hadSelection = Boolean(state.selectedTrain || state.trains.length);
      return {
        ...state,
        date: action.date,
        dateProvided: true,
        flow: "SEARCHING",
        screen: hadSelection ? "results" : state.screen,
        searching: false,
        notice: hadSelection ? DATE_CHANGE_NOTICE : null,
        error: null,
        ...clearDownstream(state, "date"),
      };
    }
    case "SET_PASSENGER_COUNT": {
      const count = Math.min(6, Math.max(1, action.count));
      let passengers = [...state.passengers];
      while (passengers.length < count) passengers.push(blankPassenger(""));
      if (passengers.length > count) passengers = passengers.slice(0, count);
      return { ...state, passengerCount: count, passengers, paxProvided: true };
    }
    case "SEARCH_START":
      return {
        ...state,
        // Board always reflects the date actually being searched — no mismatched chips/cards.
        date: action.date || state.date,
        dateProvided: action.date ? true : state.dateProvided,
        searching: true,
        flow: "SEARCHING",
        screen: "results",
        error: null,
        emptyMessage: null,
        selectedTrain: null,
        selectedClass: null,
        seatPreference: "",
        trains: [],
        recommendations: [],
        booking: null,
        passengers: state.passengers.map((p) => ({
          ...blankPassenger(""),
          id: p.id,
        })),
      };
    case "SEARCH_SUCCESS":
      return {
        ...state,
        searching: false,
        trains: action.trains,
        recommendations: action.recommendations,
        flow: "RESULTS_FOUND",
        screen: "results",
        emptyMessage: null,
        selectedTrain: null,
        selectedClass: null,
        seatPreference: "",
      };
    case "SEARCH_EMPTY":
      return {
        ...state,
        searching: false,
        trains: [],
        recommendations: [],
        selectedTrain: null,
        selectedClass: null,
        seatPreference: "",
        flow: "RESULTS_FOUND",
        screen: "results",
        emptyMessage: `No trains available for ${action.date}`,
      };
    case "SEARCH_ERROR":
      return {
        ...state,
        searching: false,
        error: action.error,
        flow: "SEARCHING",
        screen: "results",
        emptyMessage: action.error,
      };
    case "PATCH_TRAIN": {
      const trains = state.trains.map((t) =>
        t.number === action.trainNumber ? { ...t, classes: action.classes } : t,
      );
      const selectedTrain =
        state.selectedTrain?.number === action.trainNumber
          ? { ...state.selectedTrain, classes: action.classes }
          : state.selectedTrain;
      return { ...state, trains, selectedTrain };
    }
    case "SELECT_TRAIN": {
      const changing =
        state.selectedTrain && state.selectedTrain.number !== action.train.number;
      return {
        ...state,
        selectedTrain: action.train,
        flow: "TRAIN_SELECTED",
        screen: "class",
        notice: changing && state.selectedClass ? DATE_CHANGE_NOTICE : state.notice,
        error: null,
        ...clearDownstream(state, "train"),
      };
    }
    case "SELECT_TRAIN_AND_CLASS": {
      if (!isBookable(action.klass.status)) {
        return { ...state, error: UNAVAILABLE_NOTICE, notice: UNAVAILABLE_NOTICE };
      }
      return {
        ...state,
        selectedTrain: action.train,
        selectedClass: action.klass,
        flow: "CLASS_SELECTED",
        screen: "seat",
        notice: null,
        error: null,
        seatPreference: "",
        booking: null,
        previewFare: null,
        passengers: state.passengers.map((p) => ({ ...p, berthPreference: "" })),
      };
    }
    case "SELECT_CLASS": {
      if (!isBookable(action.klass.status)) {
        return { ...state, error: UNAVAILABLE_NOTICE, notice: UNAVAILABLE_NOTICE };
      }
      const changing =
        state.selectedClass && state.selectedClass.code !== action.klass.code;
      const seats = BERTH_BY_CLASS[action.klass.code] ?? [];
      return {
        ...state,
        selectedClass: action.klass,
        flow: "CLASS_SELECTED",
        screen: "seat",
        notice: changing && state.seatPreference ? SEAT_RESELECT_NOTICE : null,
        error: null,
        seatPreference: "",
        booking: null,
        passengers: state.passengers.map((p) => ({
          ...p,
          berthPreference: seats.includes(p.berthPreference) ? p.berthPreference : "",
        })),
      };
    }
    case "SELECT_SEAT":
      return {
        ...state,
        seatPreference: action.seat,
        passengers: state.passengers.map((p) => {
          const emptyName = !String(p.name ?? "").trim();
          return {
            ...p,
            gender: emptyName ? "" : p.gender,
            berthPreference: "",
          };
        }),
        flow: "PASSENGERS_PENDING",
        screen: "passengers",
        notice: null,
      };
    case "SET_PASSENGERS":
      return { ...state, passengers: action.passengers };
    case "ADD_PASSENGER": {
      if (state.passengers.length >= 6) return state;
      const passengers = [...state.passengers, blankPassenger("")];
      return { ...state, passengers, passengerCount: passengers.length };
    }
    case "REMOVE_PASSENGER": {
      if (state.passengers.length <= 1) return state;
      const passengers = state.passengers.filter((p) => p.id !== action.id);
      return { ...state, passengers, passengerCount: passengers.length };
    }
    case "UPDATE_PASSENGER": {
      const patch = { ...action.patch };
      if (patch.name != null) patch.name = sanitizePassengerName(patch.name);
      if (patch.age != null) patch.age = sanitizePassengerAge(patch.age);
      if (patch.gender != null && !isAllowedGender(patch.gender)) delete patch.gender;
      return {
        ...state,
        passengers: state.passengers.map((p) =>
          p.id === action.id ? { ...p, ...patch } : p,
        ),
      };
    }
    case "GO_REVIEW":
      return {
        ...state,
        flow: "FARE_REVIEW",
        screen: "review",
        error: null,
        previewFare: action.fare,
      };
    case "SET_BOOKING": {
      const map: Record<string, FlowState> = {
        DRAFT: "PAYMENT_PENDING",
        PAYMENT_PENDING: "PAYMENT_PENDING",
        BOOKING_PENDING: "BOOKING_PENDING",
        CONFIRMED: "CONFIRMED",
        FAILED: "FAILED",
        CANCELLED: "CANCELLED",
      };
      return {
        ...state,
        booking: action.booking,
        flow: map[action.booking.status] ?? state.flow,
        screen: action.booking.status === "DRAFT" ? "review" : "status",
      };
    }
    case "SET_FLOW":
      return { ...state, flow: action.flow };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "CLEAR_NOTICE":
      return { ...state, notice: null };
    case "UNAVAILABLE":
      return {
        ...state,
        selectedClass: null,
        seatPreference: "",
        notice: UNAVAILABLE_NOTICE,
        error: UNAVAILABLE_NOTICE,
        flow: state.selectedTrain ? "TRAIN_SELECTED" : "RESULTS_FOUND",
        screen: state.selectedTrain ? "class" : "results",
      };
    case "GO":
      return { ...state, screen: action.screen };
    case "BACK": {
      // Train board is the results UI — never drop back into the old chat thread.
      if (state.screen === "results" || state.screen === "home") {
        return { ...state, error: null };
      }
      const idx = FLOW_SCREENS.indexOf(state.screen);
      if (idx <= 0) return { ...state, screen: "home", flow: "SEARCHING" };
      const prev = FLOW_SCREENS[idx - 1];
      return { ...state, screen: prev, error: null };
    }
    case "NEW_BOOKING":
      return {
        ...initialBooking(state.date),
        from: state.from,
        to: state.to,
        date: state.date,
        passengerCount: 1,
        sessionId: (state.sessionId || 0) + 1,
      };
    case "CANCEL_HOME":
      return {
        ...initialBooking(todayYmd()),
        sessionId: (state.sessionId || 0) + 1,
      };
    default:
      return state;
  }
}

export function validatePassengers(passengers: Passenger[]): Record<string, Partial<Record<keyof Passenger, string>>> {
  const errors: Record<string, Partial<Record<keyof Passenger, string>>> = {};
  for (const p of passengers) {
    const e: Partial<Record<keyof Passenger, string>> = {};
    if (!p.name.trim() || p.name.trim().length < 3) e.name = "Enter full name";
    else if (!/^[\p{L}\p{M}][\p{L}\p{M} .']+$/u.test(p.name.trim())) e.name = "Use letters only";
    const age = Number(p.age);
    if (!p.age || !Number.isInteger(age) || age < 1 || age > 120) e.age = "Enter a valid age";
    if (!p.gender) e.gender = "Select gender";
    if (!p.berthPreference) e.berthPreference = "Select preference";
    if (Object.keys(e).length) errors[p.id] = e;
  }
  return errors;
}

export const STORAGE_KEY = "railbook.booking.v1";

export function persist(state: BookingSnapshot): void {
  try {
    const slim: BookingSnapshot = {
      ...state,
      searching: false,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
  } catch {
    /* ignore quota */
  }
}

export function restore(fallbackDate: string): BookingSnapshot | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BookingSnapshot;
    if (!parsed || typeof parsed !== "object") return null;
    const sessionId = Number(parsed.sessionId) || 0;
    let screen = parsed.screen;
    const trains = Array.isArray(parsed.trains) ? parsed.trains : [];
    if (["class", "seat", "passengers", "review"].includes(screen) && !parsed.selectedTrain) {
      screen = trains.length ? "results" : "home";
    }
    if (screen === "results" && !trains.length) screen = "home";
    if (screen === "seat" && !parsed.selectedClass) screen = parsed.selectedTrain ? "class" : trains.length ? "results" : "home";
    const passengers = Array.isArray(parsed.passengers)
      ? parsed.passengers.map((p) => ({
          ...p,
          gender: String(p.name ?? "").trim() ? p.gender : "",
        }))
      : [blankPassenger()];
    return {
      ...initialBooking(fallbackDate),
      ...parsed,
      trains,
      passengers,
      screen,
      searching: false,
      dateProvided: Boolean(parsed.dateProvided),
      paxProvided: Boolean(parsed.paxProvided),
      sessionId,
    };
  } catch {
    return null;
  }
}
