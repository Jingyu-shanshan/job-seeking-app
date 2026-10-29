import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import type {
  AddRequirementRequest,
  Draft,
  WriteDraftRequest,
  ImportAlertEmailResponse,
  ImportJobLinkRequest,
  JobDetail,
  JobDetails,
  JobSearchRequest,
  JobSearchResponse,
  CreateImportedJobRequest,
  DuplicateJob,
} from '@jsa/shared';
import { firstValueFrom } from 'rxjs';

@Service()
export class JobsApi {
  private readonly http = inject(HttpClient);

  paste(job: CreateImportedJobRequest): Promise<JobDetail> {
    return firstValueFrom(this.http.post<JobDetail>('/api/jobs', job));
  }

  updateDetails(jobId: string, details: JobDetails): Promise<JobDetail> {
    return firstValueFrom(this.http.put<JobDetail>(`/api/jobs/${jobId}/details`, details));
  }

  remove(jobId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/jobs/${jobId}`));
  }

  search(request: JobSearchRequest): Promise<JobSearchResponse> {
    return firstValueFrom(this.http.post<JobSearchResponse>('/api/job-searches', request));
  }

  importLink(
    url: string,
    method: ImportJobLinkRequest['method'] = 'direct',
    createNew = false,
  ): Promise<JobDetail> {
    return firstValueFrom(
      this.http.post<JobDetail>('/api/jobs/import-link', {
        url,
        ...(method === 'direct' ? {} : { method }),
        ...(createNew ? { createNew: true } : {}),
      }),
    );
  }

  /** `url` is the job page the text came from; needed when the job has no address. */
  pasteText(jobId: string, text: string, url?: string): Promise<JobDetail> {
    return firstValueFrom(
      this.http.post<JobDetail>(`/api/jobs/${jobId}/text`, { text, ...(url ? { url } : {}) }),
    );
  }

  importText(jobId: string): Promise<JobDetail> {
    return firstValueFrom(this.http.post<JobDetail>(`/api/jobs/${jobId}/snapshots`, {}));
  }

  summarise(snapshotId: string): Promise<JobDetail> {
    return firstValueFrom(this.http.post<JobDetail>(`/api/snapshots/${snapshotId}/summary`, {}));
  }

  match(snapshotId: string): Promise<JobDetail> {
    return firstValueFrom(this.http.post<JobDetail>(`/api/snapshots/${snapshotId}/match`, {}));
  }

  /** Writes a resume or cover letter draft for a job text with DeepSeek. */
  writeDraft(snapshotId: string, request: WriteDraftRequest): Promise<Draft> {
    return firstValueFrom(this.http.post<Draft>(`/api/snapshots/${snapshotId}/drafts`, request));
  }

  addRequirement(snapshotId: string, requirement: AddRequirementRequest): Promise<JobDetail> {
    return firstValueFrom(
      this.http.post<JobDetail>(`/api/snapshots/${snapshotId}/requirements`, requirement),
    );
  }

  removeRequirement(id: string): Promise<JobDetail> {
    return firstValueFrom(this.http.delete<JobDetail>(`/api/requirements/${id}`));
  }

  /** Imports one job-alert email from its full source. */
  importAlertEmail(message: string): Promise<ImportAlertEmailResponse> {
    return firstValueFrom(
      this.http.post<ImportAlertEmailResponse>('/api/alert-emails', { message }),
    );
  }
}

export function usd(amount: number): string {
  return `$${amount.toFixed(amount < 0.01 ? 4 : 2)}`;
}

export function duplicateJobs(error: unknown): DuplicateJob[] | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) return null;
  const body: unknown = error.error;
  if (
    !body ||
    typeof body !== 'object' ||
    !('code' in body) ||
    body.code !== 'duplicate_job' ||
    !('jobs' in body)
  )
    return null;
  const jobs: unknown = body.jobs;
  if (
    !Array.isArray(jobs) ||
    !jobs.length ||
    !jobs.every(
      (job: unknown) =>
        !!job &&
        typeof job === 'object' &&
        'id' in job &&
        typeof job.id === 'string' &&
        !!job.id &&
        'title' in job &&
        typeof job.title === 'string' &&
        'company' in job &&
        (job.company === null || typeof job.company === 'string') &&
        'location' in job &&
        typeof job.location === 'string',
    )
  )
    return null;
  return jobs as DuplicateJob[];
}
