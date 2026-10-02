import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quoteFinder } from './quote.ts';

const text = `Senior Backend Engineer

What you bring
- 5+ years of Python
- Fluent English; Finnish is a plus

Kehittäjä – 开发者`;

test('accepts a quote copied from the text, whatever its whitespace', () => {
  const find = quoteFinder(text);
  assert.ok(find('5+ years of Python') >= 0);
  // 跨行的引用：模型常把换行写成空格。
  assert.ok(find('What you bring - 5+ years of Python') >= 0);
  assert.ok(find('  Fluent English;\n Finnish is a plus ') >= 0);
  assert.ok(find('Kehittäjä – 开发者') >= 0);
});

test('rejects a quote that is changed, joined, shortened with an ellipsis or empty', () => {
  const find = quoteFinder(text);
  for (const quote of [
    '5+ years of python',
    '5 years of Python',
    '5+ years of Python and Go',
    'Fluent English … a plus',
    'Fluent English; Finnish is required',
    '',
    '   ',
  ]) {
    assert.equal(find(quote), -1, quote);
  }
});

test('compares composed and decomposed letters alike', () => {
  const find = quoteFinder('Kehittäjä');
  assert.ok(find('Kehittäjä') >= 0);
});

test('gives positions in text order', () => {
  const find = quoteFinder(text);
  assert.ok(find('Fluent English') > find('5+ years of Python'));
  assert.ok(find('5+ years of Python') > find('Senior Backend Engineer'));
});
