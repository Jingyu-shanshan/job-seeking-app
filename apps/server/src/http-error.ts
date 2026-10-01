/**
 * An error Fastify answers with its `statusCode` and a `{ statusCode, error, message }` body, the
 * same shape as its own validation errors. Only use messages that are safe to show the user.
 */
export function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}
