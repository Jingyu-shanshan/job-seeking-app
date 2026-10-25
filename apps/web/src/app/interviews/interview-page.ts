import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import { FormField, form, maxLength } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import type { InterviewSource, InterviewState } from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { CompanyResearchPanel } from './company-research';
import { InterviewsApi } from './interviews-api';

@Component({
  selector: 'app-interview-page',
  imports: [DatePipe, RouterLink, FormField, CompanyResearchPanel],
  template: `
    <p><a [routerLink]="['/applications', id()]">Back to the application</a></p>
    <h1>Interview preparation</h1>
    <p>
      Model-generated practice, based on the job text and the materials you actually sent. These are
      possible questions to practise, not questions the company is known to ask.
    </p>
    @if (data.hasValue()) {
      @let state = data.value();
      <h2>{{ state.title }}</h2>
      <section aria-labelledby="sources-heading">
        <h2 id="sources-heading">
          {{ state.preparation ? 'Sources used' : 'Text selected from the frozen application' }}
        </h2>
        <p class="hint">
          {{
            state.preparation
              ? 'This preparation used the frozen sources below. It cannot be regenerated; your notes can be updated separately.'
              : 'Only the text below and any excerpts you allow are sent. A later draft or job description is not used.'
          }}
        </p>
        @for (source of state.sources; track source.ref) {
          <details [id]="'source-' + source.ref">
            <summary>
              {{ source.ref }} ·
              {{ source.kind === 'job' ? 'Job text as sent' : 'Sent material excerpt' }}
            </summary>
            <pre>{{ source.text }}</pre>
            @if (source.fileId) {
              <p><a [href]="'/api/application-files/' + source.fileId">PDF as sent</a></p>
              <p class="hash">SHA-256 {{ source.sha256 }}</p>
              @if (source.factVersionIds.length) {
                <p class="hash">Fact versions: {{ source.factVersionIds.join(', ') }}</p>
              }
            }
          </details>
        } @empty {
          <p>No frozen source text is available.</p>
        }
      </section>
      @if (state.preparation; as prep) {
        <p class="hint">
          Generated {{ prep.createdAt | date: 'd MMM y, HH:mm' }} with {{ prep.model }}. Estimated
          cost: US$ {{ prep.costUsd }}.
        </p>
        @for (group of groups; track group.key) {
          <section [attr.aria-labelledby]="group.key + '-heading'">
            <h2 [id]="group.key + '-heading'">{{ group.label }}</h2>
            <ol>
              @for (q of prep.answer[group.key]; track $index) {
                <li>
                  {{ q.text }}
                  <span class="refs"
                    >Sources:
                    @for (ref of q.sources; track ref) {
                      <a [href]="'#source-' + ref">{{ ref }}</a>
                    }
                  </span>
                </li>
              }
            </ol>
          </section>
        }
        <section aria-labelledby="stories-heading">
          <h2 id="stories-heading">STAR drafts — to confirm</h2>
          <p>
            Review every experience and fill the gaps from your own memory. All story text and your
            notes stay in this practice area; they do not become confirmed facts or application
            materials.
          </p>
          @for (story of prep.answer.stories; track $index) {
            <article>
              <h3>{{ story.title }}</h3>
              <p class="tag todo">Practice draft · to confirm</p>
              <dl>
                <dt>Situation</dt>
                <dd>{{ story.situation ?? 'Add the context.' }}</dd>
                <dt>Task</dt>
                <dd>{{ story.task ?? 'Add your own responsibility.' }}</dd>
                <dt>Action</dt>
                <dd>{{ story.action ?? 'Add what you personally did.' }}</dd>
                <dt>Result</dt>
                <dd>{{ story.result ?? 'Add the actual outcome.' }}</dd>
              </dl>
              @if (story.missing.length) {
                <p class="notice">To fill in from your own memory:</p>
                <ul>
                  @for (gap of story.missing; track $index) {
                    <li>{{ gap }}</li>
                  }
                </ul>
              }
              <p class="refs">
                Sources:
                @for (ref of story.sources; track ref) {
                  <a [href]="'#source-' + ref">{{ ref }}</a>
                }
              </p>
            </article>
          }
        </section>
        <section aria-labelledby="notes-heading" [attr.aria-busy]="operation()?.kind === 'save'">
          <h2 id="notes-heading">Your private notes</h2>
          <label for="practice-notes">Your additions and practice notes — to confirm</label>
          <textarea
            id="practice-notes"
            rows="8"
            [formField]="notesForm.notes"
            [readOnly]="busy()"
            aria-describedby="notes-hint notes-feedback notes-error"
          ></textarea>
          <p class="hint" id="notes-hint">
            Saved privately in the app. Your notes are not sent to DeepSeek or added to facts or
            materials. Up to 12,000 characters.
          </p>
          <p class="error" role="alert" id="notes-error">
            @if (notesForm.notes().invalid()) {
              Keep your notes within 12,000 characters before saving.
            } @else if (error()) {
              Could not save practice notes. Your changes are still here. {{ error() }}
            }
          </p>
          <p id="notes-feedback" role="status">
            @if (operation()?.kind === 'save') {
              Saving practice notes…
            } @else if (unsaved()) {
              Unsaved changes.
            } @else if (saved()) {
              Notes saved.
            } @else {
              No unsaved changes.
            }
          </p>
          <button
            type="button"
            class="primary"
            (click)="saveNotes()"
            [disabled]="busy() || notesForm.notes().invalid() || !unsaved()"
          >
            {{ busy() ? 'Saving…' : 'Save notes' }}
          </button>
        </section>
      } @else {
        @if (state.cannotGenerate) {
          <p class="notice">{{ state.cannotGenerate }}</p>
          <p>Interview preparation is available only for an application recorded as Applied.</p>
        } @else {
          <section aria-labelledby="generate-heading" [attr.aria-busy]="busy()">
            <h2 id="generate-heading">Prepare from these sources</h2>
            <p>
              One click makes one paid DeepSeek request. The selected text leaves the EU. Contact
              details, form answers and private facts are excluded.
            </p>
            @if (state.omittedStatements) {
              <p class="notice">
                {{ state.omittedStatements }} frozen statements were left out because their facts
                are no longer allowed to go to the model, or they contain private details. The
                historical application record stays unchanged.
              </p>
            }
            <fieldset [disabled]="busy()" class="excerpts">
              <legend>External PDF excerpts for this preparation</legend>
              @if (!state.externalFiles.length) {
                <p>No external PDF excerpts to select. The frozen sources above will be used.</p>
              }
              @for (file of state.externalFiles; track file.id; let i = $index) {
                <section [attr.aria-label]="file.fileName">
                  <h3>{{ file.fileName }}</h3>
                  @if (file.problem) {
                    <p class="error">{{ file.problem }}</p>
                  } @else {
                    <details>
                      <summary>Read the text extracted from the PDF as sent</summary>
                      <pre>{{ file.text }}</pre>
                    </details>
                    <label [for]="'excerpt-' + i">Work excerpt to send (optional)</label>
                    <textarea
                      [id]="'excerpt-' + i"
                      [attr.aria-describedby]="'excerpt-hint-' + i"
                      rows="5"
                      [formField]="excerptForm.excerpts[i].text"
                    ></textarea>
                    <p class="hint" [id]="'excerpt-hint-' + i">
                      Copy one continuous passage above. Leave out your name, contact details,
                      address, work permit and salary. Leave blank to omit this file.
                    </p>
                  }
                </section>
              }
              @if (state.externalFiles.length) {
                <label class="consent"
                  ><input type="checkbox" [formField]="excerptForm.allowExcerpts" /> I checked the
                  excerpts for private details and allow them to go to DeepSeek outside the
                  EU.</label
                >
              }
            </fieldset>
            @if (!canGenerate()) {
              <p class="notice">
                {{
                  needsConsent()
                    ? 'Allow the selected excerpts before generating, or clear them to leave those files out.'
                    : 'Add a work excerpt from a PDF above. No permitted sent-material text is available yet.'
                }}
              </p>
            }
            <p>
              <button
                class="primary"
                type="button"
                (click)="generate()"
                [disabled]="busy() || !canGenerate()"
              >
                {{ busy() ? 'Generating practice…' : 'Generate interview practice' }}
              </button>
            </p>
            @if (busy()) {
              <p role="status">DeepSeek is preparing your practice. This can take two minutes.</p>
            }
            @if (error()) {
              <p class="error" role="alert">
                Could not generate interview practice. {{ error() }} Your excerpts are still here. A
                retry makes another paid request; the failed request may also have incurred a
                charge.
              </p>
            }
          </section>
        }
      }
      <app-company-research [applicationId]="id()" />
    } @else if (data.isLoading()) {
      <p role="status">Loading interview preparation…</p>
    } @else {
      <p class="error" role="alert">Could not load the application. {{ loadError() }}</p>
      <button type="button" (click)="data.reload()">Try again</button>
    }
  `,
  styles: `
    :host {
      display: block;
      max-width: 72ch;
    }
    section {
      margin-top: 32px;
    }
    .excerpts {
      border: 0;
      padding: 0;
    }
    .excerpts legend {
      padding: 0;
    }
    h2 {
      margin-bottom: 0.5rem;
    }
    h3 {
      margin-bottom: 0.5rem;
    }
    li,
    details {
      margin-bottom: 0.75rem;
    }
    article {
      margin: 24px 0;
      padding: 16px 0;
      border-block: 1px solid var(--line);
    }
    dt {
      font-weight: 600;
    }
    dd {
      margin: 0 0 0.75rem;
    }
    textarea {
      display: block;
      box-sizing: border-box;
      width: 100%;
      margin-top: 0.5rem;
      font: inherit;
      color: inherit;
      background: var(--surface);
    }
    button {
      min-height: 2.75rem;
      font: inherit;
    }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: inherit;
    }
    .refs,
    .hint,
    .hash {
      font-size: 14px;
    }
    .refs {
      display: block;
    }
    .refs a {
      margin-right: 0.5rem;
    }
    .hash {
      overflow-wrap: anywhere;
    }
    .consent {
      margin-top: 1rem;
    }
    a {
      text-underline-offset: 0.15em;
    }
  `,
})
export class InterviewPage {
  readonly id = input.required<string>();
  private readonly api = inject(InterviewsApi);
  protected readonly data = httpResource<InterviewState>(
    () => `/api/applications/${this.id()}/interview`,
  );
  protected readonly loadError = computed(() => errorMessage(this.data.error()));
  protected readonly operation = linkedSignal<string, { kind: 'generate' | 'save' } | null>({
    source: this.id,
    computation: () => null,
  });
  protected readonly busy = computed(() => this.operation() !== null);
  protected readonly error = linkedSignal({ source: this.id, computation: () => '' });
  protected readonly saved = linkedSignal({ source: this.id, computation: () => false });
  protected readonly groups = [
    { key: 'technical', label: 'Technical practice' },
    { key: 'projects', label: 'Project follow-ups' },
    { key: 'interviewer', label: 'Questions for the interviewer' },
  ] as const;
  private readonly notes = linkedSignal(() => ({
    notes: this.data.hasValue() ? (this.data.value().preparation?.notes ?? '') : '',
  }));
  protected readonly notesForm = form(this.notes, (p) => maxLength(p.notes, 12000));
  private readonly excerpts = linkedSignal(() => ({
    excerpts: this.data.hasValue()
      ? this.data.value().externalFiles.map((f) => ({ fileId: f.id, text: '' }))
      : [],
    allowExcerpts: false,
  }));
  protected readonly excerptForm = form(this.excerpts);
  protected readonly unsaved = computed(
    () =>
      this.data.hasValue() &&
      !!this.data.value().preparation &&
      this.notes().notes !== this.data.value().preparation?.notes,
  );
  protected readonly needsConsent = computed(
    () => this.excerpts().excerpts.some((e) => e.text.trim()) && !this.excerpts().allowExcerpts,
  );
  protected readonly canGenerate = computed(() => {
    if (!this.data.hasValue() || this.data.value().cannotGenerate) return false;
    const chosen = this.excerpts().excerpts.filter((e) => e.text.trim());
    return (
      (chosen.length === 0 || this.excerpts().allowExcerpts) &&
      (chosen.length > 0 ||
        this.data.value().sources.some((s: InterviewSource) => s.kind === 'material'))
    );
  });

  protected async generate() {
    if (this.busy() || !this.canGenerate()) return;
    const id = this.id();
    const operation = { kind: 'generate' } as const;
    this.operation.set(operation);
    this.error.set('');
    try {
      const picked = this.excerpts();
      const result = await this.api.generate(id, {
        ...picked,
        excerpts: picked.excerpts.filter((e) => e.text.trim()),
      });
      if (this.operation() === operation) this.data.set(result);
    } catch (error) {
      if (this.operation() === operation) this.error.set(errorMessage(error));
    } finally {
      if (this.operation() === operation) this.operation.set(null);
    }
  }

  protected async saveNotes() {
    if (this.busy() || !this.unsaved() || this.notesForm.notes().invalid()) return;
    const id = this.id();
    const operation = { kind: 'save' } as const;
    this.operation.set(operation);
    this.error.set('');
    this.saved.set(false);
    try {
      const result = await this.api.saveNotes(id, this.notes().notes);
      if (this.operation() === operation) {
        this.data.set(result);
        this.saved.set(true);
      }
    } catch (error) {
      if (this.operation() === operation) this.error.set(errorMessage(error));
    } finally {
      if (this.operation() === operation) this.operation.set(null);
    }
  }
}
