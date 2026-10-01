import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  imports: [RouterLink],
  selector: 'app-not-found',
  template: `
    <h1>Page not found</h1>
    <p><a routerLink="/">Back to the start page</a></p>
  `,
})
export class NotFound {}
