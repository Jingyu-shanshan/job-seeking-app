import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';

describe('App', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('renders the product name as a link to the start page', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const link = (fixture.nativeElement as HTMLElement).querySelector('header a');
    expect(link?.textContent).toContain('Job Search Workbench');
    expect(link?.getAttribute('href')).toBe('/');
  });

  it('routes an unknown path to the not-found page', async () => {
    const harness = await RouterTestingHarness.create('/no/such/page');

    expect((harness.routeNativeElement as HTMLElement).querySelector('h1')?.textContent).toBe(
      'Page not found',
    );
  });

  it('routes the root path to the start page', async () => {
    const harness = await RouterTestingHarness.create('/');
    TestBed.inject(HttpTestingController).expectOne('/health').flush({ status: 'ok' });

    expect((harness.routeNativeElement as HTMLElement).querySelector('h1')?.textContent).toBe(
      'Job Search Workbench',
    );
  });
});
