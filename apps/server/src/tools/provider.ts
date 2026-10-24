import {
  FetchResponseSchema,
  SearchResponseSchema,
  type ToolRequest,
  type ToolResult,
} from '@jsa/shared';
import { Value } from 'typebox/value';
import { httpError } from '../http-error.ts';

export const toolPriceUsd = 0.00075;
export const toolUrls = {
  search: 'https://api.deepseek.com/v1/tools/search',
  fetch: 'https://api.deepseek.com/v1/tools/fetch',
} as const;

export function toolOf(url: string): ToolRequest['tool'] | undefined {
  return url === toolUrls.search ? 'search' : url === toolUrls.fetch ? 'fetch' : undefined;
}

function parseToolResult(tool: ToolRequest['tool'], value: unknown): ToolResult | undefined {
  if (tool === 'search' && Value.Check(SearchResponseSchema, value)) {
    return {
      results: value.results.map(({ title, url, snippet, summary, content }) => ({
        title,
        url,
        snippet,
        summary,
        content,
      })),
    };
  }
  if (tool === 'fetch' && Value.Check(FetchResponseSchema, value)) {
    return { title: value.title, content: value.content };
  }
  return undefined;
}

/** Undefined means the provider's billable outcome could not be confirmed. */
export function toolCost(
  tool: ToolRequest['tool'],
  status: number,
  value: unknown,
): number | undefined {
  if (status >= 400 && status <= 599) return 0;
  if (status !== 200) return undefined;
  const result = parseToolResult(tool, value);
  if (!result) return undefined;
  return ('results' in result ? result.results.length > 0 : result.content.trim().length > 0)
    ? toolPriceUsd
    : 0;
}

export async function readToolResponse(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('Response too large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function callTool(options: {
  tool: ToolRequest['tool'];
  input: string;
  apiKey: string;
  fetch: typeof globalThis.fetch;
}): Promise<{ result: ToolResult | null; message: string; cost: number | undefined }> {
  let response: Response;
  try {
    response = await options.fetch(toolUrls[options.tool], {
      method: 'POST',
      headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(
        options.tool === 'search'
          ? { query: options.input, count: 5, need_content: false }
          : { url: options.input },
      ),
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    return {
      result: null,
      cost: undefined,
      message:
        'DeepSeek could not be reached or timed out. The estimated fee is kept; check the saved call before starting another request.',
    };
  }
  if (response.status !== 200) {
    void response.body?.cancel().catch(() => {});
    const detail =
      response.status === 401
        ? 'Check DEEPSEEK_API_KEY on the server.'
        : response.status === 402
          ? 'Top up the DeepSeek account.'
          : response.status === 429
            ? 'Rate limited; try again later.'
            : 'The page may be unavailable or blocked. Paste its text or save it in the desktop app.';
    return {
      result: null,
      cost: toolCost(options.tool, response.status, null),
      message: `DeepSeek returned HTTP ${response.status}. ${detail}`,
    };
  }
  try {
    const parsed = await readToolResponse(response);
    const cost = toolCost(options.tool, response.status, parsed);
    const result = parseToolResult(options.tool, parsed);
    if (!result) throw new Error('Invalid response');
    return {
      result,
      cost,
      message: cost === 0 ? 'No results or page content; no fee.' : 'Completed.',
    };
  } catch {
    return {
      result: null,
      cost: undefined,
      message: 'DeepSeek returned an invalid or oversized response. The estimated fee is kept.',
    };
  }
}

export function checkToolInput(tool: ToolRequest['tool'], input: string) {
  if (!input.trim()) throw httpError(400, 'Enter a query or public page link.');
  if (tool === 'search' && [...input].length > 128)
    throw httpError(400, 'Keep the search query within 128 characters.');
}
