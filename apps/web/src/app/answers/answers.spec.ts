import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { SavedAnswer } from '@jsa/shared';
import { Answers } from './answers';

const notice: SavedAnswer = {
  id: '00000000-0000-4000-8000-000000000001',
  wordings: ['What is your notice period?', 'Notice period'],
  answer: ['One month'],
  sensitive: false,
  places: [],
  updatedAt: '2026-10-07T08:00:00.000Z',
};

const permit: SavedAnswer = {
  id: '00000000-0000-4000-8000-000000000002',
  wordings: ['Do you have a work permit for Finland?'],
  answer: ['Yes'],
  sensitive: true,
  places: ['Finland'],
  updatedAt: '2026-10-07T08:00:00.000Z',
};

describe('Answers', () => {
  let fixture: ComponentFixture<Answers>;
  let http: HttpTestingController;

  const page = () => fixture.nativeElement as HTMLElement;
  const text = (el: Element | null = page()) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const button = (label: string, within: Element = page()) =>
    [...within.querySelectorAll('button')].find((b) => text(b) === label)!;
  const field = (label: string, within: Element = page()) =>
    [...within.querySelectorAll('label')]
      .find((l) => text(l).startsWith(label))!
      .querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!;
  const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const cards = () => [...page().querySelectorAll('article')];

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Answers],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(Answers);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  async function load(answers: SavedAnswer[]) {
    http.expectOne('/api/answers').flush(answers);
    await fixture.whenStable();
  }

  it('lists the saved answers with their wordings, sensitivity and places', async () => {
    await load([notice, permit]);
    expect(text(page().querySelector('#saved-heading'))).toBe('Saved answers (2)');
    const items = [...cards()[0]!.querySelectorAll('li')].map((li) => text(li));
    expect(items).toEqual(['What is your notice period?', 'Notice period']);
    expect(text(cards()[0]!.querySelector('.answer'))).toBe('One month');
    expect(text(cards()[0]!)).toContain('Every job');
    expect(text(cards()[1]!)).toContain('Sensitive Only for jobs in Finland');
    expect(text()).toContain('Nothing here is sent to DeepSeek.');
  });

  it('says how to get answers when there are none', async () => {
    await load([]);
    expect(text()).toContain('No saved answers yet.');
  });

  it('adds an answer: one wording per line, places by commas', async () => {
    await load([notice]);
    const add = page().querySelector('details')!;
    await type(field('Questions it answers', add), 'Salary expectation\n\nExpected salary ');
    await type(field('Your answer', add), '4000 EUR a month');
    field('Sensitive', add).click();
    await type(field('Only for jobs', add), 'Finland, Helsinki ;');
    button('Add', add).click();
    const request = http.expectOne('/api/answers');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      wordings: ['Salary expectation', 'Expected salary'],
      answer: ['4000 EUR a month'],
      sensitive: true,
      places: ['Finland', 'Helsinki'],
    });
    const added: SavedAnswer = { ...notice, id: permit.id, ...request.request.body };
    request.flush(added);
    await fixture.whenStable();
    expect(cards().length).toBe(2);
    expect(text(cards()[1]!)).toContain('4000 EUR a month');
    expect(field('Questions it answers', add).value).toBe('');
  });

  it('keeps several options of a multi-choice answer apart', async () => {
    await load([]);
    const add = page().querySelector('details')!;
    await type(field('Questions it answers', add), 'Which languages do you speak?');
    await type(field('Your answer', add), 'English\nFinnish');
    field('Several options', add).click();
    button('Add', add).click();
    const request = http.expectOne('/api/answers');
    expect(request.request.body.answer).toEqual(['English', 'Finnish']);
    request.flush({ ...notice, ...request.request.body });
    await fixture.whenStable();
  });

  it('asks for a wording and an answer before adding', async () => {
    await load([]);
    const add = page().querySelector('details')!;
    button('Add', add).click();
    await fixture.whenStable();
    expect(text(add)).toContain('Write the question as a form asks it.');
    expect(text(add)).toContain('Write your answer.');
  });

  it('changes an answer, and shows why the server refused one', async () => {
    await load([notice, permit]);
    button('Edit', cards()[0]!).click();
    await fixture.whenStable();
    const card = cards()[0]!;
    expect(field('Your answer', card).value).toBe('One month');
    await type(field('Your answer', card), 'Two months');
    button('Save', card).click();
    const request = http.expectOne(`/api/answers/${notice.id}`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body.answer).toEqual(['Two months']);
    request.flush(
      { message: 'Another saved answer already answers “Notice period”.' },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    expect(text(card.querySelector('[role=alert]'))).toBe(
      'Another saved answer already answers “Notice period”.',
    );
    await type(field('Your answer', card), 'Six weeks');
    button('Save', card).click();
    http.expectOne(`/api/answers/${notice.id}`).flush({ ...notice, answer: ['Six weeks'] });
    await fixture.whenStable();
    expect(text(cards()[0]!)).toContain('Six weeks');
    expect(cards()[0]!.querySelector('form')).toBeNull();
  });

  it('deletes an answer', async () => {
    await load([notice, permit]);
    button('Delete', cards()[0]!).click();
    const request = http.expectOne(`/api/answers/${notice.id}`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null);
    await fixture.whenStable();
    expect(cards().map((c) => c.getAttribute('aria-label'))).toEqual([permit.wordings[0]]);
  });
});
