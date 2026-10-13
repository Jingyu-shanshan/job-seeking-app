import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Runs } from './runs';

describe('Runs', () => {
  let fixture: ComponentFixture<Runs>, http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Runs],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(Runs);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });
  afterEach(() => {
    fixture.destroy();
    http.verify();
  });
  it('starts with zero model spend, draft and submission limits, and no schedule', async () => {
    http.expectOne('/api/runs').flush({ presets: [], runs: [] });
    await fixture.whenStable();
    const inputs = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>('input'),
    );
    expect(inputs.map((i) => i.value)).toEqual([
      'My job search',
      '20',
      '0',
      '0',
      '20',
      '600',
      '0',
      '0',
    ]);
    expect(fixture.nativeElement.textContent).toContain(
      'Every submission still needs your individual approval',
    );
  });
  it('saving a preset does not start a run, and exposes errors', async () => {
    http.expectOne('/api/runs').flush({ presets: [], runs: [] });
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('button[type=submit]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const save = http.expectOne('/api/run-presets');
    expect(save.request.body.costLimitUsd).toBe(0);
    save.flush({ message: 'Could not save the preset.' }, { status: 500, statusText: 'Error' });
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Could not save the preset.');
    http.expectNone('/api/runs');
  });
});
