import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import type { CreatedRunnerToken, JobFillState, RunnerToken } from '@jsa/shared';
import { firstValueFrom } from 'rxjs';

/** Runner tokens and fills (T17). Reads go through `httpResource`. */
@Service()
export class RunnerApi {
  private readonly http = inject(HttpClient);

  issueToken(name: string): Promise<CreatedRunnerToken> {
    return firstValueFrom(this.http.post<CreatedRunnerToken>('/api/runner-tokens', { name }));
  }

  revokeToken(id: string): Promise<RunnerToken> {
    return firstValueFrom(this.http.delete<RunnerToken>(`/api/runner-tokens/${id}`));
  }

  /** Starts a fill of the job's form, which the runner takes when it asks for work next. */
  startFill(jobId: string): Promise<JobFillState> {
    return firstValueFrom(this.http.post<JobFillState>(`/api/jobs/${jobId}/fill`, {}));
  }

  /** After the user acted in the window: the runner looks at the form again. */
  continueFill(taskId: string): Promise<JobFillState> {
    return firstValueFrom(this.http.post<JobFillState>(`/api/fill-tasks/${taskId}/continue`, {}));
  }

  closeFill(taskId: string): Promise<JobFillState> {
    return firstValueFrom(this.http.post<JobFillState>(`/api/fill-tasks/${taskId}/close`, {}));
  }
}
