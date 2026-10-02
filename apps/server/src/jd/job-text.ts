import { maxJobTextLength } from '@jsa/shared';
import { tidyText } from '../discovery/html.ts';
import { httpError } from '../http-error.ts';

/** Job text as it is stored: tidied, and refused with `empty` when nothing is left. */
export function checkJobText(text: string, empty: string): string {
  const body = tidyText(text);
  if (body === '') throw httpError(400, empty);
  if (body.length > maxJobTextLength) {
    throw httpError(400, `The job text is longer than ${maxJobTextLength} characters.`);
  }
  return body;
}
