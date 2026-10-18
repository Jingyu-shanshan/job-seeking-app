import { httpResource } from '@angular/common/http';
import { Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { FactsResponse, JobDetail, JobsResponse, Profile } from '@jsa/shared';

@Component({
  imports: [RouterLink],
  selector: 'app-home',
  template: `
    <h1>Your next step</h1>
    <p>Build a clear application from your own experience, then review what goes out.</p>
    @if (failed()) {
      <p role="alert">Your next steps could not be loaded. Your saved data is still there.</p>
      <button type="button" (click)="retry()">Retry</button>
    } @else if (nextStep(); as next) {
      <section class="next" aria-labelledby="next-title">
        <h2 id="next-title">{{ next.title }}</h2>
        <p>{{ next.text }}</p>
        <a class="button primary" [routerLink]="next.path">{{ next.link }}</a>
      </section>
    } @else {
      <p role="status">Loading your next steps…</p>
    }

    @if (ready()) {
      <h2>Before your next application</h2>
      <ul class="checklist">
        <li>
          <h3>Add your experience</h3>
          <p>
            {{ confirmed() }} confirmed · {{ proposed() }} to confirm. Confirmation and permissions
            are separate.
          </p>
          <a routerLink="/facts">Open Facts</a>
        </li>
        <li>
          <h3>Add your document name</h3>
          <p>
            {{
              hasName() ? 'Your document name is saved.' : 'A name is needed to save a checked PDF.'
            }}
          </p>
          <a routerLink="/profile">Open Your details</a>
        </li>
        <li>
          <h3>Choose a job</h3>
          <p>{{ jobs.value()?.jobs?.length }} saved. Adding a job does not send an application.</p>
          <a routerLink="/jobs/paste">Paste a job</a>
        </li>
        <li>
          <h3>Review materials and the form</h3>
          @if (job.hasValue()) {
            @if (job.value().snapshot?.drafts?.length) {
              <p>
                {{ job.value().title }}: {{ job.value().snapshot?.drafts?.length }} draft(s). Read
                every statement and its evidence, check saved PDFs, then preview the actual form and
                attachments before approving this application.
              </p>
            } @else {
              <p>
                {{ job.value().title }} has no drafts for its current job text. Open the job to
                prepare materials.
              </p>
            }
            <a [routerLink]="'/jobs/' + job.value().id">Open this job</a>
          } @else {
            <p>
              Choose an open job to prepare and review its materials. Review is required for every
              application.
            </p>
            <a routerLink="/jobs">Open Jobs</a>
          }
        </li>
      </ul>
    }
    <div class="actions">
      <a class="button" routerLink="/jobs/paste">Paste a job</a>
      <a class="button" routerLink="/facts">Add your experience</a>
    </div>
    <p class="hint">
      Sources are optional. You can <a routerLink="/sources">set up discovery later</a>.
    </p>
  `,
  styles: `
    .next {
      margin: 24px 0 32px;
      padding: 24px;
      background: var(--info-bg);
      border-radius: 6px;
      color: var(--info-text);
    }
    .next h2 {
      margin-top: 0;
    }
    .checklist {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .checklist li {
      padding: 20px 0;
      border-bottom: 1px solid var(--line);
    }
    .checklist h3 {
      margin: 0 0 8px;
    }
    .checklist p {
      margin-bottom: 8px;
    }
    @media (max-width: 600px) {
      .next {
        padding: 16px;
      }
    }
  `,
})
export class Home {
  protected readonly facts = httpResource<FactsResponse>(() => '/api/facts');
  protected readonly profile = httpResource<Profile>(() => '/api/profile');
  protected readonly jobs = httpResource<JobsResponse>(() => '/api/jobs');
  private readonly selectedJob = computed(() =>
    this.jobs.hasValue()
      ? this.jobs.value().jobs.find((job) => !job.application && job.verdict !== 'ineligible')
      : undefined,
  );
  protected readonly job = httpResource<JobDetail>(() => {
    const job = this.selectedJob();
    return job ? `/api/jobs/${job.id}` : undefined;
  });
  protected readonly failed = computed(
    () => !!(this.facts.error() || this.profile.error() || this.jobs.error() || this.job.error()),
  );
  protected readonly ready = computed(
    () =>
      this.facts.hasValue() &&
      this.profile.hasValue() &&
      this.jobs.hasValue() &&
      (!this.selectedJob() || this.job.hasValue()),
  );
  protected readonly confirmed = computed(() =>
    this.facts.hasValue()
      ? this.facts.value().facts.filter((f) => f.current.status === 'confirmed').length
      : 0,
  );
  protected readonly proposed = computed(() =>
    this.facts.hasValue()
      ? this.facts.value().facts.filter((f) => f.current.status === 'proposed').length
      : 0,
  );
  protected readonly hasName = computed(
    () => this.profile.hasValue() && !!this.profile.value().name.trim(),
  );
  protected readonly nextStep = computed(() => {
    if (!this.ready()) return null;
    const unknown = this.jobs.value()!.jobs.find((j) => j.application === 'to_verify');
    if (unknown)
      return {
        title: 'Check an application result',
        text: `${unknown.title}: the result is unknown. Check whether it went through before trying again.`,
        path: `/jobs/${unknown.id}`,
        link: 'Check this application',
      };
    if (this.proposed())
      return {
        title: 'Review your experience',
        text: 'Your facts are waiting for confirmation. Check each one, then choose its permissions.',
        path: '/facts',
        link: 'Review facts',
      };
    if (!this.confirmed())
      return {
        title: 'Start with your experience',
        text: 'Add a fact or import Markdown or a PDF. Review the text and confirm what is accurate.',
        path: '/facts',
        link: 'Add your experience',
      };
    if (!this.hasName())
      return {
        title: 'Add your document name',
        text: 'Your name is needed to save a checked PDF. Contact details are optional and never go to DeepSeek.',
        path: '/profile',
        link: 'Add your details',
      };
    if (!this.selectedJob())
      return {
        title: 'Choose a job',
        text: 'Paste one original job description, or choose a job from your saved list.',
        path: '/jobs/paste',
        link: 'Paste a job',
      };
    if (!this.facts.value()!.facts.some((f) => f.sendableToModel && f.usableInMaterials))
      return {
        title: 'Choose your fact permissions',
        text: 'Writing drafts needs confirmed facts allowed for both DeepSeek and materials. Review these choices on Facts.',
        path: '/facts',
        link: 'Review permissions',
      };
    const job = this.job.value()!;
    const draft = job.snapshot?.drafts[0];
    if (draft)
      return {
        title: 'Review your materials',
        text: draft.outdated.length
          ? 'This draft is out of date. Review the changes on the draft page before preparing a new document.'
          : `${job.title}: read each statement and its evidence. A generated draft or saved PDF does not mean you have reviewed or sent it.`,
        path: `/drafts/${draft.id}`,
        link: 'Review this draft',
      };
    return {
      title: 'Prepare your materials',
      text: `${job.title}: open the job to review its text and prepare a draft. Model calls start only when you request them.`,
      path: `/jobs/${job.id}`,
      link: 'Open this job',
    };
  });

  protected retry() {
    for (const resource of [this.facts, this.profile, this.jobs, this.job]) {
      if (resource.error()) resource.reload();
    }
  }
}
