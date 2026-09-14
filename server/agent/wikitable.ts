/* Round-18m-31 (user: "India mein total kitni Vande Bharat chalti hai? → app ne 6-train picker diya"):
 * COUNT / LIST sawaal ("kitni vande bharat", "saari rajdhani list", "how many shatabdi") ka jawab Wikipedia
 * page ke SABSE BADE data-table se — har row = ek service/route. Section naam + row count + rows dete hain.
 * (Pehla table nahi — wo aksar infobox/history hota hai.) */

export type WikiCountTable = {
  title: string;
  url: string;
  section: string | null;
  rowCount: number;
  header: string[];
  rows: string[][];
};

let wikiFetchImpl: typeof fetch | null = null;
export function setWikiTableFetch(fn: typeof fetch | null): void {
  wikiFetchImpl = fn;
}

function cleanWiki(x: string): string {
  return x
    .replace(/\[\[(?:[^\]|]*\|)?([^\]|]+)\]\]/g, "$1")
    .replace(/\{\{cvt\|([^|}]+)\|([^|}]+)[^}]*\}\}/g, "$1 $2")
    .replace(/\{\{efn[^{}]*\}\}/g, "")
    .replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/<ref[\s\S]*?<\/ref>/g, "")
    .replace(/<br\s*\/?>/gi, " — ")
    .replace(/<[^>]+>/g, " ")
    .replace(/'{2,3}/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseLargestWikiTable(text: string, title: string, minRows = 5): WikiCountTable | null {
  let best: WikiCountTable | null = null;
  let pos = 0;
  for (;;) {
    const i = text.indexOf("{|", pos);
    if (i < 0) break;
    const end = text.indexOf("\n|}", i);
    const table = text.slice(i, end > 0 ? end : undefined);
    pos = end > 0 ? end + 3 : text.length;
    const secM = [...text.slice(0, i).matchAll(/^==+\s*([^=]+?)\s*==+\s*$/gm)].pop();
    const section = secM ? secM[1].trim() : null;
    const header: string[] = [];
    const rows: string[][] = [];
    for (const chunk of table.split(/\n\|-[^\n]*/)) {
      const cells: string[] = [];
      let isHeader = false;
      let hasDataCell = false;
      for (const line of chunk.split("\n")) {
        if (line.startsWith("!")) {
          isHeader = true;
          for (const part of line.replace(/^!/, "").split("!!")) {
            const c = cleanWiki(part.replace(/^[^|]*\|(?!\|)/, ""));
            if (c) cells.push(c);
          }
        } else if (line.startsWith("|") && !line.startsWith("|+") && !line.startsWith("|}") && !line.startsWith("{|")) {
          hasDataCell = true;
          for (const part of line.replace(/^\|/, "").split("||")) {
            const c = cleanWiki(part.replace(/^(?:[a-z]+="[^"]*"\s*)+\|(?!\|)/, ""));
            if (c) cells.push(c);
          }
        }
      }
      if (!cells.length) continue;
      /* Row jisme "!" serial cell + "|" data cells (Rajdhani table) = DATA row; sirf "!" cells = header. */
      if (isHeader && !hasDataCell) { if (!rows.length) header.push(...cells); }
      else rows.push(cells);
    }
    const dataRows = rows.filter((r) => r.length >= 2);
    if (dataRows.length >= minRows && (!best || dataRows.length > best.rowCount)) {
      best = { title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`, section, rowCount: dataRows.length, header, rows: dataRows };
    }
  }
  return best;
}

export async function wikiLargestTable(title: string, minRows = 5): Promise<WikiCountTable | null> {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&redirects=1&origin=*`;
    const res = await (wikiFetchImpl ?? globalThis.fetch.bind(globalThis))(url, { headers: { "User-Agent": "RailBook/1.0 (railway assistant)" }, signal: AbortSignal.timeout(9000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { parse?: { title?: string; wikitext?: { "*": string } } };
    const text = String(j?.parse?.wikitext?.["*"] ?? "");
    if (!text) return null;
    return parseLargestWikiTable(text, j.parse?.title ?? title, minRows);
  } catch {
    return null;
  }
}

/* Train-type family → canonical Wikipedia page jiska services-table complete list hai. */
export const TRAIN_FAMILY_PAGES: [RegExp, string][] = [
  [/\bvande\s*bharat\s*(sleeper|metro)\b/i, "Vande Bharat Sleeper"],
  [/\bvande\s*bharat\b|\bvande\b/i, "Vande Bharat Express"],
  [/\bamrit\s*bharat\b/i, "Amrit Bharat Express"],
  [/\brajdhani\b/i, "Rajdhani Express"],
  [/\bshatabdi\b|\bshatbdi\b/i, "Shatabdi Express"],
  [/\bjan\s*shatabdi\b|\bjanshatabdi\b/i, "Jan Shatabdi Express"],
  [/\bduronto\b/i, "Duronto Express"],
  [/\btejas\b/i, "Tejas Express"],
  [/\bhumsafar\b/i, "Humsafar Express"],
  [/\bgarib\s*rath\b/i, "Garib Rath Express"],
  [/\bgatimaan\b|\bgatiman\b/i, "Gatimaan Express"],
  [/\bsampark\s*kranti\b/i, "Sampark Kranti Express"],
  [/\bantyodaya\b/i, "Antyodaya Express"],
  [/\bdouble\s*decker\b/i, "Double Decker Express"],
  [/\bnamo\s*bharat\b|\brapid\s*rail\b|\brrts\b/i, "Delhi–Meerut Regional Rapid Transit System"],
  [/\bmetro\b/i, "List of metro systems in India"],
  [/\bluxury\b|\bpalace on wheels\b|\bmaharaja/i, "List of luxury trains in India"],
  [/\bzone(s)?\b|\bmandal\b/i, "Zones and divisions of Indian Railways"],
];
export function trainFamilyPage(text: string): string | null {
  for (const [re, page] of TRAIN_FAMILY_PAGES) if (re.test(text)) return page;
  return null;
}
/* "kitni/kitne/total/how many/list/saari" — count-or-list intent. */
export const COUNT_LIST_RE = /\b(?:(?:kitni|kitne|total|how many|count of|number of)\s+(?:vande|rajdhani|shatabdi|duronto|tejas|humsafar|amrit|garib|gatimaan|antyodaya|trains?|gaadi|gaadiyan|services|routes?)|(?:trains?|services|routes?|vande bharat|rajdhani|shatabdi|duronto)\s+(?:kitni|kitne|total)|list\s+(?:of|do|batao|dikhao|chahiye)|(?:saari|sari|sab|all|poori|puri)\s+(?:vande|rajdhani|shatabdi|duronto|tejas|humsafar|trains?|list)|kaun kaun s[ei]\s+(?:route|train|shehar|city)|kon kon s[ei]\s+(?:route|train|shehar|city)|kahan kahan|kin kin (?:routes?|shehron|cities))\b/i;
/* Attribute sawaal (speed/fare/history/coach) count nahi hai — family-table path skip. */
export const ATTRIBUTE_Q_RE = /\b(speed|tez|fast|fare|kiraya|price|history|kab|shuru|coach|coaches|engine|seat|seats|wifi|khaana|khana|food|pantry|catering|time|timing|kitne baje|kitni der|duration)\b/i;
