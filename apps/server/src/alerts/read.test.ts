import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  linkedInAlert,
  linkedInCard,
  mandrillLink,
  pathTrackerLink,
  testEmail,
} from '../testing/email.ts';
import { type AlertMessage, parseMessage } from './message.ts';
import { findAlertProvider } from './providers.ts';
import { readJobs } from './read.ts';

// Made-up emails; the companies and job ids are invented. The layouts after the first tests copy
// real alert emails of each site (2026-10-05): which links go through which tracker, where the
// title sits, and what follows it.

async function parsed(source: string): Promise<AlertMessage> {
  const message = await parseMessage(source);
  assert.ok(!('error' in message), 'error' in message ? message.error : '');
  return message;
}

const linkedIn = findAlertProvider('linkedin_alert')!;

test('reads each LinkedIn card: title, company, location, the job address without parameters', async () => {
  const message = await parsed(
    testEmail({
      from: 'jobalerts-noreply@linkedin.com',
      subject: '“software engineer”: Acme Oy - Backend Engineer and more',
      html: linkedInAlert([
        linkedInCard({
          id: 4100000001,
          title: 'Backend Engineer',
          company: 'Acme Oy',
          location: 'Helsinki, Uusimaa, Finland (Hybrid)',
          extra: 'Actively recruiting',
        }),
        linkedInCard({
          id: 4100000002,
          title: 'Ohjelmistokehittäjä',
          company: 'Esimerkki Oy',
          location: 'Espoo, Uusimaa, Finland (On-site)',
        }),
      ]),
    }),
  );
  const { jobs, unreadable } = readJobs(message, linkedIn);
  assert.equal(unreadable, 0);
  assert.deepEqual(jobs, [
    {
      url: 'https://www.linkedin.com/jobs/view/4100000001/',
      externalId: '4100000001',
      title: 'Backend Engineer',
      company: 'Acme Oy',
      location: 'Helsinki, Uusimaa, Finland (Hybrid)',
      details: 'Actively recruiting',
    },
    {
      url: 'https://www.linkedin.com/jobs/view/4100000002/',
      externalId: '4100000002',
      title: 'Ohjelmistokehittäjä',
      company: 'Esimerkki Oy',
      location: 'Espoo, Uusimaa, Finland (On-site)',
      details: '',
    },
  ]);
  // Nothing of the email's sign-in or tracking parameters is kept.
  assert.ok(jobs.every((job) => !/otpToken|trk|midToken/.test(JSON.stringify(job))));
});

test('hidden preview text, the head, and links that are not one job are not read', async () => {
  const message = await parsed(
    testEmail({
      from: 'jobalerts-noreply@linkedin.com',
      subject: 'jobs',
      html: linkedInAlert([
        linkedInCard({
          id: 4100000003,
          title: 'Data Engineer',
          company: 'Acme',
          location: 'Helsinki',
        }),
      ]),
    }),
  );
  const { jobs } = readJobs(message, linkedIn);
  assert.deepEqual(
    jobs.map((job) => job.title),
    ['Data Engineer'],
  );
  assert.ok(!JSON.stringify(jobs).includes('Hidden Preview'));
});

test('an action link is not a title; a card without a readable title is counted', async () => {
  const job = (id: number) => `https://www.linkedin.com/comm/jobs/view/${id}/?otpToken=x`;
  const message = await parsed(
    testEmail({
      from: 'jobs-listings@linkedin.com',
      subject: 'Acme is hiring',
      html: `<div><a href="${job(1)}"><img alt="Acme"></a>
        <a href="${job(1)}">Site Reliability Engineer</a><p>Acme · Helsinki</p>
        <a href="${job(1)}">View job</a></div>
        <div><a href="${job(2)}"><img alt="Other"></a><a href="${job(2)}">Apply now</a></div>`,
    }),
  );
  const { jobs, unreadable } = readJobs(message, linkedIn);
  assert.deepEqual(
    jobs.map((j) => [j.title, j.company, j.location]),
    [['Site Reliability Engineer', 'Acme', 'Helsinki']],
  );
  assert.equal(unreadable, 1);
});

test('a job address carried in a redirect link’s parameter counts; the redirect is not followed', async () => {
  const target = encodeURIComponent('https://www.linkedin.com/jobs/view/4100000004/?trk=x');
  const message = await parsed(
    testEmail({
      from: 'jobalerts-noreply@linkedin.com',
      subject: 'jobs',
      html: `<p><a href="https://click.example.com/track?u=${target}&amp;sig=1">Cloud Engineer</a></p><p>Acme · Remote</p>
        <p><a href="https://click.example.com/opaque/AbCdEf">Mystery Engineer</a></p>`,
    }),
  );
  assert.deepEqual(
    readJobs(message, linkedIn).jobs.map((j) => [j.url, j.title]),
    [['https://www.linkedin.com/jobs/view/4100000004/', 'Cloud Engineer']],
  );
});

test('the text part is read when the HTML part lists no job', async () => {
  const message = await parsed(
    testEmail({
      from: 'jobalerts-noreply@linkedin.com',
      subject: 'jobs',
      html: '<p>Open this email in a browser.</p>',
      text: [
        'Your job alert for software engineer',
        '',
        'Frontend Developer',
        'Acme Oy',
        'Helsinki, Uusimaa, Finland',
        'View job: https://www.linkedin.com/comm/jobs/view/4100000005/?trackingId=abc&otpToken=x',
        '',
        '---------------------------------------------------------',
        '',
        'QA Engineer',
        'Esimerkki Oy',
        'Tampere, Pirkanmaa, Finland',
        'View job: https://www.linkedin.com/comm/jobs/view/4100000006/?trackingId=def',
        '',
        '---------------------------------------------------------',
        'Unsubscribe: https://www.linkedin.com/comm/psettings/email-unsubscribe?x=1',
      ].join('\n'),
    }),
  );
  assert.deepEqual(
    readJobs(message, linkedIn).jobs.map((j) => [j.externalId, j.title, j.company, j.location]),
    [
      ['4100000005', 'Frontend Developer', 'Acme Oy', 'Helsinki, Uusimaa, Finland'],
      ['4100000006', 'QA Engineer', 'Esimerkki Oy', 'Tampere, Pirkanmaa, Finland'],
    ],
  );
});

test('a job listed twice in one email is read once', async () => {
  const card = linkedInCard({ id: 4100000007, title: 'SRE', company: 'Acme', location: 'Espoo' });
  const message = await parsed(
    testEmail({
      from: 'jobalerts-noreply@linkedin.com',
      subject: 'jobs',
      html: linkedInAlert([card, card]),
    }),
  );
  assert.equal(readJobs(message, linkedIn).jobs.length, 1);
});

test('an email with no job links reads no jobs', async () => {
  const message = await parsed(
    testEmail({
      from: 'jobs-noreply@linkedin.com',
      subject: 'Alex, looking for a new job?',
      html: '<p>Premium can help you stand out. <a href="https://www.linkedin.com/premium">Try it</a></p>',
    }),
  );
  assert.deepEqual(readJobs(message, linkedIn), { jobs: [], unreadable: 0 });
});

test('job links of other sources follow their rules; company alerts take the company from the subject', async () => {
  const teamtailor = findAlertProvider('teamtailor_alert')!;
  const message = await parsed(
    testEmail({
      from: 'no-reply@capaloai.teamtailor-mail.com',
      subject: 'Example Labs: 2 new jobs matching your profile',
      html: `<p><a href="https://careers.example.com/jobs/1234567-senior-engineer?utm_source=x">Senior Engineer</a></p><p>Helsinki</p>
        <p><a href="https://example.teamtailor.com/fi/jobs/7654321-data-analyst">Data Analyst</a></p><p>Remote</p>
        <p><a href="https://careers.example.com/jobs">All jobs</a></p>`,
    }),
  );
  assert.deepEqual(readJobs(message, teamtailor).jobs, [
    {
      url: 'https://careers.example.com/jobs/1234567',
      externalId: '1234567',
      title: 'Senior Engineer',
      company: 'Example Labs',
      location: 'Helsinki',
      details: '',
    },
    {
      url: 'https://example.teamtailor.com/jobs/7654321',
      externalId: '7654321',
      title: 'Data Analyst',
      company: 'Example Labs',
      location: 'Remote',
      details: '',
    },
  ]);

  const upwork = findAlertProvider('upwork_alert')!;
  const gig = await parsed(
    testEmail({
      from: 'donotreply@upwork.com',
      subject: 'New job alert: Senior Software Engineer',
      html: `<p><a href="https://www.upwork.com/jobs/Senior-Software-Engineer_~021234567890123456789/?referrer=email">Senior Software Engineer</a></p>
        <p>Hourly: $40-$80</p><p>We need help with our API.</p>`,
    }),
  );
  assert.deepEqual(readJobs(gig, upwork).jobs, [
    {
      url: 'https://www.upwork.com/jobs/~021234567890123456789',
      externalId: '~021234567890123456789',
      title: 'Senior Software Engineer',
      company: null,
      location: '',
      details: 'Hourly: $40-$80 · We need help with our API.',
    },
  ]);
});

const read = async (providerId: string, email: Parameters<typeof testEmail>[0]) =>
  readJobs(await parsed(testEmail(email)), findAlertProvider(providerId)!);

test('Glassdoor: recently-viewed job cards split company and location and exclude the recipient footer', async () => {
  const card = (id: string, title: string, companyLocation: string) => {
    const url = `https://www.glassdoor.com/job-listing/${title.toLowerCase().replaceAll(' ', '-')}-example-JV.htm?jl=${id}&amp;utm_source=email&amp;token=private`;
    return `<table><tr><td><a href="${url}"><img alt="Company logo"></a><span>3.5 ★</span></td>
      <td><h2><a href="${url}">${title}</a></h2><p><a href="${url}">${companyLocation}</a></p></td></tr></table>`;
  };
  const result = await read('glassdoor_alert', {
    from: 'noreply@glassdoor.com',
    subject: 'Esimerkki,Acme: Apply Now',
    html: `<p style="display:none">See all of your recently viewed jobs, saved jobs, and more</p>
      <h1>Don't forget to apply to these jobs</h1><p>Your recently viewed jobs</p>
      ${card('1009000000001', 'Full-Stack Developer', 'Esimerkki Oy - Helsinki')}
      ${card('1009000000002', 'Junior Front-end Developer', 'Acme - Software Oy - Jyväskylä')}
      <p>This message was sent to person@example.com.</p><p>Privacy Policy | Manage Settings | Unsubscribe</p>
      <p>Glassdoor, 300 Mission Street, San Francisco, CA</p>`,
  });
  assert.deepEqual(result, {
    unreadable: 0,
    jobs: [
      {
        url: 'https://www.glassdoor.com/job-listing/index.htm?jl=1009000000001',
        externalId: '1009000000001',
        title: 'Full-Stack Developer',
        company: 'Esimerkki Oy',
        location: 'Helsinki',
        details: '',
      },
      {
        url: 'https://www.glassdoor.com/job-listing/index.htm?jl=1009000000002',
        externalId: '1009000000002',
        title: 'Junior Front-end Developer',
        company: 'Acme - Software Oy',
        location: 'Jyväskylä',
        details: '',
      },
    ],
  });
});

test('Glassdoor: a card without the expected company and location is unreadable', async () => {
  const result = await read('glassdoor_alert', {
    from: 'noreply@glassdoor.com',
    subject: 'Esimerkki: Apply Now',
    html: `<h2><a href="https://www.glassdoor.com/job-listing/index.htm?jl=1009000000001">Engineer</a></h2>
      <p>This message was sent to person@example.com.</p>`,
  });
  assert.deepEqual(result, { jobs: [], unreadable: 1 });
});

test('Työmarkkinatori: company and location share a line; deadlines and subscription text are not locations', async () => {
  const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
  ];
  const card = (id: string, title: string, companyLocation: string, deadline = '') =>
    `<li><h2><span><a href="https://tyomarkkinatori.fi/en/personal-customers/vacancies/${id}/en?utm_source=email">${title}</a></span></h2>
      <p>${companyLocation}${deadline ? `<br>${deadline}` : ''}</p><hr></li>`;
  const result = await read('tyomarkkinatori_alert', {
    from: 'noreply@tyomarkkinatori.fi',
    subject: 'Job Market Finland: Latest jobs found by Job Alerts',
    html: `<h1>Latest jobs from Job Alerts</h1><p>Job Alerts is active until 05.01.2027.</p><hr>
      <ul>${card(ids[0]!, 'Backend Developer', 'Esimerkki Oy - More than one location', 'Application period ends 12.10.2026 19.00')}
      ${card(ids[1]!, 'Data Engineer', 'Acme - Software Oy - Helsinki')}
      ${card(ids[2]!, 'QA Engineer', 'Beta Oy - Espoo')}</ul>
      <p>In this message, you can see the most recent jobs found by Job Alerts at the time the message was sent.</p>
      <p>Use the link below to view all job postings that match your Job Alerts search criteria.</p>
      <p><a href="https://tyomarkkinatori.fi/en/personal-customers/vacancies/?q=software">View the current job postings</a></p>
      <p><a href="https://tyomarkkinatori.fi/en/jobalert/cancel?token=private&amp;email=person@example.com">Cancel Job Alert subscription</a></p>`,
  });
  assert.deepEqual(result, {
    unreadable: 0,
    jobs: [
      {
        url: `https://tyomarkkinatori.fi/henkiloasiakkaat/avoimet-tyopaikat/${ids[0]}`,
        externalId: ids[0],
        title: 'Backend Developer',
        company: 'Esimerkki Oy',
        location: 'More than one location',
        details: 'Application period ends 12.10.2026 19.00',
      },
      {
        url: `https://tyomarkkinatori.fi/henkiloasiakkaat/avoimet-tyopaikat/${ids[1]}`,
        externalId: ids[1],
        title: 'Data Engineer',
        company: 'Acme - Software Oy',
        location: 'Helsinki',
        details: '',
      },
      {
        url: `https://tyomarkkinatori.fi/henkiloasiakkaat/avoimet-tyopaikat/${ids[2]}`,
        externalId: ids[2],
        title: 'QA Engineer',
        company: 'Beta Oy',
        location: 'Espoo',
        details: '',
      },
    ],
  });
});

test('Työmarkkinatori: an unrecognised card is unreadable instead of guessing company or location', async () => {
  const result = await read('tyomarkkinatori_alert', {
    from: 'noreply@tyomarkkinatori.fi',
    subject: 'Job Market Finland: Latest jobs found by Job Alerts',
    html: `<h2><a href="https://tyomarkkinatori.fi/en/personal-customers/vacancies/11111111-1111-4111-8111-111111111111/en">Backend Developer</a></h2>
      <p>Application period ends 12.10.2026 19.00</p>`,
  });
  assert.deepEqual(result, { jobs: [], unreadable: 1 });
});

test('Duunitori: company, title and excerpt above a "Read more" link through Mandrill', async () => {
  const job = (id: number, slug: string) =>
    mandrillLink(
      `https://duunitori.fi/tyopaikat/tyo/${slug}-scsom-${id}?utm_source=jobsfinland&utm_medium=email`,
    );
  const card = (company: string, title: string, excerpt: string, link: string) =>
    `<tr><td><p>${company}</p><h2>${title}</h2><p>${excerpt}</p><p><a href="${link}">Read more</a></p></td></tr>`;
  const result = await read('duunitori_alert', {
    from: 'duunivahti@duunitori.fi',
    subject: 'Duunitori found 2 jobs in Finland for you - View the newest opportunities',
    html: `<h1>Finland Jobs Jobwatch</h1><p>Hey,</p><p>Here are 2 new jobs that we found by your jobwatch</p>
      <table>
        ${card('Esimerkki Oy', 'Backend Developer', 'We build payment software and need…', job(18000001, 'backend-developer'))}
        ${card('Acme Oy', 'Data Engineer', 'Join our data team in Helsinki…', job(18000002, 'data-engineer'))}
      </table>
      <p><a href="${mandrillLink('https://jobsfinland.fi//tyopaikat?haku=&kategoria=IT')}">Katso kaikki hakuehtojasi vastaavat auki olevat työpaikat hakua</a></p>
      <p>Categories: IT</p>
      <p><a href="${mandrillLink('https://duunitori.fi/paikkavahti/abc/poista')}">Cancel subscription</a></p>`,
  });
  assert.deepEqual(result, {
    unreadable: 0,
    jobs: [
      {
        url: 'https://duunitori.fi/tyopaikat/tyo/backend-developer-scsom-18000001',
        externalId: '18000001',
        title: 'Backend Developer',
        company: 'Esimerkki Oy',
        location: '',
        details: 'We build payment software and need…',
      },
      {
        url: 'https://duunitori.fi/tyopaikat/tyo/data-engineer-scsom-18000002',
        externalId: '18000002',
        title: 'Data Engineer',
        company: 'Acme Oy',
        location: '',
        details: 'Join our data team in Helsinki…',
      },
    ],
  });
});

test('The Hub: the title links to the job, then company, location and type in cells of their own', async () => {
  const job = mandrillLink(
    'https://thehub.io/jobs/6a00000000000000000000a1?utm_medium=email&utm_source=alerts',
  );
  const result = await read('thehub_alert', {
    from: 'noreply@thehub.io',
    subject: 'Esimerkki is looking for Senior Backend Engineer',
    html: `<p><a href="${mandrillLink('https://thehub.io/profile-settings/abc?subscribe=1')}">edit settings</a></p>
      <table><tr>
        <td><a href="${job}"><img src="https://example.com/logo.png" alt=""></a></td>
        <td><a href="${job}"><span>Senior Backend Engineer</span></a>
          <table><tr>
            <td><a href="${job}"><span>Esimerkki</span></a></td><td><a href="${job}"><span></span></a></td>
            <td><a href="${job}">Helsinki</a></td><td><a href="${job}"><span></span></a></td>
            <td><a href="${job}">Full-time</a></td>
          </tr></table>
        </td>
      </tr></table>
      <p><a href="${mandrillLink('https://thehub.io/jobs/?roles=fullstack')}">More jobs</a></p>`,
  });
  assert.deepEqual(result.jobs, [
    {
      url: 'https://thehub.io/jobs/6a00000000000000000000a1',
      externalId: '6a00000000000000000000a1',
      title: 'Senior Backend Engineer',
      company: 'Esimerkki',
      location: 'Helsinki',
      details: 'Full-time',
    },
  ]);
});

test('Jooble: saved-search alerts are not jobs; only individual job links are read', async () => {
  const job =
    'https://fi.jooble.org/alert-vacancy/ABCDEFGHIJKLMNOPQRST/0?ed=1&amp;fm=1&amp;mid=x&amp;letterType=1&amp;utm_source=letter';
  const result = await read('jooble_alert', {
    from: 'subscribe@fi.jooble.org',
    subject: 'Esimerkki etsii Software Developer, ja 14 muuta uutta työpaikkaa',
    html: `<p>Päivittäiset työhälytyksesi</p>
      <a href="${job}"><div><table><tr><td><span>14 uutta työpaikkailmoitusta</span></td></tr></table>
        <table><tr><td><h2><a href="${job}">Junior Developer</a></h2></td></tr><tr><td><p>Helsinki, 40 km</p></td></tr></table>
      </div></a>
      <p><a href="${job}">Näytä työpaikat</a></p>
      <p><a href="https://fi.jooble.org/Account/Subscriptions?utm_source=x">Muokkaa työpaikkahälytyksiä</a></p>`,
  });
  assert.deepEqual(result, { jobs: [], unreadable: 0 });
  const individual = await read('jooble_alert', {
    from: 'subscribe@fi.jooble.org',
    subject: 'One new job',
    html: `<p><a href="https://fi.jooble.org/desc/-100000002?utm_source=letter">Backend Developer</a></p>
      <p>Example Oy</p><p>Helsinki</p>`,
  });
  assert.deepEqual(individual.jobs, [
    {
      url: 'https://fi.jooble.org/desc/-100000002',
      externalId: '-100000002',
      title: 'Backend Developer',
      company: 'Example Oy',
      location: 'Helsinki',
      details: '',
    },
  ]);
});

test('Totaljobs alerts: EmailLink.aspx links on Totaljobs and CWJobs, then company, location and pay', async () => {
  const job = (site: string, id: number) =>
    `https://www.${site}/JobSearch/EmailLink.aspx?JobID=${id}&amp;GUID=abc&amp;DCMP=x&amp;SEARCH=y`;
  const card = (link: string, title: string, rest: string[]) =>
    `<tr><td><a href="${link}">${title}</a></td></tr>${rest.map((line) => `<tr><td>${line}</td></tr>`).join('')}`;
  const result = await read('totaljobs_alert', {
    from: 'totaljobs@totaljobsmail.com',
    subject: '2 new ".NET Developer" jobs in Example Town',
    html: `<p>20 jobs found</p><table>
      ${card(job('totaljobs.com', 100000001), '.NET Developer', ['Example Recruitment', 'City of London (EC3)', '£60000 - £80000 per annum'])}
      ${card(job('cwjobs.co.uk', 100000002), 'C# Developer', ['Example Technology', 'London', 'From £45,000 to £50,000 per annum'])}
      </table><p><a href="https://www.totaljobs.com/JobSearch/EmailLink.aspx?GUID=abc&amp;Search=x">See more on totaljobs</a></p>`,
  });
  assert.deepEqual(
    result.jobs.map((j) => [j.url, j.title, j.company, j.location, j.details]),
    [
      [
        'https://www.totaljobs.com/job/100000001',
        '.NET Developer',
        'Example Recruitment',
        'City of London (EC3)',
        '£60000 - £80000 per annum',
      ],
      [
        'https://www.cwjobs.co.uk/job/100000002',
        'C# Developer',
        'Example Technology',
        'London',
        'From £45,000 to £50,000 per annum',
      ],
    ],
  );
});

test('Totaljobs recommendations: the job id inside a tracker path, the title from the subject, icons between specs', async () => {
  const job = pathTrackerLink(
    'https://www.totaljobs.com/JobSearch/EmailLink.aspx?JobId=100000003&GUID=abc&RecommendedJob=1&offer_position=1',
  );
  const spec = (icon: string, text: string) =>
    `<span><span><img alt="${icon}" src="https://example.com/${icon}.png"></span><span>&nbsp;&nbsp;${text}</span>&emsp;</span>`;
  const result = await read('totaljobs_alert', {
    from: 'totaljobs@jobs.totaljobsmail.com',
    subject: 'Our recommendation: Full Stack Engineer',
    html: `<p>Hello Alex,</p><p>We recommend this job for you. Take a look and see if you want to apply.</p>
      <h1>Full Stack Engineer</h1>
      <div>${spec('company', 'Example Recruitment Ltd')}${spec('location', 'Midlands')}${spec('contract type', 'Permanent')}${spec('salary', '£50000 - £60000 per annum')}</div>
      <p>1 day ago</p>
      <p><a href="${job}">Send application <img alt="" src="https://example.com/arrow.png"></a> <a href="${pathTrackerLink('https://www.totaljobs.com/JobSearch/EmailLink.aspx?JobId=100000003&EditApplication=1')}">Edit application</a></p>
      <p>Read the full job description <a href="${job}">here</a></p>
      <p><a href="${pathTrackerLink('https://surveys.example.com/rate?UserId=1')}">How would you rate your experience with this email?</a></p>`,
  });
  assert.deepEqual(result.jobs, [
    {
      url: 'https://www.totaljobs.com/job/100000003',
      externalId: '100000003',
      title: 'Full Stack Engineer',
      company: 'Example Recruitment Ltd',
      location: 'Midlands',
      details: 'Permanent · £50000 - £60000 per annum · 1 day ago',
    },
  ]);
});

test('Wärtsilä Careers: a list of "Title - City, CC" links, the country code written out', async () => {
  const job = (path: string) =>
    `https://careers.wartsila.com/job/${path}/?feedId=1&amp;utm_source=j2w`;
  const result = await read('wartsila_careers_alert', {
    from: 'wrtsiloyj-jobnotification@noreply12.jobs2web.com',
    subject: 'New jobs posted from careers.wartsila.com',
    html: `<p>New jobs posted from careers.wartsila.com</p><ul>
      <li><a href="${job('Vaasa-Agile-Coach/1400000001')}">Agile Coach - Vaasa, FI</a></li>
      <li><a href="${job('Vancouver-Software-Developer-%28Engineer-2%29-BC/1400000002')}">Software Developer (Engineer 2) - Vancouver, CA</a></li>
      <li><a href="${job('Quito-Service-Engineer%2C-E&amp;A/1400000003')}">Service Engineer, E&amp;A - Quito, EC</a></li>
      </ul>`,
  });
  assert.deepEqual(
    result.jobs.map((j) => [j.externalId, j.title, j.company, j.location]),
    [
      ['1400000001', 'Agile Coach', 'Wärtsilä', 'Vaasa, Finland'],
      ['1400000002', 'Software Developer (Engineer 2)', 'Wärtsilä', 'Vancouver, Canada'],
      ['1400000003', 'Service Engineer, E&A', 'Wärtsilä', 'Quito, Ecuador'],
    ],
  );
  assert.ok(result.jobs.every((j) => j.url && !j.url.includes('?')));
});

test('Teamtailor: newer cards with "Department · Locations · Hybrid", older ones above a "View ad" link', async () => {
  const footer = `<p>Since you have Connected to Esimerkki, you will always be updated with the latest job openings that fit your profile.</p>
    <p><a href="https://careers.example.com/?utm_content=x">Browse career site</a> or <a href="https://careers.example.com/connect/profile">update your profile</a></p>`;
  const newer = await read('teamtailor_alert', {
    from: 'no-reply@esimerkki.teamtailor-mail.com',
    subject: 'Esimerkki : 2 new jobs matching your profile',
    html: `<h1><a href="https://careers.example.com/"><img alt=""></a>Esimerkki</h1><p>Alex, we have 2 new jobs that match your profile</p>
      <p><a href="https://careers.example.com/jobs/6400001-solution-architect">Solution Architect</a></p>
      <p>Technical experts · Tampere, Jyväskylä and 7 more · Hybrid</p>
      <p><a href="https://careers.example.com/jobs/6400002-release-manager">Release Manager</a></p>
      <p>Espoo Office (Headquarters)</p>
      ${footer}`,
  });
  assert.deepEqual(
    newer.jobs.map((j) => [j.url, j.title, j.company, j.location, j.details]),
    [
      [
        'https://careers.example.com/jobs/6400001',
        'Solution Architect',
        'Esimerkki',
        'Tampere, Jyväskylä and 7 more (Hybrid)',
        'Technical experts',
      ],
      [
        'https://careers.example.com/jobs/6400002',
        'Release Manager',
        'Esimerkki',
        'Espoo Office (Headquarters)',
        '',
      ],
    ],
  );

  const older = await read('teamtailor_alert', {
    from: 'no-reply@message.teamtailor.com',
    subject: 'Esimerkki : Software Developer - Customer solutions',
    html: `<h1><a href="https://careers.example.com/"><img alt=""></a></h1>
      <h2>Software Developer - Customer solutions</h2><p>Tech/IT - Helsinki</p><p>Hybrid Remote</p>
      <p>We are looking for a developer who…</p>
      <p><a href="https://careers.example.com/en-GB/jobs/5100001-software-developer-customer-solutions?utm_source=connect">View ad →</a></p>
      ${footer}`,
  });
  assert.deepEqual(older.jobs, [
    {
      url: 'https://careers.example.com/jobs/5100001',
      externalId: '5100001',
      title: 'Software Developer - Customer solutions',
      company: 'Esimerkki',
      location: 'Helsinki (Hybrid, Remote)',
      details: 'Tech/IT',
    },
  ]);
});

test('a tracker that carries no readable address gives no job, and nothing is requested to find out', async () => {
  const result = await read('duunitori_alert', {
    from: 'duunivahti@duunitori.fi',
    subject: 'Duunitori found 1 job in Finland for you',
    html: `<p>Esimerkki Oy</p><h2>Backend Developer</h2><p>An excerpt.</p>
      <p><a href="https://u1234.ct.sendgrid.net/ls/click?upn=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789">Read more</a></p>`,
  });
  assert.deepEqual(result, { jobs: [], unreadable: 0 });
});

test('a title that starts like a button stays a title', async () => {
  const result = await read('linkedin_alert', {
    from: 'jobalerts-noreply@linkedin.com',
    subject: 'jobs',
    html: linkedInAlert([
      linkedInCard({
        id: 4100000011,
        title: 'Open Source Engineer',
        company: 'Acme',
        location: 'Espoo',
      }),
      linkedInCard({
        id: 4100000012,
        title: 'Show Producer',
        company: 'Beta',
        location: 'Helsinki',
      }),
    ]),
  });
  assert.deepEqual(
    result.jobs.map((j) => j.title),
    ['Open Source Engineer', 'Show Producer'],
  );
});

test('a recruiter message that only links to the talent network, such as a rejection, has no job', async () => {
  const result = await read('teamtailor_recruiter', {
    from: 'conversations@message.teamtailor.com',
    subject: 'Senior Backend Developer at Example Club',
    html: `<h1>Example Club</h1><p>Hi Alex!</p>
      <p>We greatly appreciate your interest in Example Club and the time you invested to apply for the position.</p>
      <p>We encourage you to join our talent network <a href="https://careers.example.org/en-GB/connect?utm_source=x">here</a>.</p>
      <p>Kind regards,</p>`,
  });
  assert.deepEqual(result, { jobs: [], unreadable: 0 });
});

test('Snaphunt: one job named in the subject and read from the email, without a link', async () => {
  // Every link goes through an encrypted click tracker, as in Snaphunt's real emails.
  const tracker = (n: number) =>
    `https://u1000001.ct.sendgrid.net/ls/click?upn=u001.EncryptedPayload${n}AbCdEfGhIjKlMnOp-2FQrStUv-3D`;
  const email = (subject: string, card: string) => ({
    from: 'no-reply@notifications.snaphunt.com',
    subject,
    html: `<p><a href="${tracker(1)}"><img alt="Snaphunt Pte. Ltd."></a></p>
      <h1>You have a new job matching your profile</h1><p>Hi Alex!</p>
      <p>You have a new job matching your profile. View job details and click 'Apply' to share your profile with the employer.</p>
      ${card}
      <p><a href="${tracker(2)}">View job</a></p>
      <h2>What does this mean?</h2><p>These companies are likely to be interested in interviewing you!</p>
      <p>If you no longer wish to receive emails from Snaphunt, please <a href="${tracker(3)}">Unsubscribe</a></p>`,
  });
  const card =
    '<h2>Odoo Consultant</h2><p>Example Partners</p><p>REMOTE | Europe/Berlin</p><p>Great Work Culture and Opportunities To Learn</p>';
  const first = await read(
    'snaphunt_alert',
    email('Matching job: Odoo Consultant at Example Partners', card),
  );
  assert.equal(first.unreadable, 0);
  assert.equal(first.jobs.length, 1);
  const [job] = first.jobs;
  assert.deepEqual(
    { ...job, externalId: undefined },
    {
      url: null,
      externalId: undefined,
      title: 'Odoo Consultant',
      company: 'Example Partners',
      location: 'REMOTE | Europe/Berlin',
      details: 'Great Work Culture and Opportunities To Learn',
    },
  );
  assert.match(job!.externalId, /^card-[0-9a-f]{40}$/);

  // The same job in another email has the same id; a title with " at " in it still reads.
  const again = await read(
    'snaphunt_alert',
    email('Matching job: Odoo Consultant at Example Partners', card),
  );
  assert.equal(again.jobs[0]!.externalId, job!.externalId);
  const tricky = await read(
    'snaphunt_alert',
    email(
      'Matching job: Head of Growth at Scale at Example Labs',
      '<h2>Head of Growth at Scale</h2><p>Example Labs</p><p>REMOTE | Europe</p>',
    ),
  );
  assert.deepEqual(
    tricky.jobs.map((j) => [j.title, j.company, j.location, j.details]),
    [['Head of Growth at Scale', 'Example Labs', 'REMOTE | Europe', '']],
  );
});

test('Snaphunt: marketing mail and a subject that does not match the email give no job', async () => {
  const none = await read('snaphunt_alert', {
    from: 'no-reply@notifications.snaphunt.com',
    subject: 'Your next job is waiting for you',
    html: '<h1>Complete your profile</h1><p>Odoo Consultant</p><p>Example Partners</p>',
  });
  assert.deepEqual(none, { jobs: [], unreadable: 0 });
  const mismatch = await read('snaphunt_alert', {
    from: 'no-reply@notifications.snaphunt.com',
    subject: 'Matching job: Odoo Consultant at Example Partners',
    html: '<h2>Odoo Consultant</h2><p>Someone Else</p><p>REMOTE | Europe</p>',
  });
  assert.deepEqual(mismatch, { jobs: [], unreadable: 0 });
});
