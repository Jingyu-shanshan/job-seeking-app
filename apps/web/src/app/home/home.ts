import { httpResource } from '@angular/common/http';
import { Component } from '@angular/core';
import type { HealthResponse } from '@jsa/shared';

@Component({
  selector: 'app-home',
  template: `
    <h1>Job Search Workbench</h1>
    <p>The skeleton is running. Job search is the next thing to be built.</p>
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
