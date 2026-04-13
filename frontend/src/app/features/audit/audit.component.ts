import { Component, ChangeDetectionStrategy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../core/services/api.service';
import { AuditLog } from '../../core/models';

@Component({
  selector: 'app-audit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="page-header">
      <div>
        <h1>Piste d'audit</h1>
        <p>Journal complet de toutes les transactions</p>
      </div>
    </div>

    <div class="loading-center" *ngIf="loading()"><div class="spinner"></div></div>

    <div class="card" *ngIf="!loading()">
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Document</th>
              <th>Utilisateur</th>
              <th>Adresse IP</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let log of logs()">
              <td>
                <span style="font-weight:500">{{ actionLabel(log.action) }}</span>
              </td>
              <td style="font-size:13px;color:var(--text-muted)">
                {{ log.id_envelope ? '#' + log.id_envelope : '—' }}
              </td>
              <td style="font-size:13px">{{ log.user_email || 'Système' }}</td>
              <td style="font-size:13px;color:var(--text-muted);font-family:monospace">
                {{ log.ip_address || '—' }}
              </td>
              <td style="font-size:13px;color:var(--text-muted)">
                {{ log.created_at | date:'dd/MM/yyyy HH:mm:ss' }}
              </td>
            </tr>
            <tr *ngIf="logs().length === 0">
              <td colspan="5" style="text-align:center;color:var(--text-muted);padding:32px">
                Aucun événement enregistré
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div class="pagination" *ngIf="total() > limit">
        <button class="btn btn-outline btn-sm" [disabled]="page() <= 1" (click)="loadPage(page() - 1)">← Préc.</button>
        <span style="font-size:13px;color:var(--text-muted)">
          Page {{ page() }} / {{ totalPages() }}
          ({{ total() }} événements)
        </span>
        <button class="btn btn-outline btn-sm" [disabled]="page() >= totalPages()" (click)="loadPage(page() + 1)">Suiv. →</button>
      </div>
    </div>
  `,
  styles: [`
    .pagination { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 16px; }
  `],
})
export class AuditComponent implements OnInit {
  loading = signal(true);
  logs    = signal<AuditLog[]>([]);
  total   = signal(0);
  page    = signal(1);
  limit   = 50;

  constructor(private api: ApiService) {}

  ngOnInit(): void { this.loadPage(1); }

  loadPage(p: number): void {
    this.loading.set(true);
    this.api.getAuditLogs(p, this.limit).subscribe({
      next: (res) => {
        this.logs.set(res.data);
        this.total.set(res.total);
        this.page.set(res.page);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  totalPages(): number { return Math.ceil(this.total() / this.limit); }

  actionLabel(a: string): string {
    const m: Record<string, string> = {
      ENVELOPE_CREATED:   '📝 Enveloppe créée',
      ENVELOPE_SENT:      '✉️ Enveloppe envoyée',
      DOCUMENT_SIGNED:    '✍️ Document signé',
      DOCUMENT_REJECTED:  '❌ Document rejeté',
      ENVELOPE_COMPLETED: '✅ Processus terminé',
      ENVELOPE_CANCELLED: '🚫 Annulation',
      SIGNATURE_DELEGATED:'🔀 Délégation',
    };
    return m[a] || a;
  }
}
