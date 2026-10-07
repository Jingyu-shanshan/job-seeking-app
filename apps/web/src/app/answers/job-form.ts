import { httpResource } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type {
  FillStatus,
  FormFill,
  FormQuestionGroup,
  JobFormState,
  SavedAnswer,
} from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { AnswersApi } from './answers-api';
import { QuestionAnswerForm } from './question-answer-form';

const statusLabels: Record<FillStatus, string> = {
  filled: 'Filled',
  needs_answer: 'Needs your answer',
  optional_empty: 'Optional, left empty',
  held_back: 'Held back',
};

const groupLabels: Partial<Record<FormQuestionGroup, string>> = {
  location: 'Where you live',
  compliance: 'Self-identification',
  demographic: 'Demographic',
  consent: 'Consent',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The job page's application form, filled with the answers the app has (T16). */
@Component({
  selector: 'app-job-form',
  imports: [DatePipe, QuestionAnswerForm, RouterLink],
  template: `
    @if (state.hasValue()) {
      @let s = state.value();
      @if (s.form; as form) {
        <p>
          Read from the job board {{ form.readAt | date: 'd MMM y'
          }}{{
            form.lastReadAt !== form.readAt
              ? ', unchanged when read again ' + (form.lastReadAt | date: 'd MMM y')
              : ''
          }}. {{ overview() }}
        </p>
        <p class="hint">
          The app fills a question with your answer for this job, a saved answer worded like it, a
          detail from <a routerLink="/profile">Your details</a>, or a PDF you kept. It never
          guesses: a required question that nothing fits needs your answer. A sensitive saved answer
          fills an optional question only when you choose so here. Saved answers are on the
          <a routerLink="/answers">Form answers</a> page. Nothing is sent to DeepSeek.
        </p>
        @if (s.canRead) {
          <button type="button" [disabled]="busy()" (click)="read()">Read the form again</button>
        }
        <ol class="questions">
          @for (f of form.fills; track f.question.key) {
            @let q = f.question;
            <li [class]="f.status">
              <p class="label">
                {{ q.label }}
                <span class="hint">({{ q.required ? 'required' : 'optional' }})</span>
                @if (groupLabels[q.group]; as group) {
                  &ngsp;<span class="tag">{{ group }}</span>
                }
                @if (f.sensitive) {
                  &ngsp;<span class="tag">Sensitive</span>
                }
              </p>
              @if (q.description) {
                <p class="description">{{ q.description }}</p>
              }
              @let shown = answerLine(f);
              <p>
                <strong>{{ statusLabels[f.status] }}{{ shown ? ':' : '' }}</strong
                >&ngsp;<span class="answer">{{ shown }}</span>
              </p>
              <p class="note">{{ f.note }}</p>
              @if (editing() === q.key) {
                <app-question-answer-form
                  [jobId]="jobId()"
                  [fill]="f"
                  [saved]="saved.value() ?? []"
                  (changed)="changed($event)"
                  (cancelled)="editing.set(null)"
                />
              } @else {
                <p class="actions">
                  @if (f.status === 'held_back') {
                    <button
                      type="button"
                      [disabled]="busy()"
                      [attr.aria-label]="'Use your saved answer for this job: ' + q.label"
                      (click)="useHeldBack(f)"
                    >
                      Use your saved answer for this job
                    </button>
                  }
                  @if (q.kind !== 'file') {
                    @let change = f.source === 'job' ? 'Change your answer' : 'Answer for this job';
                    <button
                      type="button"
                      [disabled]="busy()"
                      [attr.aria-label]="change + ': ' + q.label"
                      (click)="editing.set(q.key)"
                    >
                      {{ change }}
                    </button>
                  }
                  @if (f.answeredForJob) {
                    <button
                      type="button"
                      [disabled]="busy()"
                      [attr.aria-label]="'Take back your answer for this job: ' + q.label"
                      (click)="clear(f)"
                    >
                      Take back your answer for this job
                    </button>
                  }
                </p>
              }
            </li>
          }
        </ol>
      } @else if (s.canRead) {
        <p>
          Reading the form sends one request to the job board, and nothing about you. The app then
          shows each question with the answer it would give, and the ones that need yours.
        </p>
        <button type="button" [disabled]="busy()" (click)="read()">
          Read the application form
        </button>
      } @else {
        <p>
          The app reads application forms only from Greenhouse job boards you use, and none of them
          lists this job now.
        </p>
      }
      <p role="status">{{ status() }}</p>
      @if (failure()) {
        <p class="error" role="alert">{{ failure() }}</p>
      }
    } @else if (state.isLoading()) {
      <p role="status">Loading the application form…</p>
    } @else {
      <p class="error" role="alert">The application form could not be loaded. {{ loadError() }}</p>
    }
  `,
  styles: `
    .questions {
      padding-left: 1.5rem;
    }
    .questions > li {
      margin-bottom: 1rem;
    }
    .questions p {
      margin: 0.25rem 0;
    }
    .label {
      font-weight: 600;
    }
    .label .hint {
      font-weight: normal;
    }
    .needs_answer strong {
      color: light-dark(#a3141c, #ff9b9b);
    }
    .answer,
    .description {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .note,
    .description {
      font-size: 0.9rem;
    }
    .hint {
      font-size: 0.9rem;
    }
    .tag {
      font-size: 0.8rem;
      font-weight: normal;
      border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
      border-radius: 0.25rem;
      padding: 0 0.25rem;
      margin-left: 0.25rem;
    }
    .actions button {
      margin-right: 0.5rem;
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class JobForm {
  private readonly api = inject(AnswersApi);

  readonly jobId = input.required<string>();

  protected readonly state = httpResource<JobFormState>(() => `/api/jobs/${this.jobId()}/form`);
  private readonly hasForm = computed(() => !!this.state.value()?.form);
  // Only a form's questions need them; read again when an answer may have added or changed one.
  protected readonly saved = httpResource<SavedAnswer[]>(() =>
    this.hasForm() ? '/api/answers' : undefined,
  );
  protected readonly loadError = computed(() => errorMessage(this.state.error()));

  protected readonly statusLabels = statusLabels;
  protected readonly groupLabels = groupLabels;
  protected readonly busy = signal(false);
  protected readonly status = signal('');
  protected readonly failure = signal('');
  /** The question whose answer form is open. */
  protected readonly editing = signal<string | null>(null);

  protected readonly overview = computed(() => {
    const fills = this.state.value()?.form?.fills ?? [];
    const counted = (status: FillStatus) => fills.filter((f) => f.status === status).length;
    const parts = [
      `${counted('filled')} filled`,
      `${counted('needs_answer')} need your answer`,
      `${counted('optional_empty') + counted('held_back')} optional left empty`,
    ];
    return `${plural(fills.length, 'question')}: ${parts.join(', ')}.`;
  });

  /** What the form gets, or the saved answer it would get if the user chose so. */
  protected answerLine(f: FormFill): string {
    if (f.answer.length) return f.answer.join('; ');
    const held = this.saved.value()?.find((a) => a.id === f.savedAnswerId);
    return f.status === 'held_back' && held
      ? `your saved answer “${held.answer.join('; ')}” is not used`
      : '';
  }

  protected changed(state: JobFormState) {
    this.state.set(state);
    this.editing.set(null);
    // A new saved answer, or a remembered wording.
    this.saved.reload();
  }

  protected read() {
    return this.run('Reading the application form from the job board…', () =>
      this.api.readForm(this.jobId()),
    );
  }

  protected useHeldBack(f: FormFill) {
    return this.run('', () => this.api.answer(this.jobId(), f.question.key, { answer: null }));
  }

  protected clear(f: FormFill) {
    return this.run('', () => this.api.clear(this.jobId(), f.question.key));
  }

  private async run(working: string, change: () => Promise<JobFormState>) {
    this.busy.set(true);
    this.failure.set('');
    this.status.set(working);
    try {
      this.state.set(await change());
      this.status.set('');
    } catch (error) {
      this.status.set('');
      this.failure.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
