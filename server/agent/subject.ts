/* ── Round-38 (27 Sep 2026, user: "har sawaal ka ek dumm sahi jawab — jaise chatgpt/gemini/claude") ─────
 * Live battery me pakda: "Ludhiana junction ke kitne platform hain?" par web answer ka page
 * "Raipur Haryana Junction railway station" ka aa gaya (galat station!) — aur wahi jawab user ko
 * chala jaata tha. Isi tarah "Sleeper coach me kitne berth" par Vande Bharat ka page.
 *
 * Yeh module jawab ka SUBJECT match karta hai: user ke sawaal ke "strong" shabd (proper noun jaise
 * station/train ka naam) jawab me (title + shuru ka text) kahin na mile to wo jawab galat subject ka
 * maana jaata hai — usi ko user ko nahi dikhaate. Koi andaza nahi: sirf shabd match.
 */

/** Generic railway/bolne ke shabd — ye "subject" nahi hote (inhe match karna zaroori nahi). */
const GENERIC = new Set([
  "train","trains","railway","railways","rail","station","stations","junction","jn","platform","platforms",
  "coach","coaches","berth","berths","seat","seats","fare","fares","ticket","tickets","booking","book",
  "status","live","time","timing","timings","schedule","route","stop","stops","speed","class","classes",
  "sleeper","general","chair","car","second","first","window","side","lower","upper","middle","ac","non",
  "kitne","kitni","kitna","kaun","kaunsi","kaunsa","kahan","kab","kya","kyu","kyun","hai","hain","hota",
  "hoti","hote","milta","milti","milte","chalti","chalta","pahunchti","jana","jaana","chahiye","batao",
  "bata","do","de","dena","karo","kar","kardo","krdo","liye","liye","ke","ki","ka","me","mein","par","se",
  "tak","aur","ya","ka","wala","wali","waley","kaise","karein","kare","karna","hoga","hogi","vehicle",
  "passenger","passengers","person","log","koi","kuch","bahut","thoda","sasta","sasti","fast","fastest",
  "best","better","abhi","aaj","kal","parso","tomorrow","today","india","indian","express","superfast",
  /* Hindi adjectives/superlatives — subject nahi hote (warna "sabse lambi train" par "lambi" subject ban kar
   * sahi Wikipedia page reject ho jaata tha). */
  "sabse","sabse8","lambi","lamba","lambe","bad","bada","badi","bade","badaa","chhota","chhoti","chhote",
  "mehnga","mehngi","mehnge","saste","tez","tezz","dheema","dheemi","jaldi","der","pehle","baad","kam",
  "zyada","achha","achhi","ache","badhiya","sundar","naya","nayi","naye","purana","purani","purane","asli",
  "sach","sachcha","galat","theek","thik","mast","bhar","bharat","hindi","english","hinglish",
  "mail","local","pass","number","no","naam","name","detail","details","info","jaankari","information",
  "facility","facilities","option","options","price","prices","rate","rates","kilometre","km","hour",
  "ghante","minutes","minute","din","day","dinon","phone","mobile","online","irctc","railbook","app",
  /* Hinglish conversation-fillers — ye subject nahi hote (warna "mujhe batao" par sahi page reject ho jaaye). */
  "mujhe","hume","humein","humko","hamko","mera","meri","mere","tera","teri","tere","aapko","aap","tum",
  "please","plz","kripya","bhai","bhaiya","yaar","dost","boss","sir","madam","dedo","de","chahta","chahti",
  "chahie","chahiye","bolo","batao","bata","dikhao","dikha","dhundo","dhoond","kholo","khol","sakta","sakti",
  "sakte","gaya","gayi","gaye","raha","rahi","rahe","jayega","jayegi","aayega","aayegi","milega","milegi",
  "karenge","honge","hoga","hogi","lagega","lagegi","padta","padti","wala","wali","waley","sab","saare",
  "saari","poora","poori","poori","chhota","chhota","bada","badi","zyada","kam","jaldi","achha","achhi",
  "theek","sahi","galat","kya","kyun","kyu","kaise","kaun","kab","kahan","kitna","kitni","kitne","hai",
  "hain","ho","hun","hu","tha","thi","the","kar","karna","karta","karti","krna","kro","karo","kardo","krdo",
  "dena","deni","leta","leti","leke","lekar","ke","ki","ka","ko","me","mein","par","pe","se","tak","aur",
  "ya","na","nahi","nai","haan","han","ji","toh","to","bhi","hi","ab","abhi","phir","fir","ise","ise","bare","baare","baarey","babat","baabat","matter","taraf",
  "haal","hal","chal","mast","badhiya","namaste","namaskar","hello","hii","hey","shukriya","thanks","thank",
]);

const isStrong = (w: string) => w.length >= 4 && !GENERIC.has(w);

/** Sawaal ke "strong" (subject) shabd — station/train ke naam, jagah, cheez. */
export function subjectTokens(text: string): string[] {
  const words = String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const w of words) if (isStrong(w) && !out.includes(w)) out.push(w);
  return out;
}

/**
 * Jawab (page/table/paragraph) sawaal ke subject ka hai ya nahi.
 * true = theek; false = alag subject (galat page) — user ko na dikhao.
 * Jis sawaal me koi strong shabd hi nahi, wahan guard lagta nahi (true).
 */
export function answerCoversSubject(question: string, title: string, body: string, opts: { minHits?: number } = {}): boolean {
  const strong = subjectTokens(question);
  if (!strong.length) return true;
  const hay = `${title} ${body}`.toLowerCase();
  const hits = strong.filter((w) => hay.includes(w));
  const need = opts.minHits ?? 1;
  return hits.length >= need;
}

/** Kitne strong shabd match hue (debug/log ke liye). */
export function subjectHitCount(question: string, title: string, body: string): number {
  const strong = subjectTokens(question);
  if (!strong.length) return Number.POSITIVE_INFINITY;
  const hay = `${title} ${body}`.toLowerCase();
  return strong.filter((w) => hay.includes(w)).length;
}


/* ── Round-39 (27 Sep): mode guard ────────────────────────────────────────────────────────────────
 * Live battery: "Ludhiana se Amritsar kitni doori hai?" par Wikipedia ka **Delhi–Amritsar–Katra
 * Expressway** (sadak!) ka jawab aa gaya — subject match (dono naam the) par MODE hi galat tha.
 * RailBook railway assistant hai: jab tak user khud sadak/bus/flight na poochhe, jawab rail ka hona
 * chahiye. Ye guard road/highway/air/metro wale pages ko reject karta hai. */

const ROAD_ASK_RE = /\b(expressway|highway|motorway|sadak|road|by ?road|bus|car|taxi|cab|flight|air|airport|metro|NH\s?\d+|flyover)\b/i;
const RAIL_DOMAIN_RE = /\b(train|trains|rail|railway|station|jn|junction|coach|berth|irctc|pnr|platform|express|superfast|sl|3a|2a|1a|cc|2s|ec)\b/i;
const ROAD_ANSWER_RE = /\b(expressway|highway|motorway|controlled-access|national highway|NH ?\d+|roadways|bus stand|airport|airline|flight|metro rail)\b/i;
const RAIL_ANSWER_RE = /\b(railway|rail|train|station|junction|coach|berth|platform|route|halt|express)\b/i;

/** User ne khud road/air/metro poochha? (tab road wala jawab bilkul valid hai) */
export function asksNonRailMode(question: string): boolean {
  return ROAD_ASK_RE.test(String(question ?? ""));
}

/**
 * Rail-domain sawaal par road/air jawab aaya to false (reject).
 * Non-rail sawaal par ye guard nahi lagta. Rail-related jawab par bhi nahi.
 */
export function answerMatchesRailMode(question: string, title: string, body: string): boolean {
  const q = String(question ?? "");
  const hay = `${title} ${body}`;
  if (asksNonRailMode(q)) return true; // user ne khud road/air poochha
  const railAnswer = RAIL_ANSWER_RE.test(hay);
  const roadAnswer = ROAD_ANSWER_RE.test(hay);
  if (roadAnswer && !railAnswer) return false;
  /* Dono ho (jaise "rail + expressway" wala paragraph) — tab hi reject jab question me rail-domain
   * ka koi shabd na ho (warna rail ka sawaal rail hi ke baare me tha). */
  if (roadAnswer && railAnswer && !RAIL_DOMAIN_RE.test(q)) {
    const roadHit = (hay.match(ROAD_ANSWER_RE) ?? []).length;
    const railHit = (hay.match(RAIL_ANSWER_RE) ?? []).length;
    if (roadHit > railHit) return false;
  }
  return true;
}
