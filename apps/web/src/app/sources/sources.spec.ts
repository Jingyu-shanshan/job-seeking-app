import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CatalogEntry, Source, SourcesResponse } from '@jsa/shared';
import { Sources } from './sources';

const board: CatalogEntry = {
  id: 'some_board',
  name: 'Some job boards',
  access: 'board_api',
  note: 'Reads public job boards.',
  terms: { checkedOn: '2026-10-01', url: 'https://example.com/terms' },
  rateLimit: { requests: 1, perSeconds: 2 },
  param: { label: 'Board name', hint: 'The last part of the address.', pattern: '^[a-z]+$' },
};

const alert: CatalogEntry = {
  id: 'some_alert',
  name: 'Some job alerts',
  access: 'email_alert',
  note: 'Its terms forbid automated access.',
  terms: { checkedOn: '2026-10-01', url: 'https://example.com/user-agreement' },
  rateLimit: null,
  param: null,
};

const paste: CatalogEntry = {
  id: 'paste',
  name: 'Paste a job',
  access: 'manual',
  note: 'Any site.',
  terms: null,
  rateLimit: null,
  param: null,
};

const source = (fields: Partial<Source>): Source => ({
  id: '00000000-0000-4000-8000-000000000001',
  catalogId: 'some_board',
  param: 'acme',
  enabled: true,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastFailureReason: null,
  ...fields,
});

/**
 * Lets a finished request's promise chain run and Angular render. Unlike `whenStable()`, it does
 * not wait for requests that are still open, such as the reload after a change.
 */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
}

describe('Sources', () => {
  let fixture: ComponentFixture<Sources>;
  let http: HttpTestingController;

  const page = () => fixture.nativeElement as HTMLElement;
  const text = () => page().textContent?.replace(/\s+/g, ' ') ?? '';
  const card = (name: string) =>
    [...page().querySelectorAll('app-catalog-entry')].find((el) =>
      el.querySelector('h4')?.textContent?.includes(name),
    ) as HTMLElement;

  async function load(sources: Source[] = []) {
    http.expectOne('/api/search-scope').flush({ area: 'helsinki', includeRemote: false });
    http
      .expectOne('/api/sources')
      .flush({ catalog: [board, alert, paste], sources } satisfies SourcesResponse);
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Sources],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(Sources);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('groups the catalog by access method and says how each entry is used', async () => {
    await load();

    const headings = [...page().querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings).toEqual(['Company job boards', 'Job-alert emails', 'Any other site']);

    const boardCard = card('Some job boards');
    expect(boardCard.textContent).toContain('Public job board API');
    expect(boardCard.textContent).toContain('At most one request every 2 seconds.');
    expect(boardCard.querySelector('a')?.getAttribute('href')).toBe('https://example.com/terms');

    const alertCard = card('Some job alerts');
    expect(alertCard.textContent).toContain('Job-alert emails you import');
    expect(alertCard.textContent).toContain('Its terms forbid automated access.');
    expect(alertCard.textContent).toContain('The app never requests this site.');

    expect(card('Paste a job').textContent).toContain('Always available.');
  });

  it('shows when each source last succeeded and why it failed since', async () => {
    await load([
      source({ param: 'fine', lastSuccessAt: '2026-10-01T08:00:00.000Z' }),
      source({
        id: '00000000-0000-4000-8000-000000000002',
        param: 'broken',
        lastSuccessAt: '2026-09-30T08:00:00.000Z',
        lastFailureAt: '2026-10-01T08:00:00.000Z',
        lastFailureReason: 'HTTP 404',
      }),
      source({ id: '00000000-0000-4000-8000-000000000003', param: 'fresh' }),
    ]);

    const items = [...card('Some job boards').querySelectorAll('li')].map((li) =>
      li.textContent?.replace(/\s+/g, ' '),
    );
    expect(items[0]).toMatch(/fine.*Last success 1 Oct 2026/);
    expect(items[0]).not.toContain('Failed');
    expect(items[1]).toMatch(
      /broken.*Last success 30 Sept? 2026.*Failed 1 Oct 2026, \d\d:00: HTTP 404/,
    );
    expect(items[2]).toMatch(/fresh.*No result yet\./);
  });

  it('turns a board off and reloads the list', async () => {
    await load([source({})]);

    const box = card('Some job boards').querySelector<HTMLInputElement>('li input')!;
    box.click();
    const patch = http.expectOne('/api/sources/00000000-0000-4000-8000-000000000001');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ enabled: false });
    patch.flush(source({ enabled: false }));
    await settle();

    http
      .expectOne('/api/sources')
      .flush({ catalog: [board, alert, paste], sources: [source({ enabled: false })] });
    await fixture.whenStable();
    expect(card('Some job boards').querySelector<HTMLInputElement>('li input')!.checked).toBe(
      false,
    );
  });

  it('puts a checkbox back and says why when the change fails', async () => {
    await load([source({})]);

    const box = card('Some job boards').querySelector<HTMLInputElement>('li input')!;
    box.click();
    http
      .expectOne('/api/sources/00000000-0000-4000-8000-000000000001')
      .flush({ message: 'There is no such source.' }, { status: 404, statusText: 'Not Found' });
    await settle();
    http.expectOne('/api/sources').flush({ catalog: [board, alert, paste], sources: [source({})] });
    await fixture.whenStable();

    expect(box.checked).toBe(true);
    expect(card('Some job boards').querySelector('[role=alert]')?.textContent).toContain(
      'There is no such source.',
    );
  });

  it('adds a board only when the name matches, and shows the server’s answer', async () => {
    await load();
    const boardCard = card('Some job boards');
    const input = boardCard.querySelector<HTMLInputElement>('form input')!;
    const submit = () => boardCard.querySelector<HTMLButtonElement>('form button')!.click();

    input.value = 'https://example.com/acme';
    input.dispatchEvent(new Event('input'));
    submit();
    await fixture.whenStable();
    http.expectNone('/api/sources');
    expect(boardCard.querySelector('[role=alert]')?.textContent).toContain(
      'Board name is not valid.',
    );

    input.value = 'acme';
    input.dispatchEvent(new Event('input'));
    submit();
    const post = http.expectOne({ method: 'POST', url: '/api/sources' });
    expect(post.request.body).toEqual({ catalogId: 'some_board', param: 'acme' });
    post.flush(
      { message: 'Some job boards: acme has already been added.' },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    expect(boardCard.querySelector('[role=alert]')?.textContent).toContain(
      'acme has already been added.',
    );

    // The server's error stays on the field until the name changes.
    submit();
    http.expectNone('/api/sources');

    input.value = 'other';
    input.dispatchEvent(new Event('input'));
    submit();
    const added = source({ param: 'other' });
    http.expectOne({ method: 'POST', url: '/api/sources' }).flush(added);
    await settle();
    http.expectOne('/api/sources').flush({ catalog: [board, alert, paste], sources: [added] });
    await fixture.whenStable();
    expect(input.value).toBe('');
    expect(boardCard.querySelector('[role=alert]')).toBeNull();
    expect(text()).toContain('Use other');
  });

  it('adds a job-alert entry the first time it is used', async () => {
    await load();

    card('Some job alerts').querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    const post = http.expectOne({ method: 'POST', url: '/api/sources' });
    expect(post.request.body).toEqual({ catalogId: 'some_alert' });
    post.flush(source({ catalogId: 'some_alert', param: '' }));
    await settle();
    http.expectOne('/api/sources').flush({ catalog: [board, alert, paste], sources: [] });
  });
});

describe('Sources, search scope', () => {
  let fixture: ComponentFixture<Sources>;
  let http: HttpTestingController;

  const page = () => fixture.nativeElement as HTMLElement;
  const radio = (value: string) =>
    page().querySelector<HTMLInputElement>(`input[type=radio][value=${value}]`)!;
  const remote = () => page().querySelector<HTMLInputElement>('fieldset ~ label input')!;
  const save = () => page().querySelector<HTMLButtonElement>('app-search-scope-form button')!;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Sources],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(Sources);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/sources').flush({ catalog: [], sources: [] });
    http.expectOne('/api/search-scope').flush({ area: 'helsinki', includeRemote: false });
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('shows the saved scope, with nothing to save yet', () => {
    expect(radio('helsinki').checked).toBe(true);
    expect(remote().checked).toBe(false);
    expect(save().disabled).toBe(true);
  });

  it('widens the scope to anywhere and saves it', async () => {
    radio('worldwide').click();
    await fixture.whenStable();
    expect(remote().disabled).toBe(true);
    expect(page().textContent).toContain('(already included)');

    save().click();
    const put = http.expectOne({ method: 'PUT', url: '/api/search-scope' });
    expect(put.request.body).toEqual({ area: 'worldwide', includeRemote: false });
    put.flush({ area: 'worldwide', includeRemote: false });
    await fixture.whenStable();

    expect(page().querySelector('app-search-scope-form [role=status]')?.textContent).toBe('Saved.');
    expect(save().disabled).toBe(true);
  });

  it('keeps the edit and shows the error when saving fails', async () => {
    radio('finland').click();
    remote().click();
    await fixture.whenStable();

    save().click();
    http
      .expectOne({ method: 'PUT', url: '/api/search-scope' })
      .flush(
        { message: 'The server has no database configured.' },
        { status: 503, statusText: 'Service Unavailable' },
      );
    await fixture.whenStable();

    expect(page().querySelector('app-search-scope-form [role=alert]')?.textContent).toContain(
      'no database configured',
    );
    expect(radio('finland').checked).toBe(true);
    expect(remote().checked).toBe(true);
    expect(save().disabled).toBe(false);
  });
});
