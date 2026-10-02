const normalize = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim();

export function quoteFinder(text: string): (quote: string) => number {
  const haystack = normalize(text);
  return (quote) => {
    const needle = normalize(quote);
    return needle === '' ? -1 : haystack.indexOf(needle);
  };
}
