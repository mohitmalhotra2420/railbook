import "@testing-library/jest-dom/vitest";

// Isolate tests from local .env keys/provider so unit tests never hit live APIs.
process.env.RAILWAY_PROVIDER = "mock";
process.env.RAILKIT_API_KEY = "";
process.env.RAILCORE_API_KEY = "";
// Round-16o: optional extra fallback APIs bhi offline — tests apna mock lagate hain.
process.env.RAILRADAR_API_KEY = "";
process.env.INDIANRAILAPI_KEY = "";
// Agentic tool-calling path must also stay offline; tests stub NVIDIA via setAgenticNvidiaFetch.
process.env.NVIDIA_API_KEY = "";
// 23 Sep 2026: naye live web sources (ConfirmTkt board + Wikipedia facts) bhi tests me
// default OFFLINE — warna "sab source fail" wale legacy tests real internet se data utha
// lete the aur UNKNOWN ki jagah AVAILABLE assert kar dete. Jo test live CT chikana chahe
// wo apna mock _setConfirmTktFetchForTests / _setWikipediaFetchForTests se lagayega.
import { _setConfirmTktFetchForTests } from "../server/railway/confirmtkt";
import { _setWikipediaFetchForTests } from "../server/railway/wikitrain";
const _offline = (async () => {
  throw new Error("live web disabled in tests");
}) as unknown as typeof fetch;
_setConfirmTktFetchForTests(_offline);
_setWikipediaFetchForTests(_offline);

// Round-16: web-scrape fallback (railyatri/erail/railenquiry) bhi offline —
// jo test scrape chahta hai wo setScrapeFetch se apna mock lagata hai.
import { setScrapeFetch } from "../server/railway/webscrape";
setScrapeFetch(async () => new Response("", { status: 404 }));
