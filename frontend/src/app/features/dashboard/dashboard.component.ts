import { Component, ChangeDetectionStrategy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { Envelope } from '../../core/models';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="page-header">
      <div>
        <h1>Bonjour, {{ auth.user?.first_name }} 👋</h1>
        <p>{{ today | date:'EEEE d MMMM yyyy':'':'fr' }} — Vue d'ensemble de votre activité</p>
      </div>
      <a routerLink="/envelopes/new" class="btn btn-primary">
        ＋ Nouvelle enveloppe
      </a>
    </div>

    <!-- Stats -->
    <div class="stats-grid" *ngIf="!loading()">
      <div class="stat-card">
        <div class="stat-icon" style="background:#e8f4fd">📨</div>
        <div>
          <div class="stat-value">{{ counts.total }}</div>
          <div class="stat-label">Enveloppes totales</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#fff3e0">⏳</div>
        <div>
          <div class="stat-value">{{ counts.in_progress }}</div>
          <div class="stat-label">En cours</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#e8f8ee">✅</div>
        <div>
          <div class="stat-value">{{ counts.completed }}</div>
          <div class="stat-label">Complétées</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#fde8e8">❌</div>
        <div>
          <div class="stat-value">{{ counts.rejected }}</div>
          <div class="stat-label">Rejetées</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:#f0f2f5">📝</div>
        <div>
          <div class="stat-value">{{ counts.draft }}</div>
          <div class="stat-label">Brouillons</div>
        </div>
      </div>
    </div>

    <div class="loading-center" *ngIf="loading()"><div class="spinner"></div></div>

    <!-- Recent envelopes -->
    <div class="card" *ngIf="!loading()">
      <div class="d-flex justify-between align-center mb-2">
        <h3 style="font-size:15px;font-weight:600">Enveloppes récentes</h3>
        <a routerLink="/envelopes" style="font-size:13px">Voir tout →</a>
      </div>

      <div class="empty-state" *ngIf="recent.length === 0">
        <div class="icon">📭</div>
        <p>Aucune enveloppe pour l'instant</p>
        <a routerLink="/envelopes/new" class="btn btn-primary btn-sm mt-2">Créer une enveloppe</a>
      </div>

      <div class="table-wrapper" *ngIf="recent.length > 0">
        <table class="data-table">
          <thead>
            <tr>
              <th>Titre</th>
              <th>Statut</th>
              <th>Circuit</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let e of recent">
              <td>
                <a [routerLink]="['/envelopes', e.id_envelope]" style="font-weight:500;color:var(--primary)">
                  {{ e.title }}
                </a>
              </td>
              <td><span [class]="'badge badge-' + e.status.toLowerCase().replace('_','-')">{{ statusLabel(e.status) }}</span></td>
              <td style="font-size:13px;color:var(--text-muted)">{{ e.circuit_type }}</td>
              <td style="font-size:13px;color:var(--text-muted)">{{ e.created_at | date:'dd/MM/yyyy' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class DashboardComponent implements OnInit {
  loading = signal(true);
  recent: Envelope[] = [];
  today = new Date();
  counts = { total: 0, draft: 0, in_progress: 0, completed: 0, rejected: 0 };

  constructor(public auth: AuthService, private api: ApiService) {}

  ngOnInit(): void {
    this.api.getEnvelopes().subscribe({
      next: (envs) => {
        this.recent = envs.slice(0, 10);
        this.counts.total       = envs.length;
        this.counts.draft       = envs.filter(e => e.status === 'DRAFT').length;
        this.counts.in_progress = envs.filter(e => e.status === 'IN_PROGRESS' || e.status === 'SENT').length;
        this.counts.completed   = envs.filter(e => e.status === 'COMPLETED').length;
        this.counts.rejected    = envs.filter(e => e.status === 'REJECTED').length;
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  statusLabel(status: string): string {
    const map: Record<string, string> = {
      DRAFT: 'Brouillon', SENT: 'Envoyé', IN_PROGRESS: 'En cours',
      COMPLETED: 'Complété', REJECTED: 'Rejeté', EXPIRED: 'Expiré', CANCELLED: 'Annulé',
    };
    return map[status] || status;
  }
}
