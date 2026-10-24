import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callTool, checkToolInput, toolCost, toolPriceUsd, toolUrls } from './provider.ts';

const result = {
  results: [
    {
      title: 'Engineer',
      url: 'https://example.com/job',
      snippet: '',
      summary: 'Summary',
      content: '',
    },
  ],
};

test('tool billing requires a confirmed result and releases only confirmed zero fees', () => {
  assert.equal(toolCost('search', 200, result), toolPriceUsd);
  assert.equal(toolCost('search', 200, { results: [] }), 0);
  assert.equal(toolCost('fetch', 200, { title: '', content: 'Page' }), toolPriceUsd);
  assert.equal(toolCost('fetch', 200, { title: '', content: '' }), 0);
  for (const status of [400, 401, 402, 403, 404, 408, 429, 500, 504])
    assert.equal(toolCost('search', status, null), 0);
  for (const value of [null, {}, { results: [null] }, { results: 'invalid' }])
    assert.equal(toolCost('search', 200, value), undefined);
  assert.equal(toolCost('fetch', 200, { title: '', content: 12 }), undefined);
  assert.equal(toolCost('search', 302, result), undefined);
  assert.equal(toolCost('fetch', 200, { title: '', content: 'Page', results: [] }), toolPriceUsd);
  assert.equal(toolCost('search', 200, { ...result, content: '' }), toolPriceUsd);
});

test('search input respects Unicode codepoint length and rejects blank queries', () => {
  checkToolInput('search', '😀'.repeat(128));
  assert.throws(() => checkToolInput('search', '😀'.repeat(129)));
  assert.throws(() => checkToolInput('search', '   '));
});

test('native tool requests contain only explicit input, use auth and never follow redirects', async () => {
  for (const tool of ['search', 'fetch'] as const) {
    const input = tool === 'search' ? 'Engineer site:example.com' : 'https://example.com/job';
    const outcome = await callTool({
      tool,
      input,
      apiKey: 'fake-key',
      fetch: async (url, init) => {
        assert.equal(url, toolUrls[tool]);
        assert.equal(init?.method, 'POST');
        assert.equal(init?.redirect, 'error');
        assert.ok(init?.signal);
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fake-key');
        assert.deepEqual(
          JSON.parse(String(init?.body)),
          tool === 'search' ? { query: input, count: 5, need_content: false } : { url: input },
        );
        return Response.json(tool === 'search' ? result : { title: '', content: 'Page' });
      },
    });
    assert.equal(outcome.cost, toolPriceUsd);
    assert.ok(outcome.result);
  }
});

test('failures never leak provider bodies or error details, and unknown outcomes keep estimates', async () => {
  for (const status of [401, 402, 403, 404, 429, 500, 504]) {
    const outcome = await callTool({
      tool: 'search',
      input: 'query',
      apiKey: 'secret',
      fetch: async () => new Response('secret', { status }),
    });
    assert.equal(outcome.cost, 0);
    assert.equal(outcome.result, null);
    assert.ok(!outcome.message.includes('secret'));
  }
  for (const fetch of [
    async () => {
      throw new Error('secret');
    },
    async () => new Response('invalid JSON'),
    async () => Response.json({ results: [null] }),
    async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)),
  ]) {
    const outcome = await callTool({ tool: 'search', input: 'query', apiKey: 'secret', fetch });
    assert.equal(outcome.cost, undefined);
    assert.equal(outcome.result, null);
    assert.ok(!outcome.message.includes('secret'));
  }
});
