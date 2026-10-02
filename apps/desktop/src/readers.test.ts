import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readJobPage, readLinkedInResults } from './readers.ts';
import { page } from './testing/page.ts';

// Made-up pages in the shape of LinkedIn's signed-in and signed-out layouts. Companies, people and
// jobs are invented.

const signedInJob = `
<header><nav><a href="/in/me">Jamie Example</a> <span>3 new notifications</span></nav></header>
<main>
  <div class="job-details-jobs-unified-top-card__container--two-pane">
    <div class="job-details-jobs-unified-top-card__company-name"><a href="/company/acme">Acme</a></div>
    <div class="job-details-jobs-unified-top-card__job-title"><h1>Platform Engineer</h1></div>
    <div class="job-details-jobs-unified-top-card__tertiary-description-container">
      <span class="tvm__text">Helsinki, Uusimaa, Finland</span> · <span>2 weeks ago</span> · <span>Over 100 applicants</span>
    </div>
    <div class="job-details-fit-level-preferences"><button>Hybrid</button> <button>Full-time</button></div>
    <p>Your profile matches several of the required qualifications</p>
  </div>
  <article class="jobs-description__container">
    <div id="job-details">
About the job
You will run our build systems.
- 3+ years with CI pipelines
    </div>
  </article>
</main>`;

test('reads only the job’s own part of a signed-in LinkedIn job page', () => {
  const reading = page(signedInJob).run(readJobPage, 'linkedin');
  assert.deepEqual(reading.job, {
    title: 'Platform Engineer',
    company: 'Acme',
    location: 'Helsinki, Uusimaa, Finland (Hybrid)',
    text: 'About the job\nYou will run our build systems.\n- 3+ years with CI pipelines',
  });
  // Nothing else from the page: not the user's name, notifications or profile hints.
  assert.equal(reading.text, '');
  assert.deepEqual(reading.jsonLd, []);
  assert.doesNotMatch(JSON.stringify(reading), /Jamie|notifications|profile matches/);
});

test('reads a signed-out LinkedIn job page', () => {
  const reading = page(`
    <section class="top-card-layout">
      <h1 class="top-card-layout__title topcard__title">Data Engineer</h1>
      <a class="topcard__org-name-link" href="https://fi.linkedin.com/company/beta">Beta</a>
      <span class="topcard__flavor topcard__flavor--bullet">Espoo, Uusimaa, Finland</span>
    </section>
    <div class="description__text"><div class="show-more-less-html__markup">You model our data.</div></div>
  `).run(readJobPage, 'linkedin');
  assert.deepEqual(reading.job, {
    title: 'Data Engineer',
    company: 'Beta',
    location: 'Espoo, Uusimaa, Finland',
    text: 'You model our data.',
  });
});

test('finds no job on a LinkedIn page without a shown description, but keeps the selection', () => {
  const hidden = page(`
    <h1 class="top-card-layout__title">Data Engineer</h1>
    <div id="job-details" hidden>Not shown.</div>
    <p id="mine">Selected job text</p>
  `);
  hidden.select('#mine');
  const reading = hidden.run(readJobPage, 'linkedin');
  assert.deepEqual([reading.job, reading.selection, reading.text], [null, 'Selected job text', '']);
});

test('reads any other page as its visible text, its selection and its JSON-LD', () => {
  const html = `
    <title>Ohjelmistokehittäjä - Gamma Oy</title>
    <script type="application/ld+json">{"@type":"JobPosting","title":"Ohjelmistokehittäjä"}</script>
    <main><h1>Ohjelmistokehittäjä</h1><p id="ad">Teet ohjelmistoja.</p></main>`;
  const other = page(html, 'https://jobs.example.fi/tyo/123');
  const reading = other.run(readJobPage, null);
  assert.equal(reading.title, 'Ohjelmistokehittäjä - Gamma Oy');
  assert.equal(reading.selection, '');
  assert.match(reading.text, /Teet ohjelmistoja\./);
  assert.deepEqual(reading.jsonLd, ['{"@type":"JobPosting","title":"Ohjelmistokehittäjä"}']);
  assert.equal(reading.job, null);

  other.select('#ad');
  assert.equal(other.run(readJobPage, null).selection, 'Teet ohjelmistoja.');
});

const signedInCard = (id: number, title: string, company: string, location: string) => `
  <li class="scaffold-layout__list-item" data-occludable-job-id="${id}">
    <div class="job-card-container" data-job-id="${id}">
      <div class="artdeco-entity-lockup__title">
        <a class="job-card-list__title--link" href="/jobs/view/${id}/?trackingId=x">
          <span aria-hidden="true"><strong>${title}</strong></span>
          <span class="visually-hidden">${title} with verification</span>
        </a>
      </div>
      <div class="artdeco-entity-lockup__subtitle"><span>${company}</span></div>
      <div class="artdeco-entity-lockup__caption">
        <ul class="job-card-container__metadata-wrapper"><li><span>${location}</span></li></ul>
      </div>
    </div>
  </li>`;

test('reads the entries a signed-in LinkedIn results list shows', () => {
  const reading = page(
    `<ul>
      ${signedInCard(4000000011, 'Data Engineer', 'Beta', 'Espoo, Uusimaa, Finland (Hybrid)')}
      ${signedInCard(4000000012, 'Backend Developer', 'Gamma', 'European Union (Remote)')}
      <!-- Not scrolled into view yet: LinkedIn has not filled it in. -->
      <li class="scaffold-layout__list-item" data-occludable-job-id="4000000013"></li>
      <!-- A list hidden on the page is not shown, so it is not read or counted. -->
      <div hidden>${signedInCard(4000000014, 'Hidden Job', 'Delta', 'Helsinki')}</div>
    </ul>`,
    'https://www.linkedin.com/jobs/search/?keywords=engineer',
  ).run(readLinkedInResults);
  assert.deepEqual(reading, {
    entries: [
      {
        id: '4000000011',
        title: 'Data Engineer',
        company: 'Beta',
        location: 'Espoo, Uusimaa, Finland (Hybrid)',
      },
      {
        id: '4000000012',
        title: 'Backend Developer',
        company: 'Gamma',
        location: 'European Union (Remote)',
      },
    ],
    unreadable: 1,
  });
});

test('reads the entries of a signed-out LinkedIn results list', () => {
  const reading = page(
    `<ul class="jobs-search__results-list">
      <li><div class="base-card base-search-card" data-entity-urn="urn:li:jobPosting:4000000021">
        <a class="base-card__full-link" href="https://fi.linkedin.com/jobs/view/sre-at-delta-4000000021"><span class="sr-only">SRE</span></a>
        <div class="base-search-card__info">
          <h3 class="base-search-card__title">SRE</h3>
          <h4 class="base-search-card__subtitle"><a href="#">Delta</a></h4>
          <div class="base-search-card__metadata"><span class="job-search-card__location">Helsinki, Uusimaa, Finland</span></div>
        </div>
      </div></li>
      <li><div class="base-card" data-entity-urn="urn:li:jobPosting:4000000022">
        <h3 class="base-search-card__title">No company shown</h3>
      </div></li>
      <li><div class="base-card" data-entity-urn="urn:li:jobPosting:not-a-number"></div></li>
    </ul>`,
    'https://fi.linkedin.com/jobs/search?keywords=sre',
  ).run(readLinkedInResults);
  assert.deepEqual(reading, {
    entries: [
      { id: '4000000021', title: 'SRE', company: 'Delta', location: 'Helsinki, Uusimaa, Finland' },
    ],
    unreadable: 1,
  });
});

test('finds nothing on a page without job entries', () => {
  const reading = page('<p>Feed</p>', 'https://www.linkedin.com/feed/').run(readLinkedInResults);
  assert.deepEqual(reading, { entries: [], unreadable: 0 });
});
