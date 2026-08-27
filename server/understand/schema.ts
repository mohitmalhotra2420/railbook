import { z } from "zod";

const IntentEnum = z.enum([
  "BOOK_TRAIN",
  "SEARCH_TRAIN",
  "CHECK_PNR",
  "VIEW_BOOKINGS",
  "CANCEL_BOOKING",
  "VIEW_WALLET",
  "ADD_MONEY",
  "SELECT_FASTEST",
  "SELECT_CHEAPEST",
  "SELECT_BEST",
  "FIND_ALTERNATE",
  "CHANGE_DATE",
  "CONFIRM_YES",
  "CONFIRM_NO",
  "HELP",
  "LIVE_TRAIN_STATUS",
  "TRAIN_SCHEDULE",
  "LIST_CITIES",
  "RAIL_POLICY",
  "ABOUT_ASSISTANT",
  "CANCELLED_TRAINS",
  "CHECK_AVAILABILITY",
  "CHECK_FARE",
  "COMPARE_TRAINS",
  "SELECT_TRAIN",
  "GENERAL_RAILWAY_KNOWLEDGE",
  "TRAIN_HISTORY",
  "OUT_OF_DOMAIN",
  "NONE",
]);

const PreferencesSchema = z
  .object({
    train: z.enum(["fastest", "cheapest", "best"]).nullable().optional().default(null),
    time: z.enum(["morning", "afternoon", "evening", "night"]).nullable().optional().default(null),
    seat: z.string().nullable().optional().default(null),
    quota: z.string().nullable().optional().default(null),
  })
  .optional()
  .default({});

export const ExtractionSchema = z.object({
  intent: IntentEnum.catch("SEARCH_TRAIN"),
  origin: z.string().nullable().optional().default(null),
  destination: z.string().nullable().optional().default(null),
  date: z.string().nullable().optional().default(null),
  dateIso: z.string().nullable().optional().default(null),
  passengers: z.number().int().min(1).max(6).nullable().optional().default(null),
  class: z.string().nullable().optional().default(null),
  preferences: PreferencesSchema,
  corrections: z
    .array(
      z.object({
        field: z.enum(["origin", "destination", "date", "passengers", "class"]),
        value: z.string(),
      }),
    )
    .optional()
    .default([]),
  missingFields: z.array(z.string()).optional().default([]),
  confidence: z.number().min(0).max(1).optional().default(0.6),
  clarificationNeeded: z.boolean().optional().default(false),
  suggestedAction: z
    .enum([
      "searchTrains",
      "getAvailability",
      "getFare",
      "getLiveStatus",
      "getCancelledTrains",
      "checkPNR",
      "getWallet",
      "getMyBookings",
      "compareTrains",
      "selectTrain",
      "updateBookingState",
      "none",
    ])
    .optional()
    .catch("none")
    .default("none"),
  trainNumber: z.string().nullable().optional().default(null),
  tool: z.string().nullable().optional().default(null),
  selectionIndex: z.number().int().min(1).max(20).nullable().optional().default(null),
  contextAction: z.enum(["preserve", "update", "interrupt", "resume", "new"]).optional().catch("preserve").default("preserve"),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

/** Accept both the current schema and older field names from tests/mocks. */
export function parseExtraction(raw: unknown): Extraction | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const prefs =
    o.preferences && typeof o.preferences === "object"
      ? (o.preferences as Record<string, unknown>)
      : {};
  const intentAliases: Record<string, string> = {
    PNR_STATUS: "CHECK_PNR",
    BOOKING_HISTORY: "VIEW_BOOKINGS",
    AVAILABILITY: "CHECK_AVAILABILITY",
    FARE: "CHECK_FARE",
    TRAIN_INFO: "TRAIN_SCHEDULE",
    STATION_LOOKUP: "SEARCH_TRAIN",
    UNKNOWN: "NONE",
    CANCELLATION_STATUS: "CANCELLED_TRAINS",
    LIVE_STATUS: "LIVE_TRAIN_STATUS",
  };
  const rawIntent = typeof o.intent === "string" ? o.intent : "";
  const entities = o.entities && typeof o.entities === "object" ? (o.entities as Record<string, unknown>) : {};
  const normalized = {
    ...o,
    intent: intentAliases[rawIntent] ?? rawIntent,
    date: o.date ?? o.dateText ?? entities.date ?? null,
    origin: o.origin ?? entities.origin ?? null,
    destination: o.destination ?? entities.destination ?? null,
    class: o.class ?? o.classPreference ?? entities.class ?? null,
    passengers: o.passengers ?? entities.passengers ?? null,
    trainNumber: o.trainNumber ?? entities.trainNumber ?? null,
    selectionIndex: o.selectionIndex ?? entities.selectionIndex ?? null,
    preferences: {
      train: prefs.train ?? o.trainPreference ?? null,
      time: prefs.time ?? o.timePreference ?? null,
      seat: prefs.seat ?? o.seatPreference ?? null,
      quota: prefs.quota ?? o.quota ?? null,
    },
  };
  const safe = ExtractionSchema.safeParse(normalized);
  return safe.success ? safe.data : null;
}

export const EXTRACTION_JSON_SCHEMA = {
  name: "railbook_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "intent",
      "origin",
      "destination",
      "date",
      "dateIso",
      "passengers",
      "class",
      "preferences",
      "corrections",
      "missingFields",
      "confidence",
      "clarificationNeeded",
      "suggestedAction",
    ],
    properties: {
      intent: {
        type: "string",
        enum: [
          "BOOK_TRAIN",
          "SEARCH_TRAIN",
          "CHECK_PNR",
          "VIEW_BOOKINGS",
          "CANCEL_BOOKING",
          "VIEW_WALLET",
          "ADD_MONEY",
          "SELECT_FASTEST",
          "SELECT_CHEAPEST",
          "SELECT_BEST",
          "FIND_ALTERNATE",
          "CHANGE_DATE",
          "CONFIRM_YES",
          "CONFIRM_NO",
          "HELP",
          "LIVE_TRAIN_STATUS",
          "TRAIN_SCHEDULE",
          "LIST_CITIES",
          "RAIL_POLICY",
          "ABOUT_ASSISTANT",
          "OUT_OF_DOMAIN",
          "NONE",
        ],
      },
      origin: { type: ["string", "null"] },
      destination: { type: ["string", "null"] },
      date: { type: ["string", "null"], description: "Natural date phrase as spoken" },
      dateIso: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
      passengers: { type: ["integer", "null"] },
      class: { type: ["string", "null"] },
      preferences: {
        type: "object",
        additionalProperties: false,
        required: ["train", "time", "seat", "quota"],
        properties: {
          train: { anyOf: [{ type: "string", enum: ["fastest", "cheapest", "best"] }, { type: "null" }] },
          time: {
            anyOf: [{ type: "string", enum: ["morning", "afternoon", "evening", "night"] }, { type: "null" }],
          },
          seat: { type: ["string", "null"] },
          quota: { type: ["string", "null"] },
        },
      },
      corrections: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["field", "value"],
          properties: {
            field: { type: "string", enum: ["origin", "destination", "date", "passengers", "class"] },
            value: { type: "string" },
          },
        },
      },
      missingFields: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
      clarificationNeeded: { type: "boolean" },
      suggestedAction: {
        type: "string",
        enum: ["searchTrains", "getAvailability", "getFare", "updateBookingState", "none"],
      },
    },
  },
} as const;
