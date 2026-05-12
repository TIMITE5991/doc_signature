import { Component, ChangeDetectionStrategy, OnInit, OnDestroy, signal, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
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
export class EnvelopeFormComponent implements OnInit, OnDestroy {
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
  zonePageMap      = signal<Map<number, number>>(new Map());
  sigZones         = signal<Map<number, { x_ratio: number; y_ratio: number; doc_id: number; page_number?: number }>>(new Map());
  // Zoom & Pan controls for preview
  zoneZoom         = signal(100);
  zonePanX         = signal(0);
  zonePanY         = signal(0);
  zonePanningMode  = signal(false);
  zoneScrollX      = signal(0);
  zoneScrollY      = signal(0);
  zoneContainerW   = signal(0);
  zoneContainerH   = signal(0);
  zoneAnimateTransform = signal(false);

  private zonePanPending = false;
  private zoneScrollPending = false;
  private zonePreviewUrlCache = new Map<number, SafeResourceUrl>();
  private zonePreviewObjectUrlCache = new Map<number, string>();
  private zoneDocBlobCache = new Map<number, Blob>();
  private lastZoneDocxDocId: number | null = null;
  private lastZoneIframeDocId: number | null = null;
  private zoneDocxRenderSeq = 0;
  private zoneIframeRenderSeq = 0;
  zoneDocxLoading = signal(false);
  zoneDocxError = signal('');
  zoneIframeLoading = signal(false);
  zoneIframeError = signal('');
  zonePreviewCacheTick = signal(0);
  private currentZonePreviewDocId: number | null = null;

  @ViewChild('zoneDocxContainer') zoneDocxContainerRef?: ElementRef<HTMLDivElement>;

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
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.api.getDocuments().subscribe({
      next: (docs) => {
        this.myDocs.set(docs);
        this.loadingDocs.set(false);
        setTimeout(() => this.refreshZonePreview(), 0);
      },
      error: () => this.loadingDocs.set(false),
    });
  }

  ngOnDestroy(): void {
    for (const url of this.zonePreviewObjectUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.zonePreviewObjectUrlCache.clear();
    this.bumpZonePreviewCacheTick();
  }

  asFormGroup(ctrl: AbstractControl): FormGroup { return ctrl as FormGroup; }

  addRecipient(): void {
    this.recipientsArray.push(this.fb.group({
      first_name:   [''],
      last_name:    [''],
      email:        ['', [Validators.required, Validators.pattern(/^[^@]+@cgrae\.ci$/)]],
      role:         ['SIGNATORY', Validators.required],
      signing_order:[this.recipientsArray.length + 1, Validators.required],
    }));
    setTimeout(() => this.refreshZonePreview(), 0);
  }

  removeRecipient(i: number): void {
    this.recipientsArray.removeAt(i);
    const updated = new Map(this.sigZones());
    updated.delete(i);
    this.sigZones.set(updated);
    const updatedPages = new Map(this.zonePageMap());
    updatedPages.delete(i);
    this.zonePageMap.set(updatedPages);
    setTimeout(() => this.refreshZonePreview(), 0);
  }

  onRecipientRoleChange(): void {
    setTimeout(() => this.refreshZonePreview(), 0);
  }

  toggleDoc(event: Event, id: number): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedDocs.update(ids => checked ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter(d => d !== id));
    if (!checked) {
      this.zoneDocBlobCache.delete(id);
      const objectUrl = this.zonePreviewObjectUrlCache.get(id);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      this.zonePreviewObjectUrlCache.delete(id);
      this.zonePreviewUrlCache.delete(id);
      this.bumpZonePreviewCacheTick();
    }
    this.normalizeZoneDocMap();
    setTimeout(() => this.refreshZonePreview(), 0);
  }

  selectZoneRecipient(i: number): void {
    this.zoneRecipientIdx.set(i);
    setTimeout(() => this.refreshZonePreview(), 0);
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
  getZonePage(i: number): number { return this.sigZones().get(i)?.page_number || 1; }

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

  getZonePreviewDoc(recipientIdx: number): Document | null {
    const docIndex = this.getRecipientDocIndex(recipientIdx);
    const docId = this.selectedDocs()[docIndex];
    if (!docId) return null;
    return this.myDocs().find(d => d.id_document === docId) || null;
  }

  isZonePreviewSupported(recipientIdx: number): boolean {
    const doc = this.getZonePreviewDoc(recipientIdx);
    if (!doc) return false;
    return this.isZoneIframePreviewByDoc(doc) || this.isZoneDocxPreviewByDoc(doc);
  }

  isZoneDocxPreview(recipientIdx: number): boolean {
    return this.isZoneDocxPreviewByDoc(this.getZonePreviewDoc(recipientIdx));
  }

  isZonePdfPreview(recipientIdx: number): boolean {
    const doc = this.getZonePreviewDoc(recipientIdx);
    if (!doc) return false;
    const mime = (doc.mime_type || '').toLowerCase();
    const ext = (doc.original_name || '').toLowerCase().split('.').pop() || '';
    return mime === 'application/pdf' || ext === 'pdf';
  }

  isZoneImagePreview(recipientIdx: number): boolean {
    const doc = this.getZonePreviewDoc(recipientIdx);
    if (!doc) return false;
    const mime = (doc.mime_type || '').toLowerCase();
    const ext = (doc.original_name || '').toLowerCase().split('.').pop() || '';
    return mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext);
  }

  isZoneIframePreview(recipientIdx: number): boolean {
    return this.isZoneIframePreviewByDoc(this.getZonePreviewDoc(recipientIdx));
  }

  getZonePreviewObjectUrl(recipientIdx: number): string {
    this.zonePreviewCacheTick();
    const docIndex = this.getRecipientDocIndex(recipientIdx);
    const docId = this.selectedDocs()[docIndex];
    if (!docId) return '';
    return this.zonePreviewObjectUrlCache.get(docId) || '';
  }

  getZonePreviewDocUrl(recipientIdx: number): SafeResourceUrl | null {
    this.zonePreviewCacheTick();
    if (!this.isZoneIframePreview(recipientIdx)) return null;
    const docIndex = this.getRecipientDocIndex(recipientIdx);
    const docId    = this.selectedDocs()[docIndex];
    if (!docId) return null;
    return this.zonePreviewUrlCache.get(docId) || null;
  }

  onZonePlacerClick(event: MouseEvent, recipientIdx: number): void {
    const target  = event.currentTarget as HTMLElement;
    const rect    = target.getBoundingClientRect();
    const x_ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width,  0), 1);
    const y_ratio = Math.min(Math.max((event.clientY - rect.top)  / rect.height, 0), 1);
    const docIndex = this.zoneDocMap().get(recipientIdx) ?? 0;
    const doc_id   = this.selectedDocs()[docIndex];
    const page_number = this.zonePageMap().get(recipientIdx) || 1;
    const updated  = new Map(this.sigZones());
    updated.set(recipientIdx, { x_ratio, y_ratio, doc_id, page_number });
    this.sigZones.set(updated);
  }

  onZonePreviewClick(event: MouseEvent, recipientIdx: number): void {
    if (this.zonePanningMode()) return;
    if (this.zoneDocxLoading() || this.zoneIframeLoading()) return;
    if (this.zoneDocxError() || this.zoneIframeError()) return;
    this.onZonePlacerClick(event, recipientIdx);
  }

  setZoneDocForRecipient(recipientIdx: number, docIndex: number): void {
    const safeIndex = this.clampDocIndex(docIndex);
    const updated = new Map(this.zoneDocMap());
    updated.set(recipientIdx, safeIndex);
    this.zoneDocMap.set(updated);
    const existing = this.sigZones().get(recipientIdx);
    if (existing) {
      const doc_id   = this.selectedDocs()[safeIndex];
      const updatedZ = new Map(this.sigZones());
      updatedZ.set(recipientIdx, { ...existing, doc_id });
      this.sigZones.set(updatedZ);
    }
    setTimeout(() => this.refreshZonePreview(), 0);
  }

  setZonePageForRecipient(recipientIdx: number, pageValue: string): void {
    const page = Math.max(1, Math.floor(Number(pageValue) || 1));
    const updated = new Map(this.zonePageMap());
    updated.set(recipientIdx, page);
    this.zonePageMap.set(updated);

    const existing = this.sigZones().get(recipientIdx);
    if (existing) {
      const updatedZ = new Map(this.sigZones());
      updatedZ.set(recipientIdx, { ...existing, page_number: page });
      this.sigZones.set(updatedZ);
    }
  }

  updateZoneXForRecipient(recipientIdx: number, xValue: string): void {
    const current = this.sigZones().get(recipientIdx);
    if (!current) return;
    const x_ratio = Math.min(Math.max(Number(xValue) / 100, 0), 1);
    const updated = new Map(this.sigZones());
    updated.set(recipientIdx, { ...current, x_ratio });
    this.sigZones.set(updated);
  }

  updateZoneYForRecipient(recipientIdx: number, yValue: string): void {
    const current = this.sigZones().get(recipientIdx);
    if (!current) return;
    const y_ratio = Math.min(Math.max(Number(yValue) / 100, 0), 1);
    const updated = new Map(this.sigZones());
    updated.set(recipientIdx, { ...current, y_ratio });
    this.sigZones.set(updated);
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
    if (this.hasStrictSequentialOrderIssue()) {
      this.error.set('Pour un circuit séquentiel strict, l\'ordre doit être unique et successif (1, 2, 3...).');
      this.recipientsArray.markAllAsTouched();
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

  private hasStrictSequentialOrderIssue(): boolean {
    if (this.form.value.circuit_type !== 'SEQUENTIAL') return false;
    const orders = this.recipientsArray.controls.map(group => Number(group.get('signing_order')?.value));
    if (orders.some(order => !Number.isFinite(order) || order < 1)) return true;
    if (new Set(orders).size !== orders.length) return true;
    const sorted = [...orders].sort((a, b) => a - b);
    return sorted.some((order, idx) => order !== idx + 1);
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
      const encodedZone = zone
        ? {
            ...zone,
            // Encode selected page into y_ratio for backward-compatible persistence.
            y_ratio: (Math.max(1, zone.page_number || 1) - 1) + zone.y_ratio,
          }
        : undefined;
      return {
        first_name:     (raw.first_name || '').trim() || fallbackFirst,
        last_name:      (raw.last_name  || '').trim() || fallbackLast,
        email,
        role:           raw.role,
        signing_order:  raw.signing_order,
        signature_zone: encodedZone,
      };
    });
  }

  // ── Zone Preview Zoom/Pan ──────────────
  zoneZoomIn(): void { 
    this.zoneAnimateTransform.set(true);
    this.zoneZoom.update(z => Math.min(z + 25, 300)); 
  }
  zoneZoomOut(): void { 
    this.zoneAnimateTransform.set(true);
    this.zoneZoom.update(z => Math.max(z - 25, 50)); 
  }
  zoneResetZoom(): void { 
    this.zoneAnimateTransform.set(true);
    this.zoneZoom.set(100); 
    this.zonePanX.set(0); 
    this.zonePanY.set(0); 
  }
  zoneTogglePanMode(): void { this.zonePanningMode.update(v => !v); }

  onZonePreviewWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    this.zoneAnimateTransform.set(true);
    const delta = event.deltaY > 0 ? -25 : 25;
    this.zoneZoom.update(z => Math.min(Math.max(z + delta, 50), 300));
  }

  onZonePreviewPan(event: PointerEvent, viewer: HTMLElement): void {
    if (!this.zonePanningMode()) return;
    if (event.button !== 0) return;
    
    this.zoneAnimateTransform.set(false);
    
    const startX = event.clientX;
    const startY = event.clientY;
    const startPanX = this.zonePanX();
    const startPanY = this.zonePanY();

    const onMove = (e: PointerEvent) => {
      if (!this.zonePanPending) {
        this.zonePanPending = true;
        requestAnimationFrame(() => {
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          this.zonePanX.set(startPanX + dx);
          this.zonePanY.set(startPanY + dy);
          this.zonePanPending = false;
        });
      }
    };
    const onEnd = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      this.zonePanPending = false;
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
    if (!this.zoneScrollPending) {
      this.zoneScrollPending = true;
      requestAnimationFrame(() => {
        this.zoneScrollX.set(target.scrollLeft);
        this.zoneScrollY.set(target.scrollTop);
        this.zoneContainerW.set(target.clientWidth);
        this.zoneContainerH.set(target.clientHeight);
        this.zoneScrollPending = false;
      });
    }
  }

  zoneScrollToPercent(y: number): void {
    const container = document.querySelector('.zone-preview-iframe-container') as HTMLElement;
    if (!container) return;
    const maxY = container.scrollHeight - container.clientHeight;
    container.scrollTop = (y / 100) * maxY;
  }

  private isZoneDocxPreviewByDoc(doc: Document | null): boolean {
    if (!doc) return false;
    const mime = (doc.mime_type || '').toLowerCase();
    const ext = (doc.original_name || '').toLowerCase().split('.').pop() || '';
    return mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx';
  }

  private clampDocIndex(index: number): number {
    const max = Math.max(0, this.selectedDocs().length - 1);
    return Math.min(Math.max(index, 0), max);
  }

  private getRecipientDocIndex(recipientIdx: number): number {
    return this.clampDocIndex(this.zoneDocMap().get(recipientIdx) ?? 0);
  }

  private normalizeZoneDocMap(): void {
    const normalized = new Map<number, number>();
    for (const [recipientIdx, docIndex] of this.zoneDocMap().entries()) {
      normalized.set(recipientIdx, this.clampDocIndex(docIndex));
    }
    this.zoneDocMap.set(normalized);
  }

  private isZoneIframePreviewByDoc(doc: Document | null): boolean {
    if (!doc) return false;
    const mime = (doc.mime_type || '').toLowerCase();
    const ext = (doc.original_name || '').toLowerCase().split('.').pop() || '';
    return mime === 'application/pdf'
      || mime.startsWith('image/')
      || ['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext);
  }

  private refreshZonePreview(): void {
    const doc = this.getZonePreviewDoc(this.zoneRecipientIdx());
    if (!doc) {
      this.zoneDocxLoading.set(false);
      this.zoneDocxError.set('');
      this.zoneIframeLoading.set(false);
      this.zoneIframeError.set('');
      this.lastZoneDocxDocId = null;
      this.lastZoneIframeDocId = null;
      this.currentZonePreviewDocId = null;
      if (this.zoneDocxContainerRef?.nativeElement) this.zoneDocxContainerRef.nativeElement.innerHTML = '';
      return;
    }

    if (this.currentZonePreviewDocId !== doc.id_document) {
      this.currentZonePreviewDocId = doc.id_document;
      this.zoneZoom.set(100);
      this.zonePanX.set(0);
      this.zonePanY.set(0);
      this.zoneAnimateTransform.set(false);
    }

    if (this.isZoneDocxPreviewByDoc(doc)) {
      this.zoneIframeLoading.set(false);
      this.zoneIframeError.set('');
      this.lastZoneIframeDocId = null;
      if (this.lastZoneDocxDocId === doc.id_document) return;
      this.lastZoneDocxDocId = doc.id_document;
      this.renderZoneDocx(doc.id_document);
      return;
    }

    if (this.isZoneIframePreviewByDoc(doc)) {
      this.zoneDocxLoading.set(false);
      this.zoneDocxError.set('');
      this.lastZoneDocxDocId = null;
      if (this.zoneDocxContainerRef?.nativeElement) this.zoneDocxContainerRef.nativeElement.innerHTML = '';
      if (this.lastZoneIframeDocId === doc.id_document && this.zonePreviewUrlCache.has(doc.id_document)) {
        this.zoneIframeLoading.set(false);
        this.zoneIframeError.set('');
        return;
      }
      this.lastZoneIframeDocId = doc.id_document;
      this.renderZoneIframe(doc.id_document);
      return;
    }

    this.zoneDocxLoading.set(false);
    this.zoneDocxError.set('');
    this.zoneIframeLoading.set(false);
    this.zoneIframeError.set('');
    this.lastZoneDocxDocId = null;
    this.lastZoneIframeDocId = null;
    if (this.zoneDocxContainerRef?.nativeElement) this.zoneDocxContainerRef.nativeElement.innerHTML = '';
  }

  private async waitForZoneDocxContainer(seq: number): Promise<HTMLDivElement | null> {
    for (let i = 0; i < 8; i++) {
      if (seq !== this.zoneDocxRenderSeq) return null;
      const container = this.zoneDocxContainerRef?.nativeElement;
      if (container) return container;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return null;
  }

  private renderZoneDocx(docId: number): void {
    const seq = ++this.zoneDocxRenderSeq;
    this.zoneDocxLoading.set(true);
    this.zoneDocxError.set('');

    const cachedBlob = this.zoneDocBlobCache.get(docId);
    if (cachedBlob) {
      this.renderZoneDocxFromBlob(cachedBlob, seq);
      return;
    }

    this.api.getDocumentBlob(docId).subscribe({
      next: async (blob) => {
        this.zoneDocBlobCache.set(docId, blob);
        await this.renderZoneDocxFromBlob(blob, seq);
      },
      error: () => {
        if (seq !== this.zoneDocxRenderSeq) return;
        this.zoneDocxLoading.set(false);
        this.zoneDocxError.set('Impossible de charger le document DOCX.');
      },
    });
  }

  private renderZoneIframe(docId: number): void {
    const seq = ++this.zoneIframeRenderSeq;
    this.zoneIframeLoading.set(true);
    this.zoneIframeError.set('');

    const existingSafe = this.zonePreviewUrlCache.get(docId);
    if (existingSafe) {
      this.zoneIframeLoading.set(false);
      return;
    }

    const cachedBlob = this.zoneDocBlobCache.get(docId);
    if (cachedBlob) {
      if (seq !== this.zoneIframeRenderSeq) return;
      this.setZoneIframeUrlFromBlob(docId, cachedBlob);
      this.zoneIframeLoading.set(false);
      return;
    }

    this.api.getDocumentBlob(docId).subscribe({
      next: (blob) => {
        if (seq !== this.zoneIframeRenderSeq) return;
        this.zoneDocBlobCache.set(docId, blob);
        this.setZoneIframeUrlFromBlob(docId, blob);
        this.zoneIframeLoading.set(false);
      },
      error: () => {
        if (seq !== this.zoneIframeRenderSeq) return;
        this.zoneIframeLoading.set(false);
        this.zoneIframeError.set('Impossible de charger ce document.');
      },
    });
  }

  private setZoneIframeUrlFromBlob(docId: number, blob: Blob): void {
    const previous = this.zonePreviewObjectUrlCache.get(docId);
    if (previous) URL.revokeObjectURL(previous);
    const objectUrl = URL.createObjectURL(blob);
    this.zonePreviewObjectUrlCache.set(docId, objectUrl);
    this.zonePreviewUrlCache.set(docId, this.sanitizer.bypassSecurityTrustResourceUrl(objectUrl));
    this.bumpZonePreviewCacheTick();
  }

  private bumpZonePreviewCacheTick(): void {
    this.zonePreviewCacheTick.update((v) => v + 1);
  }

  private async renderZoneDocxFromBlob(blob: Blob, seq: number): Promise<void> {
    try {
      if (seq !== this.zoneDocxRenderSeq) return;
      const container = await this.waitForZoneDocxContainer(seq);
      if (!container) return;
      container.innerHTML = '<p style="padding:12px;color:#64748b">Chargement DOCX...</p>';

      const ab = await blob.arrayBuffer();
      const mod: any = await import('docx-preview');
      if (seq !== this.zoneDocxRenderSeq) return;

      container.innerHTML = '';
      await mod.renderAsync(ab, container, undefined, { inWrapper: true });
      if (seq !== this.zoneDocxRenderSeq) return;

      this.zoneDocxLoading.set(false);
      this.zoneDocxError.set('');
      this.cdr.detectChanges();
    } catch {
      if (seq !== this.zoneDocxRenderSeq) return;
      this.zoneDocxLoading.set(false);
      this.zoneDocxError.set('Impossible de prévisualiser ce DOCX.');
      this.cdr.detectChanges();
    }
  }
}
