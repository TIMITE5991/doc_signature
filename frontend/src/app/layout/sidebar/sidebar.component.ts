import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

interface NavItem {
  icon: string;
  label: string;
  route: string;
  roles?: string[];
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-logo">CS</div>
        <div>
          <span class="brand-name">CGRAE</span>
          <span class="brand-sub">Signature</span>
        </div>
      </div>

      <nav class="sidebar-nav">
        <ng-container *ngFor="let item of visibleItems">
          <a [routerLink]="item.route" routerLinkActive="active" class="nav-item">
            <span class="nav-icon">{{ item.icon }}</span>
            <span>{{ item.label }}</span>
          </a>
        </ng-container>
      </nav>

      <div class="sidebar-footer">
        <div class="user-info">
          <div class="user-avatar">
            {{ initials }}
          </div>
          <div class="user-details">
            <div class="user-name">{{ auth.user?.first_name }} {{ auth.user?.last_name }}</div>
            <div class="user-role">{{ auth.user?.role }}</div>
          </div>
        </div>
      </div>
    </aside>
  `,
  styles: [`
    .sidebar {
      width: var(--sidebar-width); background: var(--primary); display: flex;
      flex-direction: column; flex-shrink: 0; overflow-y: auto;
    }
    .sidebar-brand {
      display: flex; align-items: center; gap: 12px; padding: 22px 20px 18px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      .brand-logo { width: 38px; height: 38px; background: #ffffff; border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        font-weight: 900; font-size: 14px; color: var(--primary); flex-shrink: 0; }
      .brand-name { display: block; font-weight: 700; color: #fff; font-size: 16px; line-height: 1.2; }
      .brand-sub  { display: block; font-size: 11px; color: rgba(255,255,255,0.75); font-weight: 600; }
    }
    .sidebar-nav { padding: 16px 12px; flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .nav-item {
      display: flex; align-items: center; gap: 12px; padding: 10px 14px;
      border-radius: 8px; color: rgba(255,255,255,0.75); text-decoration: none;
      font-size: 14px; font-weight: 500; transition: all 0.2s;
      &:hover { background: rgba(255,255,255,0.1); color: #fff; }
      &.active { background: rgba(255,255,255,0.15); color: #fff; font-weight: 600; }
      .nav-icon { font-size: 18px; width: 22px; text-align: center; flex-shrink: 0; }
    }
    .sidebar-footer {
      padding: 16px; border-top: 1px solid rgba(255,255,255,0.1);
    }
    .user-info { display: flex; align-items: center; gap: 10px; }
    .user-avatar { width: 36px; height: 36px; background: #ffffff; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 13px; color: var(--primary); flex-shrink: 0; }
    .user-name { font-size: 13px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; }
    .user-role { font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 1px; }
  `],
})
export class SidebarComponent {
  private items: NavItem[] = [
    { icon: '📊', label: 'Tableau de bord', route: '/dashboard' },
    { icon: '📨', label: 'Enveloppes',       route: '/envelopes' },
    { icon: '📄', label: 'Documents',        route: '/documents' },
    { icon: '📋', label: 'Modèles',          route: '/templates' },
    { icon: '🔔', label: 'Notifications',    route: '/notifications' },
    { icon: '🔍', label: 'Piste d\'audit',   route: '/audit' },
    { icon: '👥', label: 'Utilisateurs',     route: '/users', roles: ['ADMIN', 'SUPER_ADMIN'] },
    { icon: '👤', label: 'Mon profil',       route: '/profile' },
  ];

  constructor(public auth: AuthService) {}

  get visibleItems(): NavItem[] {
    return this.items.filter(item =>
      !item.roles || item.roles.some(r => this.auth.hasRole(r)),
    );
  }

  get initials(): string {
    const u = this.auth.user;
    if (!u) return '?';
    return `${u.first_name[0] ?? ''}${u.last_name[0] ?? ''}`.toUpperCase();
  }
}
