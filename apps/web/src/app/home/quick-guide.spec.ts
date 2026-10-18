import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Session, type User } from '../auth/session';
import { QuickGuide } from './quick-guide';

describe('QuickGuide', () => {
  let fixture: ComponentFixture<QuickGuide>;
  let user: ReturnType<typeof signal<User | null>>;
  const key = (id = 'account-1') => `jsa:quick-guide:v1:${id}`;
  const page = () => fixture.nativeElement as HTMLElement;
  const text = () => page().textContent;
  async function click(label: string) {
    Array.from(page().querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === label)!
      .click();
    await fixture.whenStable();
  }
  async function mount() {
    fixture = TestBed.createComponent(QuickGuide);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    localStorage.clear();
    user = signal<User | null>({ id: 'account-1', email: 'owner@example.com' });
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: Session, useValue: { user } }],
    });
    await mount();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('offers three optional steps, previous, finish and replay without business requests', async () => {
    expect(text()).toContain('Step 1 of 3');
    expect(page().querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
    expect(page().querySelector('a')?.getAttribute('href')).toBe('/facts');
    await click('Continue');
    expect(text()).toContain('Step 2 of 3');
    expect(document.activeElement?.id).toBe('guide-title');
    await click('Previous');
    expect(text()).toContain('Step 1 of 3');
    await click('Continue');
    await click('Continue');
    expect(text()).toContain('Review before sending');
    await click('Finish guide');
    expect(page().querySelector('section')).toBeNull();
    expect(JSON.parse(localStorage.getItem(key())!)).toBe('completed');
    fixture.destroy();
    await mount();
    expect(page().querySelector('section')).toBeNull();
    fixture.componentInstance.reopen();
    await fixture.whenStable();
    expect(text()).toContain('Step 1 of 3');
    expect(document.activeElement?.id).toBe('guide-title');
  });

  it('resumes after refreshing and remembers a skip', async () => {
    await click('Continue');
    fixture.destroy();
    await mount();
    expect(text()).toContain('Step 2 of 3');
    await click('Skip guide');
    fixture.destroy();
    await mount();
    expect(page().querySelector('section')).toBeNull();
  });

  it('uses stable IDs, preserves progress after an email change and isolates another account', async () => {
    await click('Continue');
    user.set({ id: 'account-1', email: 'changed@example.com' });
    await fixture.whenStable();
    expect(text()).toContain('Step 2 of 3');
    user.set({ id: 'account-2', email: 'changed@example.com' });
    await fixture.whenStable();
    expect(text()).toContain('Step 1 of 3');
    await click('Skip guide');
    user.set({ id: 'account-1', email: 'owner@example.com' });
    await fixture.whenStable();
    expect(text()).toContain('Step 2 of 3');
    expect(JSON.parse(localStorage.getItem(key('account-2'))!)).toBe('skipped');
  });

  it.each(['99', '{}', '"unknown"', 'null', '{broken'])(
    'ignores invalid stored progress: %s',
    async (stored) => {
      fixture.destroy();
      localStorage.setItem(key(), stored);
      await mount();
      expect(text()).toContain('Step 1 of 3');
      await click('Skip guide');
      expect(page().querySelector('section')).toBeNull();
    },
  );

  it('remains usable when storage cannot be read or written, keeping progress in memory', async () => {
    fixture.destroy();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await mount();
    expect(text()).toContain('could not remember this guide');
    await click('Continue');
    expect(text()).toContain('Step 2 of 3');
    await click('Skip guide');
    expect(page().querySelector('section')).toBeNull();
    fixture.componentInstance.reopen();
    await fixture.whenStable();
    expect(text()).toContain('Step 1 of 3');
  });
});
