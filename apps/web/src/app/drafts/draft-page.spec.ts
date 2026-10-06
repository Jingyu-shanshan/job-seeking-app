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

function statement(fields: Partial<DraftStatement>): DraftStatement {
  const s = {
    id: `00000000-0000-4000-8000-000000000${next++}`,
    section: 'experience' as const,
    block: 0,
    line: 'bullet' as const,
    about: 'me' as const,
    text: 'Built the invoice API.',
    quote: null,
    facts: [invoice],
    problems: [],
    verbatim: false,
    edited: false,
    included: true,
    ...fields,
  };
  return {
    ...s,
    modelText: fields.modelText ?? s.text,
    inDocument: s.included && s.problems.length === 0,
  };
}

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

  const item = (startsWith: string) =>
    [...page().querySelectorAll('app-statement-review')].find((el) =>
      text(el.querySelector('.text')).startsWith(startsWith),
    )!;
  const check = (startsWith: string) => text(item(startsWith).querySelector('app-statement-check'));
  const buttonIn = (el: Element, label: string) =>
    [...el.querySelectorAll('button')].find((b) => text(b) === label);

  it('shows every statement where it goes, with what its checks found', async () => {
    await load(resume());
    expect(text(page().querySelector('h1'))).toBe('Resume draft');
    expect(text()).toContain(
      'For Payments Engineer at Example Pay. Written by deepseek-flash on 5 Oct 2026',
    );
    expect(text()).toContain('from 4 facts, about $0.0012.');
    expect(text()).toContain(
      '7 statements: 5 in the document, 2 left out by the checks. 4 of those in the document are not your fact word for word.',
    );
    expect(headings()).toEqual(['Headline', 'Summary', 'Experience', 'Skills']);
    const links = [...page().querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual([`/jobs/${jobId}`, `/drafts/${draftId}/document`]);

    expect(check('Cut processing time by 45%.')).toContain(
      'Left out: “45%” is not in the facts it cites.',
    );
    expect(check('Led the platform team.')).toContain('Left out: It cites none of your facts.');
    expect(check(invoice.body)).toContain('In the document Your fact word for word.');
    const struck = [...page().querySelectorAll('.out')].map((el) => text(el));
    expect(struck).toEqual(['Cut processing time by 45%.', 'Led the platform team.']);

    const summary = item('Builds invoice APIs in Go.');
    expect(text(summary)).toContain('In DeepSeek’s words: read it against the facts it cites.');
    const restsOn = summary.querySelector('details')!;
    expect(text(restsOn)).toContain(role.body);
    expect(text(restsOn)).toContain('(fact version 1)');
    // How it differs from the cited fact it is closest to.
    expect(text(restsOn)).toContain('How it differs from the fact it is closest to:');
    expect([...restsOn.querySelectorAll('ins')].map((el) => text(el))).toEqual([
      'Builds',
      'APIs',
      '.',
    ]);
  });

  it('edits a statement, and shows the draft as the server checked it again', async () => {
    const draft = resume();
    await load(draft);
    const wrong = draft.statements[4]!;
    const row = item('Cut processing time by 45%.');
    buttonIn(row, 'Edit')!.click();
    await fixture.whenStable();
    const area = row.querySelector('textarea')!;
    expect(area.value).toBe('Cut processing time by 45%.');
    area.value = 'Cut processing time by about 30%.';
    area.dispatchEvent(new Event('input'));
    buttonIn(row, 'Save')!.click();
    const request = http.expectOne(`/api/drafts/${draftId}/statements/${wrong.id}`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      text: 'Cut processing time by about 30%.',
      included: true,
    });
    const edited = statement({
      ...wrong,
      text: 'Cut processing time by about 30%.',
      modelText: wrong.text,
      edited: true,
      problems: [],
    });
    request.flush({
      ...draft,
      statements: draft.statements.map((s) => (s.id === wrong.id ? edited : s)),
    });
    await fixture.whenStable();

    const fixed = item('Cut processing time by about 30%.');
    expect(fixed.querySelector('textarea')).toBeNull();
    expect(check('Cut processing time by about 30%.')).toContain(
      'In the document In your words: read it against the facts it cites.',
    );
    expect(text()).toContain(
      '5 of those in the document are not your fact word for word; you edited 1 statement.',
    );
    const changes = [...fixed.querySelectorAll('details')].at(-1)!;
    expect(text(changes.querySelector('summary'))).toBe('Your changes to DeepSeek’s text');
    expect([...changes.querySelectorAll('ins')].map((el) => text(el))).toEqual(['about 30']);
    expect([...changes.querySelectorAll('del')].map((el) => text(el))).toEqual(['45']);

    // Back to DeepSeek's text.
    buttonIn(fixed, 'Use DeepSeek’s text')!.click();
    const back = http.expectOne(`/api/drafts/${draftId}/statements/${wrong.id}`);
    expect(back.request.body).toEqual({ text: 'Cut processing time by 45%.', included: true });
    back.flush(draft);
    await fixture.whenStable();
    expect(buttonIn(item('Cut processing time by 45%.'), 'Use DeepSeek’s text')).toBeUndefined();
  });

  it('leaves a statement out and puts it back', async () => {
    const draft = resume();
    await load(draft);
    const kept = draft.statements[3]!;
    buttonIn(item(invoice.body), 'Leave out')!.click();
    const request = http.expectOne(`/api/drafts/${draftId}/statements/${kept.id}`);
    expect(request.request.body).toEqual({ text: invoice.body, included: false });
    const left = statement({ ...kept, included: false });
    request.flush({
      ...draft,
      statements: draft.statements.map((s) => (s.id === kept.id ? left : s)),
    });
    await fixture.whenStable();
    expect(check(invoice.body)).toContain(
      'Left out by you. It passes the checks; put it back to use it.',
    );
    expect(text()).toContain('4 in the document, 2 left out by the checks, 1 left out by you.');
    buttonIn(item(invoice.body), 'Put back')!.click();
    expect(http.expectOne(`/api/drafts/${draftId}/statements/${kept.id}`).request.body).toEqual({
      text: invoice.body,
      included: true,
    });
  });

  it('shows the server’s message when a change fails', async () => {
    const draft = resume();
    await load(draft);
    buttonIn(item(invoice.body), 'Leave out')!.click();
    http
      .expectOne(`/api/drafts/${draftId}/statements/${draft.statements[3]!.id}`)
      .flush({ message: 'There is no such draft.' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect(text(item(invoice.body).querySelector('[role=alert]'))).toBe('There is no such draft.');
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
