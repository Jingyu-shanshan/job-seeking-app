import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import type {
  AddRequirementRequest,
  Draft,
  DraftKind,
  ImportAlertEmailResponse,
  JobDetail,
  PasteJobRequest,
} from '@jsa/shared';
import { firstValueFrom } from 'rxjs';

@Service()
export class JobsApi {
  private readonly http = inject(HttpClient);

  paste(job: PasteJobRequest): Promise<JobDetail> {
    return firstValueFrom(this.http.post<JobDetail>('/api/jobs', job));
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
  writeDraft(snapshotId: string, kind: DraftKind): Promise<Draft> {
    return firstValueFrom(this.http.post<Draft>(`/api/snapshots/${snapshotId}/drafts`, { kind }));
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
