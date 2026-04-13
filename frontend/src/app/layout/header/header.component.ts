import { Component, ChangeDetectionStrategy, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription, interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../core/services/api.service';

@Component({
  selector: 'app-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <header class="header">
      <div class="header-title">
        <h2>{{ pageTitle }}</h2>
      </div>
      <div class="header-actions">
        <button class="notif-btn" (click)="goNotifications()">
          🔔
          <span class="badge-dot" *ngIf="api.unreadNotifCount() > 0">{{ api.unreadNotifCount() }}</span>
        </button>
        <button class="btn btn-outline btn-sm" (click)="logout()">
          Déconnexion
        </button>
      </div>
    </header>
  `,
  styles: [`
    .header {
      height: var(--header-height); background: var(--surface);
      border-bottom: 1px solid var(--border); padding: 0 32px;
      display: flex; align-items: center; justify-content: space-between;
      flex-shrink: 0;
      h2 { font-size: 16px; font-weight: 600; color: var(--text-primary); }
    }
    .header-actions { display: flex; align-items: center; gap: 16px; }
    .notif-btn {
      position: relative; background: none; border: none; cursor: pointer;
      font-size: 20px; padding: 6px; border-radius: 8px;
      &:hover { background: var(--border); }
    }
    .badge-dot {
      position: absolute; top: 0; right: 0;
      background: var(--danger); color: #fff;
      border-radius: 10px; font-size: 10px; font-weight: 700;
      padding: 1px 5px; min-width: 16px; text-align: center; line-height: 14px;
    }
  `],
})
export class HeaderComponent implements OnInit, OnDestroy {
  private pollSub?: Subscription;

  constructor(
    public auth: AuthService,
    public api: ApiService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    if (!this.auth.isLoggedIn) return;
    this.api.getUnreadCount().subscribe();
    // polling toutes les 30 secondes
    this.pollSub = interval(30_000).pipe(
      switchMap(() => this.api.getUnreadCount()),
    ).subscribe();
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
  }

  get pageTitle(): string {
    const map: Record<string, string> = {
      '/dashboard':    'Tableau de bord',
      '/envelopes':    'Enveloppes',
      '/documents':    'Documents',
      '/templates':    'Modèles',
      '/notifications':'Notifications',
      '/audit':        'Piste d\'audit',
      '/users':        'Utilisateurs',
      '/profile':      'Mon profil',
    };
    const url = this.router.url.split('?')[0];
    for (const [path, title] of Object.entries(map)) {
      if (url.startsWith(path)) return title;
    }
    return 'CGRAE Signature';
  }

  goNotifications(): void {
    this.router.navigate(['/notifications']);
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/auth/login']);
  }
}
