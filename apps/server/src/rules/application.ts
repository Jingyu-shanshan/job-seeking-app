// Recording an application the user sent outside the app (T09). Only a submission counts as
// applied: the runner's that Greenhouse confirmed or the user verified, or one the user records
// here. Drafting, printing or opening a job's page never does.

/** How far ahead of the server's clock a given time may be, for a browser clock running fast. */
export const clockSlackMs = 5 * 60 * 1000;

export interface RecordFacts {
  /** The job has text the record can keep. */
  hasText: boolean;
  /** The job's application that went in or may have, if any. */
  openApplication: 'submitted' | 'to_verify' | null;
  /** The job has a runner fill that is not over. */
  openFill: boolean;
}

/** Why the user cannot record an application sent outside the app now, or null. */
export function cannotRecord(facts: RecordFacts): string | null {
  if (facts.openApplication === 'submitted') return 'This job’s application went in already.';
  if (facts.openApplication === 'to_verify') {
    return 'The result of the runner’s application to this job is unknown. Say whether it went through first.';
  }
  if (facts.openFill) return 'Close the runner’s fill of this job’s form first.';
  if (!facts.hasText) {
    return 'Save or paste the job’s text first: the record keeps the text you applied to.';
  }
  return null;
}

/**
 * Why `sentAt` cannot be when the user sent the application, or null. It may not be in the
 * future, beyond a few minutes for a browser clock running fast (such a time is taken as now).
 */
export function sentAtProblem(sentAt: Date, now: Date): string | null {
  if (Number.isNaN(sentAt.getTime())) return 'Give the date and time you sent it.';
  if (sentAt.getTime() - now.getTime() > clockSlackMs) {
    return 'The time you sent it is in the future.';
  }
  return null;
}

/** The files that are the same file as one before them, by their SHA-256, by name. */
export function repeatedFiles(files: readonly { fileName: string; sha256: string }[]): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const file of files) {
    if (seen.has(file.sha256)) repeated.push(file.fileName);
    seen.add(file.sha256);
  }
  return repeated;
}
