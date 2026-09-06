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
    keys: ["pantry car", "pantry kya", "khana milta", "food milta", "catering kaise", "e-catering", "ecatering"],
    answer:
      "Pantry car train ka onboard kitchen-coach hota hai jisse meals/breakfast serve hote hain (meal plan ya alag khareed). Pantry na ho to IRCTC eCatering se bade stations par pre-booked food milta hai (Ecatering.irctc / app). Rajdhani/Shatabdi/Vande Bharat mein catering aam taur par fare ke saath hota hai; Jan Shatabdi/express mein optional.",
  },
  {
    keys: ["vistadome", "vistadome coach", "glass roof"],
    answer:
      "Vistadome special AC coach hai — badi glass windows, glass roof section, rotating seats aur observation lounge — scenic routes (Jungle Safari, hill routes) ke liye. Premium fare hota hai, limited trains mein.",
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
    keys: ["1031 ka number", "rail madad", "139 helpline", "railway complaint"],
    answer: "Rail Madad (139) Indian Railways ki helpline hai — enquiry, complaint, medical assistance, security. App: Rail Madad. Emergency: 139 ya Railways security 182.",
  },
];

/* ── Scoring: question text mein kitne KB keys overlap karte hain. ── */
export function railKbAnswer(questionText: string): string | null {
  const q = ` ${questionText.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ")} `;
  if (q.trim().length < 4) return null;
  let best: { score: number; entry: KbEntry } | null = null;
  for (const entry of ENTRIES) {
    let score = 0;
    for (const key of entry.keys) {
      const k = key.toLowerCase();
      if (k.includes(" ") ? q.includes(k) : new RegExp(`\\b${k}\\b`).test(q)) score += k.includes(" ") ? 3 : 2;
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
