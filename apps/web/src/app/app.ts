import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

@Component({
  imports: [RouterLink, RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  template: `
    <header>
      <a routerLink="/">Job Search Workbench</a>
    </header>
    <main>
      <router-outlet />
    </main>
  `,
})
export class App {}
