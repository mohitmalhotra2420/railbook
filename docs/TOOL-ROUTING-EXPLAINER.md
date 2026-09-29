# "ChatGPT sahi tool kaise chunta hai?" — aur RailBook isme kahan khada hai

**User ka sawaal (29 Sep 2026):** *"ChatGPT ke developers ne har sawaal pehle se nahi likha hoga, phir bhi wo
haर baar sahi tool kaise chun leta hai? Humara AI bhi waisa hi kare."*

## 1. ChatGPT ise kaise karta hai (asli 5 hisse — koi jaadu nahi)

1. **Tool ka description ek "instruction" hota hai, list-item nahi.** Model ko tool ka naam nahi, uska
   *kaam* bataaya jaata hai: "jab user X poochhe to PEHLE ye call karo". Model phir apni bhasha-samajh se
   kaam ko description se milata hai — isliye naye phrasing par bhi kaam karta hai.
2. **Ek "policy" layer** — system prompt me thode se general rules (kai sawaalon par lagne wale), jaise
   "live data se pehle tool chalao", "data na mile to sach batao", "ek jagah se do jagah ka safar ho to
   plan ka tool". Ye rules sawaal-specific nahi hote — isliye hazaar tarah ke sawaal cover ho jaate hain.
3. **Model ki general reasoning** (pretraining) — intent padhna usi se aata hai. Training se hi model ko
   pata hota hai ki "late hai kya" = live status, "kitna lagega" = fare/plan. Isi liye poochne ki zaroorat
   nahi padti.
4. **Feedback loops (asli raaz):** jawab grounded hai ya nahi (numbers evidence me hain?), tool fail hua to
   agla tool, jawab adhoora hai to dobara soche, aur ambiguous ho to **ek saaf sawaal** poochhe. Asli
   product yahi loops se "perfect" lagta hai — pehli koshish me nahi.
5. **Eval batteries:** developer alag-alag tarah ke sawaalon ki list rakhta hai aur har release par
   chala kar dekhta hai kaun sa routing toota. Jo failure aata hai, uska ilaaj tool description ya guard
   me hota hai — us ek sawaal par patch nahi.

## 2. RailBook me ye sab kahan hai

| Pillar | RailBook me |
|---|---|
| Tool = instruction | `FIND_SEATS_DESCRIPTION` ("jab user seat/sirf confirmed poochhe to PEHLE ye call karo…"), TRACK_TRAIN, GET_FARE, CHECK_PNR sab me |
| Policy layer | system rules 25b (live data tumhare paas hai), 30 (live vs general mode), 31 (khud ka dimaag: pehle iraada, phir tool, missing ho to poochho), **32 (intent → tool ka naksha)**, 33 (resolve-only), **34 (jawab me sirf tool ka data — apni memory se kuch nahi)** |
| Model reasoning | NIM ka gpt-oss-20b/muse — Hinglish/Hindi samajhta hai; aapke exact phrasing ("Yaar LDH se SVDK…") par khud stations/date nikaal kar tool chunta hai |
| Feedback loops | grounded check (numbers evidence me na ho to jawab reject), adequacy net (R45), station-code verification (R46), **tool-recovery HINT (R54 — fail hue tool ke result me usi kaam ke agle tools ki list model ko di jaati hai)**, ambiguity par chips wala ek saaf sawaal |
| Eval battery | **`tools/round54-routing-battery.mts`** — 12 alag-alag sawaal, har ek ka sahi tool family; PASS/KB/FAIL report |

## 3. R54 battery ka asli result (local, aaj)

```
PASS | live status        | tools: getLiveStatus          | 12326 late hai kya
PASS | timetable/route    | tools: GET_TIMETABLE          | 12013 ka poora route batao
PASS | route seat         | tools: FIND_SEATS             | LDH se JAT kal confirm seat batao
PASS | train+class seat   | tools: CHECK_AVAILABILITY     | 12094 me 3A me kitni seat khali hai kal
PASS | fare               | tools: GET_FARE               | 12013 ka kiraya LDH se ASR 3A
PASS | PNR                | tools: CHECK_PNR              | PNR 1234567890 ka status
PASS | cancellations      | tools: GET_CANCELLED_TRAINS   | aaj koi train cancel hui hai kya
PASS | station board      | tools: GET_STATION_BOARD      | LDH par abhi kaunsi trains aa rahi hain
KB   | rules              | tools: (none, 0s)             | tatkal booking kitne baje khulti hai
KB   | general knowledge  | tools: (none, 0s)             | sabse lambi train kaun si hai
PASS | coach position     | tools: GET_COACH_POSITION     | 12013 me coach position kya hai
PASS | route + timing     | tools: FIND_SEATS             | kal subah LDH se DLI jane wali trains ke timings
```
**Matlab: 10/12 sawaalon par model ne KHUD sahi tool chuna. 2 sawaal (rules/GK) model tak jaate hi nahi —
curated railway KB se 0 second me verified jawab aata hai (R40b).** Ye sirf itminaan hai: "tatkal 10/11 baje"
ya "Vivek Express 4,154 km" jaise facts model ki yaad par chhodna galat number de sakta hai (R40 me model ne
4,273 km likh diya tha). Agar aap chahein to in sawaalon par bhi model se jawab likhwa sakte hain (KB ke facts
diye jaate hain) — bata dijiye, ek line ka kaam hai; abhi maine accuracy ko pehle rakha hai.

## 4. Aage kya (jab provider/key aaye)

- Battery ko har release par chalana (ab tool ban gaya) — jo sawaal FAIL ho, uska ilaaj **tool description
  ya policy rule** me karna (us sawaal par patch nahi), bilkul waise jaise upar pillar 5 me likha hai.
- `AI_LLM_*` env se naya provider lagne par battery dobara — alag model ka routing behaviour alag hota hai.

## 5. LIVE PROD battery (deploy 5df4cd4 — 29 Sep 2026, asli app par)

```
PASS | live status        | 15s | TRACK_TRAIN                         | 12326 late hai kya
PASS | timetable/route    | 24s | GET_TIMETABLE                       | 12013 ka poora route batao
PASS | route seat         | 28s | FIND_SEATS ×2                       | LDH se JAT kal confirm seat batao
PASS | train+class seat   | 11s | CHECK_AVAILABILITY (fail→hint)      | 12094 me 3A me kitni seat khali hai kal
PASS | fare               |  5s | GET_FARE                            | 12013 ka kiraya LDH se ASR 3A
PASS | PNR                | 28s | CHECK_PNR ✗ → WEB_SEARCH            | PNR 1234567890 ka status batao
PASS | cancellations      |  5s | GET_CANCELLED_TRAINS                | aaj koi train cancel hui hai kya
PASS | station board      | 47s | GET_STATION_BOARD                   | LDH par abhi kaunsi trains aa rahi hain
KB   | rule               |  0s | (curated KB)                        | tatkal booking kitne baje khulti hai
KB   | general knowledge  |  0s | (curated KB)                        | sabse lambi train kaun si hai
PASS | coach position     | 33s | GET_COACH_POSITION ✗ → GET_TRAIN_INFO| 12013 me coach position kya hai
PASS | route + timing     | 27s | FIND_SEATS ×2                       | kal subah LDH se DLI jane wali trains ke timings

ROUTING PASS: 10/12 (KB path: 2) — prod par wahi natija jo local par.
```
**Dhyaan dene wali baat:** `CHECK_PNR ✗ → WEB_SEARCH` aur `GET_COACH_POSITION ✗ → GET_TRAIN_INFO` — yaani jab pehla tool fail hua, model ne **hint ke hisaab se khud agla sahi tool chalaya** (R54 loop, live prod par kaam karta dikha).

## 6. Round-54b — "zero-tool self-repair" (ChatGPT wala sudhaar-loop, ab humare paas bhi)

Problem: model kabhi bina koi tool chalaye seedha jawab likh deta tha — jaise *"12326 25 minute late hai"* ya *"mere paas live data ka access nahi hai"* (dono hi galat; numbers banaye hue, aur tools uske paas hain). Ab server ek **feedback loop** chalata hai:

- Sawaal LIVE type ka ho (seat/fare/status/PNR/timetable/board/cancellation) **aur** ek bhi tool na chala ho **aur** jawab me data jaise numbers ya "access nahi hai" jaisi baat ho →
- server ek **corrective round** bhejta hai: *"ye LIVE sawaal hai, bina tool ke jawab mana hai — abhi sahi tool chalao"* + kaam ke hisaab se tool ka naam (status → TRACK_TRAIN, seat → CHECK_AVAILABILITY/FIND_SEATS, fare → GET_FARE, PNR → CHECK_PNR, timetable → GET_TIMETABLE, board → GET_STATION_BOARD).
- Model phir tool chalata hai aur usi data se jawab deta hai. Ye round **user ko dikhta nahi** (system ke andar hota hai).
- Legit clarification (station/passenger/date poochna) isse chhooti hai — wahan poochhna hi sahi hai.

Test: `tests/round54-self-repair.test.ts` (2) — pehla test dekhta hai ki bina-tool jawab par corrective round jaata hai aur phir asli tool chalta hai; doosra ki legit clarification par loop trigger nahi hota.
