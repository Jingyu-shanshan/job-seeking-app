import { httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, maxLength, required } from '@angular/forms/signals';
import type { Fact, FactKind, FactsResponse } from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { FactCard } from './fact-card';
import { FactsApi, kindLabels } from './facts-api';

const kinds = Object.keys(kindLabels) as FactKind[];

@Component({
  selector: 'app-facts',
  imports: [FactCard, FormField, FormRoot],
  template: `
    <h1>Facts about you</h1>
    <p>
      Your experience, skills and how you describe yourself. Only facts you confirmed and allowed
      for materials can appear in a resume or cover letter, and only facts you allowed for DeepSeek
      are ever sent to it. Editing a fact adds a new version that you confirm again; versions are
      never deleted.
    </p>

    <details>
      <summary><h2>Add a fact</h2></summary>
      <form [formRoot]="addForm">
        <label>
          Kind
          <select [formField]="addForm.kind">
            @for (kind of kinds; track kind) {
              <option [value]="kind">{{ kindLabels[kind] }}</option>
            }
          </select>
        </label>
        <label>
          Text
          <textarea rows="3" [formField]="addForm.body"></textarea>
        </label>
        @if (addForm.body().touched() && addForm.body().errors().length) {
          <p class="error" role="alert">{{ addForm.body().errors()[0].message }}</p>
        }
        @for (error of addForm().errors(); track $index) {
          <p class="error" role="alert">{{ error.message }}</p>
        }
        <button type="submit" [disabled]="addForm().submitting()">Add</button>
      </form>
    </details>

    <details>
      <summary><h2>Import Markdown</h2></summary>
      <p>
        Each list item or paragraph becomes one fact to confirm; the heading above it decides its
        kind (for example “Work experience”, “Skills”, “Languages”). Facts you already have are
        skipped.
      </p>
      <label>
        Markdown file
        <input
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          (change)="readFile(file)"
          #file
        />
      </label>
      <label>
        Or paste it
        <textarea rows="8" [value]="markdown()" (input)="markdown.set(area.value)" #area></textarea>
      </label>
      <button
        type="button"
        [disabled]="importing() || !markdown().trim()"
        (click)="importMarkdown()"
      >
        Import
      </button>
      <p role="status">{{ importResult() }}</p>
      @if (importError()) {
        <p class="error" role="alert">{{ importError() }}</p>
      }
    </details>

    @if (data.hasValue()) {
      <p>{{ overview() }}</p>
      @for (group of groups(); track group.kind) {
        <section [attr.aria-labelledby]="group.kind + '-heading'">
          <h2 [id]="group.kind + '-heading'">{{ group.label }} ({{ group.facts.length }})</h2>
          @for (fact of group.facts; track fact.id) {
            <app-fact-card [fact]="fact" (changed)="replace($event)" />
          }
        </section>
      } @empty {
        <p>No facts yet. Add one or import a Markdown file.</p>
      }
    } @else if (data.isLoading()) {
      <p role="status">Loading facts…</p>
    } @else {
      <p class="error" role="alert">The facts could not be loaded. {{ loadError() }}</p>
    }
  `,
  styles: `
    summary h2 {
      display: inline;
    }
    form,
    details > label {
      display: grid;
      gap: 0.5rem;
      max-width: 48rem;
      margin-bottom: 0.5rem;
    }
    label {
      display: grid;
      gap: 0.25rem;
    }
    button {
      justify-self: start;
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class Facts {
  private readonly api = inject(FactsApi);

  protected readonly kinds = kinds;
  protected readonly kindLabels = kindLabels;

  protected readonly data = httpResource<FactsResponse>(() => '/api/facts');
  protected readonly loadError = computed(() => errorMessage(this.data.error()));

  protected readonly groups = computed(() => {
    const facts = this.data.value()?.facts ?? [];
    return kinds
      .map((kind) => ({
        kind,
        label: kindLabels[kind],
        facts: facts.filter((f) => f.kind === kind),
      }))
      .filter((group) => group.facts.length > 0);
  });

  protected readonly overview = computed(() => {
    const facts = this.data.value()?.facts ?? [];
    const toConfirm = facts.filter((f) => f.current.status === 'proposed').length;
    const usable = facts.filter((f) => f.usableInMaterials).length;
    return `${facts.length} facts: ${toConfirm} to confirm, ${usable} usable in materials.`;
  });

  private readonly addModel = signal<{ kind: FactKind; body: string }>({
    kind: 'experience',
    body: '',
  });

  protected readonly addForm = form(
    this.addModel,
    (s) => {
      required(s.body, { message: 'Write the fact.' });
      maxLength(s.body, 5000, { message: 'Keep a fact under 5000 characters.' });
    },
    {
      submission: {
        action: async (f) => {
          const { kind, body } = f().value();
          try {
            const fact = await this.api.add(kind, body.trim());
            this.data.update((d) => d && { facts: [...d.facts, fact] });
          } catch (error) {
            return { kind: 'server', message: errorMessage(error) };
          }
          f().reset({ kind, body: '' });
          return undefined;
        },
      },
    },
  );

  protected readonly markdown = signal('');
  protected readonly importing = signal(false);
  protected readonly importResult = signal('');
  protected readonly importError = signal('');

  protected replace(fact: Fact) {
    this.data.update((d) => d && { facts: d.facts.map((f) => (f.id === fact.id ? fact : f)) });
  }

  protected async readFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (file) this.markdown.set(await file.text());
  }

  protected async importMarkdown() {
    this.importing.set(true);
    this.importResult.set('');
    this.importError.set('');
    try {
      const result = await this.api.import(this.markdown());
      this.data.set({ facts: result.facts });
      this.importResult.set(
        `Added ${result.added} facts to confirm; skipped ${result.skipped} you already had.`,
      );
      this.markdown.set('');
    } catch (error) {
      this.importError.set(errorMessage(error));
    } finally {
      this.importing.set(false);
    }
  }
}
