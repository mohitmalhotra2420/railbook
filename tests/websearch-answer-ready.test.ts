/* ══ ROUND-15 (2026-09-07): "Muse ko web search mein better banao" ══
 * Prod mein "vande bharat ki top speed kitni hai" par Muse WEB_SEARCH ko
 * 3x repeat karke cap hit kar raha tha aur reply raw "• Web search …: 3
 * results" summaries thi — 300-char snippets se 30B model jawab
 * synthesize nahi kar paata.
 *
 * Fix: WEB_SEARCH tool khud topicpage engine (Wikipedia full page →
 * sawaal-focused paragraph/table) se ANSWER-READY summary deta hai;
 * doosri search reject (already answered); model/empty fail par
 * deterministicSummary web-answer ko seedha reply banata hai. */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { executeApprovedTool, runAgenticTurn, setAgenticNvidiaFetch } from "../server/agent/agentic";
import { setWebFetch } from "../server/agent/websearch";
import { cleanQueryEn, findTopicAnswer, focusSentences } from "../server/agent/topicpage";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const VB_INTRO =
  "Vande Bharat Express is a medium to long-distance semi-high speed express train service operated by the Indian Railways. " +
  "It is a reserved, air-conditioned chair car service connecting cities that are less than 800 km (500 mi) apart. " +
  "The first commercial service of Vande Bharat was officially inaugurated on 15 February 2019 by Prime Minister Narendra Modi. " +
  "The trainsets are self-propelling electric multiple units (EMUs) in eight, sixteen or twenty coach configurations. " +
  "They were introduced as part of the Make in India initiative by the Indian government, and are designed and manufactured by the state-owned Integral Coach Factory in Chennai. " +
  "Introduced in 2018, the trainsets achieved speeds up to 183 km/h (114 mph) during trial runs. " +
  "However, the maximum operational speed is restricted to 160 km/h (99 mph), which is achieved on the Tughlakabad–Agra section. " +
  "This is the highest operational speed on the Indian Railways network, shared with Gatimaan Express over the same section.";

const VB_HISTORY =
  "Efforts to increase speed In 1960, the Indian Railway Board commissioned a study to increase the speed of its trains, which was restricted to 96 km/h (60 mph) on the existent broad gauge lines. " +
  "The Research Design and Standards Organisation was tasked with achieving a target speed of 160 km/h (99 mph) and an intermediate target of 120 km/h (75 mph). " +
  "Speed trials were conducted and a speed of 120 km/h was achieved. Further speed studies looked at 140 km/h and 150 km/h on select speed sections.";

const SLEEPER_EXTRACT =
  "The Vande Bharat Sleeper trainset, formerly known as Train 20, is a semi-high-speed, long-distance electric multiple unit developed for the Indian Railways.\n\n" +
  "Background and planning The express trains operated by the Indian Railways are often limited to a maximum speed of 100–110 km/h (62–68 mph), with the average speeds of about 54 km/h (34 mph). The speed limitations included the lack of infrastructure for higher speed.";

/** Wiki mock — search order simulates real ranking: full query → Sleeper
 * page first; subject-only "vande bharat" → Express page first. */
function wikiMock(): void {
  setWebFetch(async (input: any) => {
    const url = String(input);
    if (url.includes("duckduckgo.com")) return jsonResponse(200, {});
    const u = new URL(url);
    if (u.searchParams.get("action") === "parse") return jsonResponse(200, { parse: { title: "", wikitext: { "*": "" } } });
    if (u.searchParams.get("list") === "search") {
      const q = (u.searchParams.get("srsearch") ?? "").toLowerCase();
      if (!q.includes("vande")) return jsonResponse(200, { query: { search: [] } });
      const titles = /speed|top/.test(q)
        ? ["Vande Bharat Sleeper", "Vande Bharat (Indian Railways)", "Vande Bharat Express"]
        : ["Vande Bharat Express", "Vande Bharat (Indian Railways)", "Vande Bharat Sleeper Express"];
      return jsonResponse(200, { query: { search: titles.map((t) => ({ title: t })) } });
    }
    if (u.searchParams.get("prop") === "extracts") {
      const title = u.searchParams.get("titles") ?? "";
      const extracts: Record<string, string> = {
        "Vande Bharat Express": `${VB_INTRO}\n\n${VB_HISTORY}`,
        "Vande Bharat Sleeper": SLEEPER_EXTRACT,
        "Vande Bharat (Indian Railways)": "Vande Bharat is a brand of Indian Railways covering the Express and Sleeper trainsets manufactured at ICF Chennai for the Indian Railways network.",
      };
      const ex = extracts[title];
      if (u.searchParams.get("exintro") === "1") {
        return jsonResponse(200, { query: { pages: ex ? { "1": { title, extract: ex.slice(0, 300) } } : {} } });
      }
      return jsonResponse(200, { query: { pages: ex ? { "1": { title, extract: ex } } : {} } });
    }
    return jsonResponse(404, {});
  });
}

describe("ROUND-15: WEB_SEARCH answer-ready (Muse web-search fix)", () => {
  beforeEach(() => {
    process.env.NVIDIA_API_KEY = "nvapi_test_key_not_real";
  });
  afterEach(() => {
    setWebFetch(null);
    setAgenticNvidiaFetch(null as never);
    process.env.NVIDIA_API_KEY = "";
  });

  it("cleanQueryEn: 'vande bharat' brand ka bharat → india translate NAHI hota", () => {
    expect(cleanQueryEn("vande bharat ki top speed kitni hai")).toBe("vande bharat top speed");
    expect(cleanQueryEn("amrit bharat express kya hai")).toBe("amrit bharat express");
    expect(cleanQueryEn("bharat ki pehli train kab chali")).toBe("india first train");
    expect(cleanQueryEn("duniya ki sabse lambi train")).toBe("world longest train");
  });

  it("focusSentences: 700-char cut se asli jawab (end wala 160 km/h sentence) nahi katta", () => {
    const out = focusSentences(VB_INTRO, /speed|km\/h|kmph|kph/i, 700);
    expect(out.length).toBeLessThanOrEqual(700);
    expect(out).toMatch(/160 km\/h/);
    expect(out).toMatch(/^Vande Bharat Express is/);
  });

  it("findTopicAnswer: subject re-rank → 'Vande Bharat Express' page (Sleeper nahi) + 160 km/h para", async () => {
    wikiMock();
    const a = await findTopicAnswer("vande bharat ki top speed kitni hai");
    expect(a?.title).toBe("Vande Bharat Express");
    expect(a?.kind).toBe("paragraph");
    expect(a?.text).toMatch(/160 km\/h/);
    expect(a?.text).not.toMatch(/1960/); // generic history para haara
  });

  it("WEB_SEARCH tool: answer-ready 'Web se mila (Wikipedia — …)' summary + 'dobara search mat karo' note", async () => {
    wikiMock();
    const r = await executeApprovedTool("WEB_SEARCH", { query: "Vande Bharat Express top speed" }, { userText: "vande bharat ki top speed kitni hai" });
    expect(r.ok).toBe(true);
    expect(r.source).toBe("web");
    expect(r.summary).toMatch(/^Web se mila \(Wikipedia — Vande Bharat Express\)/);
    expect(r.summary).toMatch(/160 km\/h/);
    expect(r.summary).toMatch(/\(Source: https:\/\/en\.wikipedia\.org\/wiki\/Vande_Bharat_Express\)/);
    const data = r.data as { answer_found: boolean; note: string; answer: string };
    expect(data.answer_found).toBe(true);
    expect(data.note).toMatch(/dobara WEB_SEARCH MAT/i);
    expect(data.answer).toMatch(/160 km\/h/);
  });

  it("WEB_SEARCH tool: topic-page fail → snippet fallback ab 'Best:' snippet summary mein deta hai", async () => {
    setWebFetch(async (url: any) => {
      const u = String(url);
      if (u.includes("api.duckduckgo.com")) {
        return jsonResponse(200, {
          AbstractText: "Gatimaan Express is a semi-high speed train with a top speed of 160 km/h.",
          AbstractURL: "https://en.wikipedia.org/wiki/Gatimaan_Express",
          Heading: "Gatimaan Express",
        });
      }
      if (u.includes("wikipedia.org")) return jsonResponse(200, { query: { search: [] } });
      return jsonResponse(404, {});
    });
    const r = await executeApprovedTool("WEB_SEARCH", { query: "gatimaan express top speed" });
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/Best: Gatimaan Express — .*160 km\/h/);
  });

  it("runAgenticTurn: model REPEAT search kare → 2nd call reject (already answered), final reply Hinglish synthesized", async () => {
    wikiMock();
    const bodies: any[] = [];
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      const toolMsgs = body.messages.filter((m: any) => m.role === "tool");
      const mk = (name: string, args: unknown, id: string) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
      if (toolMsgs.length === 0) {
        return jsonResponse(200, { model: "meta/muse-glimmer-30b", choices: [{ message: { content: null, tool_calls: [mk("WEB_SEARCH", { query: "vande bharat top speed" }, "c1")] } }] });
      }
      if (toolMsgs.length === 1) {
        // Muse-style loop: same topic dobara
        return jsonResponse(200, { model: "meta/muse-glimmer-30b", choices: [{ message: { content: null, tool_calls: [mk("WEB_SEARCH", { query: "Vande Bharat Express maximum speed" }, "c2")] } }] });
      }
      const last = JSON.parse(toolMsgs[toolMsgs.length - 1].content);
      expect(last.ok).toBe(false);
      expect(last.summary).toMatch(/Dobara search ki zaroorat nahi/);
      expect(last.summary).toMatch(/160 km\/h/);
      return jsonResponse(200, {
        model: "meta/muse-glimmer-30b",
        choices: [{ message: { content: "Web se mila (Wikipedia — Vande Bharat Express): Vande Bharat ki maximum operational speed 160 km/h hai; trial runs mein 183 km/h tak gayi thi. (Source: https://en.wikipedia.org/wiki/Vande_Bharat_Express)" } }],
      });
    });
    const turn = await runAgenticTurn({ text: "vande bharat ki top speed kitni hai", now: "2026-09-07T10:00:00+05:30" });
    expect(turn.ok).toBe(true);
    expect(turn.grounded).toBe(true);
    expect(turn.steps.map((s) => `${s.tool}${s.ok ? "✓" : "✗"}`)).toEqual(["WEB_SEARCH✓", "WEB_SEARCH✗"]);
    expect(String(turn.reply)).toMatch(/160 km\/h/);
    expect(String(turn.reply)).not.toMatch(/Web search ".*": \d+ results/);
  });

  it("runAgenticTurn: model empty-content de → deterministic reply = web answer (raw '• Web search' dump NAHI)", async () => {
    wikiMock();
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const toolMsgs = body.messages.filter((m: any) => m.role === "tool").length;
      if (toolMsgs === 0) {
        return jsonResponse(200, {
          model: "meta/muse-glimmer-30b",
          choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "WEB_SEARCH", arguments: JSON.stringify({ query: "vande bharat top speed" }) } }] } }],
        });
      }
      // Model sirf reasoning ke saath khaali content deta hai (Muse quirk)
      return jsonResponse(200, { model: "meta/muse-glimmer-30b", choices: [{ message: { content: "", reasoning_content: "" } }] });
    });
    const turn = await runAgenticTurn({ text: "vande bharat ki top speed kitni hai", now: "2026-09-07T10:00:00+05:30" });
    const reply = String(turn.reply);
    expect(reply).toMatch(/^Web se mila \(Wikipedia — Vande Bharat Express\)/);
    expect(reply).toMatch(/160 km\/h/);
    expect(reply).toMatch(/web-scrape ka jawab/);
    expect(reply).not.toMatch(/^• /m);
  });
});
