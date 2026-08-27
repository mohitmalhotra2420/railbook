import type { Extraction } from "./schema.js";

/** Tools Gemini/NVIDIA must never be allowed to run. */
export const FORBIDDEN_MONEY_TOOLS = [
  "createBooking",
  "confirmBooking",
  "addMoney",
  "debit",
  "credit",
  "cancelBooking",
  "bookTrain",
  "charge",
] as const;

export function isForbiddenMoneyTool(tool: string | null | undefined): boolean {
  if (!tool) return false;
  const t = tool.toLowerCase();
  return (
    FORBIDDEN_MONEY_TOOLS.some((name) => name.toLowerCase() === t) ||
    t.includes("debit") ||
    t.includes("charge") ||
    t.includes("createbooking") ||
    t.includes("confirmbooking") ||
    t.includes("addmoney")
  );
}

/** Shadow Gemini may classify BOOK_TRAIN but must never authorize money. */
export function geminiSafetyOk(ex: Extraction | null): boolean {
  if (!ex) return true;
  if (isForbiddenMoneyTool(ex.tool)) return false;
  if (isForbiddenMoneyTool(ex.suggestedAction)) return false;
  return true;
}

/** Strip any money tool Gemini might have emitted. Never used to execute. */
export function sanitizeShadowExtraction(ex: Extraction): Extraction {
  const tool = isForbiddenMoneyTool(ex.tool) ? null : ex.tool;
  const suggestedAction = isForbiddenMoneyTool(ex.suggestedAction) ? "none" : ex.suggestedAction;
  return { ...ex, tool, suggestedAction };
}
