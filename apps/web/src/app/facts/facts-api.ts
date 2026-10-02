import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import type { Fact, FactKind, ImportFactsResponse, UpdateFactVersionRequest } from '@jsa/shared';
import { firstValueFrom } from 'rxjs';

@Service()
export class FactsApi {
  private readonly http = inject(HttpClient);

  add(kind: FactKind, body: string): Promise<Fact> {
    return firstValueFrom(this.http.post<Fact>('/api/facts', { kind, body }));
  }

  edit(factId: string, body: string): Promise<Fact> {
    return firstValueFrom(this.http.post<Fact>(`/api/facts/${factId}/versions`, { body }));
  }

  update(versionId: string, change: UpdateFactVersionRequest): Promise<Fact> {
    return firstValueFrom(this.http.patch<Fact>(`/api/fact-versions/${versionId}`, change));
  }

  import(markdown: string): Promise<ImportFactsResponse> {
    return firstValueFrom(this.http.post<ImportFactsResponse>('/api/facts/import', { markdown }));
  }
}

export const kindLabels: Record<FactKind, string> = {
  experience: 'Work experience',
  project: 'Projects',
  education: 'Education',
  skill: 'Skills',
  language: 'Languages',
  certification: 'Certifications',
  statement: 'How you describe yourself',
  other: 'Other',
};
