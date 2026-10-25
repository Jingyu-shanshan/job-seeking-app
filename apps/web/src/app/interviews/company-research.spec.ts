import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CompanyResearch } from '@jsa/shared';
import { CompanyResearchPanel } from './company-research';

const id = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const url = `/api/applications/${id}/company-research`;
const version: CompanyResearch = {
  id,
  company: 'Example',
  website: 'https://example.com',
  topic: 'products',
  query: '"Example" site:example.com products',
  createdAt: '2026-10-25T10:00:00Z',
  status: 'completed',
  message: 'Official excerpts saved; recency unverified.',
  costUsd: 0.00075,
  estimated: false,
  issues: [],
  sources: [
    {
      url: 'https://example.com/products',
      finalUrl: 'https://example.com/products',
      title: 'Products',
      method: 'public_page',
      readAt: '2026-10-25T10:00:01Z',
      text: '<script>Untrusted text</script>',
      truncated: false,
    },
  ],
};

describe('CompanyResearchPanel', () => {
  let fixture: ComponentFixture<CompanyResearchPanel>;
  let http: HttpTestingController;
  const page = () => fixture.nativeElement as HTMLElement;
  const text = () => page().textContent ?? '';
  const button = (label: string) =>
    [...page().querySelectorAll('button')].find((b) => b.textContent?.includes(label))!;
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };
  const type = async (index: number, value: string) => {
    const field = page().querySelectorAll('input')[index]!;
    field.value = value;
    field.dispatchEvent(new Event('input'));
    await settle();
  };
  const load = async (available = true) => {
    http.expectOne(url).flush({ available, estimatedCostUsd: 0.00075, versions: [version] });
    await settle();
  };
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CompanyResearchPanel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(CompanyResearchPanel);
    fixture.componentRef.setInput('applicationId', id);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });
  afterEach(() => http.verify());

  it('shows prior evidence safely and requires valid input before one manual paid search', async () => {
    await load();
    expect(text()).toContain('US$ 0.00075');
    expect(text()).toContain('saved separately');
    expect(page().querySelector('pre')!.textContent).toBe('<script>Untrusted text</script>');
    expect(page().querySelector('script')).toBeNull();
    expect(button('new paid').disabled).toBe(true);
    await type(0, 'Example');
    await type(1, 'https://example.com');
    button('new paid').click();
    button('new paid').click();
    TestBed.tick();
    expect(page().querySelector('fieldset')!.disabled).toBe(true);
    const request = http.expectOne(url);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      id: expect.any(String),
      company: 'Example',
      website: 'https://example.com',
      topic: 'products',
      maxCostUsd: 0.00075,
    });
    request.flush({ ...version, id: request.request.body.id });
    await settle();
    expect(page().querySelectorAll('article').length).toBe(2);
    expect(text()).not.toContain('Check saved request');
  });

  it('keeps inputs and prior versions after failure and checks the same request without charging again', async () => {
    await load();
    await type(0, 'Example');
    await type(1, 'https://example.com');
    button('new paid').click();
    const first = http.expectOne(url);
    const payload = first.request.body;
    first.flush({ message: 'Lost response' }, { status: 502, statusText: 'Bad Gateway' });
    await settle();
    expect(page().querySelectorAll('input')[0]!.value).toBe('Example');
    expect(page().querySelectorAll('article').length).toBe(1);
    expect(text()).toContain('Lost response');
    expect(page().querySelector('fieldset')!.disabled).toBe(true);
    button('Check saved').click();
    const check = http.expectOne(url);
    expect(check.request.body).toEqual(payload);
    check.flush({ ...version, id: payload.id, status: 'pending' });
    await settle();
    expect(text()).toContain('Check saved request');
    button('Check saved').click();
    http.expectOne(url).flush({
      ...version,
      id: payload.id,
      status: 'failed',
      sources: [],
      message: 'Unknown; previous versions unchanged.',
    });
    await settle();
    expect(page().querySelectorAll('article').length).toBe(2);
    expect(page().querySelector('fieldset')!.disabled).toBe(false);
    expect(text()).toContain('remain unknown');
  });

  it('disables new searches when unavailable and preserves earlier versions', async () => {
    await load(false);
    expect(page().querySelector('fieldset')!.disabled).toBe(true);
    expect(text()).toContain('DEEPSEEK_API_KEY');
    expect(page().querySelectorAll('article').length).toBe(1);
  });

  it('does not show an old request in a different application after navigation', async () => {
    await load();
    await type(0, 'Example');
    await type(1, 'https://example.com');
    button('new paid').click();
    const pending = http.expectOne(url);
    fixture.componentRef.setInput('applicationId', otherId);
    fixture.detectChanges();
    http
      .expectOne(`/api/applications/${otherId}/company-research`)
      .flush({ available: true, estimatedCostUsd: 0.00075, versions: [] });
    pending.flush(version);
    await settle();
    expect(page().querySelectorAll('article').length).toBe(0);
    expect(page().querySelectorAll('input')[0]!.value).toBe('');
  });
});
