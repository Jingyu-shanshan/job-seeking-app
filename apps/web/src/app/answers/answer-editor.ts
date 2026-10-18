import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormField, FormRoot, form, required } from '@angular/forms/signals';
import type { SaveAnswerRequest, SavedAnswer } from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { AnswersApi, parsePlaces } from './answers-api';

/** The editor as the form edits a saved answer: lists are lines of text. */
interface Model {
  wordings: string;
  answer: string;
  /** The answer is several options of a multi-select question, one per line. */
  several: boolean;
  sensitive: boolean;
  places: string;
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

function toModel(answer: SavedAnswer | null): Model {
  return {
    wordings: answer?.wordings.join('\n') ?? '',
    answer: answer?.answer.join('\n') ?? '',
    several: (answer?.answer.length ?? 0) > 1,
    sensitive: answer?.sensitive ?? false,
    places: answer?.places.join(', ') ?? '',
  };
}

function toRequest(m: Model): SaveAnswerRequest {
  return {
    wordings: lines(m.wordings),
    answer: m.several ? lines(m.answer) : [m.answer.trim()],
    sensitive: m.sensitive,
    places: parsePlaces(m.places),
  };
}

/** Adds a saved answer, or changes one (T16). */
@Component({
  selector: 'app-answer-editor',
  imports: [FormField, FormRoot],
  template: `
    <form [formRoot]="editor">
      <fieldset class="form-fields" [disabled]="locked() || editor().submitting()">
        <label>
          Questions it answers, one per line, worded as forms ask them
          <textarea rows="3" [formField]="editor.wordings"></textarea>
        </label>
        <label>
          Your answer
          <textarea rows="3" [formField]="editor.answer"></textarea>
        </label>
        <label class="check">
          <input type="checkbox" [formField]="editor.several" />
          Several options, one per line, for a question where you pick more than one
        </label>
        <label class="check">
          <input type="checkbox" [formField]="editor.sensitive" />
          Sensitive, such as a work permit, salary or self-identification: it fills an optional
          question only when you choose so for that job
        </label>
        <label>
          Only for jobs whose location names one of these places, separated by commas (empty: every
          job)
          <input type="text" [formField]="editor.places" />
        </label>
        @for (field of [editor.wordings, editor.answer]; track $index) {
          @if (field().touched() && field().errors().length) {
            <p class="error" role="alert">{{ field().errors()[0].message }}</p>
          }
        }
        @if (failure()) {
          <p class="error" role="alert">{{ failure() }}</p>
        }
        <p class="hint">
          Question wordings and your answer are required. Places are optional; an empty list means
          every job. Nothing here is sent to DeepSeek.
        </p>
      </fieldset>
      <div class="actions">
        <button
          type="submit"
          [disabled]="locked() || editor().submitting() || (answer() !== null && !unsaved())"
        >
          {{ answer() ? 'Save' : 'Add' }}
        </button>
        @if (answer()) {
          <button
            type="button"
            [disabled]="locked() || editor().submitting()"
            (click)="cancelled.emit()"
          >
            Cancel
          </button>
        }
      </div>
      <p role="status">
        {{
          editor().submitting()
            ? 'Saving answer…'
            : unsaved()
              ? 'Unsaved changes.'
              : status() || 'No unsaved changes.'
        }}
      </p>
    </form>
  `,
  styles: `
    form {
      display: grid;
      gap: 0.5rem;
      max-width: 72ch;
    }
    label {
      display: grid;
      gap: 0.25rem;
    }

    button {
      margin-right: 0.5rem;
    }
  `,
})
export class AnswerEditor {
  private readonly api = inject(AnswersApi);

  /** The saved answer to change; null to add one. */
  readonly answer = input<SavedAnswer | null>(null);
  readonly saved = output<SavedAnswer>();
  readonly saving = output<boolean>();
  readonly locked = input(false);
  readonly cancelled = output();

  private readonly model = linkedSignal<Model>(() => toModel(this.answer()));
  protected readonly status = signal('');
  protected readonly failure = signal('');
  protected readonly unsaved = computed(
    () => JSON.stringify(this.model()) !== JSON.stringify(toModel(this.answer())),
  );

  protected readonly editor = form(
    this.model,
    (s) => {
      required(s.wordings, { message: 'Write the question as a form asks it.' });
      required(s.answer, { message: 'Write your answer.' });
    },
    {
      submission: {
        action: async (f) => {
          if (this.locked()) return undefined;
          this.status.set('');
          this.failure.set('');
          this.saving.emit(true);
          const request = toRequest(f().value());
          const existing = this.answer();
          try {
            this.saved.emit(
              existing ? await this.api.update(existing.id, request) : await this.api.add(request),
            );
          } catch (error) {
            this.failure.set(errorMessage(error));
            return undefined;
          } finally {
            this.saving.emit(false);
          }
          if (!existing) f().reset(toModel(null));
          this.status.set('Answer saved.');
          return undefined;
        },
      },
    },
  );
}
