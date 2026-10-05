import { createHash } from 'node:crypto';
import PostalMime from 'postal-mime';

// An imported email's source (T20), as the user's mail program shows it: headers, then the body,
// usually an HTML part and a text part. Parsing is postal-mime's; nothing in the email is
// followed, loaded or run.

export interface AlertMessage {
  /** The Message-ID, or a hash of the source when there is none. */
  key: string;
  /** The From address in lower case. */
  from: string;
  subject: string;
  sentAt: Date | null;
  html: string;
  text: string;
}

const notAnEmail =
  'This is not an email’s full source. Paste all of it, headers included (in Gmail: ⋮ → Show original → Copy to clipboard), or upload the .eml file.';

export async function parseMessage(source: string): Promise<AlertMessage | { error: string }> {
  let email;
  try {
    email = await PostalMime.parse(source, { attachmentEncoding: 'base64' });
  } catch {
    return { error: notAnEmail };
  }
  const from = email.from?.address?.trim().toLowerCase();
  if (!from || !email.headers.some((header) => header.key === 'date' || header.key === 'subject')) {
    return { error: notAnEmail };
  }

  const messageId = email.messageId?.trim().replace(/^<|>$/g, '');
  const sentAt = email.date ? new Date(email.date) : null;
  return {
    key: messageId
      ? messageId.slice(0, 1000)
      : // The same email pasted and uploaded can differ in line endings and trailing space.
        `sha256:${createHash('sha256')
          .update(source.replace(/\r\n?/g, '\n').trim())
          .digest('hex')}`,
    from,
    subject: (email.subject ?? '').replace(/\s+/g, ' ').trim(),
    sentAt: sentAt && !Number.isNaN(sentAt.getTime()) ? sentAt : null,
    html: email.html ?? '',
    text: email.text ?? '',
  };
}
