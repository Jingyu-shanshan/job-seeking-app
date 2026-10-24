import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Tools } from './tools';

describe('Web tools', () => {
  let fixture: ComponentFixture<Tools>;
  let http: HttpTestingController;
  const page = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };
  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(Tools);
    http = TestBed.inject(HttpTestingController);
    await settle();
    http.expectOne('/api/tools').flush({ available: true, estimatedCostUsd: 0.00075, calls: [] });
    await fixture.whenStable();
  });
  afterEach(() => http.verify());
  const submit = async () => {
    const input = page().querySelector('input')!;
    input.value = 'Engineer site:example.com';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    page().querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await settle();
  };
  it('quotes the fee and never makes a paid request on load', () => {
    expect(page().textContent).toContain('0.00075');
    expect(page().textContent).toContain('No requests yet');
    http.expectNone((r) => r.method === 'POST');
  });
  it('sends only explicit input and approved cost, then displays persisted results', async () => {
    await submit();
    const req = http.expectOne((r) => r.method === 'POST');
    expect(req.request.body).toEqual({
      id: expect.any(String),
      tool: 'search',
      input: 'Engineer site:example.com',
      maxCostUsd: 0.00075,
    });
    expect(page().querySelector('fieldset')!.disabled).toBe(true);
    const call = {
      id: req.request.body.id,
      tool: 'search',
      input: 'Engineer site:example.com',
      createdAt: '2026-10-23T08:00:00Z',
      costUsd: 0,
      estimated: false,
      message: 'No results',
      result: { results: [] },
    };
    req.flush(call);
    await settle();
    http
      .expectOne('/api/tools')
      .flush({ available: true, estimatedCostUsd: 0.00075, calls: [call] });
    await fixture.whenStable();
    expect(page().textContent).toContain('No results');
    expect(page().textContent).toContain('Recorded fee');
  });
  it('retains the same operation ID on a lost response instead of creating a second charge', async () => {
    await submit();
    const req = http.expectOne((r) => r.method === 'POST');
    const original = req.request.body;
    req.error(new ProgressEvent('error'));
    await settle();
    expect(page().querySelector('input')!.value).toBe(original.input);
    expect(page().querySelector('fieldset')!.disabled).toBe(true);
    const retry = Array.from(page().querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Retry / check'),
    )!;
    retry.click();
    await settle();
    const retried = http.expectOne((r) => r.method === 'POST');
    expect(retried.request.body).toEqual(original);
    retried.flush({ message: 'still unavailable' }, { status: 500, statusText: 'Failed' });
    await settle();
  });
  it('allows input correction after a confirmed pre-send validation failure', async () => {
    await submit();
    http
      .expectOne((r) => r.method === 'POST')
      .flush(
        { message: 'Keep the search query within 128 characters.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle();
    expect(page().querySelector('fieldset')!.disabled).toBe(false);
    expect(page().querySelector('input')!.value).toContain('Engineer');
  });
});
