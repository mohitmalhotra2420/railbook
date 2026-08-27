import type { Block } from "../ai/orchestrate";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  blocks?: Block[];
  pending?: boolean;
}
