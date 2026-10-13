import { InterviewAnswerSchema, type InterviewAnswer, type InterviewSource } from '@jsa/shared';
import { Value } from 'typebox/value';
import { sensitiveData } from './facts.ts';

/** Historical text stays historical; permissions are checked separately by the caller. */
export function interviewTextAllowed(text: string, privateDetails: readonly string[]): boolean {
  const lower = text.toLocaleLowerCase();
  return (
    sensitiveData(text).length === 0 &&
    !privateDetails.some(
      (detail) => detail.trim() !== '' && lower.includes(detail.trim().toLocaleLowerCase()),
    )
  );
}

export function checkInterviewAnswer(
  answer: unknown,
  sources: readonly InterviewSource[],
): InterviewAnswer | undefined {
  if (!Value.Check(InterviewAnswerSchema, answer)) return undefined;
  const refs = new Map(sources.map((s) => [s.ref, s]));
  const items = [...answer.technical, ...answer.projects, ...answer.stories, ...answer.interviewer];
  if (items.some((item) => item.sources.some((ref) => !refs.has(ref)))) return undefined;
  if (answer.projects.some((q) => !q.sources.some((ref) => refs.get(ref)?.kind === 'material')))
    return undefined;
  if (answer.stories.some((s) => !s.sources.some((ref) => refs.get(ref)?.kind === 'material')))
    return undefined;
  // Everything a story says remains a draft, even when all refs are valid.
  return answer;
}
