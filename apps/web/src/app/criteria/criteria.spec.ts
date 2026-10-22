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
    expect([...section('Job title').querySelectorAll('li span')].map((s) => text(s))).toEqual([
      'backend',
      'platform engineer',
    ]);
    expect(textInput('Job title').value).toBe('');
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
    while (section('Job title').querySelector('li button')) {
      section('Job title').querySelector<HTMLButtonElement>('li button')!.click();
      await fixture.whenStable();
    }
    await fixture.whenStable();
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
  it('locks pending edits and retries the same criteria after a failed save', async () => {
    while (section('Job title').querySelector('li button')) {
      section('Job title').querySelector<HTMLButtonElement>('li button')!.click();
      await fixture.whenStable();
    }
    await type(textInput('Job title'), 'platform');
    section('Job title')
      .querySelector<HTMLButtonElement>('app-options-field .entry button')!
      .click();
    await fixture.whenStable();
    save().click();
    const request = http.expectOne('/api/criteria');
    TestBed.tick();
    expect(text()).toContain('Saving criteria…');
    expect(textInput('Job title').closest('fieldset')?.disabled).toBe(true);
    request.flush({ message: 'Sample save failed.' }, { status: 503, statusText: 'Unavailable' });
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(text(section('Job title').querySelector('li span'))).toBe('platform');
    expect(text()).toContain('Sample save failed.');
    save().click();
    const retry = http.expectOne('/api/criteria');
    expect(retry.request.body.title.words).toEqual(['platform']);
    expect(retry.request.body.location.ifUnknown).toBe('to_confirm');
    retry.flush({ ...saved, title: { strength: 'hard', words: ['platform'] } });
    await fixture.whenStable();
    expect(text()).toContain('Saved.');
  });

  it('adds multiple titles and locations as alternatives and saves their arrays', async () => {
    await click(radio('Location', 'custom'));
    for (const place of ['Berlin', 'Stockholm', 'berlin']) {
      await type(textInput('Location'), place);
      section('Location')
        .querySelector<HTMLButtonElement>('app-options-field .entry button')!
        .click();
      await fixture.whenStable();
    }
    for (const title of ['Product Designer', 'Data Analyst']) {
      await type(textInput('Job title'), title);
      textInput('Job title').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      await fixture.whenStable();
    }
    expect([...section('Location').querySelectorAll('li span')].map((s) => text(s))).toEqual([
      'Berlin',
      'Stockholm',
    ]);
    section('Job title')
      .querySelector<HTMLButtonElement>('button[aria-label="Remove backend"]')!
      .click();
    await fixture.whenStable();
    save().click();
    const request = http.expectOne('/api/criteria');
    expect(request.request.body.location).toEqual({
      ...saved.location,
      area: 'custom',
      places: ['Berlin', 'Stockholm'],
    });
    expect(request.request.body.title.words).toEqual([
      'platform engineer',
      'Product Designer',
      'Data Analyst',
    ]);
    request.flush(request.request.body);
    await fixture.whenStable();
    expect(save().disabled).toBe(true);
  });

  it('enables title preferences when adding a role to an off criterion', async () => {
    await click(radio('Job title', 'off'));
    await type(textInput('Job title'), 'Researcher');
    section('Job title')
      .querySelector<HTMLButtonElement>('app-options-field .entry button')!
      .click();
    await fixture.whenStable();
    expect(radio('Job title', 'preference').checked).toBe(true);
  });

  it('requires a custom location and keeps the form unchanged when geolocation is denied', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
    const getCurrentPosition = vi.fn((_success, failure) => failure({ code: 1 }));
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    try {
      const locate = [...section('Location').querySelectorAll('button')].find(
        (b) => text(b) === 'Use current location',
      )!;
      expect(getCurrentPosition).not.toHaveBeenCalled();
      locate.click();
      await fixture.whenStable();
      expect(text(section('Location'))).toContain('Location permission was denied.');
      expect(save().disabled).toBe(true);
      http.expectNone((r) => r.url.includes('bigdatacloud'));
      await click(radio('Location', 'custom'));
      expect(text(section('Location'))).toContain('Add at least one location, or choose Anywhere.');
    } finally {
      if (original) Object.defineProperty(navigator, 'geolocation', original);
      else Reflect.deleteProperty(navigator, 'geolocation');
    }
  });

  it('suggests the detected city and country without silently applying them', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) =>
          success({ coords: { latitude: 52.52, longitude: 13.4 } } as GeolocationPosition),
      },
    });
    try {
      [...section('Location').querySelectorAll('button')]
        .find((b) => text(b) === 'Use current location')!
        .click();
      await new Promise((resolve) => setTimeout(resolve));
      const request = http.expectOne((r) => r.url.includes('bigdatacloud'));
      expect(request.request.params.get('latitude')).toBe('52.52');
      request.flush({ city: 'Berlin', countryName: 'Germany' });
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
      expect(save().disabled).toBe(true);
      [...section('Location').querySelectorAll('button')]
        .find((b) => text(b) === 'Add Berlin')!
        .click();
      await fixture.whenStable();
      save().click();
      const put = http.expectOne('/api/criteria');
      expect(put.request.body.location).toEqual({
        ...saved.location,
        area: 'custom',
        places: ['Helsinki', 'Espoo', 'Berlin'],
      });
      put.flush(put.request.body);
      await fixture.whenStable();
    } finally {
      if (original) Object.defineProperty(navigator, 'geolocation', original);
      else Reflect.deleteProperty(navigator, 'geolocation');
    }
  });

  it('shows a load error and can retry without interpreting missing criteria as a pass', async () => {
    const other = TestBed.createComponent(CriteriaPage);
    TestBed.tick();
    http
      .expectOne('/api/criteria')
      .flush({ message: 'Sample read failed.' }, { status: 503, statusText: 'Unavailable' });
    await other.whenStable();
    expect(other.nativeElement.querySelector('form')).toBeNull();
    other.nativeElement.querySelector('button').click();
    TestBed.tick();
    http.expectOne('/api/criteria').flush(saved);
    await other.whenStable();
    expect(other.nativeElement.textContent).toContain('Not saying never');
    other.destroy();
  });
});
