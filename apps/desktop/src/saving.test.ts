import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PageReading } from './readers.ts';
import {
  jobPageRequest,
  jobPostingOf,
  pageSavedMessage,
  resultsRequest,
  resultsSavedMessage,
  siteOf,
} from './saving.ts';

const linkedInPage = 'https://www.linkedin.com/jobs/search/?currentJobId=4000000001';
const otherPage = 'https://jobs.example.fi/tyo/123';

const reading = (fields: Partial<PageReading> = {}): PageReading => ({
  title: 'Page title',
  selection: '',
  text: '',
  jsonLd: [],
  job: null,
  ...fields,
});

const job = {
  title: 'Platform Engineer',
  company: 'Acme',
  location: 'Helsinki, Uusimaa, Finland (Hybrid)',
  text: 'About the job\nYou will run our build systems.',
};

test('knows LinkedIn by its host, over https only', () => {
  assert.equal(siteOf(linkedInPage), 'linkedin');
  assert.equal(siteOf('https://fi.linkedin.com/jobs/view/1'), 'linkedin');
  assert.equal(siteOf('https://notlinkedin.com/jobs/view/1'), null);
  assert.equal(siteOf('http://www.linkedin.com/jobs/view/1'), null);
  assert.equal(siteOf('about:blank'), null);
});

test('on LinkedIn, saves the job’s description, even when text is selected', () => {
  assert.deepEqual(
    jobPageRequest(linkedInPage, reading({ job, selection: 'some selected words' })),
    {
      request: {
        url: linkedInPage,
        title: 'Platform Engineer',
        company: 'Acme',
        location: 'Helsinki, Uusimaa, Finland (Hybrid)',
        text: 'About the job\nYou will run our build systems.',
      },
      saved: 'the job’s description',
    },
  );
});

test('on LinkedIn without a description, saves the selection or asks for one', () => {
  const selected = jobPageRequest(
    linkedInPage,
    reading({ title: '(3) Platform Engineer | Acme | LinkedIn', selection: 'Job text' }),
  );
  assert.deepEqual(selected, {
    request: { url: linkedInPage, title: 'Platform Engineer | Acme | LinkedIn', text: 'Job text' },
    saved: 'the text you selected',
  });

  const none = jobPageRequest(linkedInPage, reading({ text: 'Whole page with my name' }));
  assert.ok('error' in none);
  assert.match(none.error, /Select the job’s text/);
});

test('elsewhere, saves the selection, or else the whole visible page', () => {
  const page = reading({ title: 'Kehittäjä - Gamma', text: 'Menu\nKehittäjä\nTeet ohjelmistoja.' });
  assert.deepEqual(jobPageRequest(otherPage, page), {
    request: { url: otherPage, title: 'Kehittäjä - Gamma', text: page.text },
    saved: 'the whole visible page',
  });
  assert.deepEqual(jobPageRequest(otherPage, { ...page, selection: 'Teet ohjelmistoja.' }), {
    request: { url: otherPage, title: 'Kehittäjä - Gamma', text: 'Teet ohjelmistoja.' },
    saved: 'the text you selected',
  });
  // Without a title, the site's name stands in.
  const untitled = jobPageRequest(otherPage, { ...page, title: '' });
  assert.ok('request' in untitled);
  assert.equal(untitled.request.title, 'jobs.example.fi');
});

test('elsewhere, takes the title, company and location from the page’s JobPosting', () => {
  const posting = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: 'Jobs' },
      {
        '@type': 'JobPosting',
        title: 'Ohjelmistokehittäjä',
        hiringOrganization: { '@type': 'Organization', name: 'Gamma Oy' },
        jobLocation: [
          { address: { addressLocality: 'Helsinki', addressCountry: 'FI' } },
          { address: { addressLocality: 'Tampere', addressCountry: { name: 'Finland' } } },
        ],
      },
    ],
  };
  const saving = jobPageRequest(
    otherPage,
    reading({ text: 'Teet ohjelmistoja.', jsonLd: ['not json', JSON.stringify(posting)] }),
  );
  assert.ok('request' in saving);
  assert.deepEqual(
    [saving.request.title, saving.request.company, saving.request.location],
    ['Ohjelmistokehittäjä', 'Gamma Oy', 'Helsinki, Finland; Tampere, Finland'],
  );
});

test('reads remote jobs and their allowed countries from a JobPosting', () => {
  assert.deepEqual(
    jobPostingOf([
      JSON.stringify([
        {
          '@type': ['JobPosting'],
          title: ' Backend  Developer ',
          hiringOrganization: 'Delta',
          jobLocationType: 'TELECOMMUTE',
          applicantLocationRequirements: [{ '@type': 'Country', name: 'FI' }, { name: 'Sweden' }],
        },
      ]),
    ]),
    { title: 'Backend Developer', company: 'Delta', location: 'Remote - Finland, Sweden' },
  );
  assert.deepEqual(jobPostingOf(['{"@type":"Organization","name":"Gamma"}', '[', '']), {});
});

test('refuses pages it cannot save', () => {
  for (const [url, value, message] of [
    ['http://jobs.example.fi/1', reading({ text: 'Text' }), /https/],
    [otherPage, reading(), /no text/],
    [otherPage, reading({ text: 'x'.repeat(100_001) }), /longer than 100,000/],
    [otherPage, { title: 1 }, /could not be read/],
    [otherPage, null, /could not be read/],
    [otherPage, { ...reading(), job: { title: 'x' } }, /could not be read/],
  ] as const) {
    const saving = jobPageRequest(url, value);
    assert.ok('error' in saving, String(url));
    assert.match(saving.error, message);
  }
});

test('turns results entries into LinkedIn job addresses, dropping malformed ones', () => {
  const saving = resultsRequest({
    entries: [
      { id: '4000000011', title: 'Data  Engineer', company: 'Beta', location: '' },
      { id: '4000000012', title: 'Developer', company: 'Gamma', location: 'Espoo' },
      { id: 'javascript:1', title: 'Bad', company: 'X', location: '' },
      { id: '4000000013', title: 42 },
    ],
    unreadable: 2,
  });
  assert.deepEqual(saving, {
    request: {
      entries: [
        {
          url: 'https://www.linkedin.com/jobs/view/4000000011/',
          title: 'Data Engineer',
          company: 'Beta',
        },
        {
          url: 'https://www.linkedin.com/jobs/view/4000000012/',
          title: 'Developer',
          company: 'Gamma',
          location: 'Espoo',
        },
      ],
    },
    saved: '2 jobs',
    unreadable: 4,
  });
});

test('says why no results were saved', () => {
  const none = resultsRequest({ entries: [], unreadable: 0 });
  assert.ok('error' in none);
  assert.equal(none.error, 'The app found no job entries on this page.');

  const unloaded = resultsRequest({ entries: [], unreadable: 3 });
  assert.ok('error' in unloaded);
  assert.match(unloaded.error, /could not read the 3 job entries on this page\. Scroll to them/);

  const many = resultsRequest({
    entries: Array.from({ length: 101 }, (_, i) => ({
      id: String(i + 1),
      title: 'Job',
      company: 'Acme',
      location: '',
    })),
    unreadable: 0,
  });
  assert.ok('error' in many);
  assert.match(many.error, /at most 100/);
  assert.ok('error' in resultsRequest('nope'));
});

test('words what was saved', () => {
  const answer = { jobId: 'id', title: 'Platform Engineer', newJob: true, text: 'first' } as const;
  assert.equal(
    pageSavedMessage(answer, 'the job’s description'),
    'Saved “Platform Engineer”, with the job’s description.',
  );
  assert.equal(
    pageSavedMessage({ ...answer, newJob: false }, 'the job’s description'),
    'Saved the text of “Platform Engineer”, with the job’s description.',
  );
  assert.equal(
    pageSavedMessage({ ...answer, newJob: false, text: 'new' }, 'the text you selected'),
    'Saved a new version of “Platform Engineer”, with the text you selected.',
  );
  assert.equal(
    pageSavedMessage({ ...answer, newJob: false, text: 'same' }, 'the whole visible page'),
    '“Platform Engineer” was already saved with this text.',
  );
  assert.equal(
    resultsSavedMessage({ saved: 1, newJobs: 0 }, 0),
    'Saved 1 job from this page, 0 of them new. They need their job text before they are summarised.',
  );
  assert.match(resultsSavedMessage({ saved: 3, newJobs: 3 }, 1), /1 entry could not be read/);
});
