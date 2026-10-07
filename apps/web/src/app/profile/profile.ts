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
        <label>
          Name
          <input type="text" autocomplete="name" [formField]="profileForm.name" />
        </label>
        <label>
          Email
          <input type="email" autocomplete="email" [formField]="profileForm.email" />
        </label>
        <label>
          Phone
          <input type="tel" autocomplete="tel" [formField]="profileForm.phone" />
        </label>
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
        <p>
          <button type="submit" [disabled]="!unsaved() || profileForm().submitting()">Save</button>
          <span role="status">{{ status() }}</span>
        </p>
        @for (error of profileForm().errors(); track $index) {
          <p class="error" role="alert">{{ error.message }}</p>
        }
      </form>
    } @else if (saved.isLoading()) {
      <p role="status">Loading your details…</p>
    } @else {
      <p class="error" role="alert">Your details could not be loaded. {{ loadError() }}</p>
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
    fieldset {
      margin: 0 0 0.75rem;
    }
    .error {
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class ProfilePage {
  private readonly http = inject(HttpClient);

  protected readonly saved = httpResource<Profile>(() => '/api/profile');
  protected readonly loadError = computed(() => errorMessage(this.saved.error()));

  // Follows the saved details; the user's edits stay local until saved.
  private readonly model = linkedSignal<Model>(() => toModel(this.saved.value() ?? blank));

  protected readonly status = signal('');

  protected readonly unsaved = computed(() => {
    const saved = this.saved.value();
    return !saved || JSON.stringify(toProfile(this.model())) !== JSON.stringify(saved);
  });

  protected readonly profileForm = form(this.model, () => {}, {
    submission: {
      action: async (f) => {
        this.status.set('');
        try {
          const profile = toProfile(f().value());
          this.saved.set(await firstValueFrom(this.http.put<Profile>('/api/profile', profile)));
        } catch (error) {
          return { kind: 'server', message: errorMessage(error) };
        }
        this.status.set('Saved.');
        return undefined;
      },
    },
  });
}
