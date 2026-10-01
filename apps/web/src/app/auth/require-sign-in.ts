import { inject } from '@angular/core';
import { type CanActivateChildFn, Router } from '@angular/router';
import { Session } from './session';

/**
 * Sends a signed-out user to the sign-in page, which returns to the requested page afterwards.
 * This only decides what to show; the server checks the session on every API request.
 */
export const requireSignIn: CanActivateChildFn = async (_route, state) => {
  const session = inject(Session);
  const router = inject(Router);
  if (await session.load()) return true;
  return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
};
