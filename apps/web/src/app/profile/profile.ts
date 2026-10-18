import { HttpClient, httpResource } from '@angular/common/http';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { FormField, FormRoot, form } from '@angular/forms/signals';
import type { Profile } from '@jsa/shared';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../sources/sources-api';

/** The details as the form edits them: the links are three fields. */
interface Model {
  name: string;
  email: string;
  phone: string;
  location: string;
  link1: string;
  link2: string;
  link3: string;
}

function toModel(p: Profile): Model {
  const [link1 = '', link2 = '', link3 = ''] = p.links;
  return {
    name: p.name,
    email: p.email,
    phone: p.phone,
    location: p.location,
    link1,
    link2,
    link3,
  };
}

function toProfile(m: Model): Profile {
  return {
    name: m.name,
    email: m.email,
    phone: m.phone,
    location: m.location,
    links: [m.link1, m.link2, m.link3].filter((link) => link.trim() !== ''),
  };
}

const blank: Profile = { name: '', email: '', phone: '', location: '', links: [] };

/** The user's details (T08): the header of every resume and cover letter. */
@Component({
  selector: 'app-profile',
  imports: [FormField, FormRoot],
  template: `
    <h1>Your details</h1>
    <p>
      The app writes these at the top of your resumes and cover letters, and your name under a cover
      letter. They never go to DeepSeek. Fill in only what you want on the documents; an empty field
      is left out. A PDF needs your name.
    </p>

    @if (saved.hasValue()) {
      <form [formRoot]="profileForm">
        <fieldset class="form-fields" [disabled]="profileForm().submitting()">
          <label>
            Name
            <input type="text" autocomplete="name" [formField]="profileForm.name" />
          </label>
          <h2>Contact details (optional)</h2>
          <div class="form-grid">
            <label>
              Email
              <input type="email" autocomplete="email" [formField]="profileForm.email" />
            </label>
            <label>
              Phone
              <input type="tel" autocomplete="tel" [formField]="profileForm.phone" />
            </label>
          </div>
          <label>
            Where you live, as documents should say it (such as a city)
            <input type="text" [formField]="profileForm.location" />
          </label>
          <fieldset>
            <legend>Links, such as a portfolio, GitHub or LinkedIn (https://…)</legend>
            <label>
              Link 1
              <input type="url" [formField]="profileForm.link1" />
            </label>
            <label>
              Link 2
              <input type="url" [formField]="profileForm.link2" />
            </label>
            <label>
              Link 3
              <input type="url" [formField]="profileForm.link3" />
            </label>
          </fieldset>
          <p class="hint">
            Empty fields are left out. Saving details does not change already sent files.
          </p>
        </fieldset>
        <div class="actions">
          <button type="submit" [disabled]="!unsaved() || profileForm().submitting()">Save</button>
        </div>
        <p role="status">
          {{
            profileForm().submitting()
              ? 'Saving your details…'
              : unsaved()
                ? 'Unsaved changes.'
                : status() || 'No unsaved changes.'
          }}
        </p>
        @if (failure()) {
          <p class="error" role="alert">{{ failure() }}</p>
        }
      </form>
    } @else if (saved.isLoading()) {
      <p role="status">Loading your details…</p>
    } @else {
      <p class="error" role="alert">Your details could not be loaded. {{ loadError() }}</p>
      <button type="button" (click)="saved.reload()">Try again</button>
    }
  `,
  styles: `
    label {
      display: block;
      margin-bottom: 0.75rem;
    }
    input {
      display: block;
      width: 100%;
      max-width: 30rem;
      box-sizing: border-box;
    }
  `,
})
export class ProfilePage {
  private readonly http = inject(HttpClient);

  protected readonly saved = httpResource<Profile>(() => '/api/profile');
  protected readonly loadError = computed(() => errorMessage(this.saved.error()));

  // Follows the saved details; the user's edits stay local until saved.
  private readonly model = linkedSignal<Model>(() =>
    toModel(this.saved.hasValue() ? this.saved.value() : blank),
  );

  protected readonly status = signal('');
  protected readonly failure = signal('');

  protected readonly unsaved = computed(() => {
    const saved = this.saved.hasValue() ? this.saved.value() : undefined;
    return !saved || JSON.stringify(toProfile(this.model())) !== JSON.stringify(saved);
  });

  protected readonly profileForm = form(this.model, () => {}, {
    submission: {
      action: async (f) => {
        this.status.set('');
        this.failure.set('');
        try {
          const profile = toProfile(f().value());
          this.saved.set(await firstValueFrom(this.http.put<Profile>('/api/profile', profile)));
        } catch (error) {
          this.failure.set(errorMessage(error));
          return undefined;
        }
        this.status.set('Saved.');
        return undefined;
      },
    },
  });
}
