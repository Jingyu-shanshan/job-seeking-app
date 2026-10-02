import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Fact, FactsResponse, ImportFactsResponse } from '@jsa/shared';
import { Facts } from './facts';

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

  it('groups facts by kind and says which ones can be used', async () => {
    const confirmed = fact(
      { kind: 'experience', usableInMaterials: true },
      { body: 'Acme Oy, backend developer', status: 'confirmed', mayUseInMaterials: true },
    );
    const contact = fact(
      { kind: 'other', sensitive: ['an email address'] },
      { body: 'me@example.com' },
    );
    await load([confirmed, fact(), contact]);

    expect(headings()).toEqual(['Work experience (1)', 'Skills (1)', 'Other (1)']);
    expect(text()).toContain('3 facts: 2 to confirm, 1 usable in materials.');
    const cards = page().querySelectorAll('app-fact-card');
    expect(text(cards[0]!)).toContain('Used in materials: yes · Sent to DeepSeek: no');
    expect(text(cards[2]!)).toContain(
      'It contains an email address, so it never goes to DeepSeek.',
    );
    expect(cards[2]!.querySelector<HTMLInputElement>('input[type=checkbox]')!.disabled).toBe(true);
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
    button('Import')!.click();
    const request = http.expectOne('/api/facts/import');
    expect(request.request.body).toEqual({ markdown: '## Skills\n- PostgreSQL' });
    request.flush({
      added: 1,
      skipped: 0,
      facts: [fact({}, { body: 'PostgreSQL', source: 'markdown' })],
    } satisfies ImportFactsResponse);
    await settle();
    expect(text()).toContain('Added 1 facts to confirm; skipped 0 you already had.');
    expect(headings()).toEqual(['Skills (1)']);
  });
});
