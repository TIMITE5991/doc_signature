import { Component, ChangeDetectionStrategy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { Notification } from '../../core/models';

@Component({
  selector: 'app-notifications',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="page-header">
      <div>
        <h1>Notifications</h1>
        <p>{{ api.unreadNotifCount() }} non lues</p>
      </div>
      <button class="btn btn-outline" (click)="markAllRead()" [disabled]="api.unreadNotifCount() === 0">
        Tout marquer comme lu
      </button>
    </div>

    <div class="loading-center" *ngIf="loading()"><div class="spinner"></div></div>

    <div class="card" *ngIf="!loading()">
      <div *ngFor="let n of notifications(); let last = last"
           class="notif-row"
           [class.unread]="!n.is_read"
           (click)="markRead(n)">
        <div class="notif-dot" *ngIf="!n.is_read"></div>
        <div class="notif-body">
          <p class="notif-msg">{{ n.message }}</p>
          <span class="notif-date">{{ n.created_at | date:'dd/MM/yyyy HH:mm' }}</span>
          <a *ngIf="n.id_envelope" [routerLink]="['/envelopes', n.id_envelope]"
             class="notif-link" (click)="$event.stopPropagation()">
            Voir l'enveloppe →
          </a>
        </div>
        <hr *ngIf="!last" class="notif-divider"/>
      </div>

      <div *ngIf="notifications().length === 0"
           style="text-align:center;color:var(--text-muted);padding:48px">
        Aucune notification
      </div>
    </div>
  `,
  styles: [`
    .notif-row {
      position: relative;
      padding: 16px 20px;
      cursor: pointer;
      transition: background .15s;
      border-radius: 6px;
    }
    .notif-row:hover { background: var(--bg-light); }
    .notif-row.unread { background: #f0f6ff; }
    .notif-dot {
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 4px;
      height: 60%;
      background: var(--primary);
      border-radius: 0 4px 4px 0;
    }
    .notif-msg { margin: 0 0 4px; font-size: 14px; }
    .notif-date { font-size: 12px; color: var(--text-muted); }
    .notif-link { font-size: 12px; color: var(--primary); margin-left: 12px; }
    .notif-divider { border: none; border-top: 1px solid var(--border-color); margin: 0; }
  `],
})
export class NotificationsComponent implements OnInit {
  loading       = signal(true);
  notifications = signal<Notification[]>([]);

  constructor(public api: ApiService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.api.getNotifications().subscribe({
      next: (list) => {
        this.notifications.set(list);
        this.api.unreadNotifCount.set(list.filter(n => !n.is_read).length);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  markRead(n: Notification): void {
    if (n.is_read) return;
    this.api.markNotificationRead(n.id_notification).subscribe(() => {
      this.notifications.update(list =>
        list.map(x => x.id_notification === n.id_notification ? { ...x, is_read: true } : x)
      );
    });
  }

  markAllRead(): void {
    this.api.markAllNotificationsRead().subscribe(() => {
      this.notifications.update(list => list.map(n => ({ ...n, is_read: true })));
    });
  }
}
