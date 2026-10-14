import { createHash } from 'node:crypto';
import {
  maxFactImportCandidates,
  maxFactImportTextLength,
  type FactCandidate,
  type PreviewFactsResponse,
} from '@jsa/shared';
import { looksLikePdf, readPdf } from '../documents/pdf.ts';
import { httpError } from '../http-error.ts';
import type { PdfPage } from '../rules/pdf.ts';
import { kindOf } from './markdown.ts';

const heading =
  /^(?:work experience|professional experience|experience|employment|projects?|project experience|education|skills|technical skills|technologies|tech stack|tools|languages|certifications?|licenses?|summary|profile|about me|工作经历|工作经验|项目|项目经历|教育|学历|技能|技术|语言|证书|资格|简介|自我介绍)[:：]?$/i;

function linesOf(page: PdfPage) {
  const lines: { text: string; y: number; height: number; right: number }[] = [];
  for (const item of [...page.items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    if (!item.text.trim()) continue;
    const last = lines.at(-1);
    if (last && Math.abs(last.y - item.y) <= 3) {
      last.text += (item.x - last.right > 1 && !/\s$/.test(last.text) ? ' ' : '') + item.text;
      last.right = item.x + item.width;
      last.height = Math.max(last.height, item.height);
    } else
      lines.push({ text: item.text, y: item.y, height: item.height, right: item.x + item.width });
  }
  return lines;
}

export async function previewPdf(
  bytes: Uint8Array,
  fileName: string,
): Promise<Pick<PreviewFactsResponse, 'pages'> & { candidates: FactCandidate[] }> {
  if (!bytes.length)
    throw httpError(400, 'The file is empty. Choose a PDF with selectable text or paste Markdown.');
  if (!looksLikePdf(bytes))
    throw httpError(
      400,
      'This file is not a PDF. Choose a PDF with selectable text or paste Markdown.',
    );
  const read = await readPdf(bytes, maxFactImportTextLength);
  if (!read.ok) throw httpError(400, read.reason);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const candidates: FactCandidate[] = [];
  let kind: FactCandidate['kind'] = 'other';
  // shortcut: columns and tables are read in row order; users correct them in review until layout-aware extraction is needed.
  const pages = read.pages.map((page, i) => {
    const lines = linesOf(page);
    let body: string[] = [];
    const finish = () => {
      if (body.length)
        candidates.push({
          kind,
          body: body.join('\n'),
          selected: true,
          source: { type: 'pdf', fileName, pages: [i + 1], sha256, edited: false },
        });
      body = [];
      if (candidates.length > maxFactImportCandidates)
        throw httpError(
          400,
          `An import can have at most ${maxFactImportCandidates} candidates. Use a shorter file.`,
        );
    };
    lines.forEach((line, n) => {
      const text = line.text.trim();
      const title = text.normalize('NFKC');
      if (heading.test(title)) {
        finish();
        kind = kindOf(title);
        return;
      }
      const previous = lines[n - 1];
      if (
        /^(?:[-*+•▪]|\d+[.)])\s/.test(text) ||
        (previous && previous.y - line.y > Math.max(previous.height, line.height) * 1.8)
      )
        finish();
      body.push(text);
    });
    finish();
    return { page: i + 1, text: lines.map((line) => line.text).join('\n') };
  });
  if (pages.reduce((sum, p) => sum + p.text.length, 0) > maxFactImportTextLength)
    throw httpError(400, `The PDF text exceeds ${maxFactImportTextLength} characters.`);
  if (!candidates.length)
    throw httpError(
      400,
      'No selectable fact text was found. Scanned PDFs need a text layer; choose a text PDF or paste Markdown.',
    );
  return { pages, candidates };
}
