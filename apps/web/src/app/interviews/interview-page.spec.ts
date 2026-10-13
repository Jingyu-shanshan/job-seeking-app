import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { InterviewState } from '@jsa/shared';
import { InterviewPage } from './interview-page';

const id = '00000000-0000-4000-8000-000000000001';
const fileId = '00000000-0000-4000-8000-000000000002';
const url = `/api/applications/${id}/interview`;
const initial: InterviewState = {
  applicationId: id,
  title: 'Backend engineer',
  cannotGenerate: null,
  omittedStatements: 1,
  sources: [
    { ref: 'J1', kind: 'job', text: 'Build APIs.', fileId: null, sha256: null, factVersionIds: [] },
  ],
  externalFiles: [
    {
      id: fileId,
      fileName: 'Resume as sent.pdf',
      sha256: 'ab'.repeat(32),
      text: 'Built an API',
      problem: null,
    },
  ],
  preparation: null,
};
const prepared: InterviewState = {
  ...initial,
  externalFiles: [],
  cannotGenerate: 'Already generated.',
  sources: [
    ...initial.sources,
    {
      ref: 'M1',
      kind: 'material',
      text: 'Built an API',
      fileId,
      sha256: 'ab'.repeat(32),
      factVersionIds: [],
    },
  ],
  preparation: {
    id,
    createdAt: '2026-10-13T09:00:00.000Z',
    model: 'fake-model',
    costUsd: 0.001,
    sources: [],
    notes: '',
    answer: {
      technical: [{ text: 'How would you design the API?', sources: ['J1'] }],
      projects: [{ text: 'What did you decide?', sources: ['M1'] }],
      interviewer: [{ text: 'What does success look like?', sources: ['J1'] }],
      stories: [
        {
          title: 'API project',
          situation: null,
          task: null,
          action: 'Built an API',
          result: null,
          missing: ['What changed?'],
          sources: ['M1'],
        },
      ],
    },
  },
};

describe('InterviewPage', () => {
  let fixture: ComponentFixture<InterviewPage>;
  let http: HttpTestingController;
  const page = () => fixture.nativeElement as HTMLElement;
  const text = () => page().textContent?.replace(/\s+/g, ' ') ?? '';
  const button = () => page().querySelector<HTMLButtonElement>('button')!;
  const load = async (state = initial) => {
    http.expectOne(url).flush(state);
    await fixture.whenStable();
  };
  const type = async (selector: string, value: string) => {
    const field = page().querySelector<HTMLTextAreaElement>(selector)!;
    field.value = value;
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [InterviewPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(InterviewPage);
    fixture.componentRef.setInput('id', id);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });
  afterEach(() => http.verify());

  it('needs explicit consent before sending an external excerpt; one request renders the four sections', async () => {
    await load();
    expect(text()).toContain('Model-generated practice');
    expect(text()).toContain('1 frozen statements were left out');
    expect(button().disabled).toBe(true);
    await type('#excerpt-0', 'Built an API');
    expect(button().disabled).toBe(true);
    const checkbox = page().querySelector<HTMLInputElement>('input[type=checkbox]')!;
    checkbox.click();
    await fixture.whenStable();
    expect(button().disabled).toBe(false);
    button().click();
    button().click();
    const request = http.expectOne(url);
    expect(request.request.method).toBe('POST');
    expect(JSON.parse(request.request.serializeBody() as string)).toEqual({
      excerpts: [{ fileId, text: 'Built an API' }],
      allowExcerpts: true,
    });
    request.flush(prepared);
    await fixture.whenStable();
    for (const heading of [
      'Technical practice',
      'Project follow-ups',
      'Questions for the interviewer',
      'STAR drafts — to confirm',
    ])
      expect(text()).toContain(heading);
    expect(text()).toContain('Add the actual outcome.');
    expect(text()).toContain('What changed?');
    expect(page().querySelector('a[href="#source-M1"]')).not.toBeNull();
    expect(text()).not.toContain('Generate interview practice');
  });

  it('saves private notes without promoting them, and retains edits on a failed save', async () => {
    await load(prepared);
    await type('#practice-notes', 'My result, still to confirm');
    button().click();
    const failed = http.expectOne(`${url}/notes`);
    expect(failed.request.method).toBe('PUT');
    expect(failed.request.body).toEqual({ notes: 'My result, still to confirm' });
    failed.flush({ message: 'Try again.' }, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(page().querySelector<HTMLTextAreaElement>('#practice-notes')!.value).toBe(
      'My result, still to confirm',
    );
    expect(page().querySelector('[role=alert]')?.textContent).toContain('Try again.');
    button().click();
    http.expectOne(`${url}/notes`).flush({
      ...prepared,
      preparation: { ...prepared.preparation!, notes: 'My result, still to confirm' },
    });
    await fixture.whenStable();
    expect(text()).toContain('Notes saved.');
    expect(button().disabled).toBe(true);
  });

  it('shows a generation failure and allows a retry without losing the selected text', async () => {
    await load({ ...initial, sources: prepared.sources, externalFiles: [] });
    button().click();
    http
      .expectOne(url)
      .flush({ message: 'Invalid references.' }, { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();
    expect(text()).toContain('Invalid references.');
    expect(button().disabled).toBe(false);
  });

  it('does not replace another application with a generation response that arrived late', async () => {
    await load({ ...initial, sources: prepared.sources, externalFiles: [] });
    button().click();
    const pending = http.expectOne(url);
    fixture.componentRef.setInput('id', fileId);
    fixture.detectChanges();
    http.expectOne(`/api/applications/${fileId}/interview`).flush({
      ...initial,
      applicationId: fileId,
      title: 'Another application',
      cannotGenerate: 'Confirm it first.',
    });
    pending.flush(prepared);
    await fixture.whenStable();
    expect(text()).toContain('Another application');
    expect(text()).not.toContain('STAR drafts');
  });

  it('gates unknown submission results', async () => {
    await load({ ...initial, cannotGenerate: 'Confirm that it went through.' });
    expect(text()).toContain('Confirm that it went through.');
    expect(page().querySelector('textarea')).toBeNull();
  });
});
