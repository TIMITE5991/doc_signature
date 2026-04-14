import { Component, ChangeDetectionStrategy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, Validators, FormGroup } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
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
