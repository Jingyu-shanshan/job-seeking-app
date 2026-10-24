import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import type { ToolCall, ToolRequest } from '@jsa/shared';
import { firstValueFrom } from 'rxjs';

@Service()
export class ToolsApi {
  private readonly http = inject(HttpClient);
  call(request: ToolRequest) {
    return firstValueFrom(this.http.post<ToolCall>('/api/tools', request));
  }
}
