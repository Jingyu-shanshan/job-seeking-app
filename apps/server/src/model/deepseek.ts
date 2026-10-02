import type { FastifyBaseLogger } from 'fastify';
import Type from 'typebox';
import { Value } from 'typebox/value';

// DeepSeek API（T05 首次接入），直接用原生 fetch 调用：接口与 OpenAI 的 Chat Completions 兼容，
// POST /chat/completions，Bearer 密钥。`response_format: { type: 'json_object' }` 保证回答是合法 JSON，
// 前提是提示里出现 "json" 并给出示例，且 max_tokens 足够，否则回答可能被截断或只有空白。
// 关闭思考模式（`thinking: { type: 'disabled' }`）：抽取不需要推理，推理的 token 按输出计费。
// 2026-10-02 核对：开发环境的网络策略挡住了 api-docs.deepseek.com，模型名、价格和参数取自搜索引擎
// 收录的官方页面（Models & Pricing、Change Log、JSON Output、Thinking Mode）：deepseek-chat 和
// deepseek-reasoner 已于 2026-07-24 停用，当前的模型名是 deepseek-flash（V4.1 Flash）。
// 首次真实调用时要对照官方页面和 DeepSeek 控制台的用量复核（见 TASKS 的 T05）。
// 模型的回答是不可信数据：这里只保证它是 JSON，内容由调用方检查。

export const deepseek = {
  url: 'https://api.deepseek.com/chat/completions',
  model: 'deepseek-flash',
  /**
   * 每百万 token 的美元价格，取高峰时段（非高峰时段减半）。费用按高峰价估算，所以估算值不低于实际计费。
   * `cachedInput` 是命中上下文缓存的输入。
   */
  pricePerMillion: { cachedInput: 0.006, input: 0.3, output: 1.2 },
  pricesChecked: { on: '2026-10-02', url: 'https://api-docs.deepseek.com/quick_start/pricing/' },
} as const;

/** 一次调用的用量，以及按价目表估算的费用（美元）。 */
export interface CallUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * 调用失败，消息可以直接给用户看（不含密钥）。供应商已经回答、只是回答不能用时带上 `usage`，
 * 因为这部分已经计费。
 */
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

/** 按高峰价估算费用，保留到百万分之一美元。 */
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

/** 发送一次 JSON 输出模式的对话请求，返回解析后的回答和用量；失败时抛出 ModelError。 */
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
    // DeepSeek 的错误回答说明原因（如模型名不存在），只写进服务日志。
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
