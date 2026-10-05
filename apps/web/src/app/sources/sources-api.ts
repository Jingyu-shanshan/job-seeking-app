import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import type { Source } from '@jsa/shared';
import { firstValueFrom } from 'rxjs';

/** Changes to the user's sources. Reads go through `httpResource`. */
@Service()
export class SourcesApi {
  private readonly http = inject(HttpClient);

  /** Adds a source; `enabled: false` turns off a job-alert source that is on by default. */
  add(catalogId: string, param?: string, enabled?: boolean): Promise<Source> {
    return firstValueFrom(
      this.http.post<Source>('/api/sources', {
        catalogId,
        ...(param === undefined ? {} : { param }),
        ...(enabled === undefined ? {} : { enabled }),
      }),
    );
  }

  setEnabled(id: string, enabled: boolean): Promise<Source> {
    return firstValueFrom(this.http.patch<Source>(`/api/sources/${id}`, { enabled }));
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/sources/${id}`));
  }
}

/** The server's message for a failed request, or a generic one. */
export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const message: unknown = error.error?.message;
    if (typeof message === 'string') return message;
    if (error.status === 0) return 'The API is not reachable.';
  }
  return 'Something went wrong. Try again.';
}
