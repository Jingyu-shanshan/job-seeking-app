import { httpResource } from '@angular/common/http';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { HealthResponse } from '@jsa/shared';

@Component({
  imports: [RouterLink],
  selector: 'app-home',
  template: `
    <h1>Job Search Workbench</h1>
    <p>
      Choose where jobs come from and which locations count on the
      <a routerLink="/sources">Sources</a> page. Finding jobs from those sources comes next.
    </p>
    <p role="status">
      @if (health.isLoading()) {
        Checking the API…
      } @else if (health.hasValue()) {
        API status: {{ health.value()?.status }}
      } @else {
        The API is not reachable.
      }
    </p>
  `,
})
export class Home {
  protected readonly health = httpResource<HealthResponse>(() => '/health');
}
