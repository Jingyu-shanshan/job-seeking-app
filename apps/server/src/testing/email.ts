// Made-up job-alert emails for tests (T20), as the full source a mail program shows: headers, then
// a multipart/alternative body with a text part (quoted-printable) and an HTML part (base64).
// Never put a real email here: real ones carry the user's address and sign-in links.

export interface TestEmail {
  from: string;
  subject: string;
  html?: string;
  text?: string;
  /** Omit for a random one; null for none. */
  messageId?: string | null;
  date?: string;
}

function quotedPrintable(text: string): string {
  return Buffer.from(text, 'utf8')
    .toString('latin1')
    .split('\n')
    .map((line) =>
      line
        .replace(
          /[=\x80-\xff]/g,
          (c) => `=${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
        )
        .replace(/(.{70})(?=.)/g, '$1=\r\n'),
    )
    .join('\r\n');
}

function encodedWord(text: string) {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=`;
}

export function testEmail({
  from,
  subject,
  html,
  text,
  messageId = `${Math.random().toString(36).slice(2)}@mail.example.com`,
  date = 'Fri, 02 Oct 2026 07:12:00 +0000',
}: TestEmail): string {
  const parts: string[] = [];
  if (text !== undefined) {
    parts.push(
      [
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        quotedPrintable(text),
      ].join('\r\n'),
    );
  }
  if (html !== undefined) {
    parts.push(
      [
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(html)
          .toString('base64')
          .replace(/(.{76})/g, '$1\r\n'),
      ].join('\r\n'),
    );
  }
  return [
    `From: "Job alerts" <${from}>`,
    'To: Test Person <person@example.com>',
    `Subject: ${encodedWord(subject)}`,
    `Date: ${date}`,
    ...(messageId === null ? [] : [`Message-ID: <${messageId}>`]),
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="part-boundary"',
    '',
    ...parts.flatMap((part) => ['--part-boundary', part]),
    '--part-boundary--',
    '',
  ].join('\r\n');
}

/**
 * A card of a LinkedIn job alert, modelled on the layout LinkedIn's alert emails have used: the
 * company logo and the title link to the job (with tracking and one-time sign-in parameters),
 * then "Company · Location" and extra lines.
 */
export function linkedInCard(job: {
  id: number;
  title: string;
  company: string;
  location: string;
  extra?: string;
}): string {
  const link = `https://www.linkedin.com/comm/jobs/view/${job.id}/?trackingId=abc%3D%3D&amp;refId=xyz&amp;lipi=urn%3Ali&amp;midToken=AQ&amp;trk=eml-email_job_alert_digest_01-job_card-0-jobcard_body&amp;otpToken=MTAwNjE2&amp;eid=e1`;
  return `<table role="presentation"><tr>
  <td><a href="${link}"><img src="https://media.licdn.com/dms/image/logo.png" alt="${job.company}" width="48"></a></td>
  <td>
    <a href="${link}" style="color:#0a66c2;font-size:16px">${job.title}</a>
    <p style="margin:0">${job.company} · ${job.location}</p>
    ${job.extra ? `<p style="margin:0">${job.extra}</p>` : ''}
  </td>
</tr></table>`;
}

export function linkedInAlert(cards: string[]): string {
  return `<html><head><style>p { color: #000 }</style><title>LinkedIn</title></head><body>
<div style="display:none;max-height:0;overflow:hidden">Software Engineer at Hidden Preview Oy and more</div>
<table role="presentation"><tr><td><h2>Your job alert for software engineer in Helsinki</h2></td></tr>
<tr><td>${cards.join('\n')}</td></tr>
<tr><td><a href="https://www.linkedin.com/comm/jobs/search?keywords=software&amp;otpToken=MTAw">See all jobs</a></td></tr>
<tr><td><a href="https://www.linkedin.com/comm/psettings/email-unsubscribe?otpToken=MTAw">Unsubscribe</a> · © 2026 LinkedIn</td></tr>
</table></body></html>`;
}

/**
 * A link through Mandrill's click tracker, as Duunitori's and The Hub's alerts write them: the
 * target address sits in base64-encoded JSON in the `p` parameter, its slashes escaped.
 */
export function mandrillLink(target: string): string {
  const inner = JSON.stringify({ u: 30000001, v: 1, url: target, id: 'abc123' }).replaceAll(
    '/',
    '\\/',
  );
  const payload = Buffer.from(JSON.stringify({ s: 'sig', v: 1, p: inner })).toString('base64');
  return `https://mandrillapp.com/track/click/30000001/${new URL(target).host}?p=${payload}`;
}

/**
 * A link through a tracker that writes the target base64url-encoded in a path segment, between
 * bytes of its own, as Totaljobs' recommendation emails do.
 */
export function pathTrackerLink(target: string): string {
  const framed = Buffer.concat([
    Buffer.from([0x46, 0x04, 0x67, 0xc4]),
    Buffer.from('send_application_top'),
    Buffer.from([0x84, 0x1c, 0x01]),
    Buffer.from(target),
    Buffer.from([0x57, 0x05, 0x73]),
  ]);
  return `https://click.totaljobsmail.com/f/a/Zx9QkF1p-H2mrr9vmEJkg~~/AAAmIgA~/${framed.toString('base64url')}`;
}
