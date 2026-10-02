import type { FactKind } from '@jsa/shared';

export interface ImportedFact {
  kind: FactKind;
  body: string;
  heading: string;
}

const headingKinds: [RegExp, FactKind][] = [
  [/project|项目/i, 'project'],
  [/experience|employment|\bwork\b|career|工作|经历|履历/i, 'experience'],
  [/education|degree|study|studies|学历|教育/i, 'education'],
  [/language|语言/i, 'language'],
  [/certific|licen[cs]e|证书|资格/i, 'certification'],
  [/skill|technolog|tech stack|tools|技能|技术/i, 'skill'],
  [/summary|profile|statement|about|introduction|表述|简介|自我介绍/i, 'statement'],
];

function kindOf(heading: string): FactKind {
  return headingKinds.find(([pattern]) => pattern.test(heading))?.[1] ?? 'other';
}

const headingLine = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const listItem = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;

export function parseFactsMarkdown(markdown: string): ImportedFact[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    if (end > 0) lines.splice(0, end + 1);
  }

  const facts: ImportedFact[] = [];
  let heading = '';
  let current: string[] | undefined;
  let inList = false;

  const finish = () => {
    const body = current?.join('\n').trim();
    if (body) facts.push({ kind: kindOf(heading), body, heading });
    current = undefined;
  };

  for (const line of lines) {
    const title = headingLine.exec(line);
    if (title) {
      finish();
      heading = title[1] ?? '';
      inList = false;
      continue;
    }
    if (line.trim() === '') {
      if (!inList) finish();
      continue;
    }
    const item = listItem.exec(line);
    if (item && item[1] === '') {
      finish();
      current = [item[2] ?? ''];
      inList = true;
      continue;
    }
    if (inList && /^\s/.test(line) && current) {
      current.push(line.trim());
      continue;
    }
    if (inList) finish();
    inList = false;
    current = [...(current ?? []), line.trim()];
  }
  finish();
  return facts;
}
