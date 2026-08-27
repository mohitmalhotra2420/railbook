import "@testing-library/jest-dom/vitest";

// Isolate tests from local .env keys/provider so unit tests never hit live APIs.
process.env.RAILWAY_PROVIDER = "mock";
process.env.RAILKIT_API_KEY = "";
process.env.RAILCORE_API_KEY = "";
