import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DuplicateJobNotice } from './duplicate-job';
import { duplicateJobs } from './jobs-api';

const jobs = [
  { id: 'job-1', title: '<img src=x onerror=alert(1)>', company: 'Acme', location: 'Helsinki' },
  { id: 'job-2', title: 'Engineer', company: null, location: '' },
];
describe('DuplicateJobNotice', () => {
  it('links every candidate as text, announces the conflict and disables confirmation while busy', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(DuplicateJobNotice);
    fixture.componentRef.setInput('jobs', jobs);
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;
    expect([...page.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/jobs/job-1',
      '/jobs/job-2',
    ]);
    expect(page.querySelector('img')).toBeNull();
    expect(page.querySelector('button')!.disabled).toBe(true);
    expect(document.activeElement).toBe(page.querySelector('[role=status]'));
    const confirm = vi.fn();
    fixture.componentInstance.createAnother.subscribe(confirm);
    page.querySelector('button')!.click();
    expect(confirm).not.toHaveBeenCalled();
    fixture.componentRef.setInput('busy', false);
    fixture.detectChanges();
    page.querySelector('button')!.click();
    expect(confirm).toHaveBeenCalledOnce();
  });
  it('only accepts well-shaped duplicate conflicts', () => {
    expect(
      duplicateJobs(new HttpErrorResponse({ status: 409, error: { code: 'duplicate_job', jobs } })),
    ).toEqual(jobs);
    for (const error of [
      null,
      new Error('failure'),
      new HttpErrorResponse({ status: 500, error: { code: 'duplicate_job', jobs } }),
      ...[
        null,
        {},
        { code: 'duplicate_job', jobs: [] },
        { code: 'duplicate_job', jobs: [{ id: 'job-1' }] },
        { code: 'other', jobs },
      ].map((error) => new HttpErrorResponse({ status: 409, error })),
    ]) {
      expect(duplicateJobs(error)).toBeNull();
    }
  });
});
