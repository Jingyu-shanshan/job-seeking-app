// 测试用的假 DeepSeek Chat Completions 接口。回答和用量都是编造的。

export interface FakeUsage {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_cache_hit_tokens?: number;
}

export interface SentRequest {
  url: string;
  headers: Headers;
  body: {
    model: string;
    messages: { role: string; content: string }[];
    response_format: unknown;
    thinking: unknown;
    max_tokens: number;
  };
}

/** 一次成功的对话回答：`content` 是模型输出的文字（JSON 模式下是 JSON 字符串）。 */
export function chatCompletion(
  content: string | null,
  {
    finishReason = 'stop',
    usage = { prompt_tokens: 3000, completion_tokens: 500, prompt_cache_hit_tokens: 1000 },
  }: { finishReason?: string | null; usage?: FakeUsage } = {},
) {
  return Response.json({
    id: 'chatcmpl-made-up',
    object: 'chat.completion',
    created: 1790900000,
    model: 'deepseek-flash',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
    usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens },
  });
}

/**
 * 回答 api.deepseek.com 的 fetch：`answer` 是模型返回的 JSON 对象，或者自定义回答的函数。
 * `requests` 收集每一次请求，便于检查请求里有什么。其他地址交给 `other`（例如假的招聘板块）。
 */
export function fakeDeepSeek(
  answer: unknown | (() => Promise<Response>),
  other: typeof globalThis.fetch = async () => new Response('Not Found', { status: 404 }),
) {
  const requests: SentRequest[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.deepseek.com/')) return other(input, init);
    requests.push({
      url,
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    if (typeof answer === 'function') return (answer as () => Promise<Response>)();
    return chatCompletion(JSON.stringify(answer));
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}
