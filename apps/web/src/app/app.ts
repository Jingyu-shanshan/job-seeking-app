import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { Session } from './auth/session';

@Component({
  imports: [RouterLink, RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  template: `
    <header>
      <a routerLink="/">Job Search Workbench</a>
      @if (session.user(); as user) {
        <span class="account">
          {{ user.email }}
          <button type="button" (click)="signOut()">Sign out</button>
        </span>
      }
    </header>
    <main>
      <router-outlet />
    </main>
  `,
})
export class App {
  protected readonly session = inject(Session);
  private readonly router = inject(Router);

  protected async signOut() {
    await this.session.signOut();
    await this.router.navigateByUrl('/login');
  }
}
