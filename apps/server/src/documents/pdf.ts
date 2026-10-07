import { getDocumentProxy } from 'unpdf';
import type { PdfPage } from '../rules/pdf.ts';

// Reads the text of a PDF the user uploaded (T08) with unpdf's build of Mozilla's PDF.js. Only
// text and where it sits are read; nothing is rendered, and no code in the file runs.

export const maxPdfPages = 20;

export type PdfRead = { ok: true; pages: PdfPage[] } | { ok: false; reason: string };

/** Whether the bytes start like a PDF; the header may follow up to 1 KiB of other bytes. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 1024)).includes('%PDF-');
}

export async function readPdf(bytes: Uint8Array): Promise<PdfRead> {
  let pdf;
  try {
    // PDF.js takes the buffer over, so it gets a copy.
    pdf = await getDocumentProxy(new Uint8Array(bytes), {
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: true,
      verbosity: 0,
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return {
      ok: false,
      reason:
        name === 'PasswordException'
          ? 'The PDF is protected with a password. Save it again without one.'
          : 'The file could not be read as a PDF.',
    };
  }
  try {
    if (pdf.numPages > maxPdfPages) {
      return { ok: false, reason: `The PDF has more than ${maxPdfPages} pages.` };
    }
    const pages: PdfPage[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const [left = 0, bottom = 0, right = 0, top = 0] = page.view;
      const content = await page.getTextContent();
      pages.push({
        width: right - left,
        height: top - bottom,
        items: content.items.flatMap((item) =>
          'str' in item
            ? [
                {
                  text: item.str,
                  x: item.transform[4] - left,
                  y: item.transform[5] - bottom,
                  width: item.width,
                  height: item.height,
                  eol: item.hasEOL,
                },
              ]
            : [],
        ),
      });
    }
    return { ok: true, pages };
  } catch {
    return { ok: false, reason: 'The file could not be read as a PDF.' };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
