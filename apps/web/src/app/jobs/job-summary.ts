import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import type { JobDetail, Requirement, Snapshot, SummaryFieldKey } from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { JobsApi, usd } from './jobs-api';
import { RequirementForm } from './requirement-form';

// 字段名与顺序；类型保证与共享的 SummaryFields 一一对应。
const fieldLabels: Record<SummaryFieldKey, string> = {
  location: 'Location',
  workplace: 'Remote, hybrid or on-site',
  employmentType: 'Employment type',
  languages: 'Working languages',
  seniority: 'Seniority',
  salary: 'Salary',
  visaSponsorship: 'Visa sponsorship or work permit',
};

const kindLabels: Record<Requirement['kind'], string> = {
  must: 'Must have',
  nice: 'Nice to have',
};

/**
 * 一个快照的总结：职责、必须项、加分项和固定字段只列出引用能在原文里找到的条目；
 * 引用找不到的放在“待确认”，不算原文说过的内容。要求可以更正、移除或补充。
 */
@Component({
  selector: 'app-job-summary',
  imports: [DatePipe, RequirementForm],
  template: `
    @let s = snapshot();
    <h3>Responsibilities</h3>
    @if (responsibilities().length) {
      <ul>
        @for (item of responsibilities(); track $index) {
          <li>
            {{ item.text }}
            <span class="quote"> “{{ item.quote }}”</span>
          </li>
        }
      </ul>
    } @else {
      <p>None found in the job text.</p>
    }

    @for (group of groups(); track group.heading) {
      <h3>{{ group.heading }}</h3>
      @if (group.note) {
        <p>{{ group.note }}</p>
      }
      @if (group.items.length) {
        <ul>
          @for (r of group.items; track r.id) {
            <li>
              @if (editing() === r.id) {
                <app-requirement-form
                  [snapshotId]="s.id"
                  [replaces]="r"
                  (saved)="saved($event)"
                  (cancelled)="editing.set(null)"
                />
              } @else {
                @if (group.showKind) {
                  <span class="tag">{{ kindLabel(r) }}</span>
                }
                {{ r.text }}
                @if (r.origin === 'user') {
                  <span class="tag">added by you</span>
                }
                @if (r.quote) {
                  <span class="quote"> “{{ r.quote }}”</span>
                }
                <span class="actions">
                  <button
                    type="button"
                    [disabled]="busy()"
                    [attr.aria-label]="'Correct ' + r.text"
                    (click)="editing.set(r.id)"
                  >
                    Correct
                  </button>
                  <button
                    type="button"
                    [disabled]="busy()"
                    [attr.aria-label]="'Remove ' + r.text"
                    (click)="remove(r)"
                  >
                    Remove
                  </button>
                </span>
              }
            </li>
          }
        </ul>
      } @else {
        <p>None found in the job text.</p>
      }
    }

    @if (editing() === 'new') {
      <app-requirement-form
        [snapshotId]="s.id"
        (saved)="saved($event)"
        (cancelled)="editing.set(null)"
      />
    } @else {
      <button type="button" [disabled]="busy()" (click)="editing.set('new')">
        Add a requirement
      </button>
    }

    <h3>Details</h3>
    <dl>
      @for (field of fields(); track field.key) {
        <dt>{{ field.label }}</dt>
        <dd>
          @if (!field.value) {
            Not stated in the job text.
          } @else if (field.value.quoteVerified) {
            {{ field.value.value }}
            <span class="quote"> “{{ field.value.quote }}”</span>
          } @else {
            Unknown: the quote given for “{{ field.value.value }}” is not in the job text.
          }
        </dd>
      }
    </dl>

    @if (unverifiedResponsibilities().length) {
      <h3>Responsibilities to confirm</h3>
      <p>Their quotes are not in the job text, so they are not part of the summary.</p>
      <ul>
        @for (item of unverifiedResponsibilities(); track $index) {
          <li>
            {{ item.text }}
            <span class="quote"> “{{ item.quote }}”</span>
          </li>
        }
      </ul>
    }

    @if (failure()) {
      <p class="error" role="alert">{{ failure() }}</p>
    }
    <p class="hint">
      Summarised by {{ summary().model }} on {{ summary().createdAt | date: 'd MMM y' }}, about
      {{ cost() }}.
    </p>
  `,
  styles: `
    ul {
      padding-left: 1.25rem;
    }
    li {
      margin-bottom: 0.5rem;
    }
    .quote {
      display: block;
      font-size: 0.9rem;
      font-style: italic;
    }
    .tag {
      font-size: 0.8rem;
      border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
      border-radius: 0.25rem;
      padding: 0 0.25rem;
    }
    .actions button {
      margin-right: 0.5rem;
    }
    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 0.5rem 1rem;
    }
    dt {
      font-weight: 600;
    }
    dd {
      margin: 0;
    }
    .hint {
      font-size: 0.9rem;
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
    @media (max-width: 40rem) {
      dl {
        grid-template-columns: 1fr;
      }
      dd {
        margin-bottom: 0.5rem;
      }
    }
  `,
})
export class JobSummaryView {
  private readonly api = inject(JobsApi);

  /** 已经总结过的快照。 */
  readonly snapshot = input.required<Snapshot>();
  /** 要求改变后的职位详情。 */
  readonly changed = output<JobDetail>();

  /** 正在更正的要求，`new` 表示正在添加。 */
  protected readonly editing = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');

  protected readonly summary = computed(() => this.snapshot().summary!);
  protected readonly cost = computed(() => usd(this.summary().costUsd));

  protected readonly responsibilities = computed(() =>
    this.summary().responsibilities.filter((item) => item.quoteVerified),
  );
  protected readonly unverifiedResponsibilities = computed(() =>
    this.summary().responsibilities.filter((item) => !item.quoteVerified),
  );

  protected readonly groups = computed(() => {
    const requirements = this.snapshot().requirements;
    const verified = (kind: Requirement['kind']) =>
      requirements.filter((r) => r.quoteVerified && r.kind === kind);
    const unverified = requirements.filter((r) => !r.quoteVerified);
    return [
      { heading: 'Must have', note: '', items: verified('must'), showKind: false },
      { heading: 'Nice to have', note: '', items: verified('nice'), showKind: false },
      ...(unverified.length
        ? [
            {
              heading: 'Requirements to confirm',
              note: 'Their quotes are not in the job text, so they are not counted as what the job asks. Correct the quote or remove them.',
              items: unverified,
              showKind: true,
            },
          ]
        : []),
    ];
  });

  protected readonly fields = computed(() =>
    (Object.keys(fieldLabels) as SummaryFieldKey[]).map((key) => ({
      key,
      label: fieldLabels[key],
      value: this.summary().fields[key],
    })),
  );

  protected kindLabel(requirement: Requirement) {
    return kindLabels[requirement.kind];
  }

  protected saved(detail: JobDetail) {
    this.editing.set(null);
    this.failure.set('');
    this.changed.emit(detail);
  }

  protected async remove(requirement: Requirement) {
    this.busy.set(true);
    this.failure.set('');
    try {
      this.changed.emit(await this.api.removeRequirement(requirement.id));
    } catch (error) {
      this.failure.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
