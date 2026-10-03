import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Criteria } from '@jsa/shared';
import { CriteriaPage } from './criteria';

const saved: Criteria = {
  location: { strength: 'hard', ifUnknown: 'to_confirm', area: 'helsinki', includeRemote: false },
  title: { strength: 'hard', words: ['backend', 'platform engineer'] },
  avoidInTitle: { strength: 'off', words: [] },
  languages: { strength: 'off', ifUnknown: 'to_confirm', languages: [] },
  employmentType: { strength: 'preference', ifUnknown: 'to_confirm', types: ['full_time'] },
  mustHaves: { strength: 'preference', ifUnknown: 'to_confirm' },
};

describe('CriteriaPage', () => {
  let fixture: ComponentFixture<CriteriaPage>;
  let http: HttpTestingController;

  const page = () => fixture.nativeElement as HTMLElement;
  const text = (el: Element | null = page()) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const section = (heading: string) =>
    [...page().querySelectorAll('section')].find((s) => text(s.querySelector('h2')) === heading)!;
  const radio = (heading: string, value: string, which = 0) =>
    section(heading).querySelectorAll<HTMLInputElement>(`input[type=radio][value=${value}]`)[
      which
    ]!;
  const textInput = (heading: string) =>
    section(heading).querySelector<HTMLInputElement>('input[type=text]')!;
  const type = async (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const click = async (input: HTMLInputElement) => {
    input.click();
    await fixture.whenStable();
  };
  const save = () => page().querySelector<HTMLButtonElement>('button[type=submit]')!;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [CriteriaPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(CriteriaPage);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/criteria').flush(saved);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('shows the saved criteria, with nothing to save yet', () => {
    expect(radio('Location', 'helsinki').checked).toBe(true);
    expect(radio('Location', 'hard').checked).toBe(true);
    expect(radio('Location', 'to_confirm').checked).toBe(true);
    expect(textInput('Job title').value).toBe('backend, platform engineer');
    expect(radio('Job title', 'hard').checked).toBe(true);
    expect(radio('Words to avoid in the title', 'off').checked).toBe(true);
    const types =
      section('Employment type').querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    expect([...types].map((box) => [text(box.parentElement), box.checked])).toEqual([
      ['Full-time', true],
      ['Part-time', false],
      ['Permanent', false],
      ['Fixed-term', false],
      ['Contract or freelance', false],
      ['Internship or trainee', false],
    ]);
    expect(radio('The job’s must-haves', 'preference').checked).toBe(true);
    expect(save().disabled).toBe(true);
  });

  it('saves changed criteria, with the location in them', async () => {
    await click(radio('Location', 'worldwide'));
    const remote = section('Location').querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(remote.disabled).toBe(true);
    expect(text(section('Location'))).toContain('(already included)');
    await type(textInput('Words to avoid in the title'), ' senior,  lead ,');
    await click(radio('Words to avoid in the title', 'hard'));
    await type(textInput('Working language'), 'English, Finnish');
    await click(radio('Working language', 'hard'));
    await click(radio('Working language', 'rule_out'));
    await click(radio('The job’s must-haves', 'hard'));
    expect(save().disabled).toBe(false);

    save().click();
    const put = http.expectOne({ method: 'PUT', url: '/api/criteria' });
    const sent: Criteria = {
      ...saved,
      location: { ...saved.location, area: 'worldwide' },
      avoidInTitle: { strength: 'hard', words: ['senior', 'lead'] },
      languages: { strength: 'hard', ifUnknown: 'rule_out', languages: ['English', 'Finnish'] },
      mustHaves: { strength: 'hard', ifUnknown: 'to_confirm' },
    };
    expect(put.request.body).toEqual(sent);
    put.flush(sent);
    await fixture.whenStable();

    expect(text(page().querySelector('[role=status]'))).toBe('Saved.');
    expect(save().disabled).toBe(true);
  });

  it('asks for something to compare with before a criterion is used', async () => {
    await click(radio('Working language', 'preference'));
    expect(text(section('Working language'))).toContain(
      'Add at least one language, or turn this criterion off.',
    );
    await type(textInput('Job title'), ' , ');
    expect(text(section('Job title'))).toContain(
      'Add at least one word, or turn this criterion off.',
    );
    const fullTime =
      section('Employment type').querySelector<HTMLInputElement>('input[type=checkbox]')!;
    await click(fullTime);
    expect(text(section('Employment type'))).toContain(
      'Tick at least one type, or turn this criterion off.',
    );
    save().click();
    await fixture.whenStable();
    http.expectNone('/api/criteria');
  });

  it('keeps the edit and shows the error when saving fails', async () => {
    await type(textInput('Working language'), 'Klingon');
    await click(radio('Working language', 'hard'));
    save().click();
    http
      .expectOne({ method: 'PUT', url: '/api/criteria' })
      .flush(
        { message: '“Klingon” is not a language the app recognises.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();

    expect(text(page().querySelector('[role=alert]'))).toBe(
      '“Klingon” is not a language the app recognises.',
    );
    expect(textInput('Working language').value).toBe('Klingon');
    expect(save().disabled).toBe(false);
  });
});
