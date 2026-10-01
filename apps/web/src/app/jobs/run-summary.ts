import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { DiscoveryRun, SourceRun } from '@jsa/shared';

export interface JobCounts {
  inScope: number;
  toConfirm: number;
  outOfScope: number;
}

const jobs = (n: number) => (n === 1 ? '1 job' : `${n} jobs`);
const sources = (n: number) => (n === 1 ? '1 source' : `${n} sources`);

/**
 * What the last run did with each source and, when the jobs in scope fall short of what the user
 * wanted, why. The app never adds sources or widens the scope to make up the difference.
 */
@Component({
  selector: 'app-run-summary',
  imports: [RouterLink],
  template: `
    @let r = run();
    <p>
      <strong>{{ headline() }}</strong>
    </p>
    @if (r.sources.length === 0) {
      <p>
        No job board is in use, so nothing was read. Add one on the
        <a routerLink="/sources">Sources</a> page.
      </p>
    } @else {
      @if (shortfall().length) {
        <p>Why not more:</p>
        <ul>
          @for (reason of shortfall(); track reason) {
            <li>{{ reason }}</li>
          }
        </ul>
        <p>
          The app does not add sources or widen the scope on its own. You can change both on the
          <a routerLink="/sources">Sources</a> page.
        </p>
      }
      <ul>
        @for (source of r.sources; track source.sourceId) {
          <li [class.problem]="source.outcome !== 'ok'">{{ describe(source) }}</li>
        }
      </ul>
      <p class="requests">{{ r.requests }} of at most {{ r.requestLimit }} requests used.</p>
    }
  `,
  styles: `
    .problem {
      color: light-dark(#a3141c, #ff9b9b);
    }
    .requests {
      font-size: 0.9rem;
    }
  `,
})
export class RunSummary {
  readonly run = input.required<DiscoveryRun>();
  readonly counts = input.required<JobCounts>();
  /** How many jobs in scope the user wanted; null when they did not say. */
  readonly target = input.required<number | null>();
  /** The search scope in words, e.g. "Helsinki and Espoo". */
  readonly scope = input.required<string>();

  protected readonly headline = computed(() => {
    const found = `${jobs(this.counts().inScope)} in scope.`;
    const target = this.target();
    return target === null ? found : `${found} You wanted ${target}.`;
  });

  /** Only when there is a target and the jobs in scope fall short of it. */
  protected readonly shortfall = computed(() => {
    const target = this.target();
    const { inScope, toConfirm, outOfScope } = this.counts();
    if (target === null || inScope >= target) return [];
    const outcomes = this.run().sources.map((s) => s.outcome);
    const failed = outcomes.filter((outcome) => outcome === 'failed').length;
    const skipped = outcomes.filter((outcome) => outcome === 'skipped').length;
    const reasons: string[] = [];
    if (failed) reasons.push(`${sources(failed)} could not be read; see below.`);
    if (skipped) {
      const verb = skipped === 1 ? 'was' : 'were';
      reasons.push(`${sources(skipped)} ${verb} skipped; see below.`);
    }
    if (toConfirm) {
      reasons.push(
        toConfirm === 1
          ? '1 job needs its location checked; it is under To confirm.'
          : `${toConfirm} jobs need their location checked; they are under To confirm.`,
      );
    }
    if (outOfScope) {
      const verb = outOfScope === 1 ? 'is' : 'are';
      reasons.push(`${jobs(outOfScope)} ${verb} outside the scope (${this.scope()}).`);
    }
    if (reasons.length === 0) reasons.push('Your sources list no more jobs in scope right now.');
    return reasons;
  });

  protected describe(source: SourceRun) {
    const name = `${source.param} (${source.name})`;
    switch (source.outcome) {
      case 'ok':
        return `${name}: ${jobs(source.found)} listed, ${source.added} new, ${source.closed} no longer listed.`;
      case 'failed':
        return `${name} could not be read: ${source.reason}`;
      case 'skipped':
        return `${name} was skipped: ${source.reason}`;
    }
  }
}
