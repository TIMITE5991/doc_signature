import { Component, ChangeDetectionStrategy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, Validators, FormGroup } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ApiService } from '../../../core/services/api.service';
import { Document } from '../../../core/models';

@Component({
  selector: 'app-envelope-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div class="page-header">
      <div>
        <h1>Nouvelle enveloppe</h1>
        <p>Configurez votre circuit de signature</p>
      </div>
    </div>

    <div *ngIf="error()" class="alert alert-danger">{{ error() }}</div>
    <div *ngIf="submitted() && (form.invalid || recipientsArray.invalid || recipientsArray.length === 0 || selectedDocs().length === 0)" class="alert alert-danger">
      Veuillez corriger les erreurs ci-dessous avant de soumettre.
    </div>

    <form [formGroup]="form" (ngSubmit)="submit()">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start">

        <!-- LEFT: envelope info -->
        <div>
          <div class="card mb-2">
            <h3 class="section-title">Informations générales</h3>
            <div class="form-group">
              <label>Titre *</label>
              <input type="text" formControlName="title" placeholder="Ex: Contrat de travail - Jean Dupont" />
            </div>
            <div class="form-group">
              <label>Objet (affiché dans l'email)</label>
              <input type="text" formControlName="subject" placeholder="Objet de l'email envoyé aux signataires" />
            </div>
            <div class="form-group">
              <label>Message personnel</label>
              <textarea formControlName="message" placeholder="Message affiché dans l'email de demande de signature..."></textarea>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="form-group">
                <label>Type de circuit *</label>
                <select formControlName="circuit_type">
                  <option value="SEQUENTIAL">Séquentiel</option>
                  <option value="PARALLEL">Parallèle</option>
                  <option value="MIXED">Mixte</option>
                  <option value="CONDITIONAL">Conditionnel</option>
                </select>
              </div>
              <div class="form-group">
                <label>Date d'expiration</label>
                <input type="date" formControlName="expires_at" />
              </div>
            </div>
          </div>

          <!-- Documents -->
          <div class="card">
            <h3 class="section-title">Documents à joindre</h3>
            <div class="loading-center" *ngIf="loadingDocs()"><div class="spinner" style="width:24px;height:24px;border-width:2px"></div></div>
            <div class="empty-state" style="padding:20px" *ngIf="!loadingDocs() && myDocs().length === 0">
              <p>Aucun document disponible. <a [routerLink]="['/documents']">Ajouter des documents →</a></p>
            </div>
            <div *ngFor="let doc of myDocs()" class="doc-item">
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
                <input type="checkbox" [value]="doc.id_document" (change)="toggleDoc($event, doc.id_document)" />
                <span style="font-size:13px">
                  <strong>{{ doc.original_name }}</strong>
                  <span style="color:var(--text-muted)"> – {{ formatSize(doc.size) }}</span>
                </span>
              </label>
            </div>
            <div class="error-msg mt-1" *ngIf="submitted() && selectedDocs().length === 0">
              Sélectionnez au moins un document
            </div>
          </div>
        </div>

        <!-- RIGHT: recipients -->
        <div class="card">
          <div class="d-flex justify-between align-center mb-2">
            <h3 class="section-title" style="margin:0">Destinataires</h3>
            <button type="button" class="btn btn-outline btn-sm" (click)="addRecipient()">＋ Ajouter</button>
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
            Seuls les emails &#64;cgrae.ci sont autorisés
          </p>

          <div class="error-msg mb-1" *ngIf="submitted() && recipients.length === 0">
            Ajoutez au moins un destinataire
          </div>

          <div *ngFor="let r of recipients.controls; let i = index" class="recipient-card" [formGroup]="r">
            <div class="recipient-header">
              <span style="font-weight:600;font-size:13px">Destinataire {{ i + 1 }}</span>
              <button type="button" class="btn-icon" (click)="removeRecipient(i)">✕</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div class="form-group" style="margin-bottom:8px">
                <label>Prénom</label>
                <input type="text" formControlName="first_name" placeholder="Prénom" />
              </div>
              <div class="form-group" style="margin-bottom:8px">
                <label>Nom</label>
                <input type="text" formControlName="last_name" placeholder="Nom" />
              </div>
            </div>
            <div class="form-group" style="margin-bottom:8px">
              <label>Email &#64;cgrae.ci</label>
              <input type="email" formControlName="email" placeholder="nom.prenom&#64;cgrae.ci" />
              <span class="error-msg" *ngIf="r.get('email')?.invalid && (r.get('email')?.touched || submitted())">
                Email invalide — doit être &#64;cgrae.ci
              </span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div class="form-group" style="margin-bottom:0">
                <label>Rôle</label>
                <select formControlName="role">
                  <option value="SIGNATORY">Signataire</option>
                  <option value="APPROVER">Approbateur</option>
                  <option value="VIEWER">Visualisateur</option>
                  <option value="DELEGATOR">Délégateur</option>
                </select>
              </div>
              <div class="form-group" style="margin-bottom:0">
                <label>Ordre</label>
                <input type="number" formControlName="signing_order" min="1" />
              </div>
            </div>
          </div>

          <div class="empty-state" style="padding:20px" *ngIf="recipients.length === 0">
            <p>Ajoutez des destinataires pour définir le circuit</p>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════
           ZONES DE SIGNATURE PRÉDÉFINIES
           Visible uniquement si ≥1 doc sélectionné ET ≥1 signataire
      ═══════════════════════════════════════════════════════════ -->
      <div class="card zone-section" *ngIf="hasZones()">
        <div class="zone-section-header">
          <div>
            <h3 class="section-title" style="margin-bottom:4px">
              📍 Zones de signature prédéfinies
              <span class="optional-badge">facultatif</span>
            </h3>
            <p style="font-size:12px;color:var(--text-muted);margin:0">
              Cliquez sur l'aperçu du document pour fixer l'emplacement exact où chaque signataire doit apposer sa signature.
              Si non défini, le signataire positionnera lui-même sa signature.
            </p>
          </div>
        </div>

        <div class="zone-layout">

          <!-- Colonne gauche : liste des signataires -->
          <div class="zone-recipients">
            <p class="zone-col-label">Signataires / Approbateurs</p>
            <div *ngFor="let i of signatoryIndices()"
                 class="zone-recipient-tab"
                 [class.active]="zoneRecipientIdx() === i"
                 (click)="zoneRecipientIdx.set(i)">
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                  {{ getRecipientLabel(i) }}
                </div>
                <div *ngIf="sigZones().has(i)" class="zone-set-info">
                  ✅ {{ zonePercentX(i) }}% L · {{ zonePercentY(i) }}% H
                </div>
                <div *ngIf="!sigZones().has(i)" class="zone-unset-info">
                  Cliquez sur le doc →
                </div>
              </div>
              <button *ngIf="sigZones().has(i)" type="button"
                      class="zone-remove-btn"
                      (click)="removeZone(i); $event.stopPropagation()"
                      title="Supprimer la zone">✕</button>
            </div>

            <!-- Sélecteur de document si plusieurs -->
            <div *ngIf="selectedDocs().length > 1" class="form-group mt-2" style="margin-bottom:0">
              <label style="font-size:11px">Document cible</label>
              <select (change)="setZoneDocForRecipient(zoneRecipientIdx(), +$any($event.target).value)">
                <option *ngFor="let docId of selectedDocs(); let di = index" [value]="di">
                  {{ getDocName(docId) }}
                </option>
              </select>
            </div>
          </div>

          <!-- Colonne droite : aperçu du document avec overlay -->
          <div class="zone-preview-col">
            <div class="zone-preview-wrap" *ngIf="getZonePreviewDocUrl(zoneRecipientIdx()) as docUrl">
              <iframe [src]="docUrl" class="zone-preview-iframe" title="Aperçu document"></iframe>

              <!-- Overlay cliquable -->
              <div class="zone-placer-overlay" (click)="onZonePlacerClick($event, zoneRecipientIdx())">
                <div class="zone-placer-hint">
                  📍 Cliquez pour placer la zone de <strong>{{ getRecipientLabel(zoneRecipientIdx()) }}</strong>
                </div>

                <!-- Marqueur de la zone définie pour ce signataire -->
                <div *ngIf="sigZones().has(zoneRecipientIdx())"
                     class="zone-placed-marker"
                     [style.left.%]="sigZones().get(zoneRecipientIdx())!.x_ratio * 100"
                     [style.top.%]="sigZones().get(zoneRecipientIdx())!.y_ratio * 100">
                  <span class="zone-placed-label">✍ {{ getRecipientLabel(zoneRecipientIdx()) }}</span>
                </div>

                <!-- Marqueurs des autres signataires (gris) -->
                <ng-container *ngFor="let i of signatoryIndices()">
                  <div *ngIf="sigZones().has(i) && i !== zoneRecipientIdx()"
                       class="zone-placed-marker zone-placed-marker-other"
                       [style.left.%]="sigZones().get(i)!.x_ratio * 100"
                       [style.top.%]="sigZones().get(i)!.y_ratio * 100">
                    <span class="zone-placed-label">{{ getRecipientLabel(i) }}</span>
                  </div>
                </ng-container>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="d-flex gap-2 justify-between mt-3">
        <button type="button" class="btn btn-outline" (click)="cancel()">Annuler</button>
        <div class="d-flex gap-1">
          <button type="submit" class="btn btn-outline" [disabled]="saving()" (click)="sendOnCreate = false">
            💾 Enregistrer brouillon
          </button>
          <button type="submit" class="btn btn-primary" [disabled]="saving()" (click)="sendOnCreate = true">
            {{ saving() ? 'Envoi...' : '✉️ Créer et envoyer' }}
          </button>
        </div>
      </div>
    </form>
  `,
  styles: [`
    .section-title { font-size: 14px; font-weight: 700; color: var(--primary); margin-bottom: 16px; }
    .doc-item { padding: 10px 0; border-bottom: 1px solid var(--border); &:last-child { border: none; } }
    .recipient-card { border: 1.5px solid var(--border); border-radius: 8px; padding: 14px; margin-bottom: 12px; }
    .recipient-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }

    /* ── Zone section ── */
    .zone-section { margin-top: 24px; }
    .zone-section-header { margin-bottom: 16px; }
    .optional-badge {
      font-size: 11px; font-weight: 400; color: var(--text-muted);
      background: #f3f4f6; border-radius: 10px; padding: 2px 8px; margin-left: 8px;
    }
    .zone-layout {
      display: grid; grid-template-columns: 220px 1fr; gap: 20px; align-items: start;
    }
    @media (max-width: 900px) { .zone-layout { grid-template-columns: 1fr; } }

    .zone-col-label {
      font-size: 11px; font-weight: 700; color: var(--primary);
      text-transform: uppercase; letter-spacing: .5px; margin-bottom: 8px;
    }
    .zone-recipients { display: flex; flex-direction: column; gap: 6px; }
    .zone-recipient-tab {
      display: flex; align-items: center; gap: 8px;
      border: 1.5px solid var(--border); border-radius: 8px;
      padding: 10px 12px; cursor: pointer; transition: border-color .15s, background .15s;
      &:hover { border-color: var(--primary); background: #f0fff8; }
      &.active { border-color: var(--primary); background: #e8fff5; }
    }
    .zone-set-info { font-size: 11px; color: #16a34a; font-weight: 600; margin-top: 2px; }
    .zone-unset-info { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
    .zone-remove-btn {
      background: none; border: none; cursor: pointer; color: #dc2626;
      font-size: 14px; padding: 2px 4px; border-radius: 4px; flex-shrink: 0;
      &:hover { background: #fee2e2; }
    }

    .zone-preview-col { position: relative; }
    .zone-preview-wrap { position: relative; border-radius: 8px; overflow: hidden; border: 1.5px solid var(--border); }
    .zone-preview-iframe { width: 100%; height: 480px; border: none; display: block; }
    .zone-placer-overlay {
      position: absolute; inset: 0; cursor: crosshair;
      background: rgba(10,124,78,0.04);
    }
    .zone-placer-hint {
      position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
      background: rgba(10,124,78,0.88); color: #fff;
      font-size: 12px; font-weight: 600; padding: 5px 14px;
      border-radius: 20px; white-space: nowrap; pointer-events: none;
    }
    .zone-placed-marker {
      position: absolute; transform: translate(-50%, -50%);
      background: #e65100; width: 26px; height: 26px; border-radius: 50%;
      border: 2px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,.25);
      pointer-events: none;
    }
    .zone-placed-marker-other { background: #6b7280; }
    .zone-placed-label {
      position: absolute; top: 28px; left: 50%; transform: translateX(-50%);
      white-space: nowrap; font-size: 11px; font-weight: 700;
      background: rgba(255,255,255,.92); padding: 2px 7px;
      border-radius: 4px; border: 1px solid rgba(0,0,0,.15);
    }
  `],
})
export class EnvelopeFormComponent implements OnInit {
  loading     = signal(true);
  loadingDocs = signal(true);
  saving      = signal(false);
  error       = signal('');
  submitted   = signal(false);
  myDocs      = signal<Document[]>([]);
  selectedDocs = signal<number[]>([]);
  sendOnCreate = false;

  // ── Zone placement ──────────────────────────────────────
  zoneRecipientIdx = signal(0);
  zoneDocMap       = signal<Map<number, number>>(new Map());   // recipientIdx → docIndex
  sigZones         = signal<Map<number, { x_ratio: number; y_ratio: number; doc_id: number }>>(new Map());

  form = this.fb.group({
    title:        ['', Validators.required],
    subject:      [''],
    message:      [''],
    circuit_type: ['SEQUENTIAL', Validators.required],
    expires_at:   [''],
  });

  recipientsArray = this.fb.array<FormGroup>([]);
  get recipients(): FormArray { return this.recipientsArray; }

  constructor(
    private fb: FormBuilder,
    private api: ApiService,
    private router: Router,
    private sanitizer: DomSanitizer,
  ) {}

  ngOnInit(): void {
    this.api.getDocuments().subscribe({
      next: (docs) => { this.myDocs.set(docs); this.loadingDocs.set(false); },
      error: () => this.loadingDocs.set(false),
    });
  }

  addRecipient(): void {
    this.recipientsArray.push(this.fb.group({
      first_name:   ['', Validators.required],
      last_name:    ['', Validators.required],
      email:        ['', [Validators.required, Validators.pattern(/^[^@]+@cgrae\.ci$/)]],
      role:         ['SIGNATORY', Validators.required],
      signing_order:[this.recipientsArray.length + 1, Validators.required],
    }));
  }

  removeRecipient(i: number): void {
    this.recipientsArray.removeAt(i);
    // Nettoyer la zone éventuellement définie pour ce signataire
    const updatedZones = new Map(this.sigZones());
    updatedZones.delete(i);
    this.sigZones.set(updatedZones);
  }

  toggleDoc(event: Event, id: number): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedDocs.update(ids =>
      checked ? [...ids, id] : ids.filter(d => d !== id),
    );
  }

  // ── Zone placement helpers ──────────────────────────────
  signatoryIndices(): number[] {
    return this.recipientsArray.controls
      .map((_, i) => i)
      .filter(i => {
        const role = this.recipientsArray.at(i).get('role')?.value;
        return role === 'SIGNATORY' || role === 'APPROVER';
      });
  }

  hasZones(): boolean {
    return this.selectedDocs().length > 0 && this.signatoryIndices().length > 0;
  }

  getRecipientLabel(i: number): string {
    const g = this.recipientsArray.at(i);
    const fn = (g?.get('first_name')?.value || '').trim();
    const ln = (g?.get('last_name')?.value || '').trim();
    if (fn || ln) return [fn, ln].filter(Boolean).join(' ');
    const email = (g?.get('email')?.value || '') as string;
    return email.split('@')[0] || `Signataire ${i + 1}`;
  }

  getDocName(docId: number): string {
    return this.myDocs().find(d => d.id_document === docId)?.original_name || `Doc ${docId}`;
  }

  getZonePreviewDocUrl(recipientIdx: number): SafeResourceUrl | null {
    const docIndex = this.zoneDocMap().get(recipientIdx) ?? 0;
    const docId = this.selectedDocs()[docIndex];
    if (!docId) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.api.getDocumentViewUrl(docId));
  }

  onZonePlacerClick(event: MouseEvent, recipientIdx: number): void {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x_ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width,  0), 1);
    const y_ratio = Math.min(Math.max((event.clientY - rect.top)  / rect.height, 0), 1);
    const docIndex = this.zoneDocMap().get(recipientIdx) ?? 0;
    const doc_id   = this.selectedDocs()[docIndex];
    const updated  = new Map(this.sigZones());
    updated.set(recipientIdx, { x_ratio, y_ratio, doc_id });
    this.sigZones.set(updated);
  }

  setZoneDocForRecipient(recipientIdx: number, docIndex: number): void {
    const updated = new Map(this.zoneDocMap());
    updated.set(recipientIdx, docIndex);
    this.zoneDocMap.set(updated);
    // Si une zone était déjà définie, mettre à jour le doc_id
    const existing = this.sigZones().get(recipientIdx);
    if (existing) {
      const doc_id  = this.selectedDocs()[docIndex];
      const updatedZ = new Map(this.sigZones());
      updatedZ.set(recipientIdx, { ...existing, doc_id });
      this.sigZones.set(updatedZ);
    }
  }

  removeZone(recipientIdx: number): void {
    const updated = new Map(this.sigZones());
    updated.delete(recipientIdx);
    this.sigZones.set(updated);
  }

  zonePercentX(i: number): number { return Math.round((this.sigZones().get(i)?.x_ratio ?? 0) * 100); }
  zonePercentY(i: number): number { return Math.round((this.sigZones().get(i)?.y_ratio ?? 0) * 100); }

  // ── Form submission ─────────────────────────────────────
  submit(): void {
    this.submitted.set(true);
    if (this.form.invalid || this.recipientsArray.invalid || this.recipientsArray.length === 0 || this.selectedDocs().length === 0) {
      this.form.markAllAsTouched();
      this.recipientsArray.markAllAsTouched();
      this.recipientsArray.controls.forEach((group) => group.markAllAsTouched());
      return;
    }

    this.saving.set(true);
    const payload = {
      ...this.form.value,
      document_ids: this.selectedDocs(),
      recipients:   this.normalizeRecipients(),
      expires_at:   this.form.value.expires_at || undefined,
    };

    if (this.sendOnCreate) {
      this.api.createAndSendEnvelope(payload).subscribe({
        next: (env) => {
          sessionStorage.setItem('envelope_flash', JSON.stringify({ type: 'success', msg: '✅ Enveloppe créée et envoyée avec succès !' }));
          this.router.navigate(['/envelopes', env.id_envelope]);
        },
        error: (err) => { this.error.set(err.message); this.saving.set(false); },
      });
    } else {
      this.api.createEnvelope(payload).subscribe({
        next: (env) => {
          sessionStorage.setItem('envelope_flash', JSON.stringify({ type: 'success', msg: '💾 Brouillon enregistré avec succès.' }));
          this.router.navigate(['/envelopes', env.id_envelope]);
        },
        error: (err) => { this.error.set(err.message); this.saving.set(false); },
      });
    }
  }

  cancel(): void { this.router.navigate(['/envelopes']); }

  formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  private normalizeRecipients() {
    return this.recipientsArray.controls.map((group, i) => {
      const raw = group.value as {
        first_name?: string; last_name?: string;
        email?: string; role?: string; signing_order?: number;
      };
      const email = (raw.email || '').trim().toLowerCase();
      const localPart = email.split('@')[0] || '';
      const parts = localPart.split(/[._-]+/).filter(Boolean);
      const fallbackFirst = parts[0] || 'Agent';
      const fallbackLast  = parts.slice(1).join(' ') || 'CGRAE';
      const zone = this.sigZones().get(i);
      return {
        first_name:     (raw.first_name || '').trim() || fallbackFirst,
        last_name:      (raw.last_name  || '').trim() || fallbackLast,
        email,
        role:           raw.role,
        signing_order:  raw.signing_order,
        signature_zone: zone || undefined,
      };
    });
  }
}


@Component({
  selector: 'app-envelope-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div class="page-header">
      <div>
        <h1>Nouvelle enveloppe</h1>
        <p>Configurez votre circuit de signature</p>
      </div>
    </div>

    <div *ngIf="error()" class="alert alert-danger">{{ error() }}</div>
    <div *ngIf="submitted() && (form.invalid || recipientsArray.invalid || recipientsArray.length === 0 || selectedDocs().length === 0)" class="alert alert-danger">
      Veuillez corriger les erreurs ci-dessous avant de soumettre.
    </div>

    <form [formGroup]="form" (ngSubmit)="submit()">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start">

        <!-- LEFT: envelope info -->
        <div>
          <div class="card mb-2">
            <h3 class="section-title">Informations générales</h3>
            <div class="form-group">
              <label>Titre *</label>
              <input type="text" formControlName="title" placeholder="Ex: Contrat de travail - Jean Dupont" />
            </div>
            <div class="form-group">
              <label>Objet (affiché dans l'email)</label>
              <input type="text" formControlName="subject" placeholder="Objet de l'email envoyé aux signataires" />
            </div>
            <div class="form-group">
              <label>Message personnel</label>
              <textarea formControlName="message" placeholder="Message affiché dans l'email de demande de signature..."></textarea>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="form-group">
                <label>Type de circuit *</label>
                <select formControlName="circuit_type">
                  <option value="SEQUENTIAL">Séquentiel</option>
                  <option value="PARALLEL">Parallèle</option>
                  <option value="MIXED">Mixte</option>
                  <option value="CONDITIONAL">Conditionnel</option>
                </select>
              </div>
              <div class="form-group">
                <label>Date d'expiration</label>
                <input type="date" formControlName="expires_at" />
              </div>
            </div>
          </div>

          <!-- Documents -->
          <div class="card">
            <h3 class="section-title">Documents à joindre</h3>
            <div class="loading-center" *ngIf="loadingDocs()"><div class="spinner" style="width:24px;height:24px;border-width:2px"></div></div>
            <div class="empty-state" style="padding:20px" *ngIf="!loadingDocs() && myDocs().length === 0">
              <p>Aucun document disponible. <a [routerLink]="['/documents']">Ajouter des documents →</a></p>
            </div>
            <div *ngFor="let doc of myDocs()" class="doc-item">
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
                <input type="checkbox" [value]="doc.id_document" (change)="toggleDoc($event, doc.id_document)" />
                <span style="font-size:13px">
                  <strong>{{ doc.original_name }}</strong>
                  <span style="color:var(--text-muted)"> – {{ formatSize(doc.size) }}</span>
                </span>
              </label>
            </div>
            <div class="error-msg mt-1" *ngIf="submitted() && selectedDocs().length === 0">
              Sélectionnez au moins un document
            </div>
          </div>
        </div>

        <!-- RIGHT: recipients -->
        <div class="card">
          <div class="d-flex justify-between align-center mb-2">
            <h3 class="section-title" style="margin:0">Destinataires</h3>
            <button type="button" class="btn btn-outline btn-sm" (click)="addRecipient()">＋ Ajouter</button>
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
            Seuls les emails &#64;cgrae.ci sont autorisés
          </p>

          <div class="error-msg mb-1" *ngIf="submitted() && recipients.length === 0">
            Ajoutez au moins un destinataire
          </div>

          <div *ngFor="let r of recipients.controls; let i = index" class="recipient-card" [formGroup]="r">
            <div class="recipient-header">
              <span style="font-weight:600;font-size:13px">Destinataire {{ i + 1 }}</span>
              <button type="button" class="btn-icon" (click)="removeRecipient(i)">✕</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div class="form-group" style="margin-bottom:8px">
                <label>Prénom</label>
                <input type="text" formControlName="first_name" placeholder="Prénom" />
              </div>
              <div class="form-group" style="margin-bottom:8px">
                <label>Nom</label>
                <input type="text" formControlName="last_name" placeholder="Nom" />
              </div>
            </div>
            <div class="form-group" style="margin-bottom:8px">
              <label>Email &#64;cgrae.ci</label>
              <input type="email" formControlName="email" placeholder="nom.prenom&#64;cgrae.ci" />
              <span class="error-msg" *ngIf="r.get('email')?.invalid && (r.get('email')?.touched || submitted())">
                Email invalide — doit être &#64;cgrae.ci
              </span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div class="form-group" style="margin-bottom:0">
                <label>Rôle</label>
                <select formControlName="role">
                  <option value="SIGNATORY">Signataire</option>
                  <option value="APPROVER">Approbateur</option>
                  <option value="VIEWER">Visualisateur</option>
                  <option value="DELEGATOR">Délégateur</option>
                </select>
              </div>
              <div class="form-group" style="margin-bottom:0">
                <label>Ordre</label>
                <input type="number" formControlName="signing_order" min="1" />
              </div>
            </div>
          </div>

          <div class="empty-state" style="padding:20px" *ngIf="recipients.length === 0">
            <p>Ajoutez des destinataires pour définir le circuit</p>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="d-flex gap-2 justify-between mt-3">
        <button type="button" class="btn btn-outline" (click)="cancel()">Annuler</button>
        <div class="d-flex gap-1">
          <button type="submit" class="btn btn-outline" [disabled]="saving()" (click)="sendOnCreate = false">
            💾 Enregistrer brouillon
          </button>
          <button type="submit" class="btn btn-primary" [disabled]="saving()" (click)="sendOnCreate = true">
            {{ saving() ? 'Envoi...' : '✉️ Créer et envoyer' }}
          </button>
        </div>
      </div>
    </form>
  `,
  styles: [`
    .section-title { font-size: 14px; font-weight: 700; color: var(--primary); margin-bottom: 16px; }
    .doc-item { padding: 10px 0; border-bottom: 1px solid var(--border); &:last-child { border: none; } }
    .recipient-card { border: 1.5px solid var(--border); border-radius: 8px; padding: 14px; margin-bottom: 12px; }
    .recipient-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  `],
})
export class EnvelopeFormComponent implements OnInit {
  loading    = signal(true);
  loadingDocs = signal(true);
  saving     = signal(false);
  error      = signal('');
  submitted  = signal(false);
  myDocs     = signal<Document[]>([]);
  selectedDocs = signal<number[]>([]);
  sendOnCreate = false;

  form = this.fb.group({
    title:        ['', Validators.required],
    subject:      [''],
    message:      [''],
    circuit_type: ['SEQUENTIAL', Validators.required],
    expires_at:   [''],
  });

  recipientsArray = this.fb.array<FormGroup>([]);

  get recipients(): FormArray { return this.recipientsArray; }

  constructor(private fb: FormBuilder, private api: ApiService, private router: Router) {}

  ngOnInit(): void {
    this.api.getDocuments().subscribe({
      next: (docs) => { this.myDocs.set(docs); this.loadingDocs.set(false); },
      error: () => this.loadingDocs.set(false),
    });
  }

  addRecipient(): void {
    this.recipientsArray.push(this.fb.group({
      first_name:   ['', Validators.required],
      last_name:    ['', Validators.required],
      email:        ['', [Validators.required, Validators.pattern(/^[^@]+@cgrae\.ci$/)]],
      role:         ['SIGNATORY', Validators.required],
      signing_order:[this.recipientsArray.length + 1, Validators.required],
    }));
  }

  removeRecipient(i: number): void { this.recipientsArray.removeAt(i); }

  toggleDoc(event: Event, id: number): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedDocs.update(ids =>
      checked ? [...ids, id] : ids.filter(d => d !== id),
    );
  }

  submit(): void {
    this.submitted.set(true);
    if (this.form.invalid || this.recipientsArray.invalid || this.recipientsArray.length === 0 || this.selectedDocs().length === 0) {
      this.form.markAllAsTouched();
      this.recipientsArray.markAllAsTouched();
      this.recipientsArray.controls.forEach((group) => group.markAllAsTouched());
      return;
    }

    this.saving.set(true);
    const payload = {
      ...this.form.value,
      document_ids: this.selectedDocs(),
      recipients:   this.normalizeRecipients(),
      expires_at:   this.form.value.expires_at || undefined,
    };

    if (this.sendOnCreate) {
      // Un seul appel HTTP : créer + envoyer atomiquement
      this.api.createAndSendEnvelope(payload).subscribe({
        next: (env) => {
          sessionStorage.setItem('envelope_flash', JSON.stringify({ type: 'success', msg: '✅ Enveloppe créée et envoyée avec succès !' }));
          this.router.navigate(['/envelopes', env.id_envelope]);
        },
        error: (err) => { this.error.set(err.message); this.saving.set(false); },
      });
    } else {
      this.api.createEnvelope(payload).subscribe({
        next: (env) => {
          sessionStorage.setItem('envelope_flash', JSON.stringify({ type: 'success', msg: '💾 Brouillon enregistré avec succès.' }));
          this.router.navigate(['/envelopes', env.id_envelope]);
        },
        error: (err) => { this.error.set(err.message); this.saving.set(false); },
      });
    }
  }

  cancel(): void { this.router.navigate(['/envelopes']); }

  formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  private normalizeRecipients() {
    return this.recipientsArray.controls.map((group) => {
      const raw = group.value as {
        first_name?: string;
        last_name?: string;
        email?: string;
        role?: string;
        signing_order?: number;
      };

      const email = (raw.email || '').trim().toLowerCase();
      const localPart = email.split('@')[0] || '';
      const parts = localPart.split(/[._-]+/).filter(Boolean);
      const fallbackFirst = parts[0] || 'Agent';
      const fallbackLast = parts.slice(1).join(' ') || 'CGRAE';

      return {
        first_name: (raw.first_name || '').trim() || fallbackFirst,
        last_name: (raw.last_name || '').trim() || fallbackLast,
        email,
        role: raw.role,
        signing_order: raw.signing_order,
      };
    });
  }
}
