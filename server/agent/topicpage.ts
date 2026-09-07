/* ── TOPIC-PAGE ANSWER ENGINE (Round-15: agentic WEB_SEARCH bhi isi ko
 * use karta hai). Hinglish sawaal → English query (cleanQueryEn) → Wikipedia
 * FULL page (findWikipediaPage) → relevance-verify → question ke hisaab se
 * best paragraph / list-table. Pehle run.ts ke andar tha — alag module
 * isliye ki agentic.ts (jo run.ts se import hota hai) bina circular import
 * ke use kar sake. Logic byte-for-byte wahi hai. */
import { findWikipediaPage, searchWikipediaTitles, wikiTableForPage } from "./websearch.js";

const FILLER_QUERY_RE =
  /\b(ka|ki|ke|ko|kya|kya|hai|hain|hun|tha|thi|the|se|mein|me|mai|main|par|pe|to|hi|bhi|batao|batana|btana|btaye|bataiye|bata|bataen|dikhao|dikha|chahiye|karo|karna|karke|kar|mujhe|mera|meri|mere|aap|tum|tumhara|kripya|please|kr|kro|nahi|na|haan|yan|ya|jaise|waise|bta|btao|lga|lagta|kabhi|hota|hoti|hote|milta|milti|milte|karta|karti|karte|matlab|meaning|wali|wala|wale|hua|hui|hue|jaata|jaati|jati|jata|ho|kab|kab|kahan|kahaan|kaha|kyun|kyo|kyon|kaise|kaisa|kaisi|kitna|kitni|kitne|kaun|kaunsi|kaunsa|konsi|konsa|cover|karta|karti|hu|bani|bana|bane|chalu|shuru|chali|chalati|chalata|chalti|chalta|bare|baare|baat|gaya|gayi|gaye)\b/gi;

const HINGLISH_TO_EN: [RegExp, string][] = [
  [/\bsabse\s+(tez|tezi|jaldi)\b/gi, "fastest"],
  [/\bsabse\s+(lambi|lamba|lambe|lambee)\b/gi, "longest"],
  [/\bsabse\s+(badi|bada|bade)\b/gi, "largest"],
  [/\bsabse\s+(choti|chota|chote)\b/gi, "smallest"],
  [/\bsabse\s+(sasti|sasta|saste)\b/gi, "cheapest"],
  [/\bsabse\s+(acchi|accha|acche|achhi)\b/gi, "best"],
  [/\bsabse\s+(purani|purana|purane)\b/gi, "oldest"],
  [/\bsabse\s+(nayi|naya|naye)\b/gi, "newest"],
  [/\bsabse\s+(famous|popular|mashhoor)\b/gi, "famous"],
  [/\btez\b/gi, "fast"],
  [/\blambi|lamba|lambe|lambee\b/gi, "longest"],
  [/\bbadi|bada|bade\b/gi, "largest"],
  [/\bchoti|chota|chote\b/gi, "smallest"],
  [/\bsasti|sasta|saste\b/gi, "cheapest"],
  [/\bpurani|purana|purane\b/gi, "oldest"],
  [/\bnayi|naya|naye\b/gi, "newest"],
  [/\bshuruaat|shurvat|shuruat\b/gi, "history"],
  [/\bshuru\b/gi, "started"],
  [/\bpehli|pehla|pehle\b/gi, "first"],
  [/\bbani|bana|bane\b/gi, ""],
  [/\bchali\b/gi, "ran"],
  [/\bchalati|chalata|chalti|chalta\b/gi, "runs"],
  [/\bindia\s+mein|india\s+me\b/gi, "india"],
  [/\bduniya|dunia|vishwa\b/gi, "world"],
  /* "vande bharat"/"amrit bharat"/"namo bharat" train-brand hain — inka
   * "bharat" translate NAHI hota (warna "vande india" wiki par galat page). */
  [/\b(?<!vande\s)(?<!amrit\s)(?<!namo\s)bharat\b/gi, "india"],
];

export function cleanQueryEn(text: string): string {
  let q = ` ${text.toLowerCase()} `;
  q = q.replace(FILLER_QUERY_RE, " ");
  for (const [re, en] of HINGLISH_TO_EN) q = q.replace(re, ` ${en} `);
  return q.replace(/\s+/g, " ").trim().slice(0, 100);
}

/** Wikipedia pages mein har railway page par aane wale generic words —
 * relevance mein inhe akela kaafi NAHI maana jaata. */
export const GENERIC_WIKI_WORDS = new Set([
  "railway", "railways", "rail", "train", "trains", "india", "indian",
  "station", "express", "line", "route", "coach", "service", "zone",
  "what", "which", "when", "where", "about", "much", "many", "this",
  "that", "tell", "show", "find", "give", "please", "have", "does",
  "first", "history", "fastest", "longest", "largest", "oldest",
  "started", "built", "runs", "local", "suburban", "network",
]);

export /** Translated query ke topic-words (fastest/longest/history...) — inka
 * page mein hona relevance ka strong signal hai. */
const TOPIC_EN_WORDS = new Set([
  "fastest", "longest", "largest", "oldest", "smallest", "first", "history",
  "started", "newest", "famous", "cheapest", "runs", "ran",
]);

/** Hinglish topic-words (sabse/tez/lambi/shuruaat...) — English pages mein
 * ye kabhi nahi milte; canonical-page routing ke liye detect hote hain. */
export const HINGLISH_TOPIC_WORDS = new Set([
  "shuruaat", "shuruat", "shurvat", "pehli", "pehla", "pehle", "purani",
  "purana", "nayi", "naya", "sabse", "tez", "tezi", "lambi", "lamba",
  "lambe", "badi", "bada", "sasti", "sasta", "acchi", "accha", "jaldi",
  "mashhoor",
]);

/** Priority-word synonyms — "kab shuru hui" (started) ka jawab Wikipedia
 * mein "introduced/inaugurated/flagged off" likha hota hai; sirf literal
 * "started" dhoondhne par 2021-upgrade jaisa galat para uth jaata tha. */
const PRIORITY_SYNONYMS: Record<string, string[]> = {
  started: ["started", "introduced", "inaugurated", "flagged off", "commenced", "began", "launched", "first"],
  first: ["first", "introduced", "inaugurated", "began", "commenced", "started"],
  history: ["history", "introduced", "inaugurated", "began", "commenced", "established", "first"],
  oldest: ["oldest", "first", "earliest"],
  newest: ["newest", "latest", "recent"],
  fastest: ["fastest", "highest speed", "top speed", "maximum speed", "maximum operational speed"],
  longest: ["longest"],
  largest: ["largest", "biggest"],
  smallest: ["smallest", "shortest"],
  cheapest: ["cheapest", "lowest fare"],
  famous: ["famous", "popular", "well-known"],
};

/** User ne foreign jagah/system explicitly poochha ho to India-guard off. */
const FOREIGN_PLACE_RE =
  /\b(japan|china|europe|america|usa|uk|britain|london|paris|france|germany|russia|australia|pakistan|bangladesh|nepal|sri lanka|world|duniya|shinkansen|bullet train|eurostar|tgv|hong kong|singapore|dubai|canada|africa)\b/i;

/** Sawaal ke ATTRIBUTE words (kya poochha ja raha hai) — subject-page
 * dhoondhte waqt ye hata diye jaate hain (Round-15). */
const ATTRIBUTE_WORDS = new Set([
  "speed", "history", "coach", "coaches", "rake", "route", "timing", "timings",
  "schedule", "fare", "fares", "length", "distance", "stops", "halts", "info",
  "information", "details", "detail", "facts", "features", "facilities",
  "catering", "pantry", "food", "locomotive", "engine", "started", "introduced",
  "inaugurated", "launched", "launch", "shuruaat", "shuruat", "shurvat",
]);

export function significantWords(text: string): string[] {
  return Array.from(
    new Set(
      ` ${text.toLowerCase()} `
        .replace(FILLER_QUERY_RE, " ")
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4 && !GENERIC_WIKI_WORDS.has(w)),
    ),
  );
}

/** Relevance: significant words page mein hone chahiye — kam se kam 2 total
 * hits AUR 1 non-generic hit (warna "first railway line" par Cherthala-
 * station jaise irrelevant pages pass ho jaate the). Original (Hinglish)
 * + translated (English) dono ke words dekhe jaate hain. */
export /** Word-boundary hit (plural-tolerant) — substring flukes ("city limits"
 * par "limit", "Indian" par "india") se bachne ke liye. */
function wordHit(hay: string, w: string): boolean {
  try {
    return new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i").test(hay);
  } catch {
    return hay.toLowerCase().includes(w.toLowerCase());
  }
}

export function wikiRelevant(question: string, hay: string): boolean {
  const h = hay.toLowerCase();
  const content = significantWords(question); // Hinglish/EN non-generic words
  const translated = cleanQueryEn(question).split(/\s+/);
  const topic = translated.filter((w) => TOPIC_EN_WORDS.has(w)); // longest/history/first...
  const generic = translated.filter((w) => GENERIC_WIKI_WORDS.has(w)); // train/india...
  if (!content.length && !topic.length && !generic.length) return true;
  /* Kam se kam 1 STRONG hit (content ya topic word) + kul 2 hits —
   * Hinglish "sabse lambi" English "longest" se match hota hai, "Cherthala
   * station" jaise generic-only pages reject ho jaate hain. */
  const strong = [...content, ...topic].filter((w) => wordHit(h, w)).length;
  const gen = generic.filter((w) => wordHit(h, w)).length;
  return strong >= 1 && strong + gen >= 2;
}

export const stripSectionTitle = (p: string) =>
  p.replace(/^(Service|Overview|Introduction|Background|History|Route|Timetable|Timing|Rake|Coaches|Loco link|Stops|Facilities|See also|Notes|References)\s+([A-Z])/, "$2");

export type TopicAnswer = {
  /** Wikipedia page title */
  title: string;
  url: string;
  /** Answer text (best paragraph / table rows) — label ke bina */
  text: string;
  /** "table" = superlative list-table rows, "paragraph" = topic paragraph, "intro" = page intro */
  kind: "table" | "paragraph" | "intro";
};

const WEB_LABEL_TAIL = "\n(Ye railway API ka data nahi, web-scrape ka jawab hai.)";

/** Formatted reply (deterministic path). Logic `findTopicAnswer` mein hai. */
export async function answerFromTopicPage(questionText: string): Promise<string | null> {
  const a = await findTopicAnswer(questionText);
  if (!a) return null;
  if (a.kind === "table") {
    return `Web se mila (Wikipedia — ${a.title}, top rows):\n${a.text}\n(Source: ${a.url})${WEB_LABEL_TAIL}`;
  }
  return `Web se mila (Wikipedia — ${a.title}): ${a.text}\n(Source: ${a.url})${WEB_LABEL_TAIL}`;
}

/** Round-15: sawaal-focused sentences — best paragraph 700 chars par cut hone
 * se asli jawab (jaise intro ke end mein "maximum operational speed 160 km/h")
 * kat jaata tha. Topic-pattern wale sentences pehle, context ke liye pehla
 * sentence saath. */
export function focusSentences(para: string, topic: RegExp, max = 700, priority?: RegExp): string {
  const sentences = para.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)?.map((x) => x.trim()).filter(Boolean) ?? [para];
  if (sentences.length <= 1 || para.length <= max) return para.slice(0, max);
  const re = new RegExp(topic.source, "i");
  /* Priority sentences (sawaal ka superlative/topic word — "fastest",
   * "longest", "first") sabse pehle, phir baaki topic-hits, document order. */
  const pri = priority ? sentences.filter((x) => priority.test(x)) : [];
  const hits = [...pri, ...sentences.filter((x) => re.test(x) && !pri.includes(x))];
  if (!hits.length) return para.slice(0, max);
  const picked: string[] = [];
  if (!re.test(sentences[0]) && !pri.includes(sentences[0]) && sentences[0].length < 260) picked.push(sentences[0]);
  for (const h of hits) {
    if (picked.join(" ").length + h.length > max) continue;
    picked.push(h);
  }
  if (!picked.length) return hits[0].slice(0, max);
  /* Document order restore (readability) — pick set wahi. */
  const order = new Map(sentences.map((x, i) => [x, i]));
  picked.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return picked.join(" ").slice(0, max);
}

export async function findTopicAnswer(questionText: string): Promise<TopicAnswer | null> {
  try {
    const DBG = process.env.TOPIC_DEBUG === "1";
    if (/\b\d{5}\b/.test(questionText)) return null; // train-number sawaal train-page se aata hai
    const q = cleanQueryEn(questionText);
    if (q.length < 4) return null;

    /* Candidate queries (ordered retry — ek query wiki-ranking par noise
     * de sakti hai, doosri sahi page laati hai):
     * 1. history/first-type GEnERAL sawaal (koi distinct naam nahi) →
     *    canonical "rail transport in india" page sabse pehle.
     * 2. poora translated query ("longest train india", "konkan railway history").
     * 3. naam-words only ("vivek express route") — jab poore query se
     *    ranking bigde. */
    const contentWords = significantWords(questionText).filter((w) => !HINGLISH_TOPIC_WORDS.has(w));
    const historyFlavored = /history|shuruaat|shuruat|pehli|pehla|first|oldest|purani|kab\s+(hui|hua|bani|shuru|chalu)/i.test(questionText);
    const candidates: string[] = [];
    if (historyFlavored && !contentWords.length) candidates.push("rail transport in india");
    candidates.push(q);
    const nameWords = cleanQueryEn(questionText)
      .split(" ")
      .filter((w) => w.length >= 4 && !GENERIC_WIKI_WORDS.has(w) && !TOPIC_EN_WORDS.has(w))
      .slice(0, 3)
      .join(" ");
    if (nameWords && nameWords !== q) candidates.push(nameWords);

    /* Round-15: SUBJECT-only query ("vande bharat" — attribute words speed/
     * history/coach hata kar). Full query ke hits ko subject-hits se
     * re-rank karte hain: jo page dono mein ho wahi asli subject. */
    const subjectWords = contentWords.filter((w) => !ATTRIBUTE_WORDS.has(w));
    const subjectQ = subjectWords.join(" ");
    let subjectTitles: string[] = [];
    if (subjectWords.length && subjectQ !== q && subjectQ !== nameWords) {
      try {
        subjectTitles = await searchWikipediaTitles(subjectQ, 3);
      } catch {
        subjectTitles = [];
      }
    }
    /* Round-15: INDIA-context guard — "railway luggage limit" par Hong Kong
     * MTR page, "longest train" par Australia ore-train page aa jaata tha.
     * Page ke shuru mein India/Indian na ho to reject; pehle "<q> india"
     * retry (user ne foreign jagah explicitly na likhi ho). */
    const foreignAsked = FOREIGN_PLACE_RE.test(questionText);
    if (!foreignAsked && !/\bindia\b/.test(q)) candidates.splice(candidates.indexOf(q) + 1, 0, `${q} india`);
    const indianContext = (p: { title: string; extract: string }) =>
      foreignAsked || /\bindia|indian\b/i.test(`${p.title} ${p.extract.slice(0, 2500)}`);
    let page: { title: string; url: string; extract: string } | null = null;
    for (const cand of candidates) {
      const p = await findWikipediaPage(cand, undefined, subjectTitles);
      if (p && indianContext(p) && wikiRelevant(questionText, `${p.title} ${p.extract.slice(0, 3000)}`)) {
        page = p;
        break;
      }
    }
    if (DBG) console.error("[topic] page", page?.title, candidates);
    if (!page) return null;

    /* RULE/how-much sawaal ("luggage limit kitni hai") par kisi ek STATION
     * ka page galat granularity hai — us station ki cloakroom se relevant
     * shabd mil bhi jaate hain to answer nahi hota. Reject → scrape/LLM. */
    const RULE_Q_RE =
      /kitna|kitni|kitne|limit|charge|charges|rule|rules|slab|kaise|how to|kya karna|process|banaye|banane|steps|allowed|permission/i;
    if (RULE_Q_RE.test(questionText) && /railway station|junction$/i.test(page.title)) return null;

    /* ── SUPERLATIVE sawaal: page ki TABLE se top rows (round-4). "sabse
     * lambi train" ka jawab list-page table mein hota hai — explaintext
     * tables strip kar deta hai, wikitext se laate hain. Sirf distance/
     * rank-type tables (km wali) — coach-code tables reject. */
    const SUPERLATIVE_Q_RE =
      /sabse\s+(tez|tezi|jaldi|lambi|lamba|lambe|badi|bada|bade|choti|chota|chote|purani|purana|nayi|naya|sasti|sasta|acchi|accha|famous|mashhoor)|longest|fastest|largest|oldest|smallest/i;
    if (SUPERLATIVE_Q_RE.test(questionText)) {
      try {
        const tbl = await wikiTableForPage(page.title);
        if (tbl) {
          const dataRows = tbl.rows.filter((r) => r.length >= 3 && /\d/.test(r.join(" ")));
          const hasDistance = tbl.rows.some((r) => /\d[\d,.]*\s*(km|kilomet|kilometer)/i.test(r.join(" ")));
          if (dataRows.length && hasDistance) {
            const top = dataRows
              .slice(0, 3)
              .map((r, idx) => `(${idx + 1}) ${r.slice(0, 5).join(" — ")}`)
              .join("\n");
            return { title: tbl.title, url: tbl.url, text: top, kind: "table" };
          }
        }
      } catch {
        /* table nahi mili — paragraph se try */
      }
    }

    const paras = page.extract
      .split(/\n\n+/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter((p) => p.length > 40);
    if (!paras.length) return null;
    /* Meta-paragraph ("This article lists...") jawab nahi hota — skip. */
    const META_PARA_RE = /this article|this list|this page lists|the following (is|are|list)|below is a list|^this is a list/i;
    const content = paras.filter((p) => !META_PARA_RE.test(p));
    if (!content.length) return null;
    const TOPIC: { q: RegExp; p: RegExp }[] = [
      { q: /sabse tez|fastest|top speed|kitni tez|speed|kitna tez|tez train/i, p: /fastest|speed|km\/h|kmph|kph/i },
      { q: /sabse lamb|longest|kitna lamba|kitni lambi|lambai/i, p: /longest|route|kilomet|\bkm\b/i },
      { q: /history|shuruaat|shuruat|pehli|pehla|first|oldest|kab hui|kab hua|kab bani|kab shuru|kahan bani|introduced/i, p: /first|introduced|began|commenced|established|opened|inaugurat|founded|history|started/i },
      /* coach/rake "kitne" se PEHLE — "kitne coach" par generic \d{2,}
       * pattern (dates/years) galat para uthata tha (Round-15). */
      { q: /coach|rake|composition/i, p: /coach|rake|LHB|composition/i },
      { q: /kitne|how much|how many|number of|kitna hota/i, p: /\d{2,}/ },
      { q: /station|junction|platform/i, p: /station|platform|terminal|junction/i },
      { q: /route|kahan se kahan|covers|kitna route/i, p: /route|connects|between|covers|via/i },
    ];
    for (const t of TOPIC) {
      if (t.q.test(questionText)) {
        /* Score-based pick: topic-pattern ki SABSE ZYADA matches wala para
         * (pehla-match intro para se galti se match ho jaata tha). */
        let best: string | null = null;
        let bestScore = 0;
        /* Sawaal ke English topic-words (fastest/longest/first…) — jis para
         * mein ye literally hon wo answer ke zyada kareeb hai. */
        const qTopicWords = q.split(/\s+/).filter((w) => TOPIC_EN_WORDS.has(w) && w !== "runs" && w !== "ran");
        const priAlts = [...new Set(qTopicWords.flatMap((w) => PRIORITY_SYNONYMS[w] ?? [w]))];
        const priRe = priAlts.length ? new RegExp(`\\b(?:${priAlts.join("|")})\\b`, "i") : undefined;
        /* Literal topic word ("fastest") synonyms ("maximum speed") se upar —
         * pool tiering ke liye. */
        const litRe = qTopicWords.length ? new RegExp(`\\b(?:${qTopicWords.join("|")})\\b`, "i") : undefined;
        /* Priority-word wale paras (topic hits ke saath) hon to unhi mein se
         * chuno — "fastest" para ko 31-speed-hit history para na haraye. */
        const topicRe = new RegExp(t.p.source, "i");
        const litPool = litRe ? content.filter((p) => litRe.test(p) && topicRe.test(p)) : [];
        const synPool = priRe ? content.filter((p) => priRe.test(p) && topicRe.test(p)) : [];
        const pool = litPool.length ? litPool : synPool.length ? synPool : content;
        for (const p of pool) {
          /* Topic hits CAP 5 — lambe generic paragraph (1960 speed-study, 14
           * "speed" hits) sirf volume se na jeetein. */
          let score = Math.min((p.match(new RegExp(t.p.source, "gi")) ?? []).length, 5);
          /* Round-15: subject-words (jaise "vande") wale para ko bonus —
           * "Vande Bharat top speed" par generic 1960-history para (subject
           * ka naam hi nahi) intro para (160 km/h wala) ko haraa deta tha. */
          const subjHits = contentWords.filter((w) => wordHit(p, w)).length;
          if (score > 0 && subjHits > 0) score += Math.min(subjHits, 3) * 3;
          if (score > 0 && priRe && priRe.test(p)) score += 6;
          if (score > bestScore) {
            bestScore = score;
            best = p;
          }
        }
        if (best) {
          const text = focusSentences(stripSectionTitle(best), t.p, 700, litRe && litRe.test(best) ? litRe : priRe);
          const ans = `Web se mila (Wikipedia — ${page.title}): ${text}\n(Source: ${page.url})`;
          /* ANSWER-VALIDATION (round-5): chuna hua paragraph sawaal ke kisi
           * strong word (content/topic) ko address nahi karta to ye jawab
           * adhoora hai ("luggage limit" par Tirupati-station intro aata
           * tha) — next layer (scrape/LLM) ko chance do. */
          const strongWords = [
            ...significantWords(questionText),
            ...cleanQueryEn(questionText).split(/\s+/).filter((w) => TOPIC_EN_WORDS.has(w)),
          ];
          if (strongWords.length > 0 && !strongWords.some((w) => wordHit(ans, w))) {
            if (DBG) console.error("[topic] strong-word reject", strongWords, ans.slice(0, 200));
            return null;
          }
          return { title: page.title, url: page.url, text, kind: "paragraph" };
        }
      }
    }
    const intro = content.slice(0, 2).map(stripSectionTitle).join(" ").slice(0, 800);
    const introAns = `Web se mila (Wikipedia — ${page.title}): ${intro}\n(Source: ${page.url})`;
    const strongWords2 = [
      ...significantWords(questionText),
      ...cleanQueryEn(questionText).split(/\s+/).filter((w) => TOPIC_EN_WORDS.has(w)),
    ];
    /* Intro sabse weak jawab hai — Round-15: kam se kam 2 strong words
     * address kare (jab 2+ hon). "railway luggage limit weight" par
     * "Passenger railroad car" intro sirf "passenger" se pass ho jaata tha. */
    const introHits = [...new Set(strongWords2)].filter((w) => wordHit(introAns, w)).length;
    if (strongWords2.length > 0 && introHits < Math.min(2, new Set(strongWords2).size)) {
      if (DBG) console.error("[topic] intro strong-word reject", strongWords2, introHits);
      return null;
    }
    return { title: page.title, url: page.url, text: intro, kind: "intro" };
  } catch {
    return null;
  }
}
