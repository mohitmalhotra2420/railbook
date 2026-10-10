/* ── RAILWAY KNOWLEDGE BASE (user request 2026-09-06: "AI ke paas har cheez
 * ka answer ho — user railway se related KUCHH BHI pooch sakta hai") ──
 *
 * General railway concepts jo har user poochh sakta hai: classes, tatkal,
 * RAC/WL, chart, PNR, facilities, train types, coaches... Ye STABLE facts
 * hain (live data nahi) — isliye local KB se dena web search se bhi fast +
 * reliable hai. KB miss ho to universal web fallback chalta hai (run.ts).
 *
 * Rule: sirf well-established general knowledge — koi specific train ka
 * data nahi, koi live figure nahi, koi guess nahi. */

export type KbEntry = {
  /** Lowercase patterns — question text in scoring (zyada word-match = better). */
  keys: string[];
  /** Hinglish answer — user-friendly, 2-6 lines. */
  answer: string;
};

const ENTRIES: KbEntry[] = [
  {
    keys: ["sleeper class", "sl class", "sleeper coach", "sl kya", "sleeper kya", "sleeper mein", "non ac sleeper", "sleeper ka matlab"],
    answer:
      "Sleeper class (SL) Indian Railways ka non-AC sleeper coach hota hai — 3-tier berth layout (upper/middle/lower + side upper/lower), openable windows, fans, aur basic bedding nahi milti (bedroll alag se lena hota hai ya AC class mein milti hai). Ek SL coach mein aam taur par 72 berths hote hain. Long-journey ka sabse sasta sleeper option hai. Booking ke time class 'SL' select karte hain.",
  },
  {
    keys: ["3a class", "3 ac", "3ac", "ac 3 tier", "third ac", "3a kya", "3a mein", "ac third"],
    answer:
      "3A (AC 3-Tier) air-conditioned sleeper class hai — 3-tier berths (upper/middle/lower + side), bedding (blanket/sheet/towel) included, charging points, aur SL se kam noise. Short aur long dono journeys ke liye sabse popular AC option hai.",
  },
  {
    keys: ["2a class", "2 ac", "2ac", "ac 2 tier", "second ac", "2a kya", "2a mein"],
    answer:
      "2A (AC 2-Tier) air-conditioned sleeper class hai — 2-tier berths (upper/lower + side lower/upper), 4 berths ka bay + side section, bedding included, zyada privacy aur space. 3A se mehnga, 1A se sasta.",
  },
  {
    keys: ["1a class", "1 ac", "first ac", "1ac", "ac first", "1a kya", "1a mein", "first class ac"],
    answer:
      "1A (First AC) sabse premium class hai — lockable private cabins (2-4 berth), attendant service, bedding included, aur sabse zyada fare. Certains trains mein hi hoti hai (Rajdhani/Shatabdi/premium trains).",
  },
  {
    keys: ["cc class", "chair car", "cc kya", "cc mein", "ac chair"],
    answer:
      "CC (AC Chair Car) day-journey AC seating class hai — reserved seats 3+2 layout, Shatabdi/Jan Shatabdi/Vande Bharat/double-decker jaise trains mein hoti hai. Berth nahi — comfortable reclining seats.",
  },
  {
    keys: ["ec class", "executive class", "ec kya", "executive chair"],
    answer:
      "EC (Executive Chair Car) premium day-seating class hai — 2+2 wide seats, zyada legroom, meal service aksar included (train ke hisaab se). Vande Bharat/Shatabdi ki top class.",
  },
  {
    keys: ["2s class", "second sitting", "2s kya", "2s mein"],
    answer:
      "2S (Second Sitting) sabse sasta reserved seating class hai — non-AC bench seats, short/day journeys ke liye. Jan Shatabdi/passenger trains mein aam hai.",
  },
  {
    keys: ["tatkal kya", "tatkal quota", "tatkal booking", "tatkal kaise", "tatkal kitne", "tatkal charge", "tatkal timing", "tatkal kab"],
    answer:
      "Tatkal emergency/last-minute booking quota hai: AC classes ke liye train ke departure se 1 din pehle subah 10:00 AM IST par, non-AC (SL/2S/CC pe depend) ke liye 11:00 AM par khulta hai. Premium Tatkal me fare dynamic (zyada) hota hai, normal Tatkal mein fixed tatkal charges. Tatkal mein ID proof zaroori hai aur refund rules strict hain.",
  },
  {
    keys: ["premium tatkal", "tatkal premium"],
    answer:
      "Premium Tatkal dynamic pricing wala tatkal quota hai — demand ke hisaab se base fare se kaafi zyada ho sakta hai. Normal tatkal ki tarah 1 din pehle khulta hai, par koi refund nahi hota cancellation par (rules IRCTC ke page se verify karein).",
  },
  {
    keys: ["ludhiana platform", "ludhiana junction platform", "ldh platform", "ludhiana station platform", "ludhiana me kitne platform", "ludhiana kitne platform"],
    answer:
      "Ludhiana Junction (LDH) me 7 platforms hain (Wikipedia aur station guides ke hisaab se; 18 tracks, Northern Railway / Firozpur division). Sabse kam platform wale bade stations me nahi — balki Punjab ka sabse vyast junction hai, 200+ trains roz rukti hain. Aapke shehar ka station hai — kuch aur jaanna ho (kaunsi train, seat, live status) to poochh lo.",
  },
  {
    keys: ["sabse purana station", "purana railway station", "oldest station", "pehla station india", "first railway station"],
    answer:
      "India ka pehla railway station Bori Bunder (Mumbai) tha — 16 April 1853 ki pehli train wahin se chali (aaj wahi jagah CSMT/Chhatrapati Shivaji Maharaj Terminus hai). Aaj bhi chalu sabse purane station buildings me Royapuram (Chennai, 1856) aur Howrah (1854) aate hain. 'Sabse purana' ka jawab is baat par depend karta hai ki pehla (1853) ya sabse purana surviving building (1856) poochha ja raha ho.",
  },
  {
    /* Round-41: comparison sawaal — dono taraf ka jawab ek jagah. */
    keys: ["tejas aur vande bharat", "tejas vs vande bharat", "tejas vande bharat fark", "vande bharat vs tejas"],
    answer:
      "Tejas vs Vande Bharat — dono premium AC chair-car day trains, par design aur operator alag:\n• Rake: Tejas = locomotive-hauled LHB coaches (IRCTC chalata hai, pehla 2017 Mumbai–Goa); Vande Bharat = self-propelled EMU trainset (locomotive nahi, Indian Railways, 2019 se).\n• Speed: Tejas practical max ~130 km/h (design 200); Vande Bharat 160 km/h, acceleration bahut tez (0–100 ~52 sec vs Tejas 2–3 min) — chhoti doori par VB usually jaldi pahunchti hai.\n• Classes: dono me CC + EC; VB ki EC me 180° rotating seats.\n• Routes: Tejas sirf kuch routes; Vande Bharat 50+ routes.\n• Catering/dynamic pricing: Tejas IRCTC-operated (chef-curated meals, dynamic pricing); VB me bhi onboard catering (service ke hisaab se included).\n• Extras: Tejas par IRCTC delay-compensation policy rahi hai; VB me nahi. Short: chhota safar + speed → Vande Bharat; airline-jaisa premium feel → Tejas.",
  },
  {
    keys: ["sl aur 3a", "sl vs 3a", "3a vs sl", "sleeper aur 3a", "sl 3a me fark", "3a ya sl", "sl ya 3a"],
    answer:
      "SL vs 3A (sleeper vs AC 3-tier):\n• SL: non-AC 3-tier — 72 berths/coach, fan + khuli khidki, bedding free nahi (alag/paid), reserved me sabse sasta.\n• 3A: AC 3-tier — 64 berths/coach, poora AC, curtains, bedding (blanket/pillow/sheets) included, zyada privacy.\n• Fare: 3A aam taur par SL se ~1.5–2x (route/distance par depend) — exact apni date par GET_FARE se.\n• Choose: budget → SL; raat ka aaram/garam mausam/bachche-buzurg → 3A. (3A me WL zyada hoti hai.)",
  },
  {
    keys: ["2s aur sl", "2s vs sl", "sl vs 2s", "2s ya sl", "sl ya 2s", "sitting ya sleeper"],
    answer:
      "2S vs SL:\n• 2S (Second Sitting): non-AC bench seat, din ke chhote safar ke liye sasta (SL se bhi kam); raat bhar baithna mushkil.\n• SL (Sleeper): non-AC berth, raat ke safar ke liye sahi; thoda mehnga par aaram zyada.\n• Din me 3–5 ghante → 2S; raat ya 6+ ghante → SL. Dono me AC nahi.",
  },
  {
    keys: ["cc aur ec", "cc vs ec", "ec vs cc", "chair car vs executive", "ec me kya alag"],
    answer:
      "CC vs EC (Vande Bharat/Shatabdi):\n• CC (AC Chair Car): 3+2 layout, standard legroom, ~72–78 seats/coach, fare kam.\n• EC (Executive Chair Car): 2+2 layout, ~56 seats, zyada legroom + footrest, Vande Bharat me 180° rotating seats, fare CC se ~1.6–2x.\n• Value → CC; business-class feel → EC. Dono chair cars hain (berth nahi).",
  },
  {
    keys: ["coach position", "coach kahan lagega", "dabba kahan", "coach number kaise pata", "coach position kaise"],
    answer:
      "Coach position live sirf thodi der pehle milta hai — aam taur par departure se ~1–2 ghante pehle jab rake platform par lagti hai. Iske liye: (1) station ka display board / announcement, (2) IRCTC/NTES app ka 'Coach Position', (3) RailBook ke station-board/coach tools (jab provider data de). Live data na mile to main andaza nahi lagaunga — platform board/app hi final hota hai.",
  },
  {
    /* Round-40: "sabse purani/pehli train", "kitne zone", "kitne station", "sabse tez train" jaisa GK. */
    keys: ["pehli train", "first train india", "sabse purani train", "train kab chali", "india ki pehli train", "1853 train"],
    answer:
      "India ki pehli passenger train 16 April 1853 ko chali thi — Bori Bunder (Mumbai) se Thane, 34 km, teen engine ke saath (Sahib, Sindh aur Sultan). Us din ~400 log safar kiya. Sabse purana aaj bhi chalu station building Royapuram (Chennai, 1856) hai; Bori Bunder wahi jagah hai jahan aaj CSMT (Chhatrapati Shivaji Maharaj Terminus) hai.",
  },
  {
    keys: ["kitne zone", "railway zones", "kitne zones", "zone kitne hain", "zones of indian railways"],
    answer:
      "Indian Railways me 18 zonal railways hain — 17 bade zones (Northern, North Western, North Central, North Eastern, Northeast Frontier, Eastern, East Coast, East Central, South Eastern, South East Central, Southern, South Western, South Central, West Central, Western, Central, Konkan Railway) + Kolkata Metro (alag zone). Isliye counting par farq dikhta hai: kai sources Kolkata Metro ko alag gin kar '19 zones' bolte hain, aur South Coast Railway (HQ Visakhapatnam, 2019 me ghoshit) apne divisions ke saath alag zone ban rahi hai. Divisions ~70 hain.",
  },
  {
    keys: ["kitne railway station", "total station", "kitne station hain", "stations in india", "kitne stations"],
    answer:
      "Indian Railways ke paas aaj lagbhag 7,300+ railway stations hain (counting method ke hisaab se figure thoda upar-neeche hota hai — sirf halt/flag-shed gine jaayein to zyada). Sabse zyada stations wale zones me Northern Railway aur Central Railway aate hain. Exact official count waqt ke saath badalta rehta hai.",
  },
  {
    keys: ["sabse tez train", "fastest train", "sabse tez gaadi", "fastest train india"],
    answer:
      "India ki sabse tez operating trains Vande Bharat Express hain — maximum 160 km/h (Delhi–Agra/Tughlakabad–Agra section), aur Gatimaan Express bhi 160 km/h. Uske baad Tejas Rajdhani aur Rajdhani services (130 km/h MPS). Trial me Vande Bharat ne 183 km/h chhue the; railways 180+ km/h (Vande Bharat sleeper/semi-high-speed upgrades) par kaam kar rahi hai.",
  },
  {
    /* Round-39 battery: "Indian Railways ka sabse bada station kaunsa hai?" par kuch nahi aaya tha. */
    keys: ["sabse bada station", "bada railway station", "largest station", "biggest station", "sabse bada railway station", "sabse bada junction"],
    answer:
      "India ka sabse bada railway station (platforms ke hisaab se) Howrah Junction (HWH), West Bengal hai — 23 platforms (India me sabse zyada), roz 600+ trains aur ~10 lakh passengers. Uske baad: Sealdah (21 platforms), CSMT Mumbai (18), Chennai Central (17), New Delhi (16). (Ye general railway knowledge hai — official list IRCTC/Indian Railways se verify kar sakte hain.)",
  },
  {
    keys: ["sabse lambi train", "sabse lamba route", "longest train route", "longest route", "lambi train route", "sabse lambi route", "vivek express", "vivek", "15905", "15906"],
    answer:
      "India ki sabse lambi train route: Vivek Express 15905/15906 — Dibrugarh (Assam) se Kanyakumari (Tamil Nadu), ~4,154 km (Wikipedia ke table ke hisaab se; kuch sources 4,286 km likhte hain), ~82.5 ghante, 9 states — India ki sabse lambi, duniya ki top-25 me. Isse chhoti: 12301/12302 Howrah–New Delhi Rajdhani (~1,451 km).",
  },
  {
    keys: ["konkan railway", "konkan railway kahan", "konkan railway route", "konkan railway kab"],
    answer:
      "Konkan Railway: Roha (Maharashtra, Mumbai ke south) se Thokur (Mangaluru ke paas, Karnataka) tak — lagbhag 741 km, Maharashtra · Goa · Karnataka se guzarti hai. 26 January 1998 se passenger service shuru (Mumbai–Mangalore Netravati Express pehli thi). Ye route coastal hai — Mandovi bridge, Karbude tunnel jaise bade structures isi par hain.",
  },
  {
    /* Round-39: "X se Y kitni doori hai" — live battery me is par Expressway (sadak) ka jawab aa gaya tha. */
    keys: ["kitni doori", "distance kitna", "rail distance", "kitne km", "doori hai", "distance hai", "kitna door"],
    answer:
      "Do station ke beech ki RAIL doori (km) mere live railway data me nahi hoti — mere providers train timings, seat availability, fare, route aur live status dete hain (road/expressway/highway ka data main railway sawaal me bilkul use nahi karta). Jo main sach me bata sakta hoon: aapke route ki ASLI direct trains aur unka journey time (jaise LDH → ASR direct trains se ~2 ghante). Kaunse do station ka time chahiye, bataiye — ya date do, main trains + time nikaal deta hoon.",
  },
  {
    /* Round-39 (battery: pet/smoking/charging/AC-fail/child-ticket jaise roz ke sawaal KB me nahi the) */
    keys: ["kutta train", "pet train", "pet le ja", "dog train", "janvar train", "kutta le ja", "pet booking", "cat train", "billi train"],
    answer:
      "Pet/dog train me: sirf AC First Class (1A) ya First Class (FC) me — pehle se booking karwa kar; Luggage Van me bhi (booking ke saath) le ja sakte hain. Pet ka alag charge lagta hai aur booking zaroori hai (bina booking allowed nahi). Sleeper / 3A / 2A / CC jaise aam coaches me pet allowed nahi hai. Exact charge/process ke liye parcel/luggage office ya IRCTC se confirm karein.",
  },
  {
    keys: ["smoking train", "smoking allowed", "sigret train", "cigarette train", "train me smoking", "beedi train"],
    answer:
      "Train aur railway station par smoking bilkul banned hai (COTPA 2003 + Railway rules) — coach, toilet, platform kisi jagah allowed nahi. Pakde jaane par penalty/fine lagta hai (amount case/jurisdiction ke hisaab se). E-cigarette/vape bhi banned hai.",
  },
  {
    keys: ["charging point", "mobile charge", "charger point", "phone charge", "charging hota"],
    answer:
      "Aaj kal ke reserved coaches me mobile charging point hota hai — SL/3A/2A/1A me berth ke paas (side-lower/bracket ke paas), CC/EC me seat ke aage/deewar par. Purane rakes aur General (GS) dabbe me charging point nahi hota. Na mile to TTE/guard se poochh sakte hain.",
  },
  {
    keys: ["ac fail refund", "ac kharab", "ac nahi chala", "ac failure", "ac band refund", "ac kharab refund"],
    answer:
      "AC kharab hone par refund: onboard staff/TTE se certificate (GC) lo, phir TDR file karo (train ke actual arrival ke 20 ghante ke andar; e-ticket par IRCTC par online). Refund jitni doori AC kaam nahi kiya utne ka difference hota hai — 3A/2A: (AC fare − Sleeper fare), AC First/Executive: (AC fare − First class fare), CC: (CC fare − Second class fare). TTE ka original certificate zaroori hota hai.",
  },
  {
    keys: ["bachche ka ticket", "bacche ka ticket", "child ticket", "bachcha ticket", "baby ticket", "child fare", "5 saal ka bachcha", "chhote bachche ka"],
    answer:
      "Bachchon ka ticket rule: 5 saal se chhote — ticket nahi lagta (free), par alag berth nahi milta, adult ke saath share. 5 se 12 saal — alag berth chahiye to full (adult) fare; bina alag berth (share karke) to half fare. 12 saal ke upar se normal full fare. Booking ke waqt bachche ki age theek daalein, warna onboard problem hoti hai.",
  },
  {
    keys: ["2a 3a fare fark", "2a aur 3a", "3a 2a me fark", "3a se 2a", "class wise fare fark", "2a zyada mehnga"],
    answer:
      "Fare ka aam order (sasta → mehnga): 2S < SL < 3A/3E < CC < 2A < EC/1A. 2A aam taur par 3A se lagbhag 25–40% mehnga hota hai (AC sleeper 2-tier me 46 berths vs 64 in 3A). Exact difference train, distance, dynamic/flexi fare aur date par depend karta hai — apne exact train+date ka asli fare main provider se nikaal ke bata sakta hoon.",
  },
  {
    /* Round-38 (battery: accessibility sawaal par "Passenger train toilet" ka adhoora page aa raha tha) */
    keys: ["wheelchair facility", "divyangjan facility", "divyang facility", "handicapped facility", "wheelchair wale", "accessible toilet", "divyangjan"],
    answer:
      "Divyangjan (wheelchair) passengers ke liye Indian Railways ki facility: online booking me 'Divyangjan' option chuno (concession + lower berth priority) · station par wheelchair/ trolley free milti hai (station master/ enq desk se) · train me SLR/guard coach ke paas reserved divyangjan berths (2 per coach, door ke paas) · bade stations par lift/ramp/accessible toilet · escort ke saath travel par bhi concession. Booking ke waqt passenger type 'Divyangjan' select karna zaroori hai, warna priority berth nahi milti.",
  },
  {
    /* Round-38 (battery: "Sleeper coach me kitne berth hote hain?" par Wikipedia Vande Bharat ka page aa gaya) */
    keys: ["sleeper coach berth", "coach me kitne berth", "kitne berth hote", "berth count", "sl coach berth", "3a me kitne berth", "2a me kitne berth", "1a me kitne berth", "chair car seat"],
    answer:
      "Aam IR coach layout (per coach): Sleeper (SL) 72 berths · 3A 64 berths · 2A 46 berths · 1A 22 berths (kabhi 24) · Chair Car (CC) 78 seats (kuch 102) · 2S 108 seats · EC 56 seats. SL/3A me side-lower 2 berths share karte hain (RAC). Train/rake ke hisaab se thoda farq ho sakta hai — exact berth count seat-selection/coach layout par depend karta hai.",
  },
  {
    keys: ["rajdhani top speed", "rajdhani ki speed", "rajdhani maximum speed", "rajdhani kitni tez"],
    answer:
      "Rajdhani Express LHB coaches ki maximum permissible speed (MPS) 130 km/h hoti hai (network par priority sabse zyada, kam stops). Comparison: Vande Bharat 160 km/h tak (operational), Gatimaan Express 160 km/h (Tughlakabad–Agra section), Tejas Rajdhani bhi 130 km/h. Average speed route ke hisaab se 55–90 km/h ke beech rehti hai.",
  },
  {
    keys: ["vande bharat top speed", "vande bharat ki speed", "vande bharat maximum speed"],
    answer:
      "Vande Bharat Express ki maximum operational speed 160 km/h hai (Delhi–Agra/Tughlakabad–Agra section par achieved — Indian Railways ki sabse tez operational speed, Gatimaan Express ke saath share). Trial runs me 183 km/h tak gayi thi. Route ke hisaab se average 70–100 km/h.",
  },
  {
    keys: ["train me khana", "khana milta", "khaana milta", "chai kitne", "khana kitne ka", "onboard food", "train me food"],
    answer:
      "Train me onboard khana IRCTC catering se aata hai: Garib Rath/Rajdhani/Duronto/Vande Bharat jaise trains me meal booking ke waqt option me included/optional hota hai (route+time ke hisaab se breakfast/lunch/dinner/tea); sleeper/general me aap IRCTC eCatering (ecatering.irctc.co.in ya 1323) se en-route station par order kar sakte ho aur seat par serve hota hai. Exact rate/menu train aur vendor par depend karta hai — verified menu IRCTC ke catering page par hota hai.",
  },
  {
    keys: ["platform kitne", "kitne platform", "platform ki jaankari", "platform number"],
    answer:
      "Station ke platform ki count mere live seat/fare tools me nahi aati — par main aapko bata sakta hoon: station ka naam/code/city, wahan se chalne wali trains, seat/fare/live status; aur platform/parking jaise station-facts ke liye Hindi/English me poochho ya Indian Railways ke station page (indiarailinfo) dekh lein. Ludhiana Junction ka apna count mere paas hai — 7 platforms.",
  },
  {
    keys: ["rac kya", "rac meaning", "rac kaise", "rac seat", "rac kab confirm", "reservation against cancellation"],
    answer:
      "RAC (Reservation Against Cancellation) ka matlab: aapko confirmed berth nahi, shared side-lower berth milti hai (2 passengers ek side lower share karte hain). Jab koi passenger cancel karta hai ya chart preparation ke time vacancy banti hai to RAC confirm ho jaati hai. RAC wale passenger travel kar hi sakte hain.",
  },
  {
    keys: ["waiting list kya", "wl kya", "waitlist kaise", "gnwl", "gnwl kya", "pqwl", "rlwl", "waitlist kab tak", "wl confirm"],
    answer:
      "Waiting List (WL) ka matlab: berth mili nahi hai, cancellation ka wait hai. Types: GNWL (general — train ke source se), RLWL (remote location quota), PQWL (pooled quota), TQWL (tatkal). GNWL/RAC mein confirm hone ke chances aam taur par RLWL/PQWL se zyada maane jaate hain. Chart preparation (departure se pehle) tak movement hoti hai.",
  },
  {
    keys: ["chart kya", "chart prepared", "chart kab", "reservation chart", "chart preparation"],
    answer:
      "Reservation Chart departure se pehle prepare hota hai (aksar raat ko ya departure se ~30 min-4 ghante pehle, train/route ke hisaab se). Chart ke baad: RAC/WL ka final status, berth number, aur coach allocation final ho jaata hai. Chart ke baad vacant berth seat-mileage/allotment se doosre passengers ko mil sakti hai.",
  },
  {
    keys: ["pnr kya", "pnr number", "pnr se", "pnr status kya", "pnr kaise"],
    answer:
      "PNR (Passenger Name Record) 10-digit number hai jo ticket book hone par milta hai — isse journey status (CNF/RAC/WL), coach/berth, aur passenger details check hoti hain. PNR aap IRCTC website/app, railway enquiry (139), ya station counter se check kar sakte hain — mujhe PNR number do to main live status nikaal deta hoon.",
  },
  {
    keys: ["arp kya", "advance reservation", "booking kitne din", "kitne din pehle", "reservation period"],
    answer:
      "ARP (Advance Reservation Period) aam taur par 60 din hota hai — yani train ke departure se 60 din pehle se booking khul jaati hai (IRCTC kabhi seasonal adjust karta hai, official page se confirm karein). Tatkal 1 din pehle khulta hai.",
  },
  {
    keys: ["blanket milti", "blanket kya", "bedroll", "bedding milti", "rasoi"],
    answer:
      "Bedding (blanket+sheet+pillow) AC classes (1A/2A/3A/CC kuch trains) mein included hoti hai. Sleeper (SL) mein bedroll included NAHI hota — station/online se kharidna ya apna le jaana padta hai. Specific train ke catering/bedding ke liye us train ki details dekhein.",
  },
  {
    keys: ["pantry car", "pantry kya", "khana milta", "khaana milta", "food milta", "khaana milega", "khana milega", "catering kaise", "catering services", "catering milti", "e-catering", "ecatering", "khaana kaise", "food kaise", "khane ka", "khaane ka", "food order"],
    answer:
      "Pantry car train ka onboard kitchen-coach hota hai jisse meals/breakfast serve hote hain (meal plan ya alag khareed). Pantry na ho to IRCTC eCatering se bade stations par pre-booked food milta hai (Ecatering.irctc / app). Rajdhani/Shatabdi/Vande Bharat mein catering aam taur par fare ke saath hota hai; Jan Shatabdi/express mein optional.",
  },
  {
    keys: ["vistadome", "vistadome coach", "glass roof"],
    answer:
      "Vistadome special AC coach hai — badi glass windows, glass roof section, rotating seats aur observation lounge — scenic routes (Jungle Safari, hill routes) ke liye. Premium fare hota hai, limited trains mein.",
  },
  {
    keys: ["vande bharat khaana", "vande bharat khana", "vande bharat food", "vande bharat catering", "vande bharat meal", "vande bharat mein khaana", "vande bharat mein khana", "vande bharat mein catering", "vande bharat mein food", "vande bharat pantry"],
    answer:
      "Vande Bharat Express mein alag pantry car nahi hoti, lekin IRCTC catering ONBOARD milti hai — booking ke time 'catering' option choose karo to fare mein meal/snacks/tea (journey time ke hisaab se breakfast/lunch/dinner) included hota hai aur seat par serve hota hai; 'no food' option lo to fare kam aur onboard sirf paid snacks/paani. Alag se IRCTC eCatering (ecatering.irctc.co.in / 1323) se en-route station par bhi order kar sakte ho. Kisi specific Vande Bharat (train number) ka catering status chahiye to number batao — main uski pantry/catering info verified site se laakar dunga.",
  },
  {
    keys: ["vande bharat kya", "vande bharat train", "bande bharat", "semi high speed", "vande bharat speed"],
    answer:
      "Vande Bharat Express indigenous semi-high-speed train hai — modern AC chair-car rakes, 160 km/h design speed (section ke hisaab se operational speed alag), automatic doors, on-board catering (service ke hisaab se). Day-journey routes par chalti hai (chair car + executive class).",
  },
  {
    keys: ["rajdhani kya", "rajdhani express"],
    answer: "Rajdhani Express premium overnight superfast trains hain jo state capitals/New Delhi ko jodti hain — full AC (1A/2A/3A), catering included, priority aur zyada speed. Sabse prestigious regular service maani jaati hain.",
  },
  {
    keys: ["shatabdi kya", "shatabdi express"],
    answer: "Shatabdi Express day-journey superfast trains hain — CC/EC seating (berth nahi), fastest connections (jaise Delhi-Amritsar), aur aksar catering included. Vande Bharat aane ke baad kaafi Shatabdi routes upgrade ho rahe hain.",
  },
  {
    keys: ["duronto kya", "duronto express"],
    answer: "Duronto Express non-stop (ya kam-stop) point-to-point superfast trains the — ab kaafi cancel/convert ho chuki hain. Full AC/non-AC dono variants the, dynamic pricing wale fare.",
  },
  {
    keys: ["garib rath", "garib Rath kya"],
    answer: "Garib Rath budget AC trains the — 3-tier AC (3E) kam fare mein. Aaj kal kaafi routes par band/convert ho chuki hain.",
  },
  {
    keys: ["hum safar", "humsafar"],
    answer: "Humsafar Express all-AC 3-tier premium trains hain — modern LHB rakes, onboard services, dynamic fare ka component.",
  },
  {
    keys: ["tejas express", "tejas kya"],
    answer: "Tejas Express private-operator (IRCTC subsidiary) premium trains hain — full AC, high onboard services, compensation-on-delay jaise features. Delhi-Lucknow aur Mumbai-Ahmedabad routes par.",
  },
  {
    keys: ["jan shatabdi", "janshatabdi"],
    answer: "Jan Shatabdi aam-log day trains hain — affordable version of Shatabdi: CC + non-AC 2S dono seating, kam fare, catering optional (alag khareed).",
  },
  {
    keys: ["lhb coach", "lhb kya", "lhb rake"],
    answer: "LHB (Linke-Hofmann-Busch) modern German-design coaches hain — ICF coaches se zyada safety (anti-climbing), speed capability (160+ km/h) aur better ride quality. Naye trains aam taur par LHB hain.",
  },
  {
    keys: ["icf coach", "icf kya"],
    answer: "ICF coaches purane Integral Coach Factory design ke hain — conventional, LHB se kam speed/safety features. dheere-dheere retire ho rahe hain.",
  },
  {
    keys: ["engine wap", "wap7", "wap5", "wag9", "locomotive kya", "engine kaunsa", "wcam"],
    answer:
      "Electric loco classes: WAP-7 (3-phase, 6350 hp — sabse common passenger loco), WAP-5 (high-speed, 140+ km/h, Rajdhani/Shatabdi/Vande Bharat), WAG-9 (freight), WAM-4 (older mixed). Diesel: WDP-4D, WDG series. 'W' wide gauge, 'A/P/G' = AC passenger/AC goods.",
  },
  {
    keys: ["tte kya", "ticket checker", "tc kya"],
    answer: "TTE (Travelling Ticket Examiner) coach ka ticket-checker hota hai — ticket verify, vacant-berth allotment (chart ke baad), aur rule enforcement karta hai. Problem ho to TTE ko ya 139 helpline par batayein.",
  },
  {
    keys: ["station code kya", "station code kaise", "railway code"],
    answer: "Station code 2-5 letters ka unique code hai (jaise NDLS = New Delhi, HW = Haridwar, LDH = Ludhiana) — booking/enquiry mein naam ki jagah ye use hota hai. Mujhe station naam boliye to main code nikaal deta hoon.",
  },
  {
    keys: ["railway zone", "zones kitne", "nr railway", "zone kya"],
    answer:
      "Indian Railways 19 zones mein bata hai (jaise NR = Northern Railway, NCR = North Central, WR = Western, SR = Southern, ECR, SER...). Har zone apne region ki operations sambhalta hai; Railway Board overall head hai.",
  },
  {
    keys: ["gauge kya", "broad gauge", "meter gauge", "narrow gauge"],
    answer: "Gauge = do rails ke beech ki doori. India mein majorly Broad Gauge (1676 mm); kuch heritage/hill lines Meter Gauge (1000 mm) ya Narrow Gauge (762 mm) par hain (jaise Darjeeling, Nilgiri).",
  },
  {
    keys: ["id proof", "id card", "identity card train", "photo id"],
    answer: "Train travel mein valid photo-ID (Aadhaar, PAN, Passport, DL, Voter ID) carry karna zaroori hai — Tatkal to ID number booking se hi chahiye. TTE maang sakta hai; na ho to penalty/travel denial ho sakta hai.",
  },
  {
    keys: ["cancellation charge", "cancel kare to", "refund kitna", "refund rules", "cancellation rules"],
    answer:
      "Cancellation refund class + time pe depend karta hai: confirm ticket 48+ ghante pehle — flat clerical charge; 12-48 ghante — 25%; <12 ghante — 50%; chart ke baad TDR process (case-by-case). Tatkal/Premium ka alag (aksar no-refund) rule hai. Exact current charges IRCTC rules se verify karein.",
  },
  {
    keys: ["concession kya", "senior citizen", "student concession"],
    answer: "Concession = fare mein chhoot (senior citizens, patients, students jaise categories) — apply rules category ke hisaab se badalte rehte hain; counter/IRCTC se confirm karein. Abhi senior-citizen concession IRCTC online mein optional-scheme ke roop mein hai.",
  },
  {
    keys: ["quota kya", "ladies quota", "senior quota", "lower berth quota", "divyang"],
    answer:
      "Booking quotas alag seat-pools hain: GN (general), TQ (tatkal), LD (ladies), SS (senior citizen/lower berth), DP (defence), HP (handicapped/divyang), PH/foreign. Quota ke hisaab se availability alag dikhti hai.",
  },
  {
    keys: ["coach position", "coach kahan", "coach position kaise"],
    answer: "Coach position = train mein coaches ka order (engine se: Loco, SLR, S1-S5..., B1-B5..., A1..., pantry). Station par display board ya app se pata chalta hai. Mujhe train number do to main live coach position nikaal deta hoon.",
  },
  {
    keys: ["platform kaise", "platform number", "platform kab"],
    answer: "Platform number departure se thodi der pehle decide/hotI hai — station enquiry (139), display boards, ya RailMadad/app se check karein. Main live platform data abhi nahi de sakta (station-side data hai).",
  },
  {
    keys: ["fair child", "child ticket", "bachcha ticket", "child fare"],
    answer: "5 saal se kam age ka bachcha bina berth ke free chalta hai (0-4 full free; 5-11 half ticket + berth chahiye to full; 12+ full). Rules IRCTC current policy se verify karein.",
  },
  {
    keys: ["break journey", "break in journey"],
    answer: "Break-journey rules allow travel beech mein rokna (certain conditions — 500+ km par ek break etc.) — ticket booking ke rules ke hisaab se; detail IRCTC/press notes se confirm karein.",
  },
  {
    keys: ["luggage limit", "luggage allowance", "saman kitna", "samaan kitna", "luggage kitna", "baggage limit", "baggage allowance", "free luggage", "luggage charge", "luggage rule", "kitna saman", "kitna samaan", "luggage weight"],
    answer:
      "Indian Railways free luggage allowance (per passenger, long-standing rules): 1A (AC First) 70 kg, 2A 50 kg, 3A/CC 40 kg, Sleeper 40 kg, 2S/Second class 35 kg. Isse zyada par excess-luggage charge lagta hai (max allowed: 1A 150 kg, 2A 100 kg, 3A/CC 40 kg, SL 80 kg, 2S 70 kg) — parcel/luggage office se book karna hota hai. Size limit: coach ke andar 100 cm × 60 cm × 25 cm tak. 5 se 12 saal ke bachche ka allowance half.",
  },
  {
    keys: ["1031 ka number", "rail madad", "139 helpline", "railway complaint"],
    answer: "Rail Madad (139) Indian Railways ki helpline hai — enquiry, complaint, medical assistance, security. App: Rail Madad. Emergency: 139 ya Railways security 182.",
  },
];

/* ── Scoring: question text mein kitne KB keys overlap karte hain. ── */
export function railKbAnswer(questionText: string): string | null {
  /* Round-18i: "RAC ka matlab kya hai" / "WL ki meaning" → "rac kya" key. */
  const normalized = questionText.toLowerCase().replace(/\b(ka|ki|ke)\s+(matlab|meaning|arth|mtlb)\b/g, "kya");
  const q = ` ${normalized.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ")} `;
  if (q.trim().length < 4) return null;
  let best: { score: number; entry: KbEntry } | null = null;
  for (const entry of ENTRIES) {
    let score = 0;
    const qtok = new Set(q.split(" ").filter((w) => w.length > 1));
    /* Round-40: "sabse BADA station" aur "sabse PURANA station" alag sawaal hain — key ka
     * distinguishing (superlative) shabd query me na ho to wo key match nahi maani jaati. */
    const DISTINCT = ["purana", "purani", "purane", "bada", "badi", "bade", "lambi", "lamba", "lambe", "tez", "sasta", "sasti", "mehnga", "mehngi", "naya", "nayi", "pehla", "pehli", "pehle", "oldest", "biggest", "largest", "longest", "fastest", "cheapest", "first", "sabse"];
    const keyOk = (k: string) => {
      const kt = k.split(" ").filter((w) => w.length > 1);
      const distinctInKey = kt.filter((w) => DISTINCT.includes(w) && w !== "sabse");
      return distinctInKey.every((w) => qtok.has(w));
    };
    for (const key of entry.keys) {
      const k = key.toLowerCase();
      if (!keyOk(k)) continue;
      if (k.includes(" ") ? q.includes(k) : new RegExp(`\\b${k}\\b`).test(q)) score += k.includes(" ") ? 3 + Math.min(2, Math.floor(k.length / 12)) : 2;
      /* Round-37f: user alag shabdon me poochhta hai ("waiting list TICKET CONFIRM hone ke RULES") —
       * key ke zyada-tar token q me hon to wahi entry (sirf multi-word keys par, 60%+ overlap). */
      else if (k.includes(" ")) {
        const kt = k.split(" ").filter((w) => w.length > 1);
        if (kt.length >= 2) {
          const matched = kt.filter((w) => qtok.has(w)).length;
          /* 0.75+ overlap AUR kam-se-kam 2 token — warna "vande bharat kya hoti hai" jaisa
           * general sawaal catering-entry se match ho jaata tha (galat jawab). */
          if (matched >= 2 && matched / kt.length >= 0.75) score += 3;
        }
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { score, entry };
  }
  /* Kam-se-kam ek solid key-match chahiye — partial fluke match se galat
   * answer nahi. Score 2 = single short word — risky; 3+ (multi-word ya
   * 2 keys) hi do. */
  if (best && best.score >= 3) {
    return `${best.entry.answer}\n(Ye general railway knowledge hai — live data nahi; rules IRCTC/official source se verify karein.)`;
  }
  return null;
}
