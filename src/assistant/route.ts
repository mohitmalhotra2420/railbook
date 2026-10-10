/** Additive AI assistant route. Hash based (like #admin/models) so no server SPA fallback change. */
export function isAssistantHash(hash: string): boolean {
  return /^#\/?assistant\/?$/i.test(hash.trim());
}
