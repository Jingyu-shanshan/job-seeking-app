import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Profile } from '@jsa/shared';
import { ProfilePage } from './profile';

const saved: Profile = {
  name: 'Test Person',
  email: 'test.person@example.com',
  phone: '',
  location: 'Helsinki',
  links: ['https://github.com/test-person'],
};

describe('ProfilePage', () => {
  let fixture: ComponentFixture<ProfilePage>;
  let http: HttpTestingController;

  const page = () => fixture.nativeElement as HTMLElement;
  const text = (el: Element | null = page()) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const field = (label: string) =>
    [...page().querySelectorAll('label')]
      .find((l) => text(l).startsWith(label))!
      .querySelector('input')!;
  const type = async (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const save = () => page().querySelector<HTMLButtonElement>('button[type=submit]')!;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(ProfilePage);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/profile').flush(saved);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  it('shows the saved details, says where they go, with nothing to save yet', () => {
    expect(text()).toContain('They never go to DeepSeek.');
    expect(field('Name').value).toBe('Test Person');
    expect(field('Email').value).toBe('test.person@example.com');
    expect(field('Phone').value).toBe('');
    expect(field('Where you live').value).toBe('Helsinki');
    expect(field('Link 1').value).toBe('https://github.com/test-person');
    expect(field('Link 2').value).toBe('');
    expect(save().disabled).toBe(true);
  });

  it('saves the details, with the links that are filled in', async () => {
    await type(field('Phone'), '+358 40 000 0000');
    await type(field('Link 3'), 'https://example.com/test-person');
    expect(save().disabled).toBe(false);
    save().click();
    const request = http.expectOne('/api/profile');
    expect(request.request.method).toBe('PUT');
    const sent = {
      ...saved,
      phone: '+358 40 000 0000',
      links: ['https://github.com/test-person', 'https://example.com/test-person'],
    };
    expect(request.request.body).toEqual(sent);
    request.flush(sent);
    await fixture.whenStable();
    expect(text(page().querySelector('[role=status]'))).toBe('Saved.');
    expect(save().disabled).toBe(true);
  });

  it('shows why the server refused the details', async () => {
    await type(field('Email'), 'not an address');
    save().click();
    http
      .expectOne('/api/profile')
      .flush(
        { message: 'Enter an email address such as name@example.com, or leave it empty.' },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    expect(text(page().querySelector('[role=alert]'))).toBe(
      'Enter an email address such as name@example.com, or leave it empty.',
    );
  });
});
