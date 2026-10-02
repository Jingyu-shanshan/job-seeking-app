import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import type { AddRequirementRequest, JobDetail, PasteJobRequest } from '@jsa/shared';
import { firstValueFrom } from 'rxjs';

@Service()
export class JobsApi {
  private readonly http = inject(HttpClient);

  paste(job: PasteJobRequest): Promise<JobDetail> {
    return firstValueFrom(this.http.post<JobDetail>('/api/jobs', job));
  }

  importText(jobId: string): Promise<JobDetail> {
    return firstValueFrom(this.http.post<JobDetail>(`/api/jobs/${jobId}/snapshots`, {}));
  }

  summarise(snapshotId: string): Promise<JobDetail> {
    return firstValueFrom(this.http.post<JobDetail>(`/api/snapshots/${snapshotId}/summary`, {}));
  }

  addRequirement(snapshotId: string, requirement: AddRequirementRequest): Promise<JobDetail> {
    return firstValueFrom(
      this.http.post<JobDetail>(`/api/snapshots/${snapshotId}/requirements`, requirement),
    );
  }

  removeRequirement(id: string): Promise<JobDetail> {
    return firstValueFrom(this.http.delete<JobDetail>(`/api/requirements/${id}`));
  }
}

export function usd(amount: number): string {
  return `$${amount.toFixed(amount < 0.01 ? 4 : 2)}`;
}
