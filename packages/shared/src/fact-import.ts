import type { Fact, FactCandidate, FactDuplicate, FactImportSource } from './facts.ts';

export const normalizedFactText = (body: string) => body.replace(/\s+/g, ' ').trim();

/** Current versions only; an unselected candidate never prevents a later one from being saved. */
export function factDuplicates(
  candidates: readonly Pick<FactCandidate, 'body' | 'selected'>[],
  facts: readonly Fact[],
): (FactDuplicate | null)[] {
  const known = new Map(facts.map((f) => [normalizedFactText(f.current.body), f]));
  const batch = new Set<string>();
  return candidates.map((candidate) => {
    const text = normalizedFactText(candidate.body);
    const fact = known.get(text);
    if (fact)
      return { status: fact.current.status === 'retired' ? 'retired' : 'active', factId: fact.id };
    if (batch.has(text)) return { status: 'batch', factId: null };
    if (candidate.selected && text) batch.add(text);
    return null;
  });
}

export function factSourceLabel(source: string): string {
  if (source === 'manual') return 'Manual entry';
  if (source === 'markdown') return 'Markdown import';
  try {
    const value = JSON.parse(source) as FactImportSource;
    if (value.type === 'pdf' && typeof value.fileName === 'string' && Array.isArray(value.pages)) {
      return `${value.edited ? 'User-corrected PDF extraction' : 'PDF extraction'}: ${value.fileName}, page ${value.pages.join(', ')}`;
    }
    if (value.type === 'markdown' && typeof value.fileName === 'string') {
      return `Markdown import: ${value.fileName || 'pasted text'}${value.edited ? ' (user-corrected)' : ''}`;
    }
  } catch {
    /* Older sources are plain text. */
  }
  return source;
}
