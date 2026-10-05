// Which job-alert source an imported email comes from (T20), and whether it is a job alert at
// all. A known sender is not enough: most sites send account messages, application updates and
// newsletters from the same addresses, so each sender has subject rules, and some are only
// trusted when the email lists jobs. Only the From address counts, never Reply-To.

export interface SenderRule {
  /** The From address in lower case, or a pattern for it. */
  from: string | RegExp;
  /** How a pattern is shown on the Sources page, e.g. `no-reply@….teamtailor-mail.com`. */
  shown?: string;
  /** When given, an email is a job alert only if its subject matches one of these. */
  subjects?: readonly RegExp[];
  /** An email whose subject matches one of these is never a job alert. */
  notSubjects?: readonly RegExp[];
  /**
   * True when every email passing the subject rules is a job alert, so one with no readable job
   * means the app cannot read its layout. False when the sender also sends other mail with such
   * subjects, so an email is a job alert only if jobs can be read from it.
   */
  alertsOnly: boolean;
}

export interface AlertSource {
  id: string;
  name: string;
  senders: readonly SenderRule[];
}

/** The address as the Sources page shows it. */
export function shownSender(rule: SenderRule): string {
  return typeof rule.from === 'string' ? rule.from : (rule.shown ?? rule.from.source);
}

function matches(rule: SenderRule, address: string) {
  return typeof rule.from === 'string' ? rule.from === address : rule.from.test(address);
}

export type Classified<S extends AlertSource> =
  | { source: S; sender: SenderRule }
  | { source: S; sender: SenderRule; notAlert: string }
  | { unknown: string };

/**
 * The source an email comes from by its From address, and whether its subject passes that
 * sender's rules. The first source with a matching sender wins.
 */
export function classifyEmail<S extends AlertSource>(
  { from, subject }: { from: string; subject: string },
  sources: readonly S[],
): Classified<S> {
  const address = from.trim().toLowerCase();
  for (const source of sources) {
    const sender = source.senders.find((rule) => matches(rule, address));
    if (!sender) continue;
    if (sender.notSubjects?.some((pattern) => pattern.test(subject))) {
      return {
        source,
        sender,
        notAlert: `Its subject shows it is not a job alert from ${source.name}.`,
      };
    }
    if (sender.subjects && !sender.subjects.some((pattern) => pattern.test(subject))) {
      return {
        source,
        sender,
        notAlert: `Its subject does not look like a job alert from ${source.name}.`,
      };
    }
    return { source, sender };
  }
  return {
    unknown: `It is from ${address || 'no sender'}, which is not a job-alert sender the app knows.`,
  };
}
