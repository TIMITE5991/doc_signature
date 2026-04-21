import { Component, ChangeDetectionStrategy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormArray, Validators, FormGroup, AbstractControl } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ApiService } from '../../../core/services/api.service';
import { Document } from '../../../core/models';

@Component({
  selector: 'app-envelope-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './envelope-form.component.html',
  styleUrl: './envelope-form.component.scss',
})
export class EnvelopeFormComponent implements OnInit {
  loading      = signal(true);
  loadingDocs  = signal(true);
  saving       = signal(false);
  error        = signal('');
  submitted    = signal(false);
  myDocs       = signal<Document[]>([]);
  selectedDocs = signal<number[]>([]);
  sendOnCreate = false;

  zoneRecipientIdx = signal(0);
  zoneDocMap       = signal<Map<number, number>>(new Map());
  sigZones         = signal<Map<number, { x_ratio: number; y_ratio: number; doc_id: number }>>(new Map());
  // Zoom & Pan controls for preview
  zoneZoom         = signal(100);
  zonePanX         = signal(0);
  zonePanY         = signal(0);
  zonePanningMode  = signal(false);
  zoneScrollX      = signal(0);
  zoneScrollY      = signal(0);
  zoneContainerW   = signal(0);
  zoneContainerH   = signal(0);

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

  asFormGroup(ctrl: AbstractControl): FormGroup { return ctrl as FormGroup; }

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
    const updated = new Map(this.sigZones());
    updated.delete(i);
    this.sigZones.set(updated);
  }

  toggleDoc(event: Event, id: number): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedDocs.update(ids => checked ? [...ids, id] : ids.filter(d => d !== id));
  }

  signatoryIndices(): number[] {
    return this.recipientsArray.controls
      .map((_, i) => i)
      .filter(i => {
        const role = this.recipientsArray.at(i).get('role')?.value;
        return role === 'SIGNATORY' || role === 'APPROVER';
      });
  }

  hasZones(): boolean { return this.selectedDocs().length > 0 && this.signatoryIndices().length > 0; }
  hasZone(i: number): boolean { return this.sigZones().has(i); }
  getZoneX(i: number): number { return (this.sigZones().get(i)?.x_ratio ?? 0) * 100; }
  getZoneY(i: number): number { return (this.sigZones().get(i)?.y_ratio ?? 0) * 100; }
  zonePercentX(i: number): number { return Math.round(this.getZoneX(i)); }
  zonePercentY(i: number): number { return Math.round(this.getZoneY(i)); }

  getRecipientLabel(i: number): string {
    const g  = this.recipientsArray.at(i);
    const fn = (g?.get('first_name')?.value || '').trim();
    const ln = (g?.get('last_name')?.value  || '').trim();
    if (fn || ln) return [fn, ln].filter(Boolean).join(' ');
    const email = (g?.get('email')?.value || '') as string;
    return email.split('@')[0] || `Signataire ${i + 1}`;
  }

  getDocName(docId: number): string {
    return this.myDocs().find(d => d.id_document === docId)?.original_name || `Doc ${docId}`;
  }

  getZonePreviewDocUrl(recipientIdx: number): SafeResourceUrl | null {
    const docIndex = this.zoneDocMap().get(recipientIdx) ?? 0;
    const docId    = this.selectedDocs()[docIndex];
    if (!docId) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.api.getDocumentViewUrl(docId));
  }

  onZonePlacerClick(event: MouseEvent, recipientIdx: number): void {
    const target  = event.currentTarget as HTMLElement;
    const rect    = target.getBoundingClientRect();
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
    const existing = this.sigZones().get(recipientIdx);
    if (existing) {
      const doc_id   = this.selectedDocs()[docIndex];
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

  submit(): void {
    this.submitted.set(true);
    if (this.form.invalid || this.recipientsArray.invalid || this.recipientsArray.length === 0 || this.selectedDocs().length === 0) {
      this.form.markAllAsTouched();
      this.recipientsArray.markAllAsTouched();
      this.recipientsArray.controls.forEach(g => g.markAllAsTouched());
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
      const raw = group.value as { first_name?: string; last_name?: string; email?: string; role?: string; signing_order?: number; };
      const email         = (raw.email || '').trim().toLowerCase();
      const localPart     = email.split('@')[0] || '';
      const parts         = localPart.split(/[._-]+/).filter(Boolean);
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

  // ── Zone Preview Zoom/Pan ──────────────
  zoneZoomIn(): void { this.zoneZoom.update(z => Math.min(z + 25, 300)); }
  zoneZoomOut(): void { this.zoneZoom.update(z => Math.max(z - 25, 50)); }
  zoneResetZoom(): void { this.zoneZoom.set(100); this.zonePanX.set(0); this.zonePanY.set(0); }
  zoneTogglePanMode(): void { this.zonePanningMode.update(v => !v); }

  onZonePreviewWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -25 : 25;
    this.zoneZoom.update(z => Math.min(Math.max(z + delta, 50), 300));
  }

  onZonePreviewPan(event: PointerEvent, viewer: HTMLElement): void {
    if (!this.zonePanningMode()) return;
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startPanX = this.zonePanX();
    const startPanY = this.zonePanY();

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      this.zonePanX.set(startPanX + dx);
      this.zonePanY.set(startPanY + dy);
    };
    const onEnd = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
  }

  zoneOverviewPercent(): number {
    if (this.zoneContainerH() === 0) return 0;
    return Math.round((this.zoneScrollY() / (this.zoneContainerH() * 2)) * 100);
  }

  onZoneContainerScroll(event: Event): void {
    const target = event.target as HTMLElement;
    this.zoneScrollX.set(target.scrollLeft);
    this.zoneScrollY.set(target.scrollTop);
    this.zoneContainerW.set(target.clientWidth);
    this.zoneContainerH.set(target.clientHeight);
  }

  zoneScrollToPercent(y: number): void {
    const container = document.querySelector('.zone-preview-iframe-container') as HTMLElement;
    if (!container) return;
    const maxY = container.scrollHeight - container.clientHeight;
    container.scrollTop = (y / 100) * maxY;
  }
}
