import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const auth   = inject(AuthService);

  return next(req).pipe(
    catchError((err) => {
      if (err.status === 401 && !req.url.includes('/auth/login') && !req.url.includes('/auth/register')) {
        auth.logout();
        router.navigate(['/auth/login']);
      }
      const rawMessage = err.error?.message || err.error?.error || 'Une erreur est survenue';
      const message = Array.isArray(rawMessage) ? rawMessage.join(', ') : String(rawMessage);
      // Garder status HTTP + message user-friendly + error body original
      const enriched = new Error(message) as any;
      enriched.status = err.status;
      enriched.error  = err.error;
      return throwError(() => enriched);
    }),
  );
};
