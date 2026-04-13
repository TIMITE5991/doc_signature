import { Component, ChangeDetectionStrategy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { Template } from '../../core/models';

@Component({
  selector: 'app-templates',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="page-header">
      <div>
        <h1>Modèles</h1>
        <p>Modèles de documents réutilisables</p>
      </div>
      <button class="btn btn-primary" (click)="openForm()">＋ Nouveau modèle</button>
    </div>

    <div *ngIf="error()" class="alert alert-danger">{{ error() }}</div>

    <!-- Form modal -->
    <div class="modal-overlay" *ngIf="showForm()" (click)="closeForm()">
      <div class="modal-box" (click)="$event.stopPropagation()">
        <h3>{{ editingId() ? 'Modifier' : 'Nouveau' }} modèle</h3>
        <form [formGroup]="form" (ngSubmit)="save()">
          <div class="form-group">
            <label>Nom du modèle *</label>
            <input type="text" formControlName="name" placeholder="Ex: Contrat de travail" />
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea formControlName="description" placeholder="Description optionnelle..."></textarea>
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
      <div class="empty-state" *ngIf="templates().length === 0">
        <div class="icon">📋</div>
        <p>Aucun modèle créé</p>
        <button class="btn btn-primary btn-sm mt-2" (click)="openForm()">Créer un modèle</button>
      </div>

      <div class="table-wrapper" *ngIf="templates().length > 0">
        <table class="data-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Description</th>
              <th>Créé par</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let tpl of templates()">
              <td style="font-weight:500">{{ tpl.name }}</td>
              <td style="color:var(--text-muted);font-size:13px">{{ tpl.description || '—' }}</td>
              <td style="font-size:13px">{{ tpl.creator_name }}</td>
              <td style="color:var(--text-muted);font-size:13px">{{ tpl.created_at | date:'dd/MM/yyyy' }}</td>
              <td>
                <button class="btn-icon" title="Modifier" (click)="edit(tpl)">✏️</button>
                <button class="btn-icon" title="Archiver" (click)="remove(tpl)">🗑️</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .modal-box { background: #fff; border-radius: 12px; padding: 32px; width: 100%; max-width: 480px; box-shadow: var(--shadow-md);
      h3 { font-size: 18px; font-weight: 700; color: var(--primary); margin-bottom: 20px; }
    }
  `],
})
export class TemplatesComponent implements OnInit {
  loading   = signal(true);
  saving    = signal(false);
  showForm  = signal(false);
  editingId = signal<number | null>(null);
  templates = signal<Template[]>([]);
  error     = signal('');

  form = this.fb.group({
    name:        ['', Validators.required],
    description: [''],
  });

  constructor(private api: ApiService, private fb: FormBuilder) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.api.getTemplates().subscribe({
      next: (list) => { this.templates.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  openForm(): void { this.editingId.set(null); this.form.reset(); this.showForm.set(true); }
  closeForm(): void { this.showForm.set(false); }

  edit(tpl: Template): void {
    this.editingId.set(tpl.id_template);
    this.form.patchValue({ name: tpl.name, description: tpl.description });
    this.showForm.set(true);
  }

  save(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    const id = this.editingId();
    const req = id
      ? this.api.updateTemplate(id, this.form.value)
      : this.api.createTemplate(this.form.value);

    req.subscribe({
      next: (tpl) => {
        if (id) this.templates.update(list => list.map(t => t.id_template === id ? tpl : t));
        else    this.templates.update(list => [tpl, ...list]);
        this.saving.set(false);
        this.closeForm();
      },
      error: (err) => { this.error.set(err.message); this.saving.set(false); },
    });
  }

  remove(tpl: Template): void {
    if (!confirm(`Archiver le modèle "${tpl.name}" ?`)) return;
    this.api.deleteTemplate(tpl.id_template).subscribe({
      next: () => this.templates.update(list => list.filter(t => t.id_template !== tpl.id_template)),
      error: (err) => this.error.set(err.message),
    });
  }
}
