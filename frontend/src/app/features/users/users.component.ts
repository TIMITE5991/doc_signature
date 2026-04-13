import { Component, ChangeDetectionStrategy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { User } from '../../core/models';

@Component({
  selector: 'app-users',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="page-header">
      <div>
        <h1>Utilisateurs</h1>
        <p>Gestion des agents CGRAE</p>
      </div>
      <button class="btn btn-primary" (click)="openForm()">＋ Nouvel utilisateur</button>
    </div>

    <div *ngIf="error()" class="alert alert-danger">{{ error() }}</div>

    <!-- Modal -->
    <div class="modal-overlay" *ngIf="showForm()" (click)="closeForm()">
      <div class="modal-box" (click)="$event.stopPropagation()">
        <h3>{{ editingId() ? 'Modifier' : 'Nouvel' }} utilisateur</h3>
        <form [formGroup]="form" (ngSubmit)="save()">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label>Prénom *</label>
              <input type="text" formControlName="first_name" />
            </div>
            <div class="form-group">
              <label>Nom *</label>
              <input type="text" formControlName="last_name" />
            </div>
          </div>
          <div class="form-group" *ngIf="!editingId()">
            <label>Email &#64;cgrae.ci *</label>
            <input type="email" formControlName="email" placeholder="nom&#64;cgrae.ci" />
          </div>
          <div class="form-group" *ngIf="!editingId()">
            <label>Mot de passe *</label>
            <input type="password" formControlName="password" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label>Rôle *</label>
              <select formControlName="role">
                <option value="SIGNATORY">Signataire</option>
                <option value="APPROVER">Approbateur</option>
                <option value="VIEWER">Visualisateur</option>
                <option value="DELEGATOR">Délégateur</option>
                <option value="ADMIN">Administrateur</option>
                <option value="SUPER_ADMIN">Super Admin</option>
              </select>
            </div>
            <div class="form-group">
              <label>Département</label>
              <input type="text" formControlName="department" />
            </div>
          </div>
          <div class="form-group">
            <label>Téléphone</label>
            <input type="text" formControlName="phone" />
          </div>
          <div class="d-flex gap-1 justify-between mt-2">
            <button type="button" class="btn btn-outline" (click)="closeForm()">Annuler</button>
            <button type="submit" class="btn btn-primary" [disabled]="form.invalid || saving()">
              {{ saving() ? 'Sauvegarde...' : 'Sauvegarder' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <div class="loading-center" *ngIf="loading()"><div class="spinner"></div></div>

    <div class="card" *ngIf="!loading()">
      <!-- Search -->
      <div class="form-group mb-2" style="max-width:320px">
        <input type="text" placeholder="🔍 Rechercher..." [(ngModel)]="search" [ngModelOptions]="{standalone: true}" />
      </div>

      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Email</th>
              <th>Rôle</th>
              <th>Département</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let u of filtered()">
              <td style="font-weight:500">{{ u.first_name }} {{ u.last_name }}</td>
              <td style="font-size:13px">{{ u.email }}</td>
              <td><span class="badge badge-sent">{{ roleLabel(u.role) }}</span></td>
              <td style="font-size:13px;color:var(--text-muted)">{{ u.department || '—' }}</td>
              <td>
                <span [class]="u.is_active ? 'badge badge-completed' : 'badge badge-cancelled'">
                  {{ u.is_active ? 'Actif' : 'Désactivé' }}
                </span>
              </td>
              <td>
                <button class="btn-icon" title="Modifier" (click)="edit(u)">✏️</button>
                <button class="btn-icon" title="Désactiver" (click)="deactivate(u)" *ngIf="u.is_active">🚫</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .modal-box { background: #fff; border-radius: 12px; padding: 32px; width: 100%; max-width: 520px; box-shadow: var(--shadow-md);
      h3 { font-size: 18px; font-weight: 700; color: var(--primary); margin-bottom: 20px; }
    }
  `],
})
export class UsersComponent implements OnInit {
  loading   = signal(true);
  saving    = signal(false);
  showForm  = signal(false);
  editingId = signal<number | null>(null);
  users     = signal<User[]>([]);
  error     = signal('');
  search    = '';

  form = this.fb.group({
    first_name:  ['', Validators.required],
    last_name:   ['', Validators.required],
    email:       [''],
    password:    [''],
    role:        ['SIGNATORY', Validators.required],
    department:  [''],
    phone:       [''],
  });

  constructor(private api: ApiService, private fb: FormBuilder) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.api.getUsers().subscribe({
      next: (list) => { this.users.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  filtered(): User[] {
    if (!this.search) return this.users();
    const q = this.search.toLowerCase();
    return this.users().filter(u =>
      u.first_name.toLowerCase().includes(q) ||
      u.last_name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q),
    );
  }

  openForm(): void {
    this.editingId.set(null);
    this.form.reset({ role: 'SIGNATORY' });
    this.form.get('email')!.setValidators([Validators.required, Validators.pattern(/^[^@]+@cgrae\.ci$/)]);
    this.form.get('password')!.setValidators([Validators.required, Validators.minLength(8)]);
    this.form.updateValueAndValidity();
    this.showForm.set(true);
  }

  closeForm(): void { this.showForm.set(false); }

  edit(u: User): void {
    this.editingId.set(u.id_user);
    this.form.get('email')!.clearValidators();
    this.form.get('password')!.clearValidators();
    this.form.updateValueAndValidity();
    this.form.patchValue({ first_name: u.first_name, last_name: u.last_name, role: u.role, department: u.department, phone: u.phone });
    this.showForm.set(true);
  }

  save(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    const id = this.editingId();
    const req = id
      ? this.api.updateUser(id, { first_name: this.form.value.first_name, last_name: this.form.value.last_name, role: this.form.value.role, department: this.form.value.department, phone: this.form.value.phone })
      : this.api.createUser(this.form.value);

    req.subscribe({
      next: (u) => {
        if (id) this.users.update(list => list.map(x => x.id_user === id ? u : x));
        else    this.users.update(list => [u, ...list]);
        this.saving.set(false);
        this.closeForm();
      },
      error: (err) => { this.error.set(err.message); this.saving.set(false); },
    });
  }

  deactivate(u: User): void {
    if (!confirm(`Désactiver l'utilisateur ${u.first_name} ${u.last_name} ?`)) return;
    this.api.deleteUser(u.id_user).subscribe({
      next: () => this.users.update(list => list.map(x => x.id_user === u.id_user ? { ...x, is_active: false } : x)),
      error: (err) => this.error.set(err.message),
    });
  }

  roleLabel(r: string): string {
    const m: Record<string, string> = { SIGNATORY: 'Signataire', APPROVER: 'Approbateur', VIEWER: 'Lecteur', DELEGATOR: 'Délégateur', ADMIN: 'Admin', SUPER_ADMIN: 'Super Admin' };
    return m[r] || r;
  }
}
