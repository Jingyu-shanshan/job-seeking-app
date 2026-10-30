import { Component, ElementRef, afterNextRender, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { DuplicateJob } from '@jsa/shared';

@Component({
  selector: 'app-duplicate-job',
  imports: [RouterLink],
  template: `
    <div role="status" tabindex="-1">
      <p>This job is already added.</p>
      <ul>
        @for (job of jobs(); track job.id) {
          <li>
            <a [routerLink]="['/jobs', job.id]">Open {{ job.title }}</a> ·
            {{ job.company || 'Company not given' }} · {{ job.location || 'Location not given' }}
          </li>
        }
      </ul>
      <p>Would you like to create another imported job?</p>
      <button type="button" [disabled]="busy()" (click)="createAnother.emit()">
        Create another imported job
      </button>
    </div>
  `,
})
export class DuplicateJobNotice {
  readonly jobs = input.required<DuplicateJob[]>();
  readonly busy = input(false);
  readonly createAnother = output<void>();
  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    afterNextRender(() => host.nativeElement.querySelector<HTMLElement>('[role=status]')?.focus());
  }
}
