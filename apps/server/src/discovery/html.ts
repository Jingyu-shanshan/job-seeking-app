import { Parser } from 'htmlparser2';

// 把来源给的职位正文变成快照里的纯文本。模型看到的、引用片段校验时对照的都是这份文本。
// 只产出文本，从不渲染来源的 HTML。

// 前后各空一行的块：段落、标题、列表、表格等。
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
// 只换行的块。
const lines = new Set(['br', 'caption', 'dd', 'div', 'dt', 'figcaption', 'li', 'summary', 'tr']);
// 内容不是正文的元素。
const skipped = new Set(['noscript', 'script', 'style', 'template']);

/**
 * HTML 转纯文本：段落和标题之间空一行，列表项各占一行并以 "- " 开头，表格单元格以空格分隔，
 * 其余标签去掉；实体解码，连续空白合并为一个空格。
 */
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
        // <pre> 里的换行保留为换行。
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

/**
 * 纯文本整理：统一换行符和 Unicode 写法（NFC），去掉行尾空白，连续空行合并为一行，去掉首尾空行。
 * 来源本身给出纯文本时（如 Ashby）也用它，所以快照文本的格式一致。
 */
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
