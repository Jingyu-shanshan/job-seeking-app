import { httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SavedAnswer } from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { AnswerEditor } from './answer-editor';
import { AnswersApi } from './answers-api';

/** The user's saved answers to application-form questions (T16). */
@Component({
  selector: 'app-answers',
  imports: [AnswerEditor, RouterLink],
  template: `
    <h1>Form answers</h1>
    <p>
      Answers the app puts into application forms. Only you write them. A saved answer fills a
      question worded like one of its questions (case and punctuation do not matter), and only for
      jobs whose location names one of its places, if it has any. A question that no answer fits
      waits for your answer on the job’s page: the app never guesses one. Your email, phone, where
      you live and your links come from <a routerLink="/profile">Your details</a>. Nothing here is
      sent to DeepSeek.
    </p>

    <details>
      <summary><h2>Add an answer</h2></summary>
      <app-answer-editor (saved)="added($event)" />
    </details>

    @if (data.hasValue()) {
      <section aria-labelledby="saved-heading">
        <h2 id="saved-heading">Saved answers ({{ data.value().length }})</h2>
        @for (a of data.value(); track a.id) {
          <article [attr.aria-label]="a.wordings[0]">
            @if (editing() === a.id) {
              <app-answer-editor
                [answer]="a"
                (saved)="replace($event)"
                (cancelled)="editing.set(null)"
              />
            } @else {
              <ul class="wordings">
                @for (w of a.wordings; track $index) {
                  <li>{{ w }}</li>
                }
              </ul>
              <p class="answer">{{ a.answer.join('; ') }}</p>
              <p class="hint">
                @if (a.sensitive) {
                  <span class="tag">Sensitive</span>
                }
                {{ a.places.length ? 'Only for jobs in ' + a.places.join(', ') : 'Every job' }}
              </p>
              <button type="button" [disabled]="busy()" (click)="editing.set(a.id)">Edit</button>
              <button type="button" [disabled]="busy()" (click)="remove(a)">Delete</button>
            }
          </article>
        } @empty {
          <p>
            No saved answers yet. Add one here, or save an answer you give on a job’s application
            form.
          </p>
        }
      </section>
      @if (failure()) {
        <p class="error" role="alert">{{ failure() }}</p>
      }
    } @else if (data.isLoading()) {
      <p role="status">Loading your answers…</p>
    } @else {
      <p class="error" role="alert">Your answers could not be loaded. {{ loadError() }}</p>
    }
  `,
  styles: `
    summary h2 {
      display: inline;
    }
    article {
      border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
      border-radius: 0.5rem;
      padding: 0.5rem 1rem;
      margin-bottom: 0.75rem;
    }
    .wordings {
      margin: 0;
      padding-left: 1.25rem;
      font-weight: 600;
    }
    .answer {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .hint {
      font-size: 0.9rem;
    }
    .tag {
      border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
      border-radius: 0.25rem;
      padding: 0 0.25rem;
      margin-right: 0.25rem;
    }
    button {
      margin-right: 0.5rem;
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class Answers {
  private readonly api = inject(AnswersApi);

  protected readonly data = httpResource<SavedAnswer[]>(() => '/api/answers');
  protected readonly loadError = computed(() => errorMessage(this.data.error()));

  protected readonly editing = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');

  protected added(answer: SavedAnswer) {
    this.data.update((answers) => answers && [...answers, answer]);
  }

  protected replace(answer: SavedAnswer) {
    this.data.update((answers) => answers?.map((a) => (a.id === answer.id ? answer : a)));
    this.editing.set(null);
  }

  protected async remove(answer: SavedAnswer) {
    this.busy.set(true);
    this.failure.set('');
    try {
      await this.api.remove(answer.id);
      this.data.update((answers) => answers?.filter((a) => a.id !== answer.id));
    } catch (error) {
      this.failure.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
