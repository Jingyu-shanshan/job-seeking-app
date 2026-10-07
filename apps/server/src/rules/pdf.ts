// Whether a PDF the user printed is the document (T08): its text must be the document's text, in
// order, with nothing missing, changed or added (a browser's date, address or page numbers), and
// no text may run off a page. Spaces and line breaks are ignored, since a PDF wraps lines where
// the page ends, and so are the bullets and separators a browser may draw as text.

export interface PdfItem {
  text: string;
  /** Where the text starts and how far it reaches, in PDF units from the page's bottom left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** A line ends after this item. */
  eol: boolean;
}

export interface PdfPage {
  width: number;
  height: number;
  items: PdfItem[];
}

const ignored = /[\s\u00ad\u200b-\u200d\u2060\ufeff]/u;
const decoration = /^[•·◦‣⁃▪∙●○■□|–—-]*$/u;
const maxListed = 8;
// How far text may reach past a page edge, in PDF units (1/72 inch), for rounding.
const tolerance = 1;

/** The text without what is ignored, and where each of its characters came from. */
function squeeze(text: string): { text: string; from: number[] } {
  let squeezed = '';
  const from: number[] = [];
  let i = 0;
  for (const char of text) {
    for (const part of char.normalize('NFKC')) {
      if (ignored.test(part)) continue;
      squeezed += part;
      from.push(i);
    }
    i += char.length;
  }
  return { text: squeezed, from };
}

const short = (text: string) => {
  const tidy = text.replace(/\s+/g, ' ').trim();
  return tidy.length > 80 ? `${tidy.slice(0, 77)}…` : tidy;
};

/** Why the PDF is not the document with these pieces of text; empty when it is. */
export function pdfTextProblems(pieces: readonly string[], pages: readonly PdfPage[]): string[] {
  const offPage: string[] = [];
  pages.forEach((page, n) => {
    for (const item of page.items) {
      if (item.text.trim() === '') continue;
      if (
        item.x < -tolerance ||
        item.y < -tolerance ||
        item.x + item.width > page.width + tolerance ||
        item.y + item.height > page.height + tolerance
      ) {
        offPage.push(`Text runs off page ${n + 1}: “${short(item.text)}”.`);
      }
    }
  });

  const raw = pages
    .flatMap((page) => page.items.map((item) => item.text + (item.eol ? '\n' : '')))
    .join('');
  const pdf = squeeze(raw);
  if (pdf.text === '') {
    return ['The PDF has no text the app can read. Print the page to PDF again; do not scan it.'];
  }

  const missing: string[] = [];
  const extra: string[] = [];
  const extraAt = (start: number, end: number) => {
    const gap = pdf.text.slice(start, end);
    if (gap === '' || decoration.test(gap)) return;
    const text = raw.slice(pdf.from[start], end < pdf.from.length ? pdf.from[end] : raw.length);
    extra.push(`The PDF has text that is not in the document: “${short(text)}”.`);
  };
  let at = 0;
  for (const piece of pieces) {
    const wanted = squeeze(piece).text;
    if (wanted === '') continue;
    const found = pdf.text.indexOf(wanted, at);
    if (found < 0) {
      missing.push(`“${short(piece)}” is not in the PDF, or reads differently there.`);
      continue;
    }
    extraAt(at, found);
    at = found + wanted.length;
  }
  extraAt(at, pdf.text.length);

  const listed = (problems: string[]) =>
    problems.length > maxListed
      ? [...problems.slice(0, maxListed), `And ${problems.length - maxListed} more like these.`]
      : problems;
  return [...listed(missing), ...listed(extra), ...listed([...new Set(offPage)])];
}
