/**
 * OpenAI-compatible tool schemas that the NVIDIA model may call.
 * READ-ONLY railway facts only. No booking / wallet mutation tool exists here on purpose.
 */

export type AutoToolName =
  | "searchStations"
  | "searchTrains"
  | "getTrainInfo"
  | "getTimetable"
  | "getLiveStatus"
  | "getAvailability"
  | "findSeats"
  | "getFare"
  | "getCancelledTrains"
  | "checkPNR"
  | "getMyBookings"
  | "getWallet";

export const AUTO_TOOL_NAMES: AutoToolName[] = [
  "searchStations",
  "searchTrains",
  "getTrainInfo",
  "getTimetable",
  "getLiveStatus",
  "getAvailability",
  "findSeats",
  "getFare",
  "getCancelledTrains",
  "checkPNR",
  "getMyBookings",
  "getWallet",
];

const CLASS_ENUM = ["1A", "2A", "3A", "3E", "SL", "CC", "EC", "2S", "EA"];

export const AUTO_TOOLS = [
  {
    type: "function",
    function: {
      name: "searchStations",
      description:
        "Resolve a city/station name (Hindi, English or Hinglish, e.g. 'Ludhiana', 'दिल्ली', 'Jammu') to official Indian Railways station codes via the live railway API. Use it when the user asks about stations in a city, or when searchTrains reported needChoice. For a normal journey search you can pass city names straight into searchTrains.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "City or station name spoken by the user" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "searchTrains",
      description:
        "Live train search for a date. Returns the real list of trains with departure/arrival times and classes. `from`/`to` accept a station code (ASR) OR the city/station name exactly as the user said it (\"Amritsar\", \"दिल्ली\") — the server resolves names via the live station API. If the result says needChoice, ask the user which station and search again with that code. Requires a journey date in YYYY-MM-DD that the user actually gave (never assume today).",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Origin station code or city name, e.g. ASR or Amritsar" },
          to: { type: "string", description: "Destination station code or city name, e.g. LDH or Ludhiana" },
          date: { type: "string", description: "Journey date YYYY-MM-DD" },
        },
        required: ["from", "to", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getTrainInfo",
      description: "Basic info (name, running days) for a 5-digit train number.",
      parameters: {
        type: "object",
        properties: { trainNumber: { type: "string", description: "5-digit train number" } },
        required: ["trainNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getTimetable",
      description:
        "Full stop-by-stop timetable/route of a train (station codes, arrival, departure). Use for 'route', 'kitne stops', 'kya X pe rukti hai', 'kitne ghante', 'X jaati hai kya'.",
      parameters: {
        type: "object",
        properties: { trainNumber: { type: "string" } },
        required: ["trainNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getLiveStatus",
      description:
        "Live running status of a train for a given START date run: current station, delay minutes, last update. Use for 'kahan hai', 'kitni late', 'live status', 'running status'. 'kal wali/yesterday/parson/7 Sep wali' = PAST run → pass that start date (yesterday = today-1). Completed runs also return final status/delay. Omit date for today's run (server auto-finds the still-running previous-day run for multi-day trains).",
      parameters: {
        type: "object",
        properties: {
          trainNumber: { type: "string" },
          date: { type: "string", description: "Run START date YYYY-MM-DD (past dates allowed, up to 40 days); omit for today" },
        },
        required: ["trainNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "findSeats",
      description:
        "Ek route ke SAARE trains par seat/class/availability ek call me (live board + per-train rows). " +
        "Seat/berth/class sawaal ke liye YEHI tool pehle call karo — jaise '2A me kaunsi train me seat hai', " +
        "'AC trains dikhao', 'sabse sasti seat wali', 'raat 9 ke baad sleeper me seat', 'sirf confirmed wali', " +
        "'12029 me seat hai kya'. classCode 'ALL' | 'AC' | '2A'/'3A'/'SL'/'CC'/'EC'/'2S' (comma se kai), " +
        "afterText = user ki time bhasha as-is ('5 baje ke baad'), sortBy 'cheapest'|'fastest'. " +
        "WL ka confirm% kabhi mat batao (data nahi) — sirf WL number.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Origin station code/naam" },
          to: { type: "string", description: "Destination station code/naam" },
          date: { type: "string", description: "YYYY-MM-DD" },
          classCode: { type: "string", description: "'ALL' | 'AC' | '1A'|'2A'|'3A'|'3E'|'SL'|'CC'|'EC'|'2S' (comma-separated bhi)" },
          onlyAvailable: { type: "boolean", description: "true = sirf AVAILABLE/RAC (default), false = WL/N-A bhi" },
          afterText: { type: "string", description: "Time filter, user ki bhasha: '5 baje ke baad' / '17:00'" },
          sortBy: { type: "string", description: "'cheapest' (sabse sasta) | 'fastest' (sabse kam time)" },
          trainNumbers: { type: "string", description: "Sirf in trains par — comma-separated" },
        },
        required: ["from", "to", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getAvailability",
      description:
        "Seat availability (AVAILABLE/RAC/WAITLIST with counts) for one train + class + date between two station codes. Needs all of: trainNumber, from, to, date, classCode. If the user did not name a class, ask or check the class codes returned by searchTrains.",
      parameters: {
        type: "object",
        properties: {
          trainNumber: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD" },
          classCode: { type: "string", enum: CLASS_ENUM },
          quota: { type: "string", description: "GN (default), TQ (tatkal), LD (ladies), SS (senior)" },
        },
        required: ["trainNumber", "from", "to", "date", "classCode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getFare",
      description:
        "Railway fare per passenger + RailBook service fee for a train/class/route. Needs trainNumber, from, to, date, classCode; passengers defaults to 1.",
      parameters: {
        type: "object",
        properties: {
          trainNumber: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          date: { type: "string" },
          classCode: { type: "string", enum: CLASS_ENUM },
          passengers: { type: "integer", minimum: 1, maximum: 6 },
        },
        required: ["trainNumber", "from", "to", "date", "classCode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getCancelledTrains",
      description: "Today's list of fully and partially cancelled trains from the railway provider.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "checkPNR",
      description: "PNR status for a 10-digit PNR number.",
      parameters: {
        type: "object",
        properties: { pnr: { type: "string", description: "10-digit PNR" } },
        required: ["pnr"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getMyBookings",
      description: "The user's own RailBook bookings (demo bookings in this app).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "getWallet",
      description: "Read-only wallet balance. Cannot add or deduct money.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

export function isAutoTool(name: string): name is AutoToolName {
  return (AUTO_TOOL_NAMES as string[]).includes(name);
}
