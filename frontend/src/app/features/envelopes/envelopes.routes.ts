import { Routes } from '@angular/router';

export const envelopesRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./envelopes-list/envelopes-list.component').then(m => m.EnvelopesListComponent),
  },
  {
    path: 'new',
    loadComponent: () => import('./envelope-form/envelope-form.component').then(m => m.EnvelopeFormComponent),
  },
  {
    path: ':id',
    loadComponent: () => import('./envelope-detail/envelope-detail.component').then(m => m.EnvelopeDetailComponent),
  },
];
