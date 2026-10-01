import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import type { Source } from '@jsa/shared';

/** When a source last worked and, if it failed since, why. */
@Component({
  selector: 'app-source-status',
  imports: [DatePipe],
  template: `
    @let s = source();
    @if (s.lastSuccessAt) {
      Last success {{ s.lastSuccessAt | date: dateFormat }}.
    } @else if (!s.lastFailureAt) {
      No result yet.
    } @else {
      Never succeeded.
    }
    @if (failing()) {
      <span class="failure">
        Failed {{ s.lastFailureAt | date: dateFormat }}: {{ s.lastFailureReason }}
      </span>
    }
  `,
  styles: `
    :host {
      display: block;
      font-size: 0.9rem;
    }
    .failure {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class SourceStatus {
  readonly source = input.required<Source>();

  protected readonly dateFormat = 'd MMM y, HH:mm';

  /** A failure counts until a later success. ISO timestamps from the API compare as text. */
  protected readonly failing = computed(() => {
    const { lastFailureAt, lastSuccessAt } = this.source();
    return lastFailureAt !== null && (lastSuccessAt === null || lastFailureAt > lastSuccessAt);
  });
}
