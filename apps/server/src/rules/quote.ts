// 原文引用的子串校验（T05）：模型或用户给出的引用片段必须逐字出现在职位原文里，否则该条目是待确认，
// 不进入硬条件评估，也不算原文说过的内容。只容忍空白的差别（模型常把换行写成空格），
// 大小写、标点、省略号和改写都不容忍，所以拼接或改写过的引用校验不过。空引用永远校验不过。

const normalize = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim();

/**
 * 返回一个查找引用的函数：引用逐字出现在 `text` 里时给出它在规整后文本中的位置（用于按原文顺序排列），
 * 否则给出 -1。`text` 只规整一次。
 */
export function quoteFinder(text: string): (quote: string) => number {
  const haystack = normalize(text);
  return (quote) => {
    const needle = normalize(quote);
    return needle === '' ? -1 : haystack.indexOf(needle);
  };
}
