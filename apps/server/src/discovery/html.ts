import { Parser } from 'htmlparser2';

const paragraphs = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'details',
  'dl',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'main',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
]);
const lines = new Set(['br', 'caption', 'dd', 'div', 'dt', 'figcaption', 'li', 'summary', 'tr']);
const skipped = new Set(['noscript', 'script', 'style', 'template']);

export function htmlToText(html: string): string {
  const out: string[] = [];
  let current = '';
  let bullet = false;
  let skip = 0;
  let pre = 0;

  const breakLine = (paragraph: boolean) => {
    const text = current.replace(/\s+/g, ' ').trim();
    if (text !== '') out.push(bullet ? `- ${text}` : text);
    current = '';
    bullet = false;
    if (paragraph && out.length > 0 && out.at(-1) !== '') out.push('');
  };

  const parser = new Parser(
    {
      onopentag(name) {
        if (skipped.has(name)) skip += 1;
        else if (name === 'pre') pre += 1;
        if (paragraphs.has(name)) breakLine(true);
        else if (lines.has(name)) breakLine(false);
        else if (name === 'td' || name === 'th') current += ' ';
        if (name === 'li') bullet = true;
      },
      ontext(text) {
        if (skip > 0) return;
        if (pre === 0) {
          current += text;
          return;
        }
        const [first = '', ...rest] = text.split('\n');
        current += first;
        for (const part of rest) {
          breakLine(false);
          current = part;
        }
      },
      onclosetag(name) {
        if (skipped.has(name)) skip -= 1;
        else if (name === 'pre') pre -= 1;
        if (paragraphs.has(name)) breakLine(true);
        else if (lines.has(name) && name !== 'br') breakLine(false);
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  breakLine(false);
  return tidyText(out.join('\n'));
}

export function tidyText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
