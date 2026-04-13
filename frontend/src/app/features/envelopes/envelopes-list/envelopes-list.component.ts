import { Component, ChangeDetectionStrategy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { Envelope } from '../../../core/models';

@Component({
  selector: 'app-envelopes-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="page-header">
      <div>
        <h1>Enveloppes</h1>
        <p>Circuits de signature de vos documents</p>
      </div>
      <a routerLink="/envelopes/new" class="btn btn-primary">＋ Nouvelle enveloppe</a>
    </div>

    <!-- Filters -->
    <div class="filter-bar">
      <button *ngFor="let f of filters" class="filter-btn"
              [class.active]="activeFilter() === f.key" (click)="activeFilter.set(f.key)">
        {{ f.label }} <span class="filter-count">{{ countByStatus(f.key) }}</span>
      </button>
    </div>

    <div class="loading-center" *ngIf="loading()"><div class="spinner"></div></div>

    <div class="card" *ngIf="!loading()">
      <div class="empty-state" *ngIf="filtered().length === 0">
        <div class="icon">📭</div>
        <p>Aucune enveloppe dans cette catégorie</p>
        <a routerLink="/envelopes/new" class="btn btn-primary btn-sm mt-2">Créer une enveloppe</a>
      </div>

      <div class="table-wrapper" *ngIf="filtered().length > 0">
        <table class="data-table">
          <thead>
            <tr>
              <th>Titre</th>
              <th>Statut</th>
              <th>Circuit</th>
              <th>Destinataires</th>
              <th>Expiration</th>
              <th>Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let e of filtered()">
              <td>
                <a [routerLink]="['/envelopes', e.id_envelope]" style="font-weight:500;color:var(--primary)">
                  {{ e.title }}
                </a>
                <div style="font-size:11px;color:var(--text-muted)" *ngIf="e.subject">{{ e.subject }}</div>
              </td>
              <td><span [class]="'badge badge-' + badgeClass(e.status)">{{ statusLabel(e.status) }}</span></td>
              <td style="font-size:13px;color:var(--text-muted)">{{ circuitLabel(e.circuit_type) }}</td>
              <td style="font-size:13px;color:var(--text-muted)">{{ e.recipients?.length ?? '—' }}</td>
              <td style="font-size:13px;color:var(--text-muted)">
                {{ e.expires_at ? (e.expires_at | date:'dd/MM/yyyy') : '—' }}
              </td>
              <td style="font-size:13px;color:var(--text-muted)">{{ e.created_at | date:'dd/MM/yyyy' }}</td>
              <td>
                <a [routerLink]="['/envelopes', e.id_envelope]" class="btn btn-outline btn-sm">Voir</a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .filter-bar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .filter-btn {
      padding: 7px 16px; border-radius: 20px; border: 1.5px solid var(--border);
      background: var(--surface); color: var(--text-secondary); cursor: pointer;
      font-size: 13px; font-weight: 500; transition: all 0.2s; font-family: inherit;
      display: flex; align-items: center; gap: 6px;
      &.active { background: var(--primary); color: #fff; border-color: var(--primary); }
      &:hover:not(.active) { border-color: var(--primary); color: var(--primary); }
    }
    .filter-count { background: rgba(0,0,0,0.1); border-radius: 10px; padding: 0 6px; font-size: 11px; }
  `],
})
export class EnvelopesListComponent implements OnInit {
  loading      = signal(true);
  activeFilter = signal('ALL');
  envelopes    = signal<Envelope[]>([]);

  filters = [
    { key: 'ALL',         label: 'Toutes' },
    { key: 'DRAFT',       label: 'Brouillons' },
    { key: 'IN_PROGRESS', label: 'En cours' },
    { key: 'COMPLETED',   label: 'Complétées' },
    { key: 'REJECTED',    label: 'Rejetées' },
  ];

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.getEnvelopes().subscribe({
      next: (list) => { this.envelopes.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  filtered(): Envelope[] {
    const f = this.activeFilter();
    if (f === 'ALL') return this.envelopes();
    if (f === 'IN_PROGRESS') return this.envelopes().filter(e => e.status === 'IN_PROGRESS' || e.status === 'SENT');
    return this.envelopes().filter(e => e.status === f);
  }

  countByStatus(key: string): number {
    if (key === 'ALL') return this.envelopes().length;
    if (key === 'IN_PROGRESS') return this.envelopes().filter(e => e.status === 'IN_PROGRESS' || e.status === 'SENT').length;
    return this.envelopes().filter(e => e.status === key).length;
  }

  statusLabel(s: string): string {
    const m: Record<string, string> = { DRAFT: 'Brouillon', SENT: 'Envoyé', IN_PROGRESS: 'En cours', COMPLETED: 'Complété', REJECTED: 'Rejeté', EXPIRED: 'Expiré', CANCELLED: 'Annulé' };
    return m[s] || s;
  }

  circuitLabel(c: string): string {
    const m: Record<string, string> = { SEQUENTIAL: 'Séquentiel', PARALLEL: 'Parallèle', MIXED: 'Mixte', CONDITIONAL: 'Conditionnel' };
    return m[c] || c;
  }

  badgeClass(s: string): string {
    return s.toLowerCase().replace('_', '-');
  }
}
