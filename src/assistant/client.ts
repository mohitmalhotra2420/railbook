/** One assistant turn through the existing server agent. Keeps conversation context via `history`.
 *  The server never books or charges from this path (booking routes are disabled). */
export type AssistantRole = "user" | "assistant";
export type AssistantMessage = { role: AssistantRole; content: string };

export const ASSISTANT_HISTORY_LIMIT = 10;

export function trimHistory(messages: AssistantMessage[]): AssistantMessage[] {
  return messages.filter((m) => m.content.trim().length > 0).slice(-ASSISTANT_HISTORY_LIMIT);
}

export async function sendAssistantTurn(text: string, history: AssistantMessage[]): Promise<string> {
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, history: trimHistory(history) }),
  });
  const data = (await res.json().catch(() => ({}))) as { reply?: unknown; error?: unknown };
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `Request failed (${res.status})`);
  const reply = typeof data.reply === "string" ? data.reply.trim() : "";
  return reply || "Is baat ka verified jawab abhi nahi mil paaya. Dobara poochiye.";
}
