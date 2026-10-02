import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { DiscoveryRun, SourceRun } from '@jsa/shared';

export interface JobCounts {
  eligible: number;
  toConfirm: number;
  ineligible: number;
}

const jobs = (n: number) => (n === 1 ? '1 job' : `${n} jobs`);
const sources = (n: number) => (n === 1 ? '1 source' : `${n} sources`);

/**
 * What the last run did with each source and, when the eligible jobs fall short of what the user
 * wanted, why. The app never adds sources or loosens the criteria to make up the difference.
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
          The app does not add sources or loosen your criteria on its own. You can change them on
          the <a routerLink="/sources">Sources</a> and <a routerLink="/criteria">Criteria</a> pages.
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
  /** How many eligible jobs the user wanted; null when they did not say. */
  readonly target = input.required<number | null>();

  protected readonly headline = computed(() => {
    const found = `${jobs(this.counts().eligible)} eligible.`;
    const target = this.target();
    return target === null ? found : `${found} You wanted ${target}.`;
  });

  /** Only when there is a target and the eligible jobs fall short of it. */
  protected readonly shortfall = computed(() => {
    const target = this.target();
    const { eligible, toConfirm, ineligible } = this.counts();
    if (target === null || eligible >= target) return [];
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
          ? '1 job does not say enough for a hard criterion; it is under To confirm.'
          : `${toConfirm} jobs do not say enough for a hard criterion; they are under To confirm.`,
      );
    }
    if (ineligible) {
      const verb = ineligible === 1 ? 'is' : 'are';
      reasons.push(`${jobs(ineligible)} ${verb} ruled out by your criteria.`);
    }
    if (reasons.length === 0) reasons.push('Your sources list no more eligible jobs right now.');
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
