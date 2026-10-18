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
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };
  const load = async (state = initial) => {
    http.expectOne(url).flush(state);
    await settle();
  };
  const type = async (selector: string, value: string) => {
    const field = page().querySelector<HTMLTextAreaElement>(selector)!;
    field.value = value;
    field.dispatchEvent(new Event('input'));
    await settle();
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
    await settle();
    expect(button().disabled).toBe(false);
    button().click();
    button().click();
    TestBed.tick();
    expect(text()).toContain('DeepSeek is preparing your practice');
    expect(page().querySelector('fieldset')!.disabled).toBe(true);
    const request = http.expectOne(url);
    expect(request.request.method).toBe('POST');
    expect(JSON.parse(request.request.serializeBody() as string)).toEqual({
      excerpts: [{ fileId, text: 'Built an API' }],
      allowExcerpts: true,
    });
    request.flush(prepared);
    await settle();
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
    expect(text()).toContain('No unsaved changes.');
    await type('#practice-notes', 'My result, still to confirm');
    expect(text()).toContain('Unsaved changes.');
    button().click();
    button().click();
    TestBed.tick();
    expect(text()).toContain('Saving practice notes…');
    expect(page().querySelector<HTMLTextAreaElement>('#practice-notes')!.readOnly).toBe(true);
    const failed = http.expectOne(`${url}/notes`);
    expect(failed.request.method).toBe('PUT');
    expect(failed.request.body).toEqual({ notes: 'My result, still to confirm' });
    failed.flush({ message: 'Try again.' }, { status: 503, statusText: 'Unavailable' });
    await settle();
    expect(page().querySelector<HTMLTextAreaElement>('#practice-notes')!.value).toBe(
      'My result, still to confirm',
    );
    expect(page().querySelector('[role=alert]')?.textContent).toContain('Try again.');
    button().click();
    http.expectOne(`${url}/notes`).flush({
      ...prepared,
      preparation: { ...prepared.preparation!, notes: 'My result, still to confirm' },
    });
    await settle();
    expect(text()).toContain('Notes saved.');
    expect(button().disabled).toBe(true);
    await type('#practice-notes', 'Another detail to confirm');
    expect(text()).toContain('Unsaved changes.');
    expect(text()).not.toContain('Notes saved.');
    expect(button().disabled).toBe(false);
  });

  it('shows a generation failure and allows a retry without losing the selected text', async () => {
    await load();
    await type('#excerpt-0', 'Built an API');
    page().querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    await settle();
    button().click();
    http
      .expectOne(url)
      .flush({ message: 'Invalid references.' }, { status: 502, statusText: 'Bad Gateway' });
    await settle();
    expect(text()).toContain('Invalid references.');
    expect(text()).toContain('retry makes another paid request');
    expect(page().querySelector<HTMLTextAreaElement>('#excerpt-0')!.value).toBe('Built an API');
    expect(page().querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true);
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
    await settle();
    expect(text()).toContain('Another application');
    expect(text()).not.toContain('STAR drafts');
  });

  it('gates unknown submission results', async () => {
    await load({ ...initial, cannotGenerate: 'Confirm that it went through.' });
    expect(text()).toContain('Confirm that it went through.');
    expect(page().querySelector('textarea')).toBeNull();
    expect(page().querySelector('button')).toBeNull();
    expect(text()).toContain('only for an application recorded as Applied');
  });

  it('previews frozen sources before the generation action and explains withheld material', async () => {
    await load();
    const source = page().querySelector('#sources-heading')!;
    expect(
      source.compareDocumentPosition(button()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(text()).toContain('historical application record stays unchanged');
    expect(text()).toContain('No permitted sent-material text is available');
    await type('#excerpt-0', 'Built an API');
    expect(text()).toContain('Allow the selected excerpts before generating');
    expect(page().querySelector('#practice-notes')).toBeNull();
  });

  it('shows external PDF extraction failures without offering text selection for that file', async () => {
    await load({
      ...initial,
      externalFiles: [{ ...initial.externalFiles[0], text: '', problem: 'No text layer found.' }],
    });
    expect(text()).toContain('No text layer found.');
    expect(page().querySelector('#excerpt-0')).toBeNull();
    expect(button().disabled).toBe(true);
  });

  it('explains the notes limit and blocks an invalid save', async () => {
    await load(prepared);
    await type('#practice-notes', 'x'.repeat(12001));
    expect(text()).toContain('Keep your notes within 12,000 characters');
    expect(button().disabled).toBe(true);
    http.expectNone(`${url}/notes`);
  });

  it('retries loading without generating practice', async () => {
    expect(text()).toContain('Loading interview preparation');
    http
      .expectOne(url)
      .flush({ message: 'Sample unavailable.' }, { status: 503, statusText: 'Unavailable' });
    await settle();
    expect(text()).toContain('Sample unavailable.');
    button().click();
    TestBed.tick();
    await load();
    expect(text()).toContain('Text selected from the frozen application');
  });

  it.each([false, true])(
    'ignores a late notes response (failed: %s) after switching applications',
    async (failed) => {
      await load(prepared);
      await type('#practice-notes', 'Notes for the first application');
      button().click();
      const pending = http.expectOne(`${url}/notes`);
      fixture.componentRef.setInput('id', fileId);
      TestBed.tick();
      http.expectOne(`/api/applications/${fileId}/interview`).flush({
        ...prepared,
        applicationId: fileId,
        title: 'Another application',
        preparation: { ...prepared.preparation!, notes: 'Another application’s notes' },
      });
      await settle();
      await type('#practice-notes', 'Updated second notes');
      button().click();
      const current = http.expectOne(`/api/applications/${fileId}/interview/notes`);
      if (failed) {
        pending.flush(
          { message: 'First save failed.' },
          { status: 503, statusText: 'Unavailable' },
        );
      } else {
        pending.flush({
          ...prepared,
          preparation: { ...prepared.preparation!, notes: 'First saved' },
        });
      }
      await settle();
      expect(text()).toContain('Another application');
      expect(text()).toContain('Saving practice notes…');
      expect(text()).not.toContain('First save failed');
      expect(text()).not.toContain('Notes saved.');
      expect(button().disabled).toBe(true);
      expect(page().querySelector<HTMLTextAreaElement>('#practice-notes')!.value).toBe(
        'Updated second notes',
      );
      current.flush({
        ...prepared,
        applicationId: fileId,
        title: 'Another application',
        preparation: { ...prepared.preparation!, notes: 'Updated second notes' },
      });
      await settle();
      expect(text()).toContain('Notes saved.');
    },
  );

  it('resets external excerpt consent and errors when switching applications', async () => {
    await load();
    await type('#excerpt-0', 'Built an API');
    page().querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    await settle();
    button().click();
    const pending = http.expectOne(url);
    fixture.componentRef.setInput('id', fileId);
    TestBed.tick();
    http
      .expectOne(`/api/applications/${fileId}/interview`)
      .flush({ ...initial, applicationId: fileId });
    pending.flush(
      { message: 'Old generation failed.' },
      { status: 503, statusText: 'Unavailable' },
    );
    await settle();
    expect(page().querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
    expect(page().querySelector<HTMLTextAreaElement>('#excerpt-0')!.value).toBe('');
    expect(text()).not.toContain('Old generation failed.');
    expect(button().disabled).toBe(true);
  });

  it('ignores an earlier save after leaving and returning to the same application', async () => {
    await load(prepared);
    await type('#practice-notes', 'First save');
    button().click();
    const pending = http.expectOne(`${url}/notes`);
    fixture.componentRef.setInput('id', fileId);
    TestBed.tick();
    http
      .expectOne(`/api/applications/${fileId}/interview`)
      .flush({ ...initial, applicationId: fileId });
    await settle();
    fixture.componentRef.setInput('id', id);
    TestBed.tick();
    await load(prepared);
    await type('#practice-notes', 'New unsaved notes');
    pending.flush({ ...prepared, preparation: { ...prepared.preparation!, notes: 'First save' } });
    await settle();
    expect(page().querySelector<HTMLTextAreaElement>('#practice-notes')!.value).toBe(
      'New unsaved notes',
    );
    expect(text()).toContain('Unsaved changes.');
    expect(text()).not.toContain('Notes saved.');
  });
});
