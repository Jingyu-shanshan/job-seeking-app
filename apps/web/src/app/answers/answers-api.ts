import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import type {
  AnswerQuestionRequest,
  JobFormState,
  SaveAnswerRequest,
  SavedAnswer,
} from '@jsa/shared';
import { firstValueFrom } from 'rxjs';

/** Changes to saved answers and to a job's form (T16). Reads go through `httpResource`. */
@Service()
export class AnswersApi {
  private readonly http = inject(HttpClient);

  add(answer: SaveAnswerRequest): Promise<SavedAnswer> {
    return firstValueFrom(this.http.post<SavedAnswer>('/api/answers', answer));
  }

  update(id: string, answer: SaveAnswerRequest): Promise<SavedAnswer> {
    return firstValueFrom(this.http.put<SavedAnswer>(`/api/answers/${id}`, answer));
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/answers/${id}`));
  }

  /** Reads the job's application form from its source. */
  readForm(jobId: string): Promise<JobFormState> {
    return firstValueFrom(this.http.post<JobFormState>(`/api/jobs/${jobId}/form`, {}));
  }

  answer(jobId: string, key: string, answer: AnswerQuestionRequest): Promise<JobFormState> {
    return firstValueFrom(this.http.put<JobFormState>(this.questionUrl(jobId, key), answer));
  }

  /** Takes back the user's answer for this job. */
  clear(jobId: string, key: string): Promise<JobFormState> {
    return firstValueFrom(this.http.delete<JobFormState>(this.questionUrl(jobId, key)));
  }

  /** Uses a saved answer for a question worded differently; the app remembers the wording. */
  useSaved(jobId: string, key: string, answerId: string): Promise<JobFormState> {
    return firstValueFrom(
      this.http.post<JobFormState>(`${this.questionUrl(jobId, key)}/saved`, { answerId }),
    );
  }

  private questionUrl(jobId: string, key: string) {
    return `/api/jobs/${jobId}/form/answers/${encodeURIComponent(key)}`;
  }
}

/** Places as the user types them: separated by commas or semicolons. */
export function parsePlaces(text: string): string[] {
  return text
    .split(/[,;]/)
    .map((place) => place.trim())
    .filter((place) => place !== '');
}
