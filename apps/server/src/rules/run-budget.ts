import { deepseek } from '../model/deepseek.ts';

/** Reserve peak-price output at its cap and one input token per byte, plus chat framing. */
// shortcut: this is a conservative estimate, revisit framing and prices when the provider changes.
export function reserveModelCost(body: string): number {
  const request: { max_tokens: number } = JSON.parse(body);
  return (
    Math.ceil(
      (Buffer.byteLength(body) + 1024) * deepseek.pricePerMillion.input +
        request.max_tokens * deepseek.pricePerMillion.output,
    ) / 1e6
  );
}
