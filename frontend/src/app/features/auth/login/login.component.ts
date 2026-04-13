import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
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
        <h2>Connexion</h2>
        <p class="auth-subtitle">Accédez à votre espace de signature</p>

        <div *ngIf="error" class="alert alert-danger">{{ error }}</div>

        <form [formGroup]="form" (ngSubmit)="submit()">
          <div class="form-group">
            <label>Email &#64;cgrae.ci</label>
            <input type="email" formControlName="email" placeholder="votre.nom&#64;cgrae.ci" autocomplete="email" />
          </div>
          <div class="form-group">
            <label>Mot de passe</label>
            <div class="input-pwd">
              <input [type]="showPwd ? 'text' : 'password'" formControlName="password"
                     placeholder="••••••••" autocomplete="current-password" />
              <button type="button" class="btn-icon" (click)="showPwd = !showPwd">
                {{ showPwd ? '🙈' : '👁️' }}
              </button>
            </div>
          </div>
          <button class="btn btn-primary w-100 btn-lg" type="submit" [disabled]="form.invalid || loading">
            {{ loading ? 'Connexion...' : 'Se connecter' }}
          </button>
        </form>

        <p class="auth-footer">
          Pas encore de compte ? <a routerLink="/auth/register">Créer un compte</a>
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
    .auth-card { background: #fff; border-radius: 12px; padding: 40px; width: 100%; max-width: 420px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      h2 { font-size: 22px; font-weight: 700; color: #0a7c4e; margin-bottom: 4px; }
      .auth-subtitle { color: #8898aa; font-size: 14px; margin-bottom: 28px; }
    }
    .input-pwd { position: relative;
      input { padding-right: 44px; }
      .btn-icon { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); }
    }
    .auth-footer { text-align: center; margin-top: 20px; color: #8898aa; font-size: 13px; }
  `],
})
export class LoginComponent {
  form = this.fb.group({
    email:    ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });
  loading = false;
  error   = '';
  showPwd = false;

  constructor(
    private fb: FormBuilder,
    private api: ApiService,
    private auth: AuthService,
    private router: Router,
  ) {}

  submit(): void {
    if (this.form.invalid) return;
    this.loading = true;
    this.error   = '';
    const { email, password } = this.form.value;

    this.api.login(email!, password!).subscribe({
      next: (res) => {
        this.auth.setAuth(res.access_token, res.user);
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.error   = err.message;
        this.loading = false;
      },
    });
  }
}
