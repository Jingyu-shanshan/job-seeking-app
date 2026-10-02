import assert from 'node:assert/strict';
import { test } from 'node:test';
import { htmlToText, tidyText } from './html.ts';

test('turns job page HTML into lines of text', () => {
  const html = `<h2>About us</h2><p>We build   things.<br>In our Helsinki&nbsp;office.</p>
    <div><strong>What you bring</strong></div>
    <ul><li>5+ years of <em>Python</em></li><li>Fluent English &amp; Finnish</li></ul>
    <table><tr><td>Salary</td><td>5000 €</td></tr></table>
    <p>Kehittäjä &ndash; 开发者</p>`;
  assert.equal(
    htmlToText(html),
    `About us

We build things.
In our Helsinki office.

What you bring

- 5+ years of Python
- Fluent English & Finnish

Salary 5000 €

Kehittäjä – 开发者`,
  );
});

test('drops scripts and styles, keeps the lines of preformatted text', () => {
  assert.equal(
    htmlToText('<style>p { color: red }</style><script>alert(1)</script><pre>a\n  b</pre>'),
    'a\nb',
  );
});

test('tidies plain text the same way', () => {
  assert.equal(tidyText('\r\n  Title  \r\n\r\n\r\n\r\nBodÿ \n'), 'Title\n\nBodÿ'.normalize());
});
