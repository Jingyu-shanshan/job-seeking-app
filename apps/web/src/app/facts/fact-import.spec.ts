import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Fact, PreviewFactsResponse, SaveFactCandidatesResponse } from '@jsa/shared';
import { FactImport } from './fact-import';

const candidate = (
  body = 'TypeScript 2021–2024',
  fields: Partial<PreviewFactsResponse['candidates'][number]> = {},
): PreviewFactsResponse['candidates'][number] => ({
  kind: 'skill',
  body,
  selected: true,
  duplicate: null,
  source: {
    type: 'pdf',
    fileName: 'sample.pdf',
    pages: [1],
    sha256: 'a'.repeat(64),
    edited: false,
  },
  ...fields,
});
const result: SaveFactCandidatesResponse = {
  added: 1,
  skipped: 0,
  cancelled: 0,
  duplicates: [],
  facts: [],
};

describe('Fact import review', () => {
  let fixture: ComponentFixture<FactImport>;
  let http: HttpTestingController;
  const page = () => fixture.nativeElement as HTMLElement;
  const text = () => page().textContent?.replace(/\s+/g, ' ') ?? '';
  const button = (label: string) =>
    [...page().querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;
  const rows = () => [...page().querySelectorAll('fieldset')];
  const areas = () => [...page().querySelectorAll<HTMLTextAreaElement>('fieldset textarea')];
  const boxes = () => [
    ...page().querySelectorAll<HTMLInputElement>('fieldset input[type=checkbox]'),
  ];
  const edit = async (area: HTMLTextAreaElement, value: string) => {
    area.value = value;
    area.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  async function preview(candidates = [candidate()], pages: PreviewFactsResponse['pages'] = []) {
    await edit(page().querySelector('textarea')!, '## Skills\n- TypeScript 2021–2024');
    button('Preview Markdown').click();
    http
      .expectOne('/api/facts/import/preview/markdown')
      .flush({ candidates, pages } satisfies PreviewFactsResponse);
    await fixture.whenStable();
  }
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FactImport],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(FactImport);
    fixture.componentRef.setInput('facts', []);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });
  afterEach(() => http.verify());

  it('previews without saving, shows page text and fingerprint, then saves corrected text and category', async () => {
    const saved = vi.fn();
    fixture.componentInstance.saved.subscribe(saved);
    await preview([candidate()], [{ page: 1, text: 'Skills\nTypeScript 2021–2024' }]);
    expect(text()).toContain('No candidates in this review have been saved.');
    expect(document.activeElement).toBe(page().querySelector('[role=status][tabindex="-1"]'));
    expect(text()).toContain('Check the page text');
    expect(text()).toContain('sample.pdf, page 1');
    expect(text()).toContain('a'.repeat(64));
    await edit(areas()[0]!, '  TypeScript 2021–2024\n30% faster.  ');
    const kind = rows()[0]!.querySelector('select')!;
    kind.value = 'project';
    kind.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(text()).toContain('User-corrected PDF extraction');
    button('Add selected to confirm').click();
    const request = http.expectOne('/api/facts/import/candidates');
    expect(request.request.body.candidates[0]).toEqual({
      ...candidate(),
      duplicate: undefined,
      kind: 'project',
      body: areas()[0]!.value,
      source: { ...candidate().source, edited: true },
    });
    request.flush(result);
    await fixture.whenStable();
    expect(saved).toHaveBeenCalledWith(result);
    expect(rows()).toHaveLength(0);
    expect(text()).not.toContain('Candidates are ready to review.');
  });

  it('uploads raw PDF regardless of its supplied MIME and blocks repeated reads', async () => {
    const file = new File(['%PDF-1.4 sample'], '履历.pdf', { type: 'text/plain' });
    const input = page().querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await Promise.resolve();
    const request = http.expectOne('/api/facts/import/preview/pdf?fileName=%E5%B1%A5%E5%8E%86.pdf');
    expect(request.request.body).toBe(file);
    expect(request.request.headers.get('Content-Type')).toBe('application/pdf');
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
    expect(input.disabled).toBe(true);
    expect(button('Preview Markdown').disabled).toBe(true);
    input.dispatchEvent(new Event('change'));
    http.expectNone('/api/facts/import/preview/pdf?fileName=%E5%B1%A5%E5%8E%86.pdf');
    request.flush({ candidates: [candidate()], pages: [] });
    await fixture.whenStable();
    expect(rows()).toHaveLength(1);
  });

  it('preserves text when splitting and merging and combines PDF page provenance', async () => {
    await preview([
      candidate('First\nSecond'),
      candidate('Third', { source: { ...candidate().source, type: 'pdf', pages: [2] } }),
    ]);
    areas()[0]!.setSelectionRange(6, 6);
    button('Split at cursor').click();
    await fixture.whenStable();
    expect(areas().map((a) => a.value)).toEqual(['First\n', 'Second', 'Third']);
    button('Merge with next').click();
    await fixture.whenStable();
    expect(areas().map((a) => a.value)).toEqual(['First\nSecond', 'Third']);
    areas()[0]!.setSelectionRange(6, 6);
    button('Split at cursor').click();
    await fixture.whenStable();
    const merge = [...page().querySelectorAll('button')].filter(
      (b) => b.textContent?.trim() === 'Merge with next',
    )[1]!;
    merge.click();
    await fixture.whenStable();
    expect(areas().map((a) => a.value)).toEqual(['First\n', 'Second\nThird']);
    button('Add selected to confirm').click();
    const request = http.expectOne('/api/facts/import/candidates');
    expect(request.request.body.candidates[1].source.pages).toEqual([1, 2]);
    expect(
      request.request.body.candidates.every(
        (c: { source: { edited: boolean } }) => c.source.edited,
      ),
    ).toBe(true);
    request.flush(result);
    await fixture.whenStable();
  });

  it('recomputes same-batch duplicates when the earlier candidate is deselected or text is corrected', async () => {
    await preview([
      candidate('Same'),
      candidate('Same', { selected: false, duplicate: { status: 'batch', factId: null } }),
    ]);
    expect(text()).toContain('1 selected · 1 duplicates to skip · 0 left out');
    boxes()[0]!.click();
    await fixture.whenStable();
    expect(text()).toContain('0 selected · 0 duplicates to skip · 2 left out');
    boxes()[1]!.click();
    await fixture.whenStable();
    expect(text()).toContain('1 selected · 0 duplicates to skip · 1 left out');
    await edit(areas()[0]!, 'Different');
    boxes()[0]!.click();
    await fixture.whenStable();
    expect(text()).toContain('2 selected · 0 duplicates to skip · 0 left out');
  });

  it('rejects blank and oversized selected text, but allows leaving invalid candidates out', async () => {
    await preview();
    await edit(areas()[0]!, ' ');
    expect(button('Add selected to confirm').disabled).toBe(true);
    await edit(areas()[0]!, 'x'.repeat(5001));
    expect(text()).toContain('at most 5000 characters');
    expect(button('Add selected to confirm').disabled).toBe(true);
    boxes()[0]!.click();
    await fixture.whenStable();
    expect(button('Add selected to confirm').disabled).toBe(false);
    button('Add selected to confirm').click();
    const request = http.expectOne('/api/facts/import/candidates');
    expect(request.request.body.candidates[0].selected).toBe(false);
    request.flush({ ...result, added: 0, cancelled: 1 });
    await fixture.whenStable();
  });

  it('keeps edits and selection after a save failure and retries the same review', async () => {
    await preview([candidate(), candidate('Second')]);
    await edit(areas()[0]!, 'Corrected Unicode 技能');
    boxes()[1]!.click();
    await fixture.whenStable();
    button('Add selected to confirm').click();
    const first = http.expectOne('/api/facts/import/candidates');
    const payload = first.request.body;
    first.flush({ message: 'Retry this save.' }, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(areas()[0]!.value).toBe('Corrected Unicode 技能');
    expect(boxes()[1]!.checked).toBe(false);
    expect(text()).toContain('Retry this save.');
    button('Add selected to confirm').click();
    const retry = http.expectOne('/api/facts/import/candidates');
    expect(retry.request.body).toEqual(payload);
    retry.flush({ ...result, cancelled: 1 });
    await fixture.whenStable();
  });

  it('offers a withdrawn duplicate view without restoring or saving it', async () => {
    const view = vi.fn();
    fixture.componentInstance.viewFact.subscribe(view);
    const id = '00000000-0000-4000-8000-000000000001';
    fixture.componentRef.setInput('facts', [
      { id, current: { body: 'Old skill', status: 'retired' } },
    ] as Fact[]);
    await preview([
      candidate('Old skill', { selected: false, duplicate: { status: 'retired', factId: id } }),
    ]);
    expect(text()).toContain('Already exists in withdrawn facts. Importing will not restore it.');
    button('View withdrawn fact / confirm again').click();
    expect(view).toHaveBeenCalledWith(id);
    http.expectNone('/api/facts/import/candidates');
    await edit(areas()[0]!, 'A different skill');
    expect(text()).not.toContain('Already exists in withdrawn facts.');
  });

  it('discards only the unsaved review and provides another input', async () => {
    await preview();
    await edit(areas()[0]!, 'Unsaved edit');
    button('Discard review / change file').click();
    await fixture.whenStable();
    expect(rows()).toHaveLength(0);
    expect(page().querySelector('input[type=file]')).not.toBeNull();
    expect(text()).toContain('Discarded the unsaved review. Saved facts were kept.');
    await preview([candidate('Another file')]);
    expect(areas()[0]!.value).toBe('Another file');
  });

  it('keeps the pasted input and makes read failures retryable', async () => {
    await edit(page().querySelector('textarea')!, 'Retry Markdown');
    button('Preview Markdown').click();
    http
      .expectOne('/api/facts/import/preview/markdown')
      .flush(
        { message: 'Choose a text PDF or paste Markdown.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    expect(rows()).toHaveLength(0);
    expect(page().querySelector('textarea')!.value).toBe('Retry Markdown');
    expect(text()).toContain('Choose a text PDF or paste Markdown.');
    button('Preview Markdown').click();
    http
      .expectOne('/api/facts/import/preview/markdown')
      .flush({ candidates: [candidate()], pages: [] });
    await fixture.whenStable();
    expect(rows()).toHaveLength(1);
  });
});
