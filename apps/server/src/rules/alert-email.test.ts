import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertProviders } from '../alerts/providers.ts';
import { classifyEmail, shownSender } from './alert-email.ts';

// Senders and subjects as the user's mailbox shows them (2026-10-03), with made-up names where a
// subject names a person.
const classify = (from: string, subject: string) => {
  const found = classifyEmail({ from, subject }, alertProviders);
  if ('unknown' in found) return 'unknown';
  return 'notAlert' in found ? `${found.source.id}: not an alert` : found.source.id;
};

test('job alerts of every known sender are recognised by their From address', () => {
  const alerts: [string, string, string][] = [
    ['jobalerts-noreply@linkedin.com', 'AI Engineer at BearingPoint', 'linkedin_alert'],
    ['jobalerts-noreply@linkedin.com', '“software engineer” jobs for you: …', 'linkedin_alert'],
    [
      'JOBS-NOREPLY@linkedin.com',
      'New jobs similar to Software Engineer at Wolt',
      'linkedin_alert',
    ],
    ['jobs-noreply@linkedin.com', 'Alex, looking for a new job?', 'linkedin_alert'],
    ['jobs-listings@linkedin.com', 'Canonical is hiring a Software Developer', 'linkedin_alert'],
    [
      'messages-noreply@linkedin.com',
      '2 new Full Stack Engineer openings at Reaktor',
      'linkedin_alert',
    ],
    [
      'messages-noreply@linkedin.com',
      'Full Stack Engineer: Twoday and Nortal are hiring',
      'linkedin_alert',
    ],
    ['donotreply@upwork.com', 'New job alert: Senior Software Engineer', 'upwork_alert'],
    [
      'duunivahti@duunitori.fi',
      'Duunitori found 3 jobs in Finland for you - View the newest opportunities',
      'duunitori_alert',
    ],
    ['noreply@thehub.io', 'We think you can be a good fit for Supermetrics', 'thehub_alert'],
    ['noreply@thehub.io', 'New Full-stack developer jobs in Helsinki, Finland', 'thehub_alert'],
    [
      'subscribe@fi.jooble.org',
      'SAHA etsii Senior Software Developer, ja 14 muuta uutta työpaikkaa',
      'jooble_alert',
    ],
    [
      'totaljobs@totaljobsmail.com',
      '25 new ".NET Developer" jobs in Bishop\'s Stortford',
      'totaljobs_alert',
    ],
    ['no-reply@notifications.snaphunt.com', 'Your next job is waiting for you', 'snaphunt_alert'],
    [
      'no-reply@notifications.snaphunt.com',
      'Matching job: Odoo Consultant at Example',
      'snaphunt_alert',
    ],
    ['noreply@glassdoor.com', 'Kesko,HeadPower Oy.: Apply Now', 'glassdoor_alert'],
    [
      'wrtsiloyj-jobnotification@noreply12.jobs2web.com',
      'New jobs posted from careers.wartsila.com',
      'wartsila_careers_alert',
    ],
    [
      'no-reply@capaloai.teamtailor-mail.com',
      'Capalo AI: one new job matching your profile',
      'teamtailor_alert',
    ],
    [
      'no-reply@solteq.teamtailor-mail.com',
      'Solteq: 2 new jobs matching your profile',
      'teamtailor_alert',
    ],
    [
      'conversations@message.teamtailor.com',
      'Senior Backend Developer at ResQ Club',
      'teamtailor_recruiter',
    ],
    // Older Teamtailor alerts, one job each, and Totaljobs' single recommendations.
    [
      'no-reply@message.teamtailor.com',
      'Aimo : Software Developer - Customer solutions',
      'teamtailor_alert',
    ],
    [
      'totaljobs@jobs.totaljobsmail.com',
      'Our recommendation: Full Stack Engineer',
      'totaljobs_alert',
    ],
  ];
  for (const [from, subject, id] of alerts) {
    assert.equal(classify(from, subject), id, `${from}: ${subject}`);
  }
});

test('mail from the same senders that is not a job alert is told apart by its subject', () => {
  const notAlerts: [string, string][] = [
    ['jobs-noreply@linkedin.com', 'Alex, your application was sent to Wolt'],
    ['jobs-noreply@linkedin.com', 'Your application was viewed by Acme'],
    ['messages-noreply@linkedin.com', 'Alex, you have 3 new invitations'],
    ['messages-noreply@linkedin.com', 'Sam sent you a message'],
    ['donotreply@upwork.com', 'Your weekly summary'],
    ['no-reply@capaloai.teamtailor-mail.com', 'Thank you for your application'],
    ['no-reply@finnplay.teamtailor-mail.com', 'Welcome to our talent community'],
    ['no-reply@finnplay.teamtailor-mail.com', 'Your data has been deleted'],
    ['conversations@message.teamtailor.com', 'Re: Senior Backend Developer at ResQ Club'],
    ['conversations@message.teamtailor.com', 'Interview for Senior Backend Developer'],
    ['noreply@tyomarkkinatori.fi', 'Confirm your email address at Job Market Finland'],
    ['noreply@tyomarkkinatori.fi', 'Työnhakuprofiilisi on vanhentumassa'],
    ['noreply@tyomarkkinatori.fi', 'Työmarkkinatori: Kirjaudu Työmarkkinatorille'],
    ['noreply@thehub.io', 'Reset your password'],
    ['noreply@glassdoor.com', 'Verify your email address'],
    ['no-reply@notifications.snaphunt.com', 'Your application for Junior Engineer role at Example'],
    ['noreply@glassdoor.com', "Just in at Acme: This week's employee reviews and more"],
    ['noreply@tyomarkkinatori.fi', 'Job Market Finland: Job Alert subscription confirmation'],
    ['no-reply@message.teamtailor.com', 'Acme: Thank you for your application'],
    ['totaljobs@jobs.totaljobsmail.com', 'Complete your profile'],
  ];
  for (const [from, subject] of notAlerts) {
    assert.match(classify(from, subject), /: not an alert$/, `${from}: ${subject}`);
  }
});

test('job titles that sound like account or application mail still count', () => {
  for (const subject of [
    'Information Security Engineer at Acme',
    'Applications Developer at Acme',
    'Applied Scientist at Acme',
    'Verification Engineer at Acme',
  ]) {
    assert.equal(classify('noreply@glassdoor.com', subject), 'glassdoor_alert', subject);
    assert.equal(classify('jobs-noreply@linkedin.com', subject), 'linkedin_alert', subject);
  }
});

test('other senders are not job-alert sources, Reply-To and look-alike domains included', () => {
  for (const from of [
    'info@glassdoor.com',
    'asiakaspalvelu@duunitori.fi',
    'jobalerts-noreply@linkedin.com.example.com',
    'no-reply@teamtailor-mail.com.example.com',
    'no-reply@capaloai.teamtailor-mail.com.evil',
    'alerts@indeed.com',
    // A recruiter writing from a company's Teamtailor address.
    'firstname.lastname@acme.teamtailor-mail.com',
    'someone@example.com',
    '',
  ]) {
    assert.equal(classify(from, 'New jobs for you'), 'unknown', from);
  }
});

test('every sender is shown as a readable address', () => {
  for (const provider of alertProviders) {
    for (const sender of provider.senders) {
      assert.match(shownSender(sender), /^[^\s@]+@[^\s@]+$/, provider.id);
    }
  }
});
