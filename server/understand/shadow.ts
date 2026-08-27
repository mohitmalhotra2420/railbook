import { env } from "../env.js";
import type { Extraction } from "./schema.js";
import { extractWithGemini, type ExtractInput, type GeminiOutcome } from "./gemini.js";
import { extractWithRapidGemini } from "./rapid-gemini.js";
import type { LlmOutcome } from "./llm.js";

export type ShadowCompare = {
  text: string;
  nvidiaIntent: string | null;
  geminiIntent: string | null;
  nvidiaTool: string | null;
  geminiTool: string | null;
  nvidiaJsonValid: boolean;
  geminiJsonValid: boolean;
  nvidiaLatencyMs: number;
  geminiLatencyMs: number;
  geminiSafetyOk: boolean;
  geminiConfirmBook: false;
  geminiExecuteTools: false;
};

const recent: ShadowCompare[] = [];
const MAX_RECENT = 40;

export function recentShadowCompares(): readonly ShadowCompare[] {
  return recent;
}

export function resetShadowCompares(): void {
  recent.length = 0;
}

function record(row: ShadowCompare): void {
  recent.push(row);
  if (recent.length > MAX_RECENT) recent.shift();
}

/**
 * Fire-and-forget. Never awaited by the customer path.
 * Gemini output is discarded after metrics — it cannot book, charge, or mutate.
 */
export function enqueueRapidGeminiShadow(input: ExtractInput, nvidia: LlmOutcome): void {
  if (!env.rapidapiGeminiShadow) return;
  void extractWithRapidGemini(input)
    .then((gemini) => {
      record(compareExtractions(input.text, nvidia, gemini));
    })
    .catch(() => {
      record({
        text: input.text,
        nvidiaIntent: nvidia.extraction?.intent ?? null,
        geminiIntent: null,
        nvidiaTool: nvidia.extraction?.tool ?? nvidia.extraction?.suggestedAction ?? null,
        geminiTool: null,
        nvidiaJsonValid: Boolean(nvidia.extraction),
        geminiJsonValid: false,
        nvidiaLatencyMs: nvidia.latencyMs,
        geminiLatencyMs: 0,
        geminiSafetyOk: true,
        geminiConfirmBook: false,
        geminiExecuteTools: false,
      });
    });
}

export function enqueueGeminiShadow(input: ExtractInput, nvidia: LlmOutcome): void {
  enqueueRapidGeminiShadow(input, nvidia);
  if (!env.geminiShadow) return;
  void extractWithGemini(input)
    .then((gemini) => {
      record(compareExtractions(input.text, nvidia, gemini));
    })
    .catch(() => {
      record({
        text: input.text,
        nvidiaIntent: nvidia.extraction?.intent ?? null,
        geminiIntent: null,
        nvidiaTool: nvidia.extraction?.tool ?? nvidia.extraction?.suggestedAction ?? null,
        geminiTool: null,
        nvidiaJsonValid: Boolean(nvidia.extraction),
        geminiJsonValid: false,
        nvidiaLatencyMs: nvidia.latencyMs,
        geminiLatencyMs: 0,
        geminiSafetyOk: true,
        geminiConfirmBook: false,
        geminiExecuteTools: false,
      });
    });
}

export function compareExtractions(
  text: string,
  nvidia: LlmOutcome,
  gemini: Pick<GeminiOutcome, "extraction" | "latencyMs" | "safetyOk">,
): ShadowCompare {
  const n: Extraction | null = nvidia.extraction;
  const g: Extraction | null = gemini.extraction;
  return {
    text,
    nvidiaIntent: n?.intent ?? null,
    geminiIntent: g?.intent ?? null,
    nvidiaTool: n?.tool ?? n?.suggestedAction ?? null,
    geminiTool: g?.tool ?? g?.suggestedAction ?? null,
    nvidiaJsonValid: Boolean(n),
    geminiJsonValid: Boolean(g),
    nvidiaLatencyMs: nvidia.latencyMs,
    geminiLatencyMs: gemini.latencyMs,
    geminiSafetyOk: gemini.safetyOk,
    geminiConfirmBook: false,
    geminiExecuteTools: false,
  };
}
