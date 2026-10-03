/**
 * Where a quote is in the job text, allowing any whitespace between its words, as the server's
 * quote check does. Undefined when it is not there.
 */
export function findQuote(text: string, quote: string): { start: number; end: number } | undefined {
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const found = new RegExp(escaped.join('\\s+'), 'u').exec(text);
  return found ? { start: found.index, end: found.index + found[0].length } : undefined;
}
