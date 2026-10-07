// A word-by-word difference between two texts (T08): what a statement changed from the fact or
// quote it rests on, or what the user changed from DeepSeek's text. Only for showing; whether a
// statement may go into the document is the server's checks.

export interface DiffPart {
  text: string;
  kind: 'same' | 'added' | 'removed';
}

const tokens = (text: string) => text.match(/\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];
const key = (token: string) => (/^\s+$/.test(token) ? ' ' : token);

/** The parts of `from` and `to` in reading order: kept, removed from `from` or added in `to`. */
export function wordDiff(from: string, to: string): DiffPart[] {
  const a = tokens(from);
  const b = tokens(to);
  // lengths[i][j]: the longest common subsequence of a[i..] and b[j..].
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i]![j] =
        key(a[i]!) === key(b[j]!)
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  const push = (text: string, kind: DiffPart['kind']) => {
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += text;
    else parts.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && key(a[i]!) === key(b[j]!)) {
      push(b[j]!, 'same');
      i++;
      j++;
    } else if (i < a.length && (j === b.length || lengths[i + 1]![j]! >= lengths[i]![j + 1]!)) {
      // What was left out comes before what replaced it.
      push(a[i++]!, 'removed');
    } else {
      push(b[j++]!, 'added');
    }
  }
  return parts;
}

/** How many words differ; for picking the cited fact a statement is closest to. */
export function changedWords(parts: readonly DiffPart[]): number {
  return parts
    .filter((part) => part.kind !== 'same')
    .reduce((n, part) => n + tokens(part.text).filter((t) => !/^\s+$/.test(t)).length, 0);
}
