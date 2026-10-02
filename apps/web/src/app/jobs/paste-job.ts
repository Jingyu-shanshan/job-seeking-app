import { Component, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, maxLength, pattern, required } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../sources/sources-api';
import { JobsApi } from './jobs-api';

// 与共享的 maxJobTextLength 相同；前端只导入共享包的类型，所以在这里写明。
const maxTextLength = 100_000;

/** 粘贴一个职位的链接和原文（T05），任何网站都可以。保存后打开该职位，在那里总结。 */
@Component({
  selector: 'app-paste-job',
  imports: [FormField, FormRoot, RouterLink],
  template: `
    <p><a routerLink="/jobs">All jobs</a></p>
    <h1>Paste a job</h1>
    <p>
      For a job from any site, including sites the app does not read, such as LinkedIn. Copy the
      job’s link and its text from the page. The text is saved as it is and never changed.
    </p>
    <form [formRoot]="pasteForm">
      <label>
        Job title
        <input [formField]="pasteForm.title" autocomplete="off" />
      </label>
      @if (showErrors(pasteForm.title)) {
        <p class="error" role="alert">{{ pasteForm.title().errors()[0].message }}</p>
      }
      <label>
        Company (optional)
        <input [formField]="pasteForm.company" autocomplete="off" />
      </label>
      <label>
        Location (optional)
        <input [formField]="pasteForm.location" autocomplete="off" />
      </label>
      <label>
        Link to the job page
        <input type="url" [formField]="pasteForm.url" autocomplete="off" />
      </label>
      @if (showErrors(pasteForm.url)) {
        <p class="error" role="alert">{{ pasteForm.url().errors()[0].message }}</p>
      }
      <label>
        Job text
        <textarea rows="16" [formField]="pasteForm.text"></textarea>
      </label>
      @if (showErrors(pasteForm.text)) {
        <p class="error" role="alert">{{ pasteForm.text().errors()[0].message }}</p>
      }
      @for (error of pasteForm().errors(); track $index) {
        <p class="error" role="alert">{{ error.message }}</p>
      }
      <button type="submit" [disabled]="pasteForm().submitting()">Save the job</button>
    </form>
  `,
  styles: `
    form {
      display: grid;
      gap: 0.5rem;
      max-width: 48rem;
    }
    label {
      display: grid;
      gap: 0.25rem;
    }
    button {
      justify-self: start;
    }
    .error {
      margin: 0;
      color: light-dark(#a3141c, #ff9b9b);
    }
  `,
})
export class PasteJob {
  private readonly api = inject(JobsApi);
  private readonly router = inject(Router);

  private readonly model = signal({ title: '', company: '', location: '', url: '', text: '' });

  protected readonly pasteForm = form(
    this.model,
    (s) => {
      required(s.title, { message: 'Enter the job title.' });
      maxLength(s.title, 1000, { message: 'Keep the title under 1000 characters.' });
      maxLength(s.company, 1000, { message: 'Keep the company under 1000 characters.' });
      maxLength(s.location, 5000, { message: 'Keep the location under 5000 characters.' });
      required(s.url, { message: 'Enter the link to the job page.' });
      pattern(s.url, /^https:\/\/\S+$/, { message: 'Enter an https link.' });
      required(s.text, { message: 'Paste the job text.' });
      maxLength(s.text, maxTextLength, {
        message: `The job text can be at most ${maxTextLength.toLocaleString('en')} characters.`,
      });
    },
    {
      submission: {
        action: async (f) => {
          const { title, company, location, url, text } = f().value();
          try {
            const job = await this.api.paste({
              title: title.trim(),
              url: url.trim(),
              text,
              ...(company.trim() ? { company: company.trim() } : {}),
              ...(location.trim() ? { location: location.trim() } : {}),
            });
            await this.router.navigate(['/jobs', job.id]);
          } catch (error) {
            return { kind: 'server', message: errorMessage(error) };
          }
          return undefined;
        },
      },
    },
  );

  protected showErrors(field: typeof this.pasteForm.title) {
    return field().touched() && field().invalid();
  }
}
