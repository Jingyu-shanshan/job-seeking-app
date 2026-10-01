import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Home } from './home';

describe('Home', () => {
  let fixture: ComponentFixture<Home>;
  let http: HttpTestingController;

  const status = () =>
    (fixture.nativeElement as HTMLElement).querySelector('[role=status]')?.textContent?.trim();

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Home],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(Home);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('shows the API status once /health answers', async () => {
    expect(status()).toBe('Checking the API…');

    http.expectOne('/health').flush({ status: 'ok' });
    await fixture.whenStable();

    expect(status()).toBe('API status: ok');
  });

  it('says so when the API is not reachable', async () => {
    http.expectOne('/health').error(new ProgressEvent('error'));
    await fixture.whenStable();

    expect(status()).toBe('The API is not reachable.');
  });
});
