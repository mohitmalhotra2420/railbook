import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api";
import { todayYmd } from "../format";
import type {
  BookingRecord,
  ClassAvailability,
  Meta,
  Recommendation,
  Station,
  TrainResult,
  WalletState,
} from "../types";
import { BERTH_BY_CLASS, isBookable } from "../types";
import {
  bookingReducer,
  initialBooking,
  persist,
  restore,
  validatePassengers,
  type BookingSnapshot,
} from "./state";

interface BookingCtx {
  state: BookingSnapshot;
  meta: Meta | null;
  wallet: WalletState | null;
  bookings: BookingRecord[];
  fieldErrors: ReturnType<typeof validatePassengers>;
  setFrom: (s: Station | null) => void;
  setTo: (s: Station | null) => void;
  swap: () => void;
  setDate: (d: string) => void;
  setPassengerCount: (n: number) => void;
  /** Round-8: "nayi baat/reset" command — journey slots/selection sab clear. */
  resetJourney: () => void;
  search: () => Promise<void>;
  searchRoute: (from: Station, to: Station, date: string) => Promise<void>;
  /** Show an already-fetched provider result (e.g. from the autonomous agent) without a second search. */
  showResults: (from: Station, to: Station, date: string, trains: TrainResult[], recommendations: Recommendation[]) => void;
  patchTrain: (trainNumber: string, classes: ClassAvailability[]) => void;
  selectTrain: (t: TrainResult) => void;
  selectTrainAndClass: (t: TrainResult, k: ClassAvailability) => void;
  selectClass: (k: ClassAvailability) => Promise<void>;
  selectSeat: (s: string) => void;
  updatePassenger: (id: string, patch: Partial<BookingSnapshot["passengers"][0]>) => void;
  addPassenger: () => void;
  removePassenger: (id: string) => void;
  goReview: () => Promise<void>;
  confirm: () => Promise<void>;
  go: (s: BookingSnapshot["screen"]) => void;
  back: () => void;
  newBooking: () => void;
  cancelHome: () => void;
  refreshWallet: () => Promise<void>;
  addMoney: (n: number) => Promise<void>;
  refreshBookings: () => Promise<void>;
  retrieve: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  clearNotice: () => void;
}

const Ctx = createContext<BookingCtx | null>(null);

export function BookingProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    bookingReducer,
    undefined,
    () => restore(todayYmd()) ?? initialBooking(todayYmd()),
  );
  const [meta, setMeta] = useState<Meta | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [fieldErrors, setFieldErrors] = useState<ReturnType<typeof validatePassengers>>({});

  useEffect(() => {
    persist(state);
  }, [state]);

  useEffect(() => {
    api.meta().then(setMeta).catch(() => undefined);
    api.wallet().then((r) => setWallet(r.wallet)).catch(() => undefined);
  }, []);

  const runSearch = useCallback(
    async (from: Station, to: Station, date: string) => {
      dispatch({ type: "SEARCH_START", date });
      try {
        const res = await api.search(from.code, to.code, date);
        if (res.empty || res.trains.length === 0) {
          dispatch({ type: "SEARCH_EMPTY", date });
        } else {
          dispatch({
            type: "SEARCH_SUCCESS",
            trains: res.trains,
            recommendations: res.recommendations,
          });
        }
      } catch (err) {
        dispatch({
          type: "SEARCH_ERROR",
          error: err instanceof Error ? err.message : "Search failed.",
        });
      }
    },
    [],
  );

  const showResults = useCallback(
    (from: Station, to: Station, date: string, trains: TrainResult[], recommendations: Recommendation[]) => {
      dispatch({ type: "SET_FROM", station: from });
      dispatch({ type: "SET_TO", station: to });
      dispatch({ type: "SET_DATE", date });
      dispatch({ type: "SEARCH_START" });
      if (trains.length === 0) dispatch({ type: "SEARCH_EMPTY", date });
      else dispatch({ type: "SEARCH_SUCCESS", trains, recommendations });
    },
    [],
  );

  const search = useCallback(async () => {
    if (!state.from || !state.to || !state.date) {
      dispatch({ type: "SET_ERROR", error: "Choose from, to and date." });
      return;
    }
    await runSearch(state.from, state.to, state.date);
  }, [state.from, state.to, state.date, runSearch]);

  const setDate = useCallback(
    (d: string) => {
      const shouldRefresh =
        Boolean(state.from && state.to) &&
        d !== state.date &&
        (state.trains.length > 0 ||
          Boolean(state.selectedTrain) ||
          state.screen === "results");
      dispatch({ type: "SET_DATE", date: d });
      if (shouldRefresh && state.from && state.to) {
        void runSearch(state.from, state.to, d);
      }
    },
    [state.from, state.to, state.date, state.trains.length, state.selectedTrain, state.screen, runSearch],
  );

  const selectClass = useCallback(
    async (klass: ClassAvailability): Promise<ClassAvailability | null> => {
      if (!state.selectedTrain || !state.from || !state.to) return null;
      if (isBookable(klass.status)) {
        dispatch({ type: "SELECT_CLASS", klass });
        return klass;
      }
      const fromCode = state.selectedTrain.from.code || state.from.code;
      const toCode = state.selectedTrain.to.code || state.to.code;
      try {
        const live = await api.availability(
          state.selectedTrain.number,
          state.date,
          fromCode,
          toCode,
          klass.code,
        );
        if (!live.bookable) {
          dispatch({ type: "UNAVAILABLE" });
          return live.availability;
        }
        dispatch({ type: "SELECT_CLASS", klass: live.availability });
        return live.availability;
      } catch {
        dispatch({ type: "UNAVAILABLE" });
        return null;
      }
    },
    [state.selectedTrain, state.from, state.to, state.date],
  );

  const goReview = useCallback(async () => {
    const errors = validatePassengers(state.passengers);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      dispatch({ type: "SET_ERROR", error: "Please fix the passenger details." });
      return;
    }
    if (!state.selectedTrain || !state.selectedClass || !state.from || !state.to) return;
    try {
      const live = await api.availability(
        state.selectedTrain.number,
        state.date,
        state.from.code,
        state.to.code,
        state.selectedClass.code,
      );
      if (!isBookable(live.availability.status)) {
        dispatch({ type: "UNAVAILABLE" });
        return;
      }
      const fareRes = await api.fare(
        state.selectedTrain.number,
        state.date,
        state.from.code,
        state.to.code,
        state.selectedClass.code,
        state.passengers.length,
      );
      dispatch({
        type: "GO_REVIEW",
        fare: {
          baseFare: fareRes.fare.baseFare,
          serviceFee: fareRes.fare.serviceFee,
          total: fareRes.fare.total,
        },
      });
    } catch (err) {
      dispatch({
        type: "SET_ERROR",
        error: err instanceof Error ? err.message : "Could not review fare.",
      });
    }
  }, [state]);

  const confirm = useCallback(async () => {
    if (!state.selectedTrain || !state.selectedClass || !state.from || !state.to) return;
    dispatch({ type: "SET_FLOW", flow: "PAYMENT_PENDING" });
    try {
      const fallbackBerth = BERTH_BY_CLASS[state.selectedClass.code]?.[0] ?? "Lower";
      const seat =
        !state.seatPreference || state.seatPreference === "No Preference"
          ? fallbackBerth
          : state.seatPreference;
      const created = state.booking?.status === "DRAFT"
        ? { booking: state.booking }
        : await api.createBooking({
            trainNumber: state.selectedTrain.number,
            date: state.date,
            from: state.from.code,
            to: state.to.code,
            classCode: state.selectedClass.code,
            seatPreference: seat,
            passengers: state.passengers.map((p) => ({
              name: p.name.trim(),
              age: Number(p.age),
              gender: p.gender,
              berthPreference:
                !p.berthPreference || p.berthPreference === "No Preference"
                  ? seat
                  : p.berthPreference,
            })),
          });
      dispatch({ type: "SET_BOOKING", booking: created.booking });
      dispatch({ type: "SET_FLOW", flow: "BOOKING_PENDING" });
      const confirmed = await api.confirmBooking(created.booking.id);
      dispatch({ type: "SET_BOOKING", booking: confirmed.booking });
      setWallet(confirmed.wallet);
    } catch (err) {
      const e = err as Error & { status?: number; code?: string };
      if (e.code === "INSUFFICIENT_FUNDS" || e.status === 402) {
        dispatch({ type: "SET_FLOW", flow: "FARE_REVIEW" });
        dispatch({
          type: "SET_ERROR",
          error: "Insufficient wallet balance.",
        });
        api.wallet().then((r) => setWallet(r.wallet)).catch(() => undefined);
        return;
      }
      dispatch({
        type: "SET_ERROR",
        error: e.message || "Booking failed.",
      });
      dispatch({ type: "SET_FLOW", flow: "FAILED" });
    }
  }, [state]);

  const refreshWallet = useCallback(async () => {
    const r = await api.wallet();
    setWallet(r.wallet);
  }, []);

  const addMoney = useCallback(async (n: number) => {
    const r = await api.addMoney(n);
    setWallet(r.wallet);
  }, []);

  const refreshBookings = useCallback(async () => {
    const r = await api.listBookings();
    setBookings(r.bookings);
  }, []);

  const retrieve = useCallback(async (id: string) => {
    const r = await api.getBooking(id.trim());
    dispatch({ type: "SET_BOOKING", booking: r.booking });
    dispatch({ type: "GO", screen: "status" });
  }, []);

  const cancel = useCallback(async (id: string) => {
    const r = await api.cancelBooking(id);
    setWallet(r.wallet);
    await refreshBookings();
  }, [refreshBookings]);

  const value = useMemo<BookingCtx>(
    () => ({
      state,
      meta,
      wallet,
      bookings,
      fieldErrors,
      setFrom: (station) => dispatch({ type: "SET_FROM", station }),
      setTo: (station) => dispatch({ type: "SET_TO", station }),
      swap: () => dispatch({ type: "SWAP_ENDS" }),
      setDate,
      setPassengerCount: (count) => dispatch({ type: "SET_PASSENGER_COUNT", count }),
      resetJourney: () => dispatch({ type: "RESET_JOURNEY" }),
      search,
      searchRoute: runSearch,
      showResults,
      patchTrain: (trainNumber, classes) => dispatch({ type: "PATCH_TRAIN", trainNumber, classes }),
      selectTrain: (train) => dispatch({ type: "SELECT_TRAIN", train }),
      selectTrainAndClass: (train, klass) => dispatch({ type: "SELECT_TRAIN_AND_CLASS", train, klass }),
      selectClass,
      selectSeat: (seat) => dispatch({ type: "SELECT_SEAT", seat }),
      updatePassenger: (id, patch) => dispatch({ type: "UPDATE_PASSENGER", id, patch }),
      addPassenger: () => dispatch({ type: "ADD_PASSENGER" }),
      removePassenger: (id) => dispatch({ type: "REMOVE_PASSENGER", id }),
      goReview,
      confirm,
      go: (screen) => dispatch({ type: "GO", screen }),
      back: () => dispatch({ type: "BACK" }),
      newBooking: () => dispatch({ type: "NEW_BOOKING" }),
      cancelHome: () => dispatch({ type: "CANCEL_HOME" }),
      refreshWallet,
      addMoney,
      refreshBookings,
      retrieve,
      cancel,
      clearNotice: () => dispatch({ type: "CLEAR_NOTICE" }),
    }),
    [
      state,
      meta,
      wallet,
      bookings,
      fieldErrors,
      setDate,
      search,
      selectClass,
      goReview,
      confirm,
      refreshWallet,
      addMoney,
      refreshBookings,
      retrieve,
      cancel,
      showResults,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBooking(): BookingCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBooking outside provider");
  return ctx;
}
