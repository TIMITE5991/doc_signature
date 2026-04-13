import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (_route, _state) => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  if (auth.isLoggedIn) return true;
  router.navigate(['/auth/login']);
  return false;
};

export const guestGuard: CanActivateFn = (_route, _state) => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn) return true;
  router.navigate(['/dashboard']);
  return false;
};

export const adminGuard: CanActivateFn = (_route, _state) => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  if (auth.isLoggedIn && auth.hasRole('ADMIN', 'SUPER_ADMIN')) return true;
  router.navigate(['/dashboard']);
  return false;
};
