import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FastifyBaseLogger } from 'fastify';
import { chatCompletion, fakeDeepSeek } from '../testing/deepseek.ts';
import { ModelError, chatJson, estimateCost } from './deepseek.ts';

const warnings: unknown[] = [];
const log = { warn: (...args: unknown[]) => warnings.push(args) } as unknown as FastifyBaseLogger;
const call = (fetch: typeof globalThis.fetch, timeoutMs?: number) =>
  chatJson({
    apiKey: 'sk-test',
    fetch,
    log,
    system: 'Answer in JSON.',
    user: '<jd>Text</jd>',
    maxTokens: 100,
    timeoutMs,
  });

test('asks for JSON without thinking, and returns the answer with its usage and cost', async () => {
  const deepseek = fakeDeepSeek({ ok: true });
  const result = await call(deepseek.fetch);
  assert.deepEqual(result, {
    answer: { ok: true },
    // 1000 × 0.006 + 2000 × 0.3 + 500 × 1.2 = 1206 微美元
    usage: { inputTokens: 3000, cachedInputTokens: 1000, outputTokens: 500, costUsd: 0.001206 },
  });
  const [request] = deepseek.requests;
  assert.equal(request?.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(request?.headers.get('authorization'), 'Bearer sk-test');
  assert.deepEqual(
    {
      model: request?.body.model,
      messages: request?.body.messages,
      response_format: request?.body.response_format,
      thinking: request?.body.thinking,
      max_tokens: request?.body.max_tokens,
    },
    {
      model: 'deepseek-flash',
      messages: [
        { role: 'system', content: 'Answer in JSON.' },
        { role: 'user', content: '<jd>Text</jd>' },
      ],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      max_tokens: 100,
    },
  );
});

test('prices every input token as a cache miss when no cache hits are reported', () => {
  assert.equal(estimateCost({ inputTokens: 10_000, cachedInputTokens: 0, outputTokens: 0 }), 0.003);
});

test('says plainly why a call failed, with the usage when DeepSeek did answer', async () => {
  const fails = async (answer: () => Promise<Response>, message: string, usage: boolean) => {
    const err = await call(fakeDeepSeek(answer).fetch).then(
      () => assert.fail('the call should fail'),
      (e: unknown) => e,
    );
    assert.ok(err instanceof ModelError);
    assert.equal(err.message, message);
    assert.equal(err.usage !== undefined, usage, message);
  };
  const status = (code: number) => async () =>
    Response.json({ error: { message: 'Made up', type: 'x' } }, { status: code });

  await fails(
    status(401),
    'DeepSeek refused the API key (HTTP 401). Check DEEPSEEK_API_KEY on the server.',
    false,
  );
  await fails(status(402), 'The DeepSeek account has no balance left (HTTP 402).', false);
  await fails(status(429), 'DeepSeek is limiting requests (HTTP 429). Try again later.', false);
  await fails(status(503), 'DeepSeek answered HTTP 503. Try again later.', false);
  await fails(
    status(400),
    'DeepSeek refused the request (HTTP 400); the server log has details.',
    false,
  );
  await fails(
    async () => new Response('<html>gateway</html>'),
    'DeepSeek answered with something other than a chat completion.',
    false,
  );
  await fails(
    async () => {
      throw new TypeError('fetch failed');
    },
    'Could not reach DeepSeek.',
    false,
  );
  await fails(
    async () => chatCompletion('{"a":', { finishReason: 'length' }),
    'The answer from DeepSeek was cut off at the token limit.',
    true,
  );
  await fails(
    async () => chatCompletion('{}', { finishReason: 'content_filter' }),
    'DeepSeek stopped the answer early (content_filter).',
    true,
  );
  await fails(async () => chatCompletion('   '), 'DeepSeek gave an empty answer.', true);
  await fails(async () => chatCompletion(null), 'DeepSeek gave an empty answer.', true);
  await fails(
    async () => chatCompletion('Sure! {"a": 1}'),
    'The answer from DeepSeek is not JSON.',
    true,
  );
  // 供应商的错误说明只进日志，不含密钥。
  assert.ok(JSON.stringify(warnings).includes('Made up'));
  assert.ok(!JSON.stringify(warnings).includes('sk-test'));
});

test('gives up on an answer that takes too long', async () => {
  // 与真实的 fetch 一样，在超时信号触发时放弃请求。
  const never = ((_: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    })) as typeof globalThis.fetch;
  await assert.rejects(call(never, 50), {
    name: 'Error',
    message: 'DeepSeek did not answer within 0.05 seconds.',
  });
});
