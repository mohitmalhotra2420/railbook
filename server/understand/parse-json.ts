import { parseExtraction, type Extraction } from "./schema.js";

export function stripFences(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  return content.trim();
}

export function parseLlmJson(content: string): Extraction | null {
  const raw = stripFences(content);
  try {
    return parseExtraction(JSON.parse(raw) as unknown);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return parseExtraction(JSON.parse(raw.slice(start, end + 1)) as unknown);
      } catch {
        return null;
      }
    }
    return null;
  }
}
