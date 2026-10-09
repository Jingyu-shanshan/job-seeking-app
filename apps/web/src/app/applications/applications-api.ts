import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import type { JobApplications, RecordApplicationRequest } from '@jsa/shared';
import { firstValueFrom } from 'rxjs';

/** Recording an application sent outside the app (T09). Reads go through `httpResource`. */
@Service()
export class ApplicationsApi {
  private readonly http = inject(HttpClient);

  record(jobId: string, request: RecordApplicationRequest): Promise<JobApplications> {
    return firstValueFrom(
      this.http.post<JobApplications>(`/api/jobs/${jobId}/applications`, request),
    );
  }
}
