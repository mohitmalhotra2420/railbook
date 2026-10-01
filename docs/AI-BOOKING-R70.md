# R70 — AI Booking journey fix: Mathura + "1" = station, "LUDHIANA se" = source (1 Oct 2026)

**User screenshots (1 Oct, 09:07 & 09:10):**
- Pehla: `Mathura mein kaun sa station? 1. MTJ ... 2. MRT ...` par `1` dabaya → `1 passenger.` ban gaya (station nahi pakda), phir `LUDHIANA se` ke baad bhi `Aur kahan jaana hai?` repeat.
- Dusra: `मुझे मथुरा जाना है` → `Ye station samajh nahi aaya`, phir `मथुरा के लिए कई स्टेशन ... 1. IB - Ib` (galat list), `Server voice abhi nahi aayi` banner.
- Complaint: "AI booking open nhi ho rha" + mic catch karta hai par results galat, chat pe sahi aate hain; mic ko ConfirmTkt/ChatGPT jaisa banao; `har baar engine bhejta hai kahan se kahan jaana hai` starting mein; chat architecture ko touch mat karna — sab AI Booking me.

**Wajah (code me mili, guess nahi):**
1. `CLIENT_STATIONS` me **Mathura cluster hi nahi tha** (54 stations only) → `findCityMentions("mathura")` kabhi Mathura ko city hi nahi maanta, `clusterStations("mathura")` empty → cityChoice galat (IB-OD list server ke generic fallback se).
2. City station choice par `1` ko `parsePaxCount("1")` aur `parseDatePhrase("1", {allowDayOnly:true})` ne **1 passenger / 1 Oct** bana diya — `pendingCity` ke jawab me pax/date nahi nikalna chahiye.
3. `"मुझे मथुरा जाना है"` me `mathura` ko **FROM** bana diya (order se), jabki `जाना है` → **TO** hona chahiye. `LUDHIANA se` (FROM) ka `से` particle ignore ho raha tha.
4. `pendingCity = mathura TO` rehte hue `LUDHIANA se` ko usi pending slot me `To=LDH` set kar deta tha, Mathura lose ho jaata tha — `outside` logic galat tha (otherSlot bharna chahiye tha, pending ko nahi).
5. `Server voice abhi nahi aayi` banner har listening par dikh raha tha (device fallback kaam kar raha tha, par banner noisy tha) — mic ka UI 5 buttons se bhara hua.

**Fix — sirf AI Booking ke andar (chat architecture untouched):**

- `src/ai/stations.ts` — Mathura cluster add: `MTJ, MRT, MUW, MPRD` (city Mathura), `CITY_NAME_ALIASES` me `mathura / मथुरा / Mathura Junction` → `mathura` city.
- `src/ai/stationPick.ts` — `matchOfferedStation` me numeric `1`..`6` aur Hindi `pehla/dusra` se direct `offered[idx]` pick (R70).
- `src/ai/aiBookingFlow.ts` — `collectJourney`:
  - `pendingWasResolved` flag + `isPureNumericChoice` (`/^[1-6][.)]?$/`) — pure numeric `1` par **date/pax bilkul nahi** (warna 1 Oct / 1 passenger).
  - `inferSlotForMention` — `से / से` → FROM, `को/तक/जाना/जाना` + single city `जाना है` → TO (latin + Devanagari दोनों). `LUDHIANA se` ab sahi FROM.
  - `outside` (city ke bahar station) — pending TO hai aur `LUDHIANA se` aaya to **otherSlot (FROM) bharo, pending ko rehne do** (Mathura lose nahi hoga).
  - Pending rehte hue bhi `2 log` jaisi pax/date yaad rahe, par `1` numeric par nahi.
- `src/views/AiBooking.tsx` — `voiceIssue === "server-failed"` ka banner **silent fallback** (device voice chal raha hai to banner nahi) — `playback-blocked` / `no-output` hi dikhega, dismissible.

**Verification (local, is build par):**

- `npx vitest run tests/ai-booking-flow.test.ts` → 54/54, `round60-station-choice` 5/5, `ai-booking-ui` 21/21
- Manual `aiBookingTurn` trace:
  - `मुझे मथुरा जाना है` → pending `mathura:to` (MTJ/MRT/MUW/MPRD list sahi, IB nahi)
  - `1` → `Mathura Junction (MTJ) le liya ✅` (pax/date null, awaiting `from`)
  - `LUDHIANA se` → `Ludhiana Junction se Mathura Junction ✅` (from LDH, to MTJ, pending cleared, awaiting `date`)
  - `Ludhiana se Mathura kal 2 log` → pending `mathura:to` + from LDH + date kal + 2 pax, `1` → search `SEARCH_TRAINS` (from LDH, to MTJ, date, pax 2) — pehle yahi `IB` list aur `1 passenger` ban raha tha.

**Deploy:** commit `ff97d15` (main), Render `dep-dauu9ns1nsns73foh8mg` (commit ff97d15) — prod `/api/version` par verify karna hai; web deploy ke baad app bina naya APK ke bhi taaza ho jayega (R69 ka stale-bundle self-heal).
