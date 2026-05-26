import { Component, ChangeDetectionStrategy, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { Envelope, AuditLog, Recipient } from '../../../core/models';

@Component({
  selector: 'app-envelope-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RouterLink],
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
                *ngIf="canSend() && (envelope()!.status === 'DRAFT' || envelope()!.status === 'REVISION')"
                (click)="send()">
          ✉️ {{ envelope()!.status === 'REVISION' ? 'Renvoyer' : 'Envoyer' }}
        </button>
        <button class="btn btn-success"
          *ngIf="canCloseCircuit()"
          (click)="closeCircuit()">
          ✅ Clôturer
        </button>
        <button class="btn btn-danger btn-sm"
                *ngIf="canCancel()"
                (click)="cancel()">
          Annuler
        </button>
        <a routerLink="/envelopes" class="btn btn-outline btn-sm">← Retour</a>
      </div>
    </div>

    <div *ngIf="successMsg()" class="alert alert-success" style="display:flex;justify-content:space-between;align-items:center">
      <span>{{ successMsg() }}</span>
      <button type="button" style="background:none;border:none;cursor:pointer;font-size:16px" (click)="successMsg.set('')">✕</button>
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

          <div class="card mt-2" *ngIf="canSend() && envelope()!.status === 'REVISION'">
            <h3 class="section-title">Corriger le document</h3>
            <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
              Téléversez la version corrigée des fichiers joints, puis renvoyez le parapheur pour poursuivre le circuit.
            </p>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
              <label class="btn btn-outline btn-sm" style="cursor:pointer;margin:0">
                📎 Importer un ou plusieurs documents corrigés
                <input type="file" multiple style="display:none" (change)="onCorrectionFilesSelected($event)" />
              </label>
              <span style="font-size:12px;color:var(--text-muted)" *ngIf="correctionLoading()">
                Téléversement et mise à jour en cours...
              </span>
            </div>
            <div class="error-msg" style="margin-bottom:10px" *ngIf="correctionUploadError()">
              {{ correctionUploadError() }}
            </div>
            <div class="empty-state" style="padding:12px;margin-top:12px" *ngIf="!correctionFiles().length">
              Aucun fichier corrigé sélectionné
            </div>
            <div *ngIf="correctionFiles().length" style="margin-top:12px;font-size:13px;color:var(--text-muted)">
              <div *ngFor="let file of correctionFiles()">• {{ file.name }} – {{ formatSize(file.size) }}</div>
            </div>

            <h4 style="font-size:13px;font-weight:700;margin:16px 0 8px;color:var(--primary)">Pièces jointes (optionnel)</h4>
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
              Ces fichiers accompagnent les documents corrigés mais ne sont pas soumis à signature.
            </p>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
              <label class="btn btn-outline btn-sm" style="cursor:pointer;margin:0">
                📎 Importer des pièces jointes
                <input type="file" multiple style="display:none" (change)="onCorrectionAttachmentFilesSelected($event)" />
              </label>
            </div>
            <div class="empty-state" style="padding:12px;margin-top:12px" *ngIf="!correctionAttachmentFiles().length">
              Aucune pièce jointe sélectionnée
            </div>
            <div *ngIf="correctionAttachmentFiles().length" style="margin-top:12px;font-size:13px;color:var(--text-muted)">
              <div *ngFor="let file of correctionAttachmentFiles()">• {{ file.name }} – {{ formatSize(file.size) }}</div>
            </div>

            <h4 style="font-size:13px;font-weight:700;margin:16px 0 8px;color:var(--primary)" *ngIf="correctionFiles().length && signatoryRecipientsForCorrection().length">
              📍 Zones prédéfinies (signature + cachet)
            </h4>
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px" *ngIf="correctionFiles().length && signatoryRecipientsForCorrection().length">
              Définissez l'emplacement souhaité par destinataire. Le cachet utilisera cette zone par défaut lors de la signature.
            </p>
            <div *ngIf="correctionFiles().length && signatoryRecipientsForCorrection().length" style="display:grid;gap:10px;margin-top:8px">
              <div *ngFor="let r of signatoryRecipientsForCorrection()" style="border:1px solid var(--border);border-radius:8px;padding:10px">
                <div style="font-size:12px;font-weight:700;margin-bottom:8px">{{ r.first_name }} {{ r.last_name }} ({{ r.email }})</div>
                <div style="display:grid;grid-template-columns:1fr 90px;gap:8px;align-items:end">
                  <div>
                    <label style="font-size:12px">Document corrigé</label>
                    <select [value]="getCorrectionZoneDocIndex(r.id_recipient)" (change)="setCorrectionZoneDocIndex(r.id_recipient, +$any($event.target).value)">
                      <option *ngFor="let file of correctionFiles(); let fi = index" [value]="fi">{{ file.name }}</option>
                    </select>
                  </div>
                  <div>
                    <label style="font-size:12px">Page</label>
                    <input type="number" min="1" [value]="getCorrectionZonePage(r.id_recipient)" (input)="setCorrectionZonePage(r.id_recipient, $any($event.target).value)" />
                  </div>
                </div>
                <div class="corr-page-nav" *ngIf="getCorrectionPreviewType(r.id_recipient) === 'pdf'">
                  <button type="button" class="btn btn-outline btn-sm" (click)="prevCorrectionPreviewPage(r.id_recipient)" [disabled]="getCorrectionZonePage(r.id_recipient) <= 1">‹</button>
                  <span>Page {{ getCorrectionZonePage(r.id_recipient) }} / {{ correctionPdfTotalPages(r.id_recipient) }}</span>
                  <button type="button" class="btn btn-outline btn-sm" (click)="nextCorrectionPreviewPage(r.id_recipient)" [disabled]="getCorrectionZonePage(r.id_recipient) >= correctionPdfTotalPages(r.id_recipient)">›</button>
                </div>
                <div style="margin-top:8px">
                  <label style="font-size:12px">Position X: {{ correctionZonePercentX(r.id_recipient) }}%</label>
                  <input type="range" min="0" max="100" [value]="correctionZonePercentX(r.id_recipient)" (input)="setCorrectionZoneX(r.id_recipient, $any($event.target).value)" />
                </div>
                <div style="margin-top:4px">
                  <label style="font-size:12px">Position Y: {{ correctionZonePercentY(r.id_recipient) }}%</label>
                  <input type="range" min="0" max="100" [value]="correctionZonePercentY(r.id_recipient)" (input)="setCorrectionZoneY(r.id_recipient, $any($event.target).value)" />
                </div>
                <div class="corr-preview-wrap" *ngIf="getCorrectionPreviewType(r.id_recipient) !== 'none'">
                  <div class="corr-preview-hint">Cliquez dans l'aperçu pour poser la zone.</div>
                  <div class="corr-preview-toolbar">
                    <button type="button" class="btn btn-outline btn-sm" (click)="decreaseCorrectionPreviewZoom()">−</button>
                    <span>Zoom aperçu: {{ correctionPreviewZoom() }}%</span>
                    <button type="button" class="btn btn-outline btn-sm" (click)="increaseCorrectionPreviewZoom()">＋</button>
                  </div>
                  <div class="corr-preview-stage"
                       [style.height.px]="correctionPreviewHeightPx()"
                       *ngIf="getCorrectionPreviewType(r.id_recipient) !== 'unsupported'"
                       (click)="onCorrectionPreviewClick($event, r.id_recipient)">
                    <iframe *ngIf="getCorrectionPreviewType(r.id_recipient) === 'pdf'"
                            class="corr-preview-frame"
                            [src]="getCorrectionPreviewSafeUrl(r.id_recipient)">
                    </iframe>
                    <img *ngIf="getCorrectionPreviewType(r.id_recipient) === 'image'"
                         class="corr-preview-image"
                         [src]="getCorrectionPreviewObjectUrl(r.id_recipient)"
                         alt="Aperçu document corrigé" />
                    <div class="corr-preview-overlay">
                      <div class="corr-preview-marker"
                           [style.left.%]="correctionZonePercentX(r.id_recipient)"
                           [style.top.%]="correctionZonePercentY(r.id_recipient)">
                      </div>
                    </div>
                  </div>
                  <div class="corr-preview-unsupported" *ngIf="getCorrectionPreviewType(r.id_recipient) === 'unsupported'">
                    Aperçu indisponible pour ce format. Utilisez un PDF ou une image pour un placement visuel.
                  </div>
                </div>
              </div>
            </div>

            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
              <button class="btn btn-primary" type="button" [disabled]="correctionLoading() || !correctionFiles().length" (click)="applyCorrectionsAndResend()">
                {{ correctionLoading() ? 'Mise à jour...' : '💾 Enregistrer et renvoyer' }}
              </button>
              <button class="btn btn-outline" type="button" [disabled]="correctionLoading() || (!correctionFiles().length && !correctionAttachmentFiles().length)" (click)="clearCorrectionFiles()">
                Réinitialiser
              </button>
            </div>
          </div>

          <div class="card mt-2" *ngIf="canForwardByCreator()">
            <h3 class="section-title">Renvoyer à un autre destinataire</h3>
            <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
              Après correction, vous pouvez relancer le circuit vers une autre personne pour vérification/analyse.
            </p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <input type="text" placeholder="Prénom" [(ngModel)]="forwardFirstName" />
              <input type="text" placeholder="Nom" [(ngModel)]="forwardLastName" />
            </div>
            <div style="margin-top:10px">
              <input type="email" placeholder="destinataire@cgrae.ci" style="width:100%" [(ngModel)]="forwardEmail" />
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
              <button class="btn btn-primary" type="button" [disabled]="forwardLoading()" (click)="forwardToNextRecipient()">
                {{ forwardLoading() ? 'Envoi...' : '🔁 Ajouter et notifier' }}
              </button>
              <button class="btn btn-outline" type="button" [disabled]="forwardLoading()" (click)="resetForwardForm()">
                Réinitialiser
              </button>
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
              <span [class]="'badge badge-' + recipientBadgeClass(r.status)">{{ recipientStatusLabel(r.status) }}</span>
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

    .corr-preview-wrap { margin-top: 10px; }
    .corr-preview-hint { font-size: 11px; color: var(--text-muted); margin-bottom: 6px; }
    .corr-preview-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 12px;
      color: var(--text-muted);
    }
    .corr-page-nav {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
      font-size: 12px;
      color: var(--text-muted);
    }
    .corr-preview-stage {
      position: relative;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: #f8fafc;
      height: 260px;
      cursor: crosshair;
    }
    .corr-preview-frame,
    .corr-preview-image {
      width: 100%;
      height: 100%;
      border: none;
      object-fit: contain;
      pointer-events: none;
      background: #fff;
    }
    .corr-preview-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .corr-preview-marker {
      position: absolute;
      width: 16px;
      height: 16px;
      border-radius: 50% 50% 50% 0;
      transform: translate(-50%, -50%) rotate(-45deg);
      background: #e65100;
      border: 2px solid #fff;
      box-shadow: 0 1px 6px rgba(0, 0, 0, .3);
    }
    .corr-preview-unsupported {
      border: 1px dashed var(--border);
      border-radius: 8px;
      padding: 12px;
      font-size: 12px;
      color: var(--text-muted);
      background: #f9fafb;
    }
  `],
})
export class EnvelopeDetailComponent implements OnInit, OnDestroy {
  loading      = signal(true);
  loadingAudit = signal(true);
  correctionLoading = signal(false);
  correctionUploadError = signal('');
  forwardLoading = signal(false);
  error        = signal('');
  successMsg   = signal('');
  envelope     = signal<Envelope | null>(null);
  auditLogs    = signal<AuditLog[]>([]);
  correctionFiles = signal<File[]>([]);
  correctionAttachmentFiles = signal<File[]>([]);
  correctionZones = signal<Map<number, { doc_index: number; x_ratio: number; y_ratio: number; page_number: number }>>(new Map());
  correctionPreviewZoom = signal(100);
  correctionPdfPageCounts = signal<Map<string, number>>(new Map());
  private correctionPreviewObjectUrlCache = new Map<string, string>();
  private correctionPdfPageLoading = new Set<string>();
  forwardFirstName = '';
  forwardLastName = '';
  forwardEmail = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private sanitizer: DomSanitizer,
    private api: ApiService,
    public auth: AuthService,
  ) {}

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));

    // Lire et effacer le message flash (sessionStorage est fiable avec lazy-loading)
    const flashRaw = sessionStorage.getItem('envelope_flash');
    if (flashRaw) {
      sessionStorage.removeItem('envelope_flash');
      try {
        const flash = JSON.parse(flashRaw) as { type: string; msg: string };
        if (flash.type === 'success') this.successMsg.set(flash.msg);
        else this.error.set(flash.msg);
      } catch { /* ignore */ }
    }

    this.api.getEnvelope(id).subscribe({
      next: (env) => { this.envelope.set(env); this.loading.set(false); },
      error: (err) => { this.error.set(err.message); this.loading.set(false); },
    });
    this.api.getEnvelopeAudit(id).subscribe({
      next: (logs) => { this.auditLogs.set(logs); this.loadingAudit.set(false); },
      error: () => this.loadingAudit.set(false),
    });
  }

  ngOnDestroy(): void {
    for (const url of this.correctionPreviewObjectUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.correctionPreviewObjectUrlCache.clear();
  }

  send(): void {
    const id = this.envelope()!.id_envelope;
    this.api.sendEnvelope(id).subscribe({
      next: (env) => this.envelope.set(env),
      error: (err) => this.error.set(err.message),
    });
  }

  onCorrectionFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const incomingFiles = Array.from(input.files ?? []);
    if (!incomingFiles.length) return;

    const existingFiles = this.correctionFiles();
    const seen = new Set(existingFiles.map((f) => `${f.name}|${f.size}|${f.lastModified}`));
    const uniqueIncoming = incomingFiles.filter((f) => {
      const key = `${f.name}|${f.size}|${f.lastModified}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    this.correctionFiles.set([...existingFiles, ...uniqueIncoming]);
    this.normalizeCorrectionZones();
    this.correctionUploadError.set('');
    input.value = '';
  }

  clearCorrectionFiles(): void {
    this.clearCorrectionPreviewCache();
    this.correctionFiles.set([]);
    this.correctionAttachmentFiles.set([]);
    this.correctionZones.set(new Map());
  }

  onCorrectionAttachmentFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const incomingFiles = Array.from(input.files ?? []);
    if (!incomingFiles.length) return;

    const existingFiles = this.correctionAttachmentFiles();
    const seen = new Set(existingFiles.map((f) => `${f.name}|${f.size}|${f.lastModified}`));
    const uniqueIncoming = incomingFiles.filter((f) => {
      const key = `${f.name}|${f.size}|${f.lastModified}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    this.correctionAttachmentFiles.set([...existingFiles, ...uniqueIncoming]);
    this.correctionUploadError.set('');
    input.value = '';
  }

  signatoryRecipientsForCorrection(): Recipient[] {
    return this.sortedRecipients().filter((r) => r.role === 'SIGNATORY');
  }

  getCorrectionZoneDocIndex(recipientId: number): number {
    return this.getCorrectionZone(recipientId).doc_index;
  }

  getCorrectionZonePage(recipientId: number): number {
    return this.getCorrectionZone(recipientId).page_number;
  }

  correctionZonePercentX(recipientId: number): number {
    return Math.round(this.getCorrectionZone(recipientId).x_ratio * 100);
  }

  correctionZonePercentY(recipientId: number): number {
    return Math.round(this.getCorrectionZone(recipientId).y_ratio * 100);
  }

  setCorrectionZoneDocIndex(recipientId: number, docIndex: number): void {
    const max = Math.max(0, this.correctionFiles().length - 1);
    const safe = Math.min(Math.max(docIndex, 0), max);
    this.updateCorrectionZone(recipientId, { doc_index: safe });
  }

  setCorrectionZonePage(recipientId: number, pageValue: string): void {
    const maxPage = this.getKnownCorrectionPdfPageCount(recipientId);
    const page = Math.max(1, Math.min(Math.floor(Number(pageValue) || 1), maxPage));
    this.updateCorrectionZone(recipientId, { page_number: page });
  }

  prevCorrectionPreviewPage(recipientId: number): void {
    const current = this.getCorrectionZonePage(recipientId);
    if (current <= 1) return;
    this.updateCorrectionZone(recipientId, { page_number: current - 1 });
  }

  nextCorrectionPreviewPage(recipientId: number): void {
    const current = this.getCorrectionZonePage(recipientId);
    const total = this.correctionPdfTotalPages(recipientId);
    if (current >= total) return;
    this.updateCorrectionZone(recipientId, { page_number: current + 1 });
  }

  setCorrectionZoneX(recipientId: number, xValue: string): void {
    const x = Math.min(Math.max(Number(xValue) / 100, 0), 1);
    this.updateCorrectionZone(recipientId, { x_ratio: x });
  }

  setCorrectionZoneY(recipientId: number, yValue: string): void {
    const y = Math.min(Math.max(Number(yValue) / 100, 0), 1);
    this.updateCorrectionZone(recipientId, { y_ratio: y });
  }

  correctionPreviewHeightPx(): number {
    return Math.round(260 * (this.correctionPreviewZoom() / 100));
  }

  increaseCorrectionPreviewZoom(): void {
    this.correctionPreviewZoom.set(Math.min(240, this.correctionPreviewZoom() + 20));
  }

  decreaseCorrectionPreviewZoom(): void {
    this.correctionPreviewZoom.set(Math.max(80, this.correctionPreviewZoom() - 20));
  }

  getCorrectionPreviewType(recipientId: number): 'none' | 'pdf' | 'image' | 'unsupported' {
    const file = this.getCorrectionPreviewFile(recipientId);
    if (!file) return 'none';

    const mime = (file.type || '').toLowerCase();
    const ext = (file.name || '').toLowerCase().split('.').pop() || '';
    if (mime === 'application/pdf' || ext === 'pdf') {
      this.ensureCorrectionPdfPageCount(recipientId);
      return 'pdf';
    }
    if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) return 'image';
    return 'unsupported';
  }

  getCorrectionPreviewObjectUrl(recipientId: number): string {
    const file = this.getCorrectionPreviewFile(recipientId);
    if (!file) return '';

    const key = this.getCorrectionFileKey(file);
    const existing = this.correctionPreviewObjectUrlCache.get(key);
    if (existing) return existing;

    const objectUrl = URL.createObjectURL(file);
    this.correctionPreviewObjectUrlCache.set(key, objectUrl);
    return objectUrl;
  }

  getCorrectionPreviewSafeUrl(recipientId: number): SafeResourceUrl | null {
    const file = this.getCorrectionPreviewFile(recipientId);
    if (!file) return null;

    this.ensureCorrectionPdfPageCount(recipientId);
    const objectUrl = this.getCorrectionPreviewObjectUrl(recipientId);
    const page = this.getCorrectionZonePage(recipientId);
    const withParams = `${objectUrl}#page=${page}&zoom=page-fit&toolbar=0&navpanes=0&statusbar=0&messages=0`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(withParams);
  }

  correctionPdfTotalPages(recipientId: number): number {
    this.ensureCorrectionPdfPageCount(recipientId);
    return this.getKnownCorrectionPdfPageCount(recipientId);
  }

  onCorrectionPreviewClick(event: MouseEvent, recipientId: number): void {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const x_ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    const y_ratio = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1);
    this.updateCorrectionZone(recipientId, { x_ratio, y_ratio });
  }

  applyCorrectionsAndResend(): void {
    if (!this.envelope() || !this.correctionFiles().length) return;
    this.correctionLoading.set(true);
    this.error.set('');
    this.correctionUploadError.set('');
    const files = this.correctionFiles();
    const attachmentFiles = this.correctionAttachmentFiles();

    const uploadDocuments = (index: number, uploadedDocumentIds: number[]) => {
      if (index >= files.length) {
        uploadAttachments(0, uploadedDocumentIds, []);
        return;
      }

      this.api.uploadDocument(files[index]).subscribe({
        next: (doc) => uploadDocuments(index + 1, [...uploadedDocumentIds, doc.id_document]),
        error: (err) => {
          this.correctionUploadError.set(this.extractUploadErrorMessage(err));
          this.correctionLoading.set(false);
        },
      });
    };

    const uploadAttachments = (index: number, uploadedDocumentIds: number[], uploadedAttachmentIds: number[]) => {
      if (index >= attachmentFiles.length) {
        const existingAttachmentIds = this.envelope()?.attachments?.map((d) => d.id_document) || [];
        const mergedAttachmentIds = [...new Set([...existingAttachmentIds, ...uploadedAttachmentIds])];
        const attachmentIdsPayload = mergedAttachmentIds.length ? mergedAttachmentIds : undefined;
        const recipientZonesPayload = this.buildRecipientZonesPayload();

        this.api.replaceEnvelopeDocuments(
          this.envelope()!.id_envelope,
          uploadedDocumentIds,
          attachmentIdsPayload,
          recipientZonesPayload,
        ).subscribe({
          next: (env) => {
            this.envelope.set(env);
            this.api.sendEnvelope(env.id_envelope).subscribe({
              next: (sentEnv) => {
                this.envelope.set(sentEnv);
                this.successMsg.set('Corrections enregistrées et parapheur renvoyé avec succès.');
                this.correctionFiles.set([]);
                this.correctionAttachmentFiles.set([]);
                this.correctionZones.set(new Map());
                this.correctionLoading.set(false);
              },
              error: (err) => {
                this.error.set(this.extractErrorMessage(err));
                this.correctionLoading.set(false);
              },
            });
          },
          error: (err) => {
            this.error.set(this.extractErrorMessage(err));
            this.correctionLoading.set(false);
          },
        });
        return;
      }

      this.api.uploadDocument(attachmentFiles[index]).subscribe({
        next: (doc) => uploadAttachments(index + 1, uploadedDocumentIds, [...uploadedAttachmentIds, doc.id_document]),
        error: (err) => {
          this.correctionUploadError.set(this.extractUploadErrorMessage(err));
          this.correctionLoading.set(false);
        },
      });
    };

    uploadDocuments(0, []);
  }

  private getCorrectionZone(recipientId: number): { doc_index: number; x_ratio: number; y_ratio: number; page_number: number } {
    const existing = this.correctionZones().get(recipientId);
    if (existing) return existing;
    return { doc_index: 0, x_ratio: 0.18, y_ratio: 0.88, page_number: 1 };
  }

  private updateCorrectionZone(
    recipientId: number,
    patch: Partial<{ doc_index: number; x_ratio: number; y_ratio: number; page_number: number }>,
  ): void {
    const next = new Map(this.correctionZones());
    const current = this.getCorrectionZone(recipientId);
    next.set(recipientId, { ...current, ...patch });
    this.correctionZones.set(next);
  }

  private normalizeCorrectionZones(): void {
    const max = Math.max(0, this.correctionFiles().length - 1);
    const next = new Map<number, { doc_index: number; x_ratio: number; y_ratio: number; page_number: number }>();
    for (const [recipientId, zone] of this.correctionZones().entries()) {
      next.set(recipientId, {
        ...zone,
        doc_index: Math.min(Math.max(zone.doc_index, 0), max),
      });
    }
    this.correctionZones.set(next);
    this.clearCorrectionPreviewCache();
  }

  private buildRecipientZonesPayload(): Array<{ id_recipient: number; doc_index: number; x_ratio: number; y_ratio: number; page_number: number }> {
    const signatoryIds = new Set(this.signatoryRecipientsForCorrection().map((r) => r.id_recipient));
    const payload: Array<{ id_recipient: number; doc_index: number; x_ratio: number; y_ratio: number; page_number: number }> = [];

    for (const [id_recipient, zone] of this.correctionZones().entries()) {
      if (!signatoryIds.has(id_recipient)) continue;
      payload.push({
        id_recipient,
        doc_index: zone.doc_index,
        x_ratio: zone.x_ratio,
        y_ratio: zone.y_ratio,
        page_number: zone.page_number,
      });
    }

    return payload;
  }

  private getCorrectionPreviewFile(recipientId: number): File | null {
    const files = this.correctionFiles();
    if (!files.length) return null;

    const zone = this.getCorrectionZone(recipientId);
    const index = Math.min(Math.max(zone.doc_index, 0), files.length - 1);
    return files[index] || null;
  }

  private getCorrectionFileKey(file: File): string {
    return `${file.name}|${file.size}|${file.lastModified}`;
  }

  private clearCorrectionPreviewCache(): void {
    for (const url of this.correctionPreviewObjectUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.correctionPreviewObjectUrlCache.clear();
    this.correctionPdfPageCounts.set(new Map());
    this.correctionPdfPageLoading.clear();
  }

  private getKnownCorrectionPdfPageCount(recipientId: number): number {
    const file = this.getCorrectionPreviewFile(recipientId);
    if (!file) return 1;
    return this.correctionPdfPageCounts().get(this.getCorrectionFileKey(file)) || 1;
  }

  private ensureCorrectionPdfPageCount(recipientId: number): void {
    const file = this.getCorrectionPreviewFile(recipientId);
    if (!file) return;

    const mime = (file.type || '').toLowerCase();
    const ext = (file.name || '').toLowerCase().split('.').pop() || '';
    const isPdf = mime === 'application/pdf' || ext === 'pdf';
    if (!isPdf) return;

    const key = this.getCorrectionFileKey(file);
    if (this.correctionPdfPageCounts().has(key) || this.correctionPdfPageLoading.has(key)) return;
    this.correctionPdfPageLoading.add(key);

    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = 'assets/pdfjs/pdf.worker.min.mjs';
        }

        const objectUrl = this.getCorrectionPreviewObjectUrl(recipientId);
        const pdfDoc = await pdfjs.getDocument(objectUrl).promise;
        const pageCount = Math.max(1, Number(pdfDoc?.numPages || 1));
        pdfDoc?.destroy?.();

        const next = new Map(this.correctionPdfPageCounts());
        next.set(key, pageCount);
        this.correctionPdfPageCounts.set(next);

        const zones = new Map(this.correctionZones());
        let hasChange = false;
        for (const [rid, zone] of zones.entries()) {
          const ridFile = this.getCorrectionPreviewFile(rid);
          if (!ridFile) continue;
          if (this.getCorrectionFileKey(ridFile) !== key) continue;
          if (zone.page_number > pageCount) {
            zones.set(rid, { ...zone, page_number: pageCount });
            hasChange = true;
          }
        }
        if (hasChange) this.correctionZones.set(zones);
      } catch {
        const next = new Map(this.correctionPdfPageCounts());
        next.set(key, 1);
        this.correctionPdfPageCounts.set(next);
      } finally {
        this.correctionPdfPageLoading.delete(key);
      }
    })();
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

  canForwardByCreator(): boolean {
    const s = this.envelope()?.status;
    return this.canSend() && (s === 'REVISION' || s === 'IN_PROGRESS' || s === 'SENT');
  }

  canCloseCircuit(): boolean {
    const s = this.envelope()?.status;
    const recipients = this.envelope()?.recipients ?? [];
    const circuitFinished = recipients.length > 0 && recipients.every((recipient) =>
      recipient.status === 'SIGNED'
      || recipient.status === 'APPROVED'
      || recipient.status === 'VIEWED'
      || recipient.status === 'DELEGATED',
    );

    return this.canSend()
      && circuitFinished
      && (s === 'IN_PROGRESS' || s === 'REVISION' || s === 'SENT');
  }

  resetForwardForm(): void {
    this.forwardFirstName = '';
    this.forwardLastName = '';
    this.forwardEmail = '';
  }

  forwardToNextRecipient(): void {
    if (!this.envelope()) return;
    const email = this.forwardEmail.trim().toLowerCase();
    const firstName = this.forwardFirstName.trim();
    const lastName = this.forwardLastName.trim();
    if (!firstName || !lastName || !/^[^@]+@cgrae\.ci$/i.test(email)) {
      this.error.set('Veuillez renseigner prénom, nom et un email @cgrae.ci valide.');
      return;
    }
    this.forwardLoading.set(true);
    this.error.set('');
    this.api.forwardEnvelopeByCreator(this.envelope()!.id_envelope, {
      forward_email: email,
      forward_first_name: firstName,
      forward_last_name: lastName,
    }).subscribe({
      next: (env) => {
        this.envelope.set(env);
        this.successMsg.set('Nouveau destinataire ajouté et notifié.');
        this.resetForwardForm();
        this.forwardLoading.set(false);
      },
      error: (err) => {
        this.error.set(err.message);
        this.forwardLoading.set(false);
      },
    });
  }

  closeCircuit(): void {
    if (!this.envelope()) return;
    if (!confirm('Clôturer ce circuit et archiver les documents dans la GED ?')) return;
    this.api.closeEnvelopeByCreator(this.envelope()!.id_envelope).subscribe({
      next: (env) => {
        this.envelope.set(env);
        this.successMsg.set('Circuit clôturé. Documents archivés dans la GED du créateur.');
      },
      error: (err) => this.error.set(err.message),
    });
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
    const m: Record<string, string> = { SEQUENTIAL: 'Séquentiel strict', PARALLEL: 'Parallèle', MIXED: 'Mixte', CONDITIONAL: 'Conditionnel' };
    return m[c] || c;
  }

  roleLabel(r: string): string {
    const m: Record<string, string> = { SIGNATORY: 'Signataire', APPROVER: 'Vérificateur', VIEWER: 'Visualisateur', DELEGATOR: 'Délégateur' };
    return m[r] || r;
  }

  recipientStatusLabel(s: string): string {
    if (this.envelope()?.status === 'CANCELLED') return 'Annulé';
    if (this.envelope()?.status === 'EXPIRED') return 'Expiré';
    const m: Record<string, string> = { PENDING: 'En attente', SENT: 'Envoyé', VIEWED: 'Vu', SIGNED: 'Signé', APPROVED: 'Approuvé', REJECTED: 'Rejeté', DELEGATED: 'Délégué', RETURNED: 'Retour corrections' };
    return m[s] || s;
  }

  recipientBadgeClass(s: string): string {
    if (this.envelope()?.status === 'CANCELLED') return 'cancelled';
    if (this.envelope()?.status === 'EXPIRED') return 'expired';
    return s.toLowerCase();
  }

  auditActionLabel(a: string): string {
    const m: Record<string, string> = {
      ENVELOPE_CREATED: '📝 Parapheur créé', ENVELOPE_SENT: '✉️ Parapheur envoyé',
      DOCUMENT_SIGNED: '✍️ Document signé', DOCUMENT_REJECTED: '❌ Document rejeté',
      DOCUMENT_VIEWED: '📤 Document soumis et envoyé',
      DOCUMENT_RETURNED: '↩️ Retour pour corrections', DOCUMENT_FORWARDED: '🔁 Document renvoyé à un destinataire',
      ENVELOPE_COMPLETED: '✅ Processus terminé',
      ENVELOPE_CLOSED_BY_CREATOR: '✅ Circuit clôturé par le créateur',
      ENVELOPE_REACTIVATED: '🔄 Parapheur réactivé',
      CIRCUIT_FORWARDED_BY_CREATOR: '🔁 Circuit relancé vers un nouveau destinataire',
      DOCUMENTS_REPLACED: '🗂 Documents corrigés remplacés',
      ENVELOPE_CANCELLED: '🚫 Parapheur annulé', SIGNATURE_DELEGATED: '🔀 Signature déléguée',
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

  private extractErrorMessage(err: any): string {
    if (Array.isArray(err?.error?.message)) return err.error.message.join(' ');
    return err?.error?.message || err?.message || 'Une erreur est survenue.';
  }

  private extractUploadErrorMessage(err: any): string {
    const status = Number(err?.status || 0);
    const rawMessage = Array.isArray(err?.error?.message)
      ? err.error.message.join(' ')
      : (err?.error?.message || err?.message || '');
    const normalizedMessage = String(rawMessage).toLowerCase();

    if (status === 413 || normalizedMessage.includes('payload too large') || normalizedMessage.includes('file too large')) {
      return 'Fichier trop volumineux. Taille maximale autorisée : 50 Mo.';
    }

    return rawMessage || 'Échec de l\'upload du fichier.';
  }
}
