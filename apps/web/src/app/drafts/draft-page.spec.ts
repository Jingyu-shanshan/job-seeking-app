import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CitedFact, Draft, DraftStatement } from '@jsa/shared';
import { DraftPage } from './draft-page';

const draftId = '00000000-0000-4000-8000-000000000001';
const jobId = '00000000-0000-4000-8000-000000000002';

let next = 100;
const fact = (body: string, current = true): CitedFact => ({
  versionId: `00000000-0000-4000-8000-000000000${next++}`,
  factId: `00000000-0000-4000-8000-000000000${next++}`,
  version: 1,
  body,
  current,
});

const role = fact('Backend developer at Acme Oy, 2021-03 – 2024-06');
const invoice = fact('Built the invoice API in Go; cut processing time by about 30%');

const statement = (fields: Partial<DraftStatement>): DraftStatement => ({
  id: `00000000-0000-4000-8000-000000000${next++}`,
  section: 'experience',
  block: 0,
  line: 'bullet',
  about: 'me',
  text: 'Built the invoice API.',
  quote: null,
  facts: [invoice],
  problems: [],
  verbatim: false,
  ...fields,
});

const resume = (fields: Partial<Draft> = {}): Draft => ({
  id: draftId,
  kind: 'resume',
  jobId,
  snapshotId: '00000000-0000-4000-8000-000000000003',
  title: 'Payments Engineer',
  company: 'Example Pay',
  createdAt: '2026-10-05T08:00:00.000Z',
  model: 'deepseek-flash',
  costUsd: 0.0012,
  factsSent: 4,
  outdated: [],
  statements: [
    statement({ section: 'headline', line: 'sentence', text: 'Backend developer', facts: [role] }),
    statement({
      section: 'summary',
      line: 'sentence',
      text: 'Builds invoice APIs in Go.',
      facts: [role, invoice],
    }),
    statement({ line: 'title', text: 'Backend developer, Acme Oy', facts: [role] }),
    statement({ text: invoice.body, verbatim: true }),
    statement({
      text: 'Cut processing time by 45%.',
      problems: [{ code: 'number', message: '“45%” is not in the facts it cites.' }],
    }),
    statement({
      text: 'Led the platform team.',
      facts: [],
      problems: [{ code: 'uncited', message: 'It cites none of your facts.' }],
    }),
    statement({ section: 'skills', line: 'title', text: 'Go, PostgreSQL', facts: [] }),
  ],
  ...fields,
});

describe('DraftPage', () => {
  let fixture: ComponentFixture<DraftPage>;
  let http: HttpTestingController;

  const page = () => fixture.nativeElement as HTMLElement;
  const text = (el: Element | null = page()) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const headings = () => [...page().querySelectorAll('h2, h3')].map((h) => text(h));

  async function load(draft: Draft) {
    http.expectOne(`/api/drafts/${draftId}`).flush(draft);
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DraftPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(DraftPage);
    fixture.componentRef.setInput('id', draftId);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('shows every statement where it goes, with what its checks found', async () => {
    await load(resume());
    expect(text(page().querySelector('h1'))).toBe('Resume draft');
    expect(text()).toContain(
      'For Payments Engineer at Example Pay. Written by deepseek-flash on 5 Oct 2026',
    );
    expect(text()).toContain('from 4 facts, about $0.0012.');
    expect(text()).toContain(
      '7 statements: 5 in the document, 2 left out. 4 of those in the document put your facts in DeepSeek’s words.',
    );
    expect(headings()).toEqual(['Headline', 'Summary', 'Experience', 'Skills']);
    expect(page().querySelector('a')!.getAttribute('href')).toBe(`/jobs/${jobId}`);

    const item = (startsWith: string) =>
      [...page().querySelectorAll('li')].find(
        (li) => li.querySelector(':scope > app-statement-check') && text(li).startsWith(startsWith),
      )!;
    const check = (startsWith: string) =>
      text(item(startsWith).querySelector('app-statement-check'));
    expect(check('Cut processing time by 45%.')).toContain(
      'Left out: “45%” is not in the facts it cites.',
    );
    expect(check('Led the platform team.')).toContain('Left out: It cites none of your facts.');
    expect(check(invoice.body)).toContain('In the document Your fact word for word.');
    const struck = [...page().querySelectorAll('.out')].map((el) => text(el));
    expect(struck).toEqual(['Cut processing time by 45%.', 'Led the platform team.']);

    const summary = item('Builds invoice APIs in Go.');
    expect(text(summary)).toContain('In DeepSeek’s words: read it against the facts it cites.');
    expect(text(summary.querySelector('details'))).toContain(role.body);
    expect(text(summary.querySelector('details'))).toContain('(fact version 1)');
  });

  it('previews only what goes into the document', async () => {
    await load(resume());
    page().querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    await fixture.whenStable();
    expect(text(page().querySelector('.headline'))).toBe('Backend developer');
    expect(text()).not.toContain('45%');
    expect(text()).not.toContain('platform team');
    expect(text()).not.toContain('Left out');
    expect([...page().querySelectorAll('.entry')].map((e) => text(e))).toEqual([
      'Backend developer, Acme Oy',
    ]);
    // A section of one-line entries is a plain list.
    expect([...page().querySelectorAll('li')].map((li) => text(li))).toEqual([
      invoice.body,
      'Go, PostgreSQL',
    ]);
  });

  it('shows a cover letter by paragraph, and statements about the job with their quotes', async () => {
    await load(
      resume({
        kind: 'cover_letter',
        statements: [
          statement({
            section: 'letter',
            line: 'sentence',
            about: 'other',
            text: 'I am applying for the Payments Engineer role.',
            facts: [],
          }),
          statement({
            section: 'letter',
            line: 'sentence',
            block: 1,
            about: 'job',
            text: 'You move money for 40,000 merchants.',
            quote: 'You will build the APIs that move money for 40,000 merchants.',
            facts: [],
          }),
        ],
      }),
    );
    expect(text(page().querySelector('h1'))).toBe('Cover letter draft');
    expect(headings()).toEqual(['Letter', 'Paragraph 1', 'Paragraph 2']);
    expect(text()).toContain('A connecting sentence: it states nothing to check.');
    const job = text(page().querySelectorAll('app-statement-check')[1]!);
    expect(job).toContain('About the job, checked against its quote.');
    expect(job).toContain(
      'The job text: “You will build the APIs that move money for 40,000 merchants.”',
    );
  });

  it('says when a draft is out of date or a fact it cites changed', async () => {
    const changed = fact(role.body, false);
    await load(
      resume({
        outdated: ['The facts that may be used in drafts have changed since.'],
        statements: [
          statement({
            section: 'headline',
            line: 'sentence',
            text: 'Backend developer',
            facts: [changed],
            problems: [
              {
                code: 'fact_changed',
                message: 'A fact it cites has changed, or may no longer appear in documents.',
              },
            ],
          }),
        ],
      }),
    );
    expect(text(page().querySelector('.notice'))).toBe(
      'The facts that may be used in drafts have changed since. You can write it again on the job page.',
    );
    expect(text()).toContain('changed since or no longer allowed in documents');

    page().querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    await fixture.whenStable();
    expect(text()).toContain('No statement passed the checks, so the document would be empty.');
  });

  it('says when the draft cannot be loaded', async () => {
    http
      .expectOne(`/api/drafts/${draftId}`)
      .flush({ message: 'There is no such draft.' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect(text(page().querySelector('[role=alert]'))).toBe(
      'The draft could not be loaded. There is no such draft.',
    );
  });
});
