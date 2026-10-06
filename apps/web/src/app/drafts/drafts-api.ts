import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import type { Draft, EditStatementRequest, PdfCheck } from '@jsa/shared';
import { firstValueFrom } from 'rxjs';

@Service()
export class DraftsApi {
  private readonly http = inject(HttpClient);

  /** Saves the user's version of a statement; the answer is the draft checked again. */
  editStatement(draftId: string, statementId: string, change: EditStatementRequest) {
    return firstValueFrom(
      this.http.put<Draft>(`/api/drafts/${draftId}/statements/${statementId}`, change),
    );
  }

  /** Sends a PDF of the draft's document; the app keeps it only if its text is the document's. */
  uploadPdf(draftId: string, file: Blob): Promise<PdfCheck> {
    return firstValueFrom(
      this.http.post<PdfCheck>(`/api/drafts/${draftId}/pdfs`, file, {
        headers: { 'content-type': 'application/pdf' },
      }),
    );
  }
}
