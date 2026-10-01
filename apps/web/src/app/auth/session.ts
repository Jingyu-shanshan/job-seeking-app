import { HttpClient } from '@angular/common/http';
import { Service, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** The signed-in account, as Better Auth returns it; only the fields the UI uses. */
export interface User {
  email: string;
}

/**
 * The browser side of the session. The session itself is an HttpOnly cookie that Better Auth
 * sets and the server checks on every API request; this only tracks who is signed in.
 */
@Service()
export class Session {
  private readonly http = inject(HttpClient);
  // `undefined` until the server has been asked.
  private readonly current = signal<User | null | undefined>(undefined);
  readonly user = this.current.asReadonly();

  /** The signed-in user, asking the server the first time. An unreachable server counts as signed out. */
  async load(): Promise<User | null> {
    const known = this.current();
    if (known !== undefined) return known;
    try {
      const session = await firstValueFrom(
        this.http.get<{ user: User } | null>('/api/auth/get-session'),
      );
      this.current.set(session?.user ?? null);
      return session?.user ?? null;
    } catch {
      return null;
    }
  }

  /** Rejects with the `HttpErrorResponse` when the server refuses. */
  async signIn(email: string, password: string): Promise<void> {
    const { user } = await firstValueFrom(
      this.http.post<{ user: User }>('/api/auth/sign-in/email', { email, password }),
    );
    this.current.set(user);
  }

  async signOut(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/sign-out', {}));
    this.current.set(null);
  }
}
