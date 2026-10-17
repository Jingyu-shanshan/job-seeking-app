import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, Injector, afterNextRender, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { Session } from './auth/session';

@Component({
  imports: [RouterLink, RouterOutlet],
  selector: 'app-root',
  host: { '[class.signed-in]': "!!session.user() && section() !== '/login'" },
  styleUrl: './app.css',
  template: `
    <a class="skip" href="#main-content" (click)="$event.preventDefault(); main.focus()">
      Skip to main content
    </a>
    <header class="side">
      <a class="brand" routerLink="/">Job Search Workbench</a>
      @if (section() !== '/login' ? session.user() : null; as user) {
        <details
          class="nav-menu"
          tabindex="-1"
          #menu
          [open]="wide()"
          (keydown.escape)="closeMenu(menu, menuToggle)"
        >
          <summary #menuToggle>
            Menu <span class="current-page">{{ pageTitle() }}</span>
          </summary>
          @for (group of navigation; track group.label) {
            @if (group.label === 'Your setup') {
              <p class="nav-group">Your setup</p>
            }
            <nav [attr.aria-label]="group.label">
              @for (link of group.links; track link.path) {
                <a
                  [routerLink]="link.path"
                  [class.active]="section() === link.path"
                  [attr.aria-current]="section() === link.path ? 'page' : null"
                  >{{ link.label }}</a
                >
              }
            </nav>
          }
        </details>
        <div class="account">
          <span>{{ user.email }}</span>
          <button type="button" [disabled]="signingOut()" (click)="signOut()">
            {{ signingOut() ? 'Signing out…' : 'Sign out' }}
          </button>
          @if (signOutError()) {
            <p class="error" role="alert">{{ signOutError() }}</p>
          }
        </div>
      }
    </header>
    <main id="main-content" tabindex="-1" #main>
      <router-outlet />
    </main>
  `,
})
export class App {
  protected readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  protected readonly wide = signal(false);
  protected readonly pageTitle = signal('Overview');
  protected readonly section = signal('/');
  protected readonly signingOut = signal(false);
  protected readonly signOutError = signal('');
  protected readonly navigation = [
    {
      label: 'Main',
      links: [
        { path: '/', label: 'Overview' },
        { path: '/jobs', label: 'Jobs' },
        { path: '/runs', label: 'Runs' },
        { path: '/applications', label: 'Applications' },
        { path: '/facts', label: 'Facts' },
      ],
    },
    {
      label: 'Your setup',
      links: [
        { path: '/profile', label: 'Your details' },
        { path: '/answers', label: 'Form answers' },
        { path: '/criteria', label: 'Criteria' },
        { path: '/sources', label: 'Sources' },
        { path: '/runner', label: 'Runner' },
        { path: '/export', label: 'Export' },
      ],
    },
  ];

  constructor() {
    const breakpoint = this.document.defaultView?.matchMedia?.('(min-width: 900px)');
    if (breakpoint) {
      this.wide.set(breakpoint.matches);
      const resize = () => {
        const focusedMenu = this.document.activeElement?.closest('.nav-menu');
        this.wide.set(breakpoint.matches);
        if (!breakpoint.matches) focusedMenu?.querySelector<HTMLElement>('summary')?.focus();
      };
      breakpoint.addEventListener('change', resize);
      inject(DestroyRef).onDestroy(() => breakpoint.removeEventListener('change', resize));
    }
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (!(event instanceof NavigationEnd)) return;
      let route = this.router.routerState.snapshot.root;
      while (route.firstChild) route = route.firstChild;
      this.pageTitle.set(route.title ?? 'Overview');
      this.section.set(
        route.routeConfig?.path === '**'
          ? ''
          : (route.data['navigation'] ?? '/' + event.urlAfterRedirects.split(/[/?#]/)[1]),
      );
      const menu = this.document.querySelector<HTMLDetailsElement>('.nav-menu');
      if (menu) menu.open = this.wide();
      afterNextRender(() => this.document.getElementById('main-content')?.focus(), {
        injector: this.injector,
      });
    });
  }

  protected closeMenu(menu: HTMLDetailsElement, toggle: HTMLElement) {
    if (this.wide()) return;
    menu.open = false;
    toggle.focus();
  }

  protected async signOut() {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    this.signOutError.set('');
    try {
      await this.session.signOut();
      await this.router.navigateByUrl('/login');
    } catch {
      this.signOutError.set('Could not sign out. Try again.');
    } finally {
      this.signingOut.set(false);
    }
  }
}
