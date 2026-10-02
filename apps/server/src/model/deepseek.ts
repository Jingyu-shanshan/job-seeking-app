import type { FastifyBaseLogger } from 'fastify';
import Type from 'typebox';
import { Value } from 'typebox/value';

export const deepseek = {
  url: 'https://api.deepseek.com/chat/completions',
  model: 'deepseek-flash',
  pricePerMillion: { cachedInput: 0.006, input: 0.3, output: 1.2 },
  pricesChecked: { on: '2026-10-02', url: 'https://api-docs.deepseek.com/quick_start/pricing/' },
} as const;

export interface CallUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export class ModelError extends Error {
  readonly usage: CallUsage | undefined;

  constructor(message: string, usage?: CallUsage) {
    super(message);
    this.usage = usage;
  }
}

const ResponseSchema = Type.Object({
  choices: Type.Array(
    Type.Object({
      message: Type.Object({ content: Type.Union([Type.String(), Type.Null()]) }),
      finish_reason: Type.Union([Type.String(), Type.Null()]),
    }),
    { minItems: 1 },
  ),
  usage: Type.Object({
    prompt_tokens: Type.Integer({ minimum: 0 }),
    completion_tokens: Type.Integer({ minimum: 0 }),
    prompt_cache_hit_tokens: Type.Optional(Type.Integer({ minimum: 0 })),
  }),
});

export function estimateCost(usage: Omit<CallUsage, 'costUsd'>): number {
  const price = deepseek.pricePerMillion;
  const cost =
    usage.cachedInputTokens * price.cachedInput +
    (usage.inputTokens - usage.cachedInputTokens) * price.input +
    usage.outputTokens * price.output;
  return Math.round(cost) / 1e6;
}

export interface ChatJsonOptions {
  apiKey: string;
  fetch: typeof globalThis.fetch;
  log: FastifyBaseLogger;
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs?: number;
}

const defaultTimeoutMs = 120_000;

export async function chatJson({
  apiKey,
  fetch,
  log,
  system,
  user,
  maxTokens,
  timeoutMs = defaultTimeoutMs,
}: ChatJsonOptions): Promise<{ answer: unknown; usage: CallUsage }> {
  let response: Response;
  let body: string;
  try {
    response = await fetch(deepseek.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: deepseek.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        temperature: 0,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    body = await response.text();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new ModelError(`DeepSeek did not answer within ${timeoutMs / 1000} seconds.`);
    }
    log.warn({ err }, 'DeepSeek request failed');
    throw new ModelError('Could not reach DeepSeek.');
  }

  if (!response.ok) {
    log.warn({ status: response.status, body: body.slice(0, 1000) }, 'DeepSeek refused a request');
    throw new ModelError(failureMessage(response.status));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = undefined;
  }
  if (!Value.Check(ResponseSchema, parsed)) {
    throw new ModelError('DeepSeek answered with something other than a chat completion.');
  }
  const reported = parsed.usage;
  const tokens = {
    inputTokens: reported.prompt_tokens,
    cachedInputTokens: Math.min(reported.prompt_cache_hit_tokens ?? 0, reported.prompt_tokens),
    outputTokens: reported.completion_tokens,
  };
  const usage = { ...tokens, costUsd: estimateCost(tokens) };

  const [choice] = parsed.choices;
  if (choice!.finish_reason === 'length') {
    throw new ModelError('The answer from DeepSeek was cut off at the token limit.', usage);
  }
  if (choice!.finish_reason !== 'stop') {
    throw new ModelError(`DeepSeek stopped the answer early (${choice!.finish_reason}).`, usage);
  }
  const content = choice!.message.content?.trim() ?? '';
  if (content === '') throw new ModelError('DeepSeek gave an empty answer.', usage);
  try {
    return { answer: JSON.parse(content), usage };
  } catch {
    throw new ModelError('The answer from DeepSeek is not JSON.', usage);
  }
}

function failureMessage(status: number): string {
  switch (status) {
    case 401:
      return 'DeepSeek refused the API key (HTTP 401). Check DEEPSEEK_API_KEY on the server.';
    case 402:
      return 'The DeepSeek account has no balance left (HTTP 402).';
    case 429:
      return 'DeepSeek is limiting requests (HTTP 429). Try again later.';
    default:
      return status >= 500
        ? `DeepSeek answered HTTP ${status}. Try again later.`
        : `DeepSeek refused the request (HTTP ${status}); the server log has details.`;
  }
}
