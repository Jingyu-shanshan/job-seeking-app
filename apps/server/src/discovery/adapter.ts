// What every source adapter returns, and the one way adapters fetch: native fetch with a time
// limit and a size limit. Everything a source returns is untrusted data.

/** One open job as a source lists it. */
export interface Posting {
  /** The source's own id for the posting. */
  externalId: string;
  title: string;
  company: string | null;
  /** '' when the source gives none; several locations separated by ';'. */
  location: string;
  /** Always https. */
  url: string;
  /** ISO 8601, or null when the source does not say. */
  publishedAt: string | null;
}

/** Reads every open job of one source, given the source's parameter (e.g. a board name). */
export type Adapter = (param: string, fetch: typeof globalThis.fetch) => Promise<Posting[]>;

/**
 * A source failed in a way the user can act on. The message is stored as the source's last
 * failure reason and shown on the Sources page, so it must not contain anything secret.
 */
export class DiscoveryError extends Error {
  readonly status: number | undefined;

  constructor(message: string, { status, cause }: { status?: number; cause?: unknown } = {}) {
    super(message, { cause });
    this.status = status;
  }
}

const timeoutMs = 15_000;
const maxBytes = 20 * 1024 * 1024;

/** GETs `url` and parses the answer as JSON, failing with a DiscoveryError that says why. */
export async function fetchJson(fetch: typeof globalThis.fetch, url: string): Promise<unknown> {
  const { host } = new URL(url);
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new DiscoveryError(`${host} answered HTTP ${response.status}.`, {
        status: response.status,
      });
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength;
      if (size > maxBytes) {
        throw new DiscoveryError(`The answer from ${host} is larger than ${maxBytes >> 20} MB.`);
      }
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new DiscoveryError(`The answer from ${host} is not JSON.`);
    }
  } catch (err) {
    if (err instanceof DiscoveryError) throw err;
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new DiscoveryError(`${host} did not answer within ${timeoutMs / 1000} seconds.`);
    }
    throw new DiscoveryError(`Could not reach ${host}.`, { cause: err });
  }
}

/** `value` as an https URL, or null when it is anything else. */
export function httpsUrl(value: string | null | undefined): string | null {
  if (!value || !URL.canParse(value)) return null;
  const url = new URL(value);
  return url.protocol === 'https:' ? url.href : null;
}
