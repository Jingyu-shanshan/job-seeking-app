// Makes small PDFs for tests: each line of text in Helvetica, one under another from the top of an
// A4 page, or at a given place. Only characters of WinAnsiEncoding can be written: Latin-1 and the
// few typographic ones below.

export type PdfLine = string | { text: string; x: number; y: number };

const width = 595;
const height = 842;

const winAnsi = new Map([
  ['€', 0x80],
  ['…', 0x85],
  ['‘', 0x91],
  ['’', 0x92],
  ['“', 0x93],
  ['”', 0x94],
  ['•', 0x95],
  ['–', 0x96],
  ['—', 0x97],
]);

function escape(text: string): string {
  return [...text]
    .map((char) => {
      if (char === '\\' || char === '(' || char === ')') return `\\${char}`;
      const code = winAnsi.get(char);
      if (code) return `\\${code.toString(8)}`;
      if (char.charCodeAt(0) > 0xff) throw new Error(`pdfOf cannot write “${char}”`);
      return char;
    })
    .join('');
}

function contentOf(lines: readonly PdfLine[]): string {
  return lines
    .map((line, i) => {
      const { text, x, y } =
        typeof line === 'string' ? { text: line, x: 50, y: height - 60 - i * 16 } : line;
      return `BT /F1 11 Tf ${x} ${y} Td (${escape(text)}) Tj ET`;
    })
    .join('\n');
}

/** A PDF with one page per list of lines. */
export function pdfOf(...pages: (readonly PdfLine[])[]): Buffer {
  const pageIds = pages.map((_, i) => 4 + i * 2);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    ...pages.flatMap((lines, i) => {
      const content = contentOf(lines);
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
          `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i]! + 1} 0 R >>`,
        `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
      ];
    }),
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
