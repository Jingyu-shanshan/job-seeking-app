import { Component, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormField, FormRoot, form, validate } from '@angular/forms/signals';
import type { FormFill, JobFormState, SavedAnswer } from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { AnswersApi, parsePlaces } from './answers-api';

interface Model {
  /** A text answer, or the chosen option of a single-choice question. */
  text: string;
  /** The chosen options of a multi-choice question. */
  choices: string[];
  consent: boolean;
  save: boolean;
  sensitive: boolean;
  places: string;
}

/** The user's answer to one question of a job's form, or a saved answer for it (T16). */
@Component({
  selector: 'app-question-answer-form',
  imports: [FormField, FormRoot],
  template: `
    @let q = fill().question;
    <form [formRoot]="answerForm">
      @switch (q.kind) {
        @case ('text') {
          <label>
            Your answer for this job
            <input type="text" [formField]="answerForm.text" />
          </label>
        }
        @case ('textarea') {
          <label>
            Your answer for this job
            <textarea rows="4" [formField]="answerForm.text"></textarea>
          </label>
        }
        @case ('single') {
          <label>
            Your answer for this job
            <select [formField]="answerForm.text">
              <option value="">Choose…</option>
              @for (option of q.options; track option) {
                <option [value]="option">{{ option }}</option>
              }
            </select>
          </label>
        }
        @case ('multi') {
          <fieldset>
            <legend>Your answer for this job</legend>
            @for (option of q.options; track option) {
              <label class="check">
                <input
                  type="checkbox"
                  [checked]="model().choices.includes(option)"
                  (change)="toggle(option, box.checked)"
                  #box
                />
                {{ option }}
              </label>
            }
          </fieldset>
        }
        @case ('consent') {
          <label class="check">
            <input type="checkbox" [formField]="answerForm.consent" />
            I give this consent for this application
          </label>
        }
      }
      @if (q.kind !== 'consent') {
        <label class="check">
          <input type="checkbox" [formField]="answerForm.save" />
          Also save it for later applications, for questions worded like this one
        </label>
        @if (model().save) {
          <label class="check">
            <input type="checkbox" [formField]="answerForm.sensitive" />
            Sensitive: it fills an optional question only when you choose so for that job
          </label>
          <label>
            Only for jobs whose location names one of these places, separated by commas (empty:
            every job)
            <input type="text" [formField]="answerForm.places" />
          </label>
        }
      }
      @if (answerForm().touched()) {
        @for (error of answerForm().errors(); track $index) {
          <p class="error" role="alert">{{ error.message }}</p>
        }
      }
      <p>
        <button type="submit" [disabled]="answerForm().submitting() || busy()">Save</button>
        <button type="button" (click)="cancelled.emit()">Cancel</button>
      </p>
    </form>

    @if (q.kind !== 'consent' && saved().length) {
      <div class="saved">
        <label>
          Or use one of your saved answers; the app remembers this wording for it
          <select [value]="pick()" (change)="pick.set(choice.value)" #choice>
            <option value="">Choose…</option>
            @for (a of saved(); track a.id) {
              <option [value]="a.id">{{ describe(a) }}</option>
            }
          </select>
        </label>
        <button type="button" [disabled]="!pick() || busy()" (click)="useSaved()">Use it</button>
        @if (pickFailure()) {
          <p class="error" role="alert">{{ pickFailure() }}</p>
        }
      </div>
    }
  `,
  styles: `
    form,
    .saved {
      display: grid;
      gap: 0.5rem;
      max-width: 40rem;
      margin: 0.5rem 0;
    }
    label {
      display: grid;
      gap: 0.25rem;
    }
    .check {
      display: block;
    }
    fieldset {
      margin: 0;
    }
    button {
      justify-self: start;
      margin-right: 0.5rem;
    }
    .error {
      margin: 0;
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class QuestionAnswerForm {
  private readonly api = inject(AnswersApi);

  readonly jobId = input.required<string>();
  readonly fill = input.required<FormFill>();
  /** The user's saved answers, to pick from. */
  readonly saved = input<SavedAnswer[]>([]);
  readonly changed = output<JobFormState>();
  readonly cancelled = output();

  protected readonly model = linkedSignal<Model>(() => {
    const f = this.fill();
    const mine = f.source === 'job' ? f.answer : [];
    return {
      text: f.question.kind === 'multi' ? '' : (mine[0] ?? ''),
      choices: f.question.kind === 'multi' ? mine : [],
      consent: f.question.kind === 'consent' && mine.length > 0,
      save: false,
      sensitive: f.looksSensitive,
      places: '',
    };
  });

  protected readonly busy = signal(false);
  protected readonly pick = signal('');
  protected readonly pickFailure = signal('');

  protected readonly describe = (a: SavedAnswer) =>
    `${a.wordings[0]}: ${a.answer.join('; ')}${a.places.length ? ` (${a.places.join(', ')})` : ''}`;

  /** The answer as the server takes it, or why there is none yet. */
  private answerOf(m: Model): string[] | string {
    switch (this.fill().question.kind) {
      case 'consent':
        return m.consent ? ['yes'] : 'Tick the box to give the consent.';
      case 'multi':
        return m.choices.length ? m.choices : 'Choose at least one option.';
      case 'single':
        return m.text ? [m.text] : 'Choose one of the options.';
      default:
        return m.text.trim() ? [m.text.trim()] : 'Write your answer.';
    }
  }

  protected readonly answerForm = form(
    this.model,
    (s) => {
      validate(s, ({ value }) => {
        const answer = this.answerOf(value());
        return typeof answer === 'string' ? { kind: 'missing', message: answer } : undefined;
      });
    },
    {
      submission: {
        action: async (f) => {
          const { save, sensitive, places } = f().value();
          try {
            this.changed.emit(
              await this.api.answer(this.jobId(), this.fill().question.key, {
                answer: this.answerOf(f().value()) as string[],
                ...(save ? { save: { sensitive, places: parsePlaces(places) } } : {}),
              }),
            );
          } catch (error) {
            return { kind: 'server', message: errorMessage(error) };
          }
          return undefined;
        },
      },
    },
  );

  protected toggle(option: string, on: boolean) {
    this.model.update((m) => ({
      ...m,
      choices: on ? [...m.choices, option] : m.choices.filter((c) => c !== option),
    }));
  }

  protected async useSaved() {
    this.busy.set(true);
    this.pickFailure.set('');
    try {
      this.changed.emit(
        await this.api.useSaved(this.jobId(), this.fill().question.key, this.pick()),
      );
    } catch (error) {
      this.pickFailure.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
