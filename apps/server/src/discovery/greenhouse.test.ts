import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeGreenhouse } from '../testing/greenhouse.ts';
import { greenhouseBoard } from './greenhouse.ts';

const failsWith = (fetch: typeof globalThis.fetch, message: string, board = 'acme') =>
  assert.rejects(greenhouseBoard.listJobs(board, fetch), { name: 'Error', message });

test('lists a board’s jobs with the fields the app keeps', async () => {
  const { fetch, requested } = fakeGreenhouse({
    acme: [
      { id: 11, title: '  Backend Engineer ', location: 'Berlin, Germany; Helsinki, Finland' },
      { id: 12, title: 'Designer', location: '', company_name: '' },
    ],
  });
  assert.deepEqual(await greenhouseBoard.listJobs('Acme', fetch), [
    {
      externalId: '11',
      title: 'Backend Engineer',
      company: 'Acme',
      location: 'Berlin, Germany; Helsinki, Finland',
      url: 'https://job-boards.greenhouse.io/acme/jobs/11',
      publishedAt: '2026-09-01T10:00:00-04:00',
    },
    {
      externalId: '12',
      title: 'Designer',
      company: null,
      location: '',
      url: 'https://job-boards.greenhouse.io/acme/jobs/12',
      publishedAt: '2026-09-01T10:00:00-04:00',
    },
  ]);
  // Without ?content=true: the job text is read in T05, not here.
  assert.deepEqual(requested, ['https://boards-api.greenhouse.io/v1/boards/Acme/jobs']);
});

test('keeps a company’s own https careers page, and links the board page instead of anything else', async () => {
  const { fetch } = fakeGreenhouse({
    acme: [
      { id: 1, absolute_url: 'https://careers.example.com/jobs/?gh_jid=1' },
      { id: 2, absolute_url: 'javascript:alert(1)' },
      { id: 3, absolute_url: 'http://careers.example.com/jobs/3' },
    ],
  });
  const urls = (await greenhouseBoard.listJobs('acme', fetch)).map((p) => p.url);
  assert.deepEqual(urls, [
    'https://careers.example.com/jobs/?gh_jid=1',
    'https://job-boards.greenhouse.io/acme/jobs/2',
    'https://job-boards.greenhouse.io/acme/jobs/3',
  ]);
});

test('accepts the missing fields Greenhouse may leave out', async () => {
  const fetch = (async () =>
    Response.json({
      jobs: [{ id: 5, title: 'Engineer', location: null, absolute_url: null }],
    })) as typeof globalThis.fetch;
  const [posting] = await greenhouseBoard.listJobs('acme', fetch);
  assert.deepEqual(posting, {
    externalId: '5',
    title: 'Engineer',
    company: null,
    location: '',
    url: 'https://job-boards.greenhouse.io/acme/jobs/5',
    publishedAt: null,
  });
});

test('says plainly why a board could not be read', async () => {
  await failsWith(fakeGreenhouse({}).fetch, 'Greenhouse has no job board called nope.', 'nope');
  await failsWith(
    fakeGreenhouse({ acme: 503 }).fetch,
    'boards-api.greenhouse.io answered HTTP 503.',
  );
  await failsWith(
    fakeGreenhouse({ acme: async () => new Response('<html>maintenance</html>') }).fetch,
    'The answer from boards-api.greenhouse.io is not JSON.',
  );
  for (const body of [
    { jobs: 'none' },
    { jobs: [{ id: 'x', title: 'A' }] },
    { jobs: [{ id: 1 }] },
  ]) {
    await failsWith(
      fakeGreenhouse({ acme: async () => Response.json(body) }).fetch,
      'Greenhouse answered with something other than a list of jobs.',
    );
  }
  await failsWith(
    (async () => {
      throw new TypeError('fetch failed');
    }) as typeof globalThis.fetch,
    'Could not reach boards-api.greenhouse.io.',
  );
});

test('cuts a location too long to save, without losing the job', async () => {
  const location = Array.from({ length: 400 }, (_, i) => `Town ${i}, Germany`).join('; ');
  const { fetch } = fakeGreenhouse({ acme: [{ id: 1, location }] });
  const [posting] = await greenhouseBoard.listJobs('acme', fetch);
  assert.ok(posting!.location.length <= 5000);
  assert.ok(posting!.location.endsWith(', Germany; …'), posting!.location.slice(-20));
});

test('stops reading an answer larger than 20 MB', async () => {
  let sent = 0;
  const chunk = new Uint8Array(1024 * 1024).fill(0x20);
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += 1;
      controller.enqueue(chunk);
    },
  });
  await failsWith(
    (async () => new Response(endless)) as typeof globalThis.fetch,
    'The answer from boards-api.greenhouse.io is larger than 20 MB.',
  );
  assert.ok(sent < 25, `read ${sent} MB`);
});

test('reads one job’s text from its HTML-escaped content', async () => {
  const { fetch, requested } = fakeGreenhouse({
    acme: [
      {
        id: 7,
        title: ' Backend Engineer ',
        location: 'Helsinki, Finland',
        content:
          '&lt;h2&gt;About&lt;/h2&gt;&lt;p&gt;Payments &amp;amp; more.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;/ul&gt;',
      },
    ],
  });
  assert.deepEqual(await greenhouseBoard.readJob('Acme', '7', fetch), {
    title: 'Backend Engineer',
    company: 'Acme',
    location: 'Helsinki, Finland',
    url: 'https://job-boards.greenhouse.io/acme/jobs/7',
    text: 'About\n\nPayments & more.\n\n- Python',
  });
  assert.deepEqual(requested, ['https://boards-api.greenhouse.io/v1/boards/Acme/jobs/7']);
});

test('says plainly why a job’s text could not be read', async () => {
  const readFails = (fetch: typeof globalThis.fetch, message: string) =>
    assert.rejects(greenhouseBoard.readJob('acme', '7', fetch), { name: 'Error', message });
  await readFails(
    fakeGreenhouse({ acme: [] }).fetch,
    'The Greenhouse board acme no longer lists this job.',
  );
  await readFails(
    fakeGreenhouse({ acme: [{ id: 7, content: '&lt;p&gt; &lt;/p&gt;' }] }).fetch,
    'Greenhouse gives no text for this job.',
  );
  await readFails(
    fakeGreenhouse({ acme: [{ id: 7, content: 'x'.repeat(100_001) }] }).fetch,
    'The job text from Greenhouse is longer than 100,000 characters.',
  );
  await readFails(
    (async () => Response.json({ id: 7, title: 'Engineer' })) as typeof globalThis.fetch,
    'Greenhouse answered with something other than a job.',
  );
});

test('reads a job’s application form as the app’s questions', async () => {
  const { fetch, requested } = fakeGreenhouse({ acme: [{ id: 7 }] });
  const form = await greenhouseBoard.readForm!('acme', '7', fetch);
  assert.deepEqual(requested, [
    'https://boards-api.greenhouse.io/v1/boards/acme/jobs/7?questions=true',
  ]);
  assert.deepEqual(
    form.map((q) => [q.key, q.kind, q.required, q.group]),
    [
      ['first_name', 'text', true, 'questions'],
      ['last_name', 'text', true, 'questions'],
      ['email', 'text', true, 'questions'],
      ['phone', 'text', false, 'questions'],
      // The file field, not its text alternative.
      ['resume', 'file', true, 'questions'],
      ['cover_letter', 'file', false, 'questions'],
      ['question_101', 'text', false, 'questions'],
      ['question_102', 'single', true, 'questions'],
      ['question_103', 'text', true, 'questions'],
      // Latitude and longitude are hidden fields the form fills itself.
      ['location', 'text', true, 'location'],
      ['gender', 'single', false, 'compliance'],
      // Processing consent asked separately, so not the general one as well.
      ['gdpr_processing_consent_given', 'consent', true, 'consent'],
    ],
  );
  const visa = form.find((q) => q.key === 'question_102')!;
  assert.equal(visa.label, 'Will you now or in the future require sponsorship for a visa?');
  assert.equal(visa.description, 'We can sponsor some visas.');
  assert.deepEqual(visa.options, ['Yes', 'No']);
  assert.deepEqual(form.find((q) => q.key === 'gender')!.options, [
    'Decline To Self Identify',
    'Female',
    'Male',
  ]);
});

test('reads demographic questions and the consents a form asks for', async () => {
  const { fetch } = fakeGreenhouse({
    acme: [
      {
        id: 8,
        form: {
          questions: [
            {
              required: true,
              label: '  Skills\n you have ',
              fields: [
                {
                  name: 'question_1',
                  type: 'multi_value_multi_select',
                  values: [{ label: 'Go' }, { label: ' Go ' }, { label: 'Rust' }, { label: '' }],
                },
              ],
            },
          ],
          demographic_questions: {
            header: 'Made up',
            questions: [
              {
                id: 4,
                label: 'Pronouns',
                required: false,
                type: 'multi_value_single_select',
                answer_options: [{ id: 1, label: 'Prefer not to say', free_form: false }],
              },
            ],
          },
          data_compliance: [
            {
              type: 'gdpr',
              requires_consent: true,
              requires_processing_consent: false,
              requires_retention_consent: false,
              demographic_data_consent_applies: true,
            },
          ],
        },
      },
    ],
  });
  const form = await greenhouseBoard.readForm!('acme', '8', fetch);
  assert.deepEqual(
    form.map((q) => [q.key, q.label, q.kind, q.required, q.options]),
    [
      ['question_1', 'Skills you have', 'multi', true, ['Go', 'Rust']],
      ['demographic_4', 'Pronouns', 'single', false, ['Prefer not to say']],
      ['gdpr_consent_given', 'Consent to the processing of your data (GDPR)', 'consent', true, []],
      [
        'gdpr_demographic_data_consent_given',
        'Consent to the processing of your answers to the demographic questions',
        'consent',
        false,
        [],
      ],
    ],
  );
});

test('says plainly why a job’s form could not be read', async () => {
  const read = (form: Record<string, unknown>) =>
    greenhouseBoard.readForm!('acme', '9', fakeGreenhouse({ acme: [{ id: 9, form }] }).fetch);
  await assert.rejects(read({}), { message: 'Greenhouse gives no application form for this job.' });
  await assert.rejects(read({ questions: 'none' }), {
    message: 'Greenhouse answered with something other than an application form.',
  });
  await assert.rejects(
    read({ questions: [{ label: 'Date', fields: [{ name: 'q', type: 'input_date' }] }] }),
    { message: 'Greenhouse’s form has a field of a kind the app does not know: input_date.' },
  );
  await assert.rejects(
    greenhouseBoard.readForm!('acme', '10', fakeGreenhouse({ acme: [] }).fetch),
    {
      message: 'The Greenhouse board acme no longer lists this job.',
    },
  );
});
