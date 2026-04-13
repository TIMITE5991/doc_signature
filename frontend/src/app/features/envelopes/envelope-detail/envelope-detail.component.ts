import { Component, ChangeDetectionStrategy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { Envelope, AuditLog, Recipient } from '../../../core/models';

@Component({
  selector: 'app-envelope-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="page-header" *ngIf="envelope()">
      <div>
        <h1>{{ envelope()!.title }}</h1>
        <span [class]="'badge badge-' + badgeClass(envelope()!.status)">
          {{ statusLabel(envelope()!.status) }}
        </span>
      </div>
      <div class="d-flex gap-1">
        <a class="btn btn-success"
           *ngIf="myPendingRecipient()?.token"
           [routerLink]="['/sign', myPendingRecipient()!.token]">
          ✍️ Traiter
        </a>
        <button class="btn btn-primary"
                *ngIf="envelope()!.status === 'DRAFT' && canSend()"
                (click)="send()">
          ✉️ Envoyer
        </button>
        <button class="btn btn-danger btn-sm"
                *ngIf="canCancel()"
                (click)="cancel()">
          Annuler
        </button>
        <a routerLink="/envelopes" class="btn btn-outline btn-sm">← Retour</a>
      </div>
    </div>

    <div class="loading-center" *ngIf="loading()"><div class="spinner"></div></div>
    <div *ngIf="error()" class="alert alert-danger">{{ error() }}</div>

    <div *ngIf="envelope() && !loading()">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start">
        <!-- LEFT -->
        <div>
          <!-- Meta -->
          <div class="card mb-2">
            <h3 class="section-title">Détails</h3>
            <div class="meta-row"><span>Circuit</span><strong>{{ circuitLabel(envelope()!.circuit_type) }}</strong></div>
            <div class="meta-row"><span>Créé par</span><strong>{{ envelope()!.creator_name }}</strong></div>
            <div class="meta-row"><span>Date de création</span><strong>{{ envelope()!.created_at | date:'dd/MM/yyyy HH:mm' }}</strong></div>
            <div class="meta-row" *ngIf="envelope()!.expires_at">
              <span>Expiration</span><strong>{{ envelope()!.expires_at | date:'dd/MM/yyyy' }}</strong>
            </div>
            <div class="meta-row" *ngIf="envelope()!.completed_at">
              <span>Complété le</span><strong>{{ envelope()!.completed_at | date:'dd/MM/yyyy HH:mm' }}</strong>
            </div>
            <div class="meta-row" *ngIf="envelope()!.message">
              <span>Message</span><em style="font-size:13px">{{ envelope()!.message }}</em>
            </div>
          </div>

          <!-- Documents -->
          <div class="card">
            <h3 class="section-title">Documents</h3>
            <div *ngFor="let doc of envelope()!.documents" class="doc-item">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                <div>
                  📄 <strong>{{ displayName(doc.original_name) }}</strong>
                  <span style="color:var(--text-muted);font-size:12px"> – {{ formatSize(doc.size) }}</span>
                </div>
                <a [href]="getDocViewUrl(doc.id_document)" target="_blank" rel="noopener"
                   class="btn btn-outline btn-sm" style="white-space:nowrap;flex-shrink:0">
                  👁 Visualiser
                </a>
              </div>
            </div>
            <div class="empty-state" style="padding:16px" *ngIf="!envelope()!.documents?.length">
              Aucun document
            </div>
          </div>
        </div>

        <!-- RIGHT: Recipients + Audit -->
        <div>
          <!-- Recipients -->
          <div class="card mb-2">
            <h3 class="section-title">Circuit de signature</h3>
            <div *ngFor="let r of sortedRecipients()" class="recipient-row">
              <div class="recipient-order">{{ r.signing_order }}</div>
              <div class="flex-1">
                <div style="font-weight:600;font-size:14px">{{ r.first_name }} {{ r.last_name }}</div>
                <div style="font-size:12px;color:var(--text-muted)">{{ r.email }}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
                  {{ roleLabel(r.role) }}
                  <span *ngIf="r.signed_at"> · Signé le {{ r.signed_at | date:'dd/MM/yyyy' }}</span>
                  <span *ngIf="r.rejection_reason"> · Rejet : {{ r.rejection_reason }}</span>
                  <span *ngIf="r.signing_comment" style="display:block;margin-top:4px;font-style:italic;background:#f0fff8;padding:4px 8px;border-radius:4px;color:#065c39">
                    💬 {{ r.signing_comment }}
                  </span>
                </div>
              </div>
              <span [class]="'badge badge-' + r.status.toLowerCase()">{{ recipientStatusLabel(r.status) }}</span>
            </div>
          </div>

          <!-- Audit -->
          <div class="card">
            <h3 class="section-title">Piste d'audit</h3>
            <div class="loading-center" style="padding:12px" *ngIf="loadingAudit()">
              <div class="spinner" style="width:20px;height:20px;border-width:2px"></div>
            </div>
            <div *ngFor="let log of auditLogs()" class="audit-row">
              <div class="audit-dot"></div>
              <div class="flex-1">
                <div style="font-weight:600;font-size:13px">{{ auditActionLabel(log.action) }}</div>
                <div style="font-size:12px;color:var(--text-muted)">
                  {{ log.user_email || 'Système' }} · {{ log.created_at | date:'dd/MM/yyyy HH:mm' }}
                </div>
              </div>
            </div>
            <div class="empty-state" style="padding:12px;font-size:13px" *ngIf="!auditLogs().length && !loadingAudit()">
              Aucun événement
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .section-title { font-size: 14px; font-weight: 700; color: var(--primary); margin-bottom: 14px; }
    .meta-row { display: flex; justify-content: space-between; align-items: baseline;
      padding: 8px 0; border-bottom: 1px solid var(--border);
      &:last-child { border: none; }
      span { color: var(--text-muted); font-size: 13px; }
    }
    .doc-item { padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 13px; &:last-child { border: none; } }
    .recipient-row { display: flex; align-items: flex-start; gap: 12px; padding: 12px 0;
      border-bottom: 1px solid var(--border); &:last-child { border: none; } }
    .recipient-order { width: 28px; height: 28px; border-radius: 50%; background: var(--primary);
      color: #fff; display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 700; flex-shrink: 0; margin-top: 2px; }
    .audit-row { display: flex; align-items: flex-start; gap: 12px; padding: 10px 0;
      border-bottom: 1px solid var(--border); &:last-child { border: none; } }
    .audit-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--primary);
      flex-shrink: 0; margin-top: 4px; }
  `],
})
export class EnvelopeDetailComponent implements OnInit {
  loading      = signal(true);
  loadingAudit = signal(true);
  error        = signal('');
  envelope     = signal<Envelope | null>(null);
  auditLogs    = signal<AuditLog[]>([]);

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    public auth: AuthService,
  ) {}

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.api.getEnvelope(id).subscribe({
      next: (env) => { this.envelope.set(env); this.loading.set(false); },
      error: (err) => { this.error.set(err.message); this.loading.set(false); },
    });
    this.api.getEnvelopeAudit(id).subscribe({
      next: (logs) => { this.auditLogs.set(logs); this.loadingAudit.set(false); },
      error: () => this.loadingAudit.set(false),
    });
  }

  send(): void {
    const id = this.envelope()!.id_envelope;
    this.api.sendEnvelope(id).subscribe({
      next: (env) => this.envelope.set(env),
      error: (err) => this.error.set(err.message),
    });
  }

  cancel(): void {
    if (!confirm('Annuler cette enveloppe ?')) return;
    const id = this.envelope()!.id_envelope;
    this.api.cancelEnvelope(id).subscribe({
      next: () => this.api.getEnvelope(id).subscribe(env => this.envelope.set(env)),
      error: (err) => this.error.set(err.message),
    });
  }

  sortedRecipients(): Recipient[] {
    return [...(this.envelope()?.recipients ?? [])].sort((a, b) => a.signing_order - b.signing_order);
  }

  canSend(): boolean {
    return this.auth.user?.id_user === this.envelope()?.created_by;
  }

  canCancel(): boolean {
    const s = this.envelope()?.status;
    return this.canSend() && (s === 'DRAFT' || s === 'SENT' || s === 'IN_PROGRESS' || s === 'REVISION');
  }

  myPendingRecipient(): Recipient | null {
    const userEmail = this.auth.user?.email?.toLowerCase();
    if (!userEmail || !this.envelope()?.recipients?.length) return null;

    return this.envelope()!.recipients!.find((r) =>
      r.email?.toLowerCase() === userEmail
      && !!r.token
      && (r.status === 'PENDING' || r.status === 'SENT' || r.status === 'VIEWED'),
    ) || null;
  }

  statusLabel(s: string): string {
    const m: Record<string, string> = { DRAFT: 'Brouillon', SENT: 'Envoyé', IN_PROGRESS: 'En cours', COMPLETED: 'Complété', REJECTED: 'Rejeté', REVISION: 'En révision', EXPIRED: 'Expiré', CANCELLED: 'Annulé' };
    return m[s] || s;
  }

  circuitLabel(c: string): string {
    const m: Record<string, string> = { SEQUENTIAL: 'Séquentiel', PARALLEL: 'Parallèle', MIXED: 'Mixte', CONDITIONAL: 'Conditionnel' };
    return m[c] || c;
  }

  roleLabel(r: string): string {
    const m: Record<string, string> = { SIGNATORY: 'Signataire', APPROVER: 'Approbateur', VIEWER: 'Visualisateur', DELEGATOR: 'Délégateur' };
    return m[r] || r;
  }

  recipientStatusLabel(s: string): string {
    const m: Record<string, string> = { PENDING: 'En attente', SENT: 'Envoyé', VIEWED: 'Vu', SIGNED: 'Signé', APPROVED: 'Approuvé', REJECTED: 'Rejeté', DELEGATED: 'Délégué', RETURNED: 'Retour corrections' };
    return m[s] || s;
  }

  auditActionLabel(a: string): string {
    const m: Record<string, string> = {
      ENVELOPE_CREATED: '📝 Enveloppe créée', ENVELOPE_SENT: '✉️ Enveloppe envoyée',
      DOCUMENT_SIGNED: '✍️ Document signé', DOCUMENT_REJECTED: '❌ Document rejeté',
      DOCUMENT_RETURNED: '↩️ Retour pour corrections', DOCUMENT_FORWARDED: '🔁 Document renvoyé à un destinataire',
      ENVELOPE_COMPLETED: '✅ Processus terminé',
      ENVELOPE_CANCELLED: '🚫 Enveloppe annulée', SIGNATURE_DELEGATED: '🔀 Signature déléguée',
    };
    return m[a] || a;
  }

  getDocViewUrl(docId: number): string { return this.api.getDocumentViewUrl(docId); }

  badgeClass(s: string): string { return s.toLowerCase().replace('_', '-'); }

  formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  displayName(name: string): string {
    if (!name || !/[ÃÂâðÌ]/.test(name)) return name;
    try {
      const bytes = Uint8Array.from(Array.from(name, (c) => c.charCodeAt(0) & 0xff));
      return new TextDecoder('utf-8').decode(bytes).normalize('NFC');
    } catch {
      return name;
    }
  }
}
