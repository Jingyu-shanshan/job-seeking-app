import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import type { AddRequirementRequest, JobDetail, PasteJobRequest } from '@jsa/shared';
import { firstValueFrom } from 'rxjs';

/** 职位原文、总结和要求的写操作（T05）。每个操作都返回职位的最新详情；读取用 `httpResource`。 */
@Service()
export class JobsApi {
  private readonly http = inject(HttpClient);

  paste(job: PasteJobRequest): Promise<JobDetail> {
    return firstValueFrom(this.http.post<JobDetail>('/api/jobs', job));
  }

  /** 从来源读取职位的当前原文。 */
  importText(jobId: string): Promise<JobDetail> {
    return firstValueFrom(this.http.post<JobDetail>(`/api/jobs/${jobId}/snapshots`, {}));
  }

  /** 用 DeepSeek 总结一个快照：一次模型请求。 */
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

/** 美元金额：不到一美分时保留四位小数，否则两位。 */
export function usd(amount: number): string {
  return `$${amount.toFixed(amount < 0.01 ? 4 : 2)}`;
}
