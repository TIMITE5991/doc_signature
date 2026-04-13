import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../core/services/api.service';
import { User } from '../../core/models';

@Component({
  selector: 'app-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="page-header">
      <div>
        <h1>Mon profil</h1>
        <p>Informations de votre compte</p>
      </div>
    </div>

    <div class="profile-grid">
      <!-- Identity card -->
      <div class="card identity-card">
        <div class="avatar-circle">{{ initials() }}</div>
        <h2 class="name">{{ user()?.first_name }} {{ user()?.last_name }}</h2>
        <p class="email">{{ user()?.email }}</p>
        <span class="badge" [ngClass]="roleBadge(user()?.role)">{{ roleLabel(user()?.role) }}</span>
        <hr style="margin:20px 0">
        <div class="info-row">
          <span class="label">Département</span>
          <span>{{ user()?.department || '—' }}</span>
        </div>
        <div class="info-row">
          <span class="label">Téléphone</span>
          <span>{{ user()?.phone || '—' }}</span>
        </div>
        <div class="info-row">
          <span class="label">Membre depuis</span>
          <span>{{ user()?.created_at | date:'MMMM yyyy' }}</span>
        </div>
      </div>

      <!-- Edit form -->
      <div class="card">
        <h3 style="margin-bottom:20px">Modifier mon profil</h3>

        <div class="alert alert-success" *ngIf="saved()">Profil mis à jour avec succès.</div>
        <div class="alert alert-danger" *ngIf="error()">{{ error() }}</div>

        <form [formGroup]="form" (ngSubmit)="save()">
          <div class="form-row">
            <div class="form-group">
              <label>Prénom</label>
              <input type="text" class="form-control" formControlName="first_name">
            </div>
            <div class="form-group">
              <label>Nom</label>
              <input type="text" class="form-control" formControlName="last_name">
            </div>
          </div>

          <div class="form-group">
            <label>Adresse e-mail</label>
            <input type="email" class="form-control" [value]="user()?.email" disabled>
            <small style="color:var(--text-muted)">L'adresse e-mail ne peut pas être modifiée.</small>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Département</label>
              <input type="text" class="form-control" formControlName="department">
            </div>
            <div class="form-group">
              <label>Téléphone</label>
              <input type="text" class="form-control" formControlName="phone">
            </div>
          </div>

          <button type="submit" class="btn btn-primary" [disabled]="saving() || !form.valid">
            <span *ngIf="saving()">Enregistrement...</span>
            <span *ngIf="!saving()">Enregistrer les modifications</span>
          </button>
        </form>
      </div>

      <!-- Stamp card -->
      <div class="card stamp-card">
        <h3 style="margin-bottom:6px">🏷 Mon cachet officiel</h3>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">
          Votre cachet (tampon) sera automatiquement apposé sur les documents lors de vos signatures.
        </p>

        <div class="alert alert-success" *ngIf="stampSaved()">Cachet sauvegardé avec succès.</div>
        <div class="alert alert-danger" *ngIf="stampError()">{{ stampError() }}</div>

        <!-- Preview -->
        <div class="stamp-preview-wrap" *ngIf="stampPreview()">
          <img [src]="stampPreview()!" alt="Aperçu cachet" class="stamp-preview">
          <button type="button" class="btn btn-outline btn-sm remove-stamp-btn"
            (click)="removeStampPreview()">❌ Supprimer</button>
        </div>
        <div class="stamp-empty" *ngIf="!stampPreview()">
          <span style="font-size:40px">🏷</span>
          <p>Aucun cachet enregistré</p>
        </div>

        <div style="margin-top:16px;display:flex;flex-direction:column;gap:10px;align-items:flex-start;flex-wrap:wrap">
          <input type="file" class="form-control" style="max-width:360px"
            accept="image/png,image/jpeg" (change)="onStampFileChange($event)">
          <button type="button" class="btn btn-primary btn-sm"
            [disabled]="!canSaveStamp() || stampSaving()"
            (click)="saveStamp()">
            {{ stampSaving() ? 'Sauvegarde...' : 'Sauvegarder le cachet' }}
          </button>
        </div>
        <p style="font-size:11px;color:var(--text-muted);margin-top:8px">
          Formats acceptés : PNG ou JPEG. Taille max : 2 Mo.
          Privilégiez un fond transparent (PNG) pour un meilleur rendu.
        </p>
      </div>

      <!-- Signature card -->
      <div class="card stamp-card">
        <h3 style="margin-bottom:6px">✍️ Ma signature prédéfinie</h3>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">
          Cette signature pourra être réutilisée automatiquement lors de la signature d'un document.
        </p>

        <div class="alert alert-success" *ngIf="signatureSaved()">Signature sauvegardée avec succès.</div>
        <div class="alert alert-danger" *ngIf="signatureError()">{{ signatureError() }}</div>

        <div class="stamp-preview-wrap" *ngIf="signaturePreview()">
          <img [src]="signaturePreview()!" alt="Aperçu signature" class="stamp-preview">
          <button type="button" class="btn btn-outline btn-sm remove-stamp-btn"
            (click)="removeSignaturePreview()">❌ Supprimer</button>
        </div>
        <div class="stamp-empty" *ngIf="!signaturePreview()">
          <span style="font-size:40px">✍️</span>
          <p>Aucune signature enregistrée</p>
        </div>

        <div style="margin-top:16px;display:flex;flex-direction:column;gap:10px;align-items:flex-start;flex-wrap:wrap">
          <input type="file" class="form-control" style="max-width:360px"
            accept="image/png,image/jpeg" (change)="onSignatureFileChange($event)">
          <button type="button" class="btn btn-primary btn-sm"
            [disabled]="!canSaveSignature() || signatureSaving()"
            (click)="saveSignature()">
            {{ signatureSaving() ? 'Sauvegarde...' : 'Sauvegarder la signature' }}
          </button>
        </div>
        <p style="font-size:11px;color:var(--text-muted);margin-top:8px">
          Formats acceptés : PNG ou JPEG. Taille max : 2 Mo.
        </p>
      </div>
    </div>
  `,
  styles: [`
    .profile-grid {
      display: grid;
      grid-template-columns: 300px 1fr;
      gap: 24px;
      align-items: start;
    }
    @media (max-width: 768px) { .profile-grid { grid-template-columns: 1fr; } }
    .identity-card { text-align: center; padding: 32px 24px; }
    .avatar-circle {
      width: 80px; height: 80px; border-radius: 50%;
      background: var(--primary); color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 28px; font-weight: 700;
      margin: 0 auto 16px;
    }
    .name { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
    .email { font-size: 14px; color: var(--text-muted); margin: 0 0 12px; }
    .info-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 0; font-size: 14px; border-bottom: 1px solid var(--border-color);
    }
    .info-row:last-child { border-bottom: none; }
    .info-row .label { color: var(--text-muted); }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .stamp-card { grid-column: 1 / -1; }
    .stamp-preview-wrap { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .stamp-preview { max-height: 100px; max-width: 220px; border: 1px solid var(--border-color); border-radius: 8px; background: #f8f8f8; padding: 6px; }
    .stamp-empty { text-align: center; padding: 24px; color: var(--text-muted); background: #f9f9f9; border: 2px dashed var(--border-color); border-radius: 8px; }
    .remove-stamp-btn { color: #c62828; border-color: #ef9a9a; }
  `],
})
export class ProfileComponent implements OnInit {
  user       = signal<User | null>(null);
  saving     = signal(false);
  saved      = signal(false);
  error      = signal('');
  stampPreview  = signal<string | null>(null);
  stampSaving   = signal(false);
  stampSaved    = signal(false);
  stampError    = signal('');
  signaturePreview = signal<string | null>(null);
  signatureSaving  = signal(false);
  signatureSaved   = signal(false);
  signatureError   = signal('');
  form!: FormGroup;

  constructor(
    private auth: AuthService,
    private api:  ApiService,
    private fb:   FormBuilder,
    private cdr:  ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    const u = this.auth.user;
    this.user.set(u);
    this.form = this.fb.group({
      first_name: [u?.first_name ?? '', Validators.required],
      last_name:  [u?.last_name  ?? '', Validators.required],
      department: [u?.department ?? ''],
      phone:      [u?.phone      ?? ''],
    });
    // Charger l'aperçu du cachet existant
    if (u?.has_stamp) {
      this.stampPreview.set(this.api.getMyStampUrl() + '&t=' + Date.now());
    }
    if (u?.has_signature) {
      this.signaturePreview.set(this.api.getMySignatureUrl() + '&t=' + Date.now());
    }
  }

  save(): void {
    if (!this.form.valid || !this.user()) return;
    this.saving.set(true);
    this.saved.set(false);
    this.error.set('');
    this.api.updateUser(this.user()!.id_user, this.form.value).subscribe({
      next: (updated) => {
        this.user.set(updated);
        this.auth.updateUser(updated);
        this.saving.set(false);
        this.saved.set(true);
      },
      error: (err) => {
        this.error.set(err?.error?.message ?? 'Erreur lors de la mise à jour.');
        this.saving.set(false);
      },
    });
  }

  onStampFileChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      this.stampError.set('Le fichier dépasse 5 Mo.');
      this.cdr.detectChanges();
      return;
    }
    this.stampError.set('');
    const reader = new FileReader();
    reader.onload = () => {
      // Redimensionner via canvas pour garder < 400ko
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 400; // px
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        this.stampPreview.set(dataUrl);
        this.stampSaved.set(false);
        this.cdr.detectChanges();
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  removeStampPreview(): void {
    this.stampPreview.set(null);
    this.stampSaved.set(false);
  }

  canSaveStamp(): boolean {
    const preview = this.stampPreview();
    return !!preview && preview.startsWith('data:');
  }

  saveStamp(): void {
    const preview = this.stampPreview();
    if (!preview || !preview.startsWith('data:')) return;
    this.stampSaving.set(true);
    this.stampSaved.set(false);
    this.stampError.set('');
    this.api.uploadMyStamp(preview).subscribe({
      next: () => {
        this.stampSaving.set(false);
        this.stampSaved.set(true);
        // Rafraîchir l'URL pour éviter le cache
        this.stampPreview.set(this.api.getMyStampUrl() + '&t=' + Date.now());
        // Mettre à jour has_stamp dans l'utilisateur local
        const u = this.user();
        if (u) { this.auth.updateUser({ ...u, has_stamp: true }); }
      },
      error: (err) => {
        this.stampSaving.set(false);
        this.stampError.set(err?.error?.message ?? 'Erreur lors de la sauvegarde.');
      },
    });
  }

  onSignatureFileChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      this.signatureError.set('Le fichier dépasse 5 Mo.');
      this.cdr.detectChanges();
      return;
    }
    this.signatureError.set('');
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 700;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        this.signaturePreview.set(canvas.toDataURL('image/png'));
        this.signatureSaved.set(false);
        this.cdr.detectChanges();
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  removeSignaturePreview(): void {
    this.signaturePreview.set(null);
    this.signatureSaved.set(false);
  }

  canSaveSignature(): boolean {
    const preview = this.signaturePreview();
    return !!preview && preview.startsWith('data:');
  }

  saveSignature(): void {
    const preview = this.signaturePreview();
    if (!preview || !preview.startsWith('data:')) return;
    this.signatureSaving.set(true);
    this.signatureSaved.set(false);
    this.signatureError.set('');
    this.api.uploadMySignature(preview).subscribe({
      next: () => {
        this.signatureSaving.set(false);
        this.signatureSaved.set(true);
        this.signaturePreview.set(this.api.getMySignatureUrl() + '&t=' + Date.now());
        const u = this.user();
        if (u) { this.auth.updateUser({ ...u, has_signature: true }); }
      },
      error: (err) => {
        this.signatureSaving.set(false);
        this.signatureError.set(err?.error?.message ?? 'Erreur lors de la sauvegarde.');
      },
    });
  }

  initials(): string {
    const u = this.user();
    return u ? `${u.first_name[0]}${u.last_name[0]}`.toUpperCase() : '?';
  }

  roleLabel(r?: string): string {
    const m: Record<string, string> = {
      SUPER_ADMIN: 'Super Admin', ADMIN: 'Administrateur',
      SIGNATORY: 'Signataire', APPROVER: 'Approbateur',
    };
    return r ? (m[r] ?? r) : '';
  }

  roleBadge(r?: string): string {
    const m: Record<string, string> = {
      SUPER_ADMIN: 'badge-danger', ADMIN: 'badge-warning',
      SIGNATORY: 'badge-primary', APPROVER: 'badge-success',
    };
    return r ? (m[r] ?? 'badge-secondary') : 'badge-secondary';
  }
}
