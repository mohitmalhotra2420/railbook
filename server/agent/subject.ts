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
