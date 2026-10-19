import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type {
  Fact,
  FactsResponse,
  PreviewFactsResponse,
  SaveFactCandidatesResponse,
} from '@jsa/shared';
import { Facts } from './facts';
import { kindLabels } from './facts-api';

let nextId = 1;
const id = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;

const fact = (fields: Partial<Fact> = {}, current: Partial<Fact['current']> = {}): Fact => ({
  id: id(),
  kind: 'skill',
  createdAt: '2026-10-02T08:00:00.000Z',
  current: {
    id: id(),
    version: 1,
    body: 'TypeScript',
    source: 'manual',
    status: 'proposed',
    maySendToModel: false,
    mayUseInMaterials: false,
    createdAt: '2026-10-02T08:00:00.000Z',
    ...current,
  },
  earlier: [],
  sendableToModel: false,
  usableInMaterials: false,
  sensitive: [],
  ...fields,
});

async function settle() {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
}

describe('Facts', () => {
  let fixture: ComponentFixture<Facts>;
  let http: HttpTestingController;

  const page = () => fixture.nativeElement as HTMLElement;
  const text = (el: Element | null = page()) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const button = (label: string, within: Element = page()) =>
    [...within.querySelectorAll('button')].find((b) => text(b) === label);
  const headings = () => [...page().querySelectorAll('section h2')].map((h) => text(h));
  const activeCards = () => [...page().querySelectorAll('section app-fact-card')];
  const withdrawn = () => page().querySelector<HTMLDetailsElement>('details.withdrawn')!;

  async function filter(label: string, value: string) {
    const select = [...page().querySelectorAll<HTMLSelectElement>('.filters select')].find((s) =>
      text(s.parentElement).startsWith(label),
    )!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  }

  async function load(facts: Fact[]) {
    http.expectOne('/api/facts').flush({ facts } satisfies FactsResponse);
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Facts],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(Facts);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('shows a failed load and retries without reading the failed resource value', async () => {
    http
      .expectOne('/api/facts')
      .flush({ message: 'Offline' }, { status: 503, statusText: 'Offline' });
    await fixture.whenStable();
    expect(text(page().querySelector('[role=alert]'))).toContain('Offline');

    button('Try again')!.click();
    await settle();
    await load([fact()]);

    expect(activeCards()).toHaveLength(1);
    expect(page().querySelector('[role=alert]')).toBeNull();
  });

  it('keeps a failed new fact and retries the same text', async () => {
    await load([]);
    page().querySelector<HTMLDetailsElement>('details')!.open = true;
    const input = page().querySelector<HTMLTextAreaElement>('form textarea')!;
    input.value = 'TypeScript';
    input.dispatchEvent(new Event('input'));
    button('Add')!.click();
    await settle();
    http
      .expectOne('/api/facts')
      .flush({ message: 'Offline' }, { status: 503, statusText: 'Offline' });
    await settle();
    expect(input.value).toBe('TypeScript');
    expect(text(page().querySelector('[role=alert]'))).toContain('Offline');

    button('Add')!.click();
    await settle();
    http.expectOne('/api/facts').flush(fact());
    await settle();

    expect(activeCards()).toHaveLength(1);
    expect(input.value).toBe('');
    expect(page().querySelector('[role=alert]')).toBeNull();
  });

  it('reloads the list when adding a fact after its initial load failed', async () => {
    http.expectOne('/api/facts').flush({}, { status: 503, statusText: 'Offline' });
    await settle();
    page().querySelector<HTMLDetailsElement>('details')!.open = true;
    const input = page().querySelector<HTMLTextAreaElement>('form textarea')!;
    input.value = 'TypeScript';
    input.dispatchEvent(new Event('input'));
    button('Add')!.click();
    await settle();
    const added = fact();
    http.expectOne('/api/facts').flush(added);
    await settle();
    await load([added]);

    expect(activeCards()).toHaveLength(1);
    expect(page().querySelector('[role=alert]')).toBeNull();
  });

  it('groups by current status before kind and explains eligibility and sensitive content', async () => {
    const confirmed = fact(
      { kind: 'experience', usableInMaterials: true },
      { body: 'Acme Oy, backend developer', status: 'confirmed', mayUseInMaterials: true },
    );
    const contact = fact(
      { kind: 'other', sensitive: ['an email address'] },
      { body: 'me@example.com' },
    );
    await load([confirmed, fact(), contact]);

    expect(headings()).toEqual(['To confirm (2)', 'Confirmed (1)']);
    expect([...page().querySelectorAll('section h3')].map((h) => text(h))).toEqual([
      'Skills (1)',
      'Other (1)',
      'Work experience (1)',
    ]);
    expect(text()).toContain(
      'Showing 3 of 3 active facts: 2 to confirm, 1 usable in materials. 0 withdrawn.',
    );
    const cards = page().querySelectorAll('app-fact-card');
    expect(text(cards[2]!)).toContain('Usable in materials: yes · Allowed for DeepSeek: no');
    expect(text(cards[1]!)).toContain(
      'It contains an email address, so it never goes to DeepSeek.',
    );
    expect(cards[1]!.querySelector<HTMLInputElement>('input[type=checkbox]')!.disabled).toBe(true);
    expect(text()).toContain('confirmed and its materials permission is on');
    expect(text()).not.toContain('Sent to DeepSeek:');
    expect(text()).not.toContain('Used in materials:');
  });

  it('confirms a fact and shows the new state', async () => {
    const proposed = fact();
    await load([proposed]);
    button('Confirm')!.click();
    const request = http.expectOne(`/api/fact-versions/${proposed.current.id}`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ status: 'confirmed' });
    request.flush(fact({ id: proposed.id }, { ...proposed.current, status: 'confirmed' }));
    await settle();
    expect(text(page().querySelector('app-fact-card'))).toContain('Confirmed Version 1');
    expect(button('Confirm')).toBeUndefined();
  });

  it('edits a fact into a new version', async () => {
    const original = fact({}, { status: 'confirmed' });
    await load([original]);
    button('Edit')!.click();
    await fixture.whenStable();
    const area = page().querySelector<HTMLTextAreaElement>('app-fact-card textarea')!;
    expect(area.value).toBe('TypeScript');
    area.value = 'TypeScript and Node.js';
    area.dispatchEvent(new Event('input'));
    button('Save')!.click();
    const request = http.expectOne(`/api/facts/${original.id}/versions`);
    expect(request.request.body).toEqual({ body: 'TypeScript and Node.js' });
    request.flush(
      fact(
        { id: original.id, earlier: [original.current] },
        { version: 2, body: 'TypeScript and Node.js', status: 'proposed' },
      ),
    );
    await settle();
    const card = text(page().querySelector('app-fact-card'));
    expect(card).toContain('To confirm Version 2');
    expect(card).toContain('Earlier versions (1)');
  });

  it('imports Markdown and reports what was added', async () => {
    await load([]);
    expect(text()).toContain('No facts yet.');
    const area = [...page().querySelectorAll('textarea')].at(-1)!;
    area.value = '## Skills\n- PostgreSQL';
    area.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    button('Preview Markdown')!.click();
    const request = http.expectOne('/api/facts/import/preview/markdown');
    expect(request.request.body).toEqual({ markdown: '## Skills\n- PostgreSQL', fileName: '' });
    request.flush({
      pages: [],
      candidates: [
        {
          kind: 'skill',
          body: 'PostgreSQL',
          selected: true,
          duplicate: null,
          source: { type: 'markdown', fileName: '', sha256: 'a'.repeat(64), edited: false },
        },
      ],
    } satisfies PreviewFactsResponse);
    await settle();
    expect(activeCards()).toHaveLength(0);
    button('Add selected to confirm')!.click();
    http.expectOne('/api/facts/import/candidates').flush({
      added: 1,
      skipped: 0,
      cancelled: 0,
      duplicates: [],
      facts: [fact({}, { body: 'PostgreSQL', source: 'markdown' })],
    } satisfies SaveFactCandidatesResponse);
    await settle();
    expect(text()).toContain('Added 1 facts to confirm; skipped 0 duplicates; left out 0.');
    expect(headings()).toEqual(['To confirm (1)']);
  });

  it('keeps withdrawn current versions of every kind only in the last, initially closed section', async () => {
    const retired = Object.keys(kindLabels).map((kind) =>
      fact({ kind: kind as Fact['kind'] }, { status: 'retired', body: `Old ${kind}` }),
    );
    const earlier = fact({}, { status: 'retired' }).current;
    const current = fact({ earlier: [earlier] }, { body: 'Current skill', status: 'confirmed' });
    await load([...retired, current]);
    expect(withdrawn().open).toBe(false);
    expect(withdrawn().querySelectorAll('app-fact-card')).toHaveLength(8);
    expect(activeCards()).toHaveLength(1);
    expect(text(activeCards()[0]!)).toContain('Current skill');
    expect(text(withdrawn().querySelector('summary'))).toBe('Withdrawn (8)');
    expect(withdrawn()).toBe(page().lastElementChild);
    expect(text()).toContain(
      'Showing 1 of 1 active facts: 0 to confirm, 0 usable in materials. 8 withdrawn.',
    );
  });

  it('sorts within each status and kind by fact creation time, then ID, including after reload', async () => {
    const first = fact({}, { body: 'First skill' });
    const second = fact({}, { body: 'Second skill' });
    const newer = fact({ createdAt: '2026-10-03T08:00:00.000Z' }, { body: 'Newer skill' });
    const experience = fact({ kind: 'experience' }, { body: 'Experience' });
    const confirmed = fact({}, { body: 'Confirmed skill', status: 'confirmed' });
    const facts = [confirmed, newer, second, experience, first];
    await load(facts);
    const bodies = () => activeCards().map((c) => text(c.querySelector('.body')));
    expect(bodies()).toEqual([
      'Experience',
      'First skill',
      'Second skill',
      'Newer skill',
      'Confirmed skill',
    ]);
    fixture.destroy();
    fixture = TestBed.createComponent(Facts);
    TestBed.tick();
    await load([...facts].reverse());
    expect(bodies()).toEqual([
      'Experience',
      'First skill',
      'Second skill',
      'Newer skill',
      'Confirmed skill',
    ]);
  });

  it('filters active status and kind, updates counts, and leaves withdrawn independent', async () => {
    await load([
      fact(),
      fact({ kind: 'experience' }),
      fact({ usableInMaterials: true }, { status: 'confirmed', mayUseInMaterials: true }),
      fact({}, { status: 'confirmed' }),
      fact({ kind: 'experience' }, { status: 'retired' }),
    ]);
    await filter('Kind', 'skill');
    expect(text()).toContain(
      'Showing 3 of 4 active facts: 1 to confirm, 1 usable in materials. 1 withdrawn.',
    );
    await filter('Status', 'confirmed');
    expect(headings()).toEqual(['Confirmed (2)']);
    expect(text()).toContain('Showing 2 of 4 active facts: 0 to confirm, 1 usable in materials.');
    await filter('Status', 'proposed');
    expect(headings()).toEqual(['To confirm (1)']);
    await filter('Kind', 'education');
    expect(activeCards()).toHaveLength(0);
    expect(text()).toContain('No active facts match these filters.');
    expect(withdrawn().querySelectorAll('app-fact-card')).toHaveLength(1);
    button('Clear filters')!.click();
    await fixture.whenStable();
    expect(activeCards()).toHaveLength(4);
  });

  it.each(['empty', 'withdrawn', 'proposed'] as const)(
    'handles an entirely %s list',
    async (state) => {
      await load(
        state === 'empty'
          ? []
          : [fact({}, { status: state === 'withdrawn' ? 'retired' : 'proposed' })],
      );
      if (state === 'empty') expect(text()).toContain('No facts yet.');
      if (state === 'withdrawn') {
        expect(text()).toContain('No active facts. Your withdrawn facts are kept below.');
        expect(activeCards()).toHaveLength(0);
      }
      if (state === 'proposed') expect(headings()).toEqual(['To confirm (1)']);
      expect(withdrawn().open).toBe(false);
    },
  );

  it('moves a withdrawn fact immediately and focuses the announced result', async () => {
    const original = fact({ kind: 'experience' }, { status: 'confirmed' });
    await load([original, fact()]);
    const withdraw = button('Withdraw', activeCards()[1]!)!;
    withdraw.focus();
    withdraw.click();
    http.expectOne(`/api/fact-versions/${original.current.id}`).flush({
      ...original,
      current: { ...original.current, status: 'retired' },
    } satisfies Fact);
    await settle();
    expect(activeCards()).toHaveLength(1);
    expect(withdrawn().querySelectorAll('app-fact-card')).toHaveLength(1);
    expect(withdrawn().open).toBe(false);
    const feedback = page().querySelector('[role=status][tabindex="-1"]')!;
    expect(text(feedback)).toBe(
      'Withdrawn. Future matches and materials will no longer use this fact.',
    );
    expect(document.activeElement).toBe(feedback);
  });

  it('keeps a failed withdrawal in place with a retryable error', async () => {
    const original = fact();
    await load([original]);
    button('Withdraw')!.click();
    http
      .expectOne(`/api/fact-versions/${original.current.id}`)
      .flush({ message: 'Try again.' }, { status: 503, statusText: 'Unavailable' });
    await settle();
    expect(activeCards()).toHaveLength(1);
    expect(text(withdrawn().querySelector('summary'))).toBe('Withdrawn (0)');
    expect(text(page().querySelector('[role=alert]'))).toBe('Try again.');
    expect(button('Withdraw')!.disabled).toBe(false);
    button('Withdraw')!.click();
    http.expectOne(`/api/fact-versions/${original.current.id}`).flush({
      ...original,
      current: { ...original.current, status: 'retired' },
    } satisfies Fact);
    await settle();
    expect(activeCards()).toHaveLength(0);
  });

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    'shows retained permissions before restoring (DeepSeek %s, materials %s)',
    async (maySendToModel, mayUseInMaterials) => {
      const original = fact(
        { kind: 'education' },
        { status: 'retired', maySendToModel, mayUseInMaterials },
      );
      await load([original, fact()]);
      withdrawn().open = true;
      const card = withdrawn().querySelector('app-fact-card')!;
      expect(text(card)).toContain(`DeepSeek: ${maySendToModel ? 'allowed' : 'not allowed'}`);
      expect(text(card)).toContain(`Materials: ${mayUseInMaterials ? 'allowed' : 'not allowed'}`);
      expect(text(card)).toContain(
        'Confirming again keeps these choices and re-enables the allowed uses.',
      );
      expect(card.querySelectorAll('input[type=checkbox]')).toHaveLength(0);
      button('Confirm again', card)!.click();
      const request = http.expectOne(`/api/fact-versions/${original.current.id}`);
      expect(request.request.body).toEqual({ status: 'confirmed' });
      request.flush({
        ...original,
        current: { ...original.current, status: 'confirmed' },
        usableInMaterials: mayUseInMaterials,
        sendableToModel: maySendToModel,
      } satisfies Fact);
      await settle();
      expect(withdrawn().querySelectorAll('app-fact-card')).toHaveLength(0);
      expect(headings()).toEqual(['To confirm (1)', 'Confirmed (1)']);
      const restored = activeCards()[1]!;
      const permissions = restored.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
      expect([...permissions].map((p) => p.checked)).toEqual([maySendToModel, mayUseInMaterials]);
    },
  );

  it('keeps failed restoration withdrawn and keeps the retained permissions visible', async () => {
    const original = fact({}, { status: 'retired', mayUseInMaterials: true });
    await load([original]);
    withdrawn().open = true;
    button('Confirm again')!.click();
    http
      .expectOne(`/api/fact-versions/${original.current.id}`)
      .flush({ message: 'Try again.' }, { status: 503, statusText: 'Unavailable' });
    await settle();
    expect(activeCards()).toHaveLength(0);
    expect(text(withdrawn())).toContain('Materials: allowed');
    expect(text(withdrawn().querySelector('[role=alert]'))).toBe('Try again.');
    expect(button('Confirm again')!.disabled).toBe(false);
  });

  it('edits a withdrawn fact into the pending section with permissions off and history intact', async () => {
    const original = fact(
      {},
      { status: 'retired', maySendToModel: true, mayUseInMaterials: true, source: 'markdown' },
    );
    await load([original]);
    await filter('Status', 'confirmed');
    await filter('Kind', 'education');
    withdrawn().open = true;
    button('Edit', withdrawn())!.click();
    await fixture.whenStable();
    const area = withdrawn().querySelector<HTMLTextAreaElement>('textarea')!;
    area.value = 'TypeScript and Node.js';
    area.dispatchEvent(new Event('input'));
    button('Save', withdrawn())!.click();
    http
      .expectOne(`/api/facts/${original.id}/versions`)
      .flush(
        fact({ id: original.id, earlier: [original.current] }, { version: 2, body: area.value }),
      );
    await settle();
    expect(headings()).toEqual(['To confirm (1)']);
    expect(withdrawn().querySelectorAll('app-fact-card')).toHaveLength(0);
    const card = activeCards()[0]!;
    expect(
      [...card.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].every((b) => !b.checked),
    ).toBe(true);
    expect(text(card)).toContain(
      'Version 1, 2 Oct 2026, withdrawn: TypeScript · Source: Markdown import',
    );
    expect(text(card)).toContain('Source: Manual entry');
    expect(text(card)).toContain('Usable in materials: no · Allowed for DeepSeek: no');
    expect(text(page().querySelector('[role=status][tabindex="-1"]'))).toContain(
      'Saved a new version to confirm. Both permissions are off',
    );
  });

  it('updates independent permissions and restores a failed checkbox change', async () => {
    const original = fact({}, { status: 'confirmed' });
    await load([original]);
    const card = activeCards()[0]!;
    card.querySelector('details')!.open = true;
    const [model, materials] = card.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    materials!.click();
    const request = http.expectOne(`/api/fact-versions/${original.current.id}`);
    expect(request.request.body).toEqual({ mayUseInMaterials: true });
    request.flush({
      ...original,
      current: { ...original.current, mayUseInMaterials: true },
      usableInMaterials: true,
    } satisfies Fact);
    await settle();
    expect(model!.checked).toBe(false);
    expect(text(card)).toContain('Usable in materials: yes · Allowed for DeepSeek: no');
    model!.click();
    http
      .expectOne(`/api/fact-versions/${original.current.id}`)
      .flush({ message: 'Try again.' }, { status: 503, statusText: 'Unavailable' });
    await settle();
    expect(model!.checked).toBe(false);
    expect(materials!.checked).toBe(true);
    expect(text(card.querySelector('[role=alert]'))).toBe('Try again.');
  });
});
