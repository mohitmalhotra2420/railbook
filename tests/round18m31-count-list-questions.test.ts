/* Round-18m-31 (user: "India mein total kitni Vande Bharat chalti hai? → app ne 6-train picker de diya; ChatGPT
 * samajh jaata hai"): (1) count/list/family sawaal train-name picker nahi kholta (CONCEPT_QUESTION_RE),
 * (2) Wikipedia family page ka services-table parse → count + list, (3) WEB_SEARCH tool isi se jawab deta hai. */
import { describe, expect, it } from "vitest";
import { CONCEPT_QUESTION_RE } from "../server/agent/context";
import { COUNT_LIST_RE, parseLargestWikiTable, trainFamilyPage } from "../server/agent/wikitable";

describe("Round-18m-31: count/list questions", () => {
  it("family + count questions are concept questions (no picker)", () => {
    for (const q of ["India mein total kitni vande Bharat chlti hai ?", "kitni rajdhani trains hain", "saari shatabdi list do", "how many duronto express run in india", "vande bharat kaun kaun se route par chalti hai"]) {
      expect(CONCEPT_QUESTION_RE.test(q) || (COUNT_LIST_RE.test(q) && !!trainFamilyPage(q))).toBe(true);
    }
    expect(trainFamilyPage("kitni vande bharat")).toBe("Vande Bharat Express");
    expect(trainFamilyPage("saari rajdhani")).toBe("Rajdhani Express");
    expect(trainFamilyPage("12461 ka status")).toBeNull();
  });
  it("largest wikitable parsed: services rows counted, '!' serial cells treated as data rows", () => {
    const wt = `== History ==\n{| class="wikitable"\n! A !! B\n|-\n| x || y\n|}\n== Services ==\n{| class="wikitable sortable"\n! rowspan="2" | Service\n! rowspan="2" | Zone\n|-\n! Max\n|-\n| [[New Delhi–Varanasi Vande Bharat Express|New Delhi–Varanasi]]\n| [[Northern Railway zone|NR]]\n|-\n| [[A–B Vande Bharat Express|A–B]]\n| WR\n|-\n! style="x" |3\n| [[C–D Express|C–D]]\n| SR\n|-\n| E–F\n| ER\n|-\n| G–H\n| CR\n|}\n`;
    const t = parseLargestWikiTable(wt, "Vande Bharat Express", 3);
    expect(t?.section).toBe("Services");
    expect(t?.rowCount).toBe(5);
    expect(t?.rows[0][0]).toBe("New Delhi–Varanasi");
    expect(t?.rows[2]).toContain("C–D");
    expect(t?.header[0]).toBe("Service");
  });
});
