import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { timeout } from 'rxjs';

@Component({
  selector: 'app-register',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div class="auth-page">
      <div class="auth-brand">
        <div class="brand-logo">CS</div>
        <h1>CGRAE <span>Signature</span></h1>
        <p>Plateforme de Signature Électronique</p>
      </div>

      <div class="auth-card">
        <h2>Créer un compte</h2>
        <p class="auth-subtitle">Réservé aux agents CGRAE (&#64;cgrae.ci)</p>

        <div *ngIf="error"   class="alert alert-danger">{{ error }}</div>
        <div *ngIf="success" class="alert alert-success">Compte créé ! <a routerLink="/auth/login">Se connecter</a></div>

        <form [formGroup]="form" (ngSubmit)="submit()" *ngIf="!success">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label>Prénom</label>
              <input type="text" formControlName="first_name" placeholder="Jean" />
            </div>
            <div class="form-group">
              <label>Nom</label>
              <input type="text" formControlName="last_name" placeholder="Dupont" />
            </div>
          </div>
          <div class="form-group">
            <label>Email &#64;cgrae.ci</label>
            <input type="email" formControlName="email" placeholder="jean.dupont&#64;cgrae.ci" />
            <span class="error-msg" *ngIf="form.get('email')?.touched && form.get('email')?.errors?.['pattern']">
              Seuls les emails &#64;cgrae.ci sont acceptés
            </span>
          </div>
          <div class="form-group">
            <label>Département</label>
            <input type="text" formControlName="department" placeholder="DSI, DRH..." />
          </div>
          <div class="form-group">
            <label>Mot de passe</label>
            <input type="password" formControlName="password" placeholder="Min. 8 caractères" />
          </div>
          <button class="btn btn-primary w-100 btn-lg" type="submit" [disabled]="form.invalid || loading">
            {{ loading ? 'Création...' : 'Créer mon compte' }}
          </button>
        </form>

        <p class="auth-footer">
          Déjà un compte ? <a routerLink="/auth/login">Se connecter</a>
        </p>
      </div>
    </div>
  `,
  styles: [`
    .auth-page {
      min-height: 100vh; display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      background: linear-gradient(135deg, #065c39 0%, #0a7c4e 50%, #12a867 100%);
      padding: 24px;
    }
    .auth-brand { text-align: center; margin-bottom: 32px; color: #fff;
      .brand-logo { width: 64px; height: 64px; background: #ffffff; border-radius: 16px;
        font-size: 24px; font-weight: 900; color: #0a7c4e; display: flex;
        align-items: center; justify-content: center; margin: 0 auto 12px; }
      h1 { font-size: 26px; font-weight: 700; margin: 0; span { color: #ffffff; } }
      p { color: rgba(255,255,255,0.75); font-size: 14px; margin-top: 4px; }
    }
    .auth-card { background: #fff; border-radius: 12px; padding: 40px; width: 100%; max-width: 460px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      h2 { font-size: 22px; font-weight: 700; color: #0a7c4e; margin-bottom: 4px; }
      .auth-subtitle { color: #8898aa; font-size: 14px; margin-bottom: 28px; }
    }
    .auth-footer { text-align: center; margin-top: 20px; color: #8898aa; font-size: 13px; }
  `],
})
export class RegisterComponent {
  form = this.fb.group({
    first_name:  ['', Validators.required],
    last_name:   ['', Validators.required],
    email:       ['', [Validators.required, Validators.pattern(/^[^@]+@cgrae\.ci$/)]],
    department:  [''],
    password:    ['', [Validators.required, Validators.minLength(8)]],
  });
  loading = false;
  error   = '';
  success = false;

  constructor(private fb: FormBuilder, private api: ApiService, private router: Router) {}

  submit(): void {
    if (this.form.invalid) return;
    this.loading = true;
    this.error   = '';

    this.api.register(this.form.value).pipe(timeout(15000)).subscribe({
      next: () => { this.success = true; this.loading = false; },
      error: (err) => {
        this.error = err?.name === 'TimeoutError'
          ? 'Le serveur met trop de temps à répondre. Vérifiez que le backend est bien démarré.'
          : err.message;
        this.loading = false;
      },
    });
  }
}
