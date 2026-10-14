import { httpResource } from '@angular/common/http';
import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormField, FormRoot, form, maxLength, required } from '@angular/forms/signals';
import type { Fact, FactKind, FactsResponse, SaveFactCandidatesResponse } from '@jsa/shared';
import { errorMessage } from '../sources/sources-api';
import { FactCard } from './fact-card';
import { FactImport } from './fact-import';
import { FactsApi, kindLabels } from './facts-api';

const kinds = Object.keys(kindLabels) as FactKind[];

@Component({
  selector: 'app-facts',
  imports: [FactCard, FactImport, FormField, FormRoot],
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

    <p role="status" tabindex="-1" #feedback>{{ operationResult() }}</p>
    <app-fact-import
      [facts]="data.value()?.facts ?? []"
      (saved)="imported($event, feedback)"
      (viewFact)="showFact($event)"
    />

    @if (data.hasValue()) {
      <div class="filters" aria-label="Filter active facts">
        <label>
          Status
          <select [value]="statusFilter()" (change)="statusFilter.set(status.value)" #status>
            <option value="all">All active</option>
            <option value="proposed">To confirm</option>
            <option value="confirmed">Confirmed</option>
          </select>
        </label>
        <label>
          Kind
          <select [value]="kindFilter()" (change)="kindFilter.set(kind.value)" #kind>
            <option value="all">All kinds</option>
            @for (kind of kinds; track kind) {
              <option [value]="kind">{{ kindLabels[kind] }}</option>
            }
          </select>
        </label>
      </div>
      <p>{{ overview() }}</p>
      <p class="hint">
        Usable in materials means this current version is confirmed and its materials permission is
        on. The DeepSeek permission is separate. Withdrawn facts are excluded.
      </p>
      @for (section of groups(); track section.status) {
        <section [attr.aria-labelledby]="section.status + '-heading'">
          <h2 [id]="section.status + '-heading'">{{ section.label }} ({{ section.count }})</h2>
          @for (group of section.kinds; track group.kind) {
            <h3>{{ group.label }} ({{ group.facts.length }})</h3>
            @for (fact of group.facts; track fact.id) {
              <app-fact-card
                [id]="'fact-' + fact.id"
                tabindex="-1"
                [fact]="fact"
                (changed)="replace($event, feedback)"
              />
            }
          }
        </section>
      } @empty {
        @if (!data.value().facts.length) {
          <p>No facts yet. Add one or import a Markdown file.</p>
        } @else if (!active().length) {
          <p>No active facts. Your withdrawn facts are kept below.</p>
        } @else {
          <p>No active facts match these filters.</p>
          <button type="button" (click)="statusFilter.set('all'); kindFilter.set('all')">
            Clear filters
          </button>
        }
      }
      <details class="withdrawn">
        <summary>
          <h2>Withdrawn ({{ withdrawn().length }})</h2>
        </summary>
        <p>
          Kept for their original text and history. Future matches and materials do not use them.
        </p>
        @for (fact of withdrawn(); track fact.id) {
          <app-fact-card
            [id]="'fact-' + fact.id"
            tabindex="-1"
            [fact]="fact"
            (changed)="replace($event, feedback)"
          />
        } @empty {
          <p>No withdrawn facts.</p>
        }
      </details>
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
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem 1.5rem;
      margin-top: 1.5rem;
    }
    select,
    textarea {
      max-width: 100%;
      box-sizing: border-box;
      font: inherit;
    }
    button,
    select,
    summary {
      min-height: 2.75rem;
    }
    summary {
      align-content: center;
      cursor: pointer;
    }
    .withdrawn {
      border-top: 1px solid color-mix(in srgb, currentColor 25%, transparent);
      margin-top: 2rem;
      padding-top: 1rem;
    }
    .hint {
      font-size: 0.9rem;
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class Facts {
  private readonly api = inject(FactsApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly kinds = kinds;
  protected readonly kindLabels = kindLabels;

  protected readonly data = httpResource<FactsResponse>(() => '/api/facts');
  protected readonly loadError = computed(() => errorMessage(this.data.error()));

  protected readonly statusFilter = signal('all');
  protected readonly kindFilter = signal('all');
  protected readonly operationResult = signal('');
  private readonly sorted = computed(() =>
    [...(this.data.value()?.facts ?? [])].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    ),
  );
  protected readonly active = computed(() =>
    this.sorted().filter((f) => f.current.status !== 'retired'),
  );
  protected readonly withdrawn = computed(() =>
    this.sorted().filter((f) => f.current.status === 'retired'),
  );
  private readonly filtered = computed(() =>
    this.active().filter(
      (f) =>
        (this.statusFilter() === 'all' || f.current.status === this.statusFilter()) &&
        (this.kindFilter() === 'all' || f.kind === this.kindFilter()),
    ),
  );
  protected readonly groups = computed(() =>
    (['proposed', 'confirmed'] as const)
      .map((status) => {
        const facts = this.filtered().filter((f) => f.current.status === status);
        return {
          status,
          label: status === 'proposed' ? 'To confirm' : 'Confirmed',
          count: facts.length,
          kinds: kinds
            .map((kind) => ({
              kind,
              label: kindLabels[kind],
              facts: facts.filter((f) => f.kind === kind),
            }))
            .filter((group) => group.facts.length > 0),
        };
      })
      .filter((section) => section.count > 0),
  );

  protected readonly overview = computed(() => {
    const facts = this.filtered();
    const toConfirm = facts.filter((f) => f.current.status === 'proposed').length;
    const usable = facts.filter(
      (f) => f.current.status === 'confirmed' && f.usableInMaterials,
    ).length;
    return `Showing ${facts.length} of ${this.active().length} active facts: ${toConfirm} to confirm, ${usable} usable in materials. ${this.withdrawn().length} withdrawn.`;
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
            this.showToConfirm();
          } catch (error) {
            return { kind: 'server', message: errorMessage(error) };
          }
          f().reset({ kind, body: '' });
          return undefined;
        },
      },
    },
  );

  protected replace(fact: Fact, feedback: HTMLElement) {
    const previous = this.data.value()?.facts.find((f) => f.id === fact.id);
    let message = '';
    if (previous && previous.current.status !== fact.current.status) {
      message =
        fact.current.status === 'retired'
          ? 'Withdrawn. Future matches and materials will no longer use this fact.'
          : 'Confirmed. The saved permissions now apply.';
    }
    if (previous && previous.current.id !== fact.current.id) {
      this.showToConfirm();
      message =
        'Saved a new version to confirm. Both permissions are off; earlier versions are kept.';
    }
    if (message) {
      this.operationResult.set(message);
      feedback.focus();
    }
    this.data.update((d) => d && { facts: d.facts.map((f) => (f.id === fact.id ? fact : f)) });
  }

  private showToConfirm() {
    this.statusFilter.set('proposed');
    this.kindFilter.set('all');
  }

  protected imported(result: SaveFactCandidatesResponse, feedback: HTMLElement) {
    this.data.set({ facts: result.facts });
    if (result.added) this.showToConfirm();
    this.operationResult.set(
      `Added ${result.added} facts to confirm; skipped ${result.skipped} duplicates; left out ${result.cancelled}. Confirm each new fact and choose its two permissions separately.`,
    );
    feedback.focus();
  }

  protected showFact(id: string) {
    this.statusFilter.set('all');
    this.kindFilter.set('all');
    afterNextRender(
      () => {
        const card = this.host.nativeElement.querySelector<HTMLElement>(`#fact-${id}`);
        card?.closest('details.withdrawn')?.setAttribute('open', '');
        card?.focus();
      },
      { injector: this.injector },
    );
  }
}
