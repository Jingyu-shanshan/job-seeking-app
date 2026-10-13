import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import type { GenerateInterviewRequest, InterviewState } from '@jsa/shared';
import { firstValueFrom } from 'rxjs';

@Service()
export class InterviewsApi {
  private readonly http = inject(HttpClient);

  generate(id: string, request: GenerateInterviewRequest) {
    return firstValueFrom(
      this.http.post<InterviewState>(`/api/applications/${id}/interview`, request),
    );
  }

  saveNotes(id: string, notes: string) {
    return firstValueFrom(
      this.http.put<InterviewState>(`/api/applications/${id}/interview/notes`, { notes }),
    );
  }
}
