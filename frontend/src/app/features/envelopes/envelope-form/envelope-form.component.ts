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
  documentUploadError = signal('');
  attachmentUploadError = signal('');
  submitted    = signal(false);
  myDocs       = signal<Document[]>([]);
  selectedDocs = signal<number[]>([]);
  selectedAttachments = signal<number[]>([]);
  uploadingDocuments = signal(false);
  uploadingAttachments = signal(false);
  documentsPage = signal(1);
  attachmentsPage = signal(1);
  readonly pageSizeOptions = [8, 15, 30];
  docsPerPage = signal(8);
  sendOnCreate = false;

  zoneRecipientIdx = signal(0);
  zoneDocMap       = signal<Map<number, number>>(new Map());
  zonePageMap      = signal<Map<string, number>>(new Map());
  sigZones         = signal<Map<string, { x_ratio: number; y_ratio: number; doc_id: number; page_number?: number }>>(new Map());
  // PDF canvas rendering
  zonePdfTotalPages  = signal(1);
  zonePdfRendering   = signal(false);
  zoneScrollX      = signal(0);
  zoneScrollY      = signal(0);
  zoneContainerW   = signal(0);
  zoneContainerH   = signal(0);

  private zoneScrollPending = false;
  private pdfDocumentCache = new Map<number, any>();
  private pdfRenderSeq     = 0;
  private zonePdfTaskRef: any = null;
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
  @ViewChild('pdfCanvas') pdfCanvasRef?: ElementRef<HTMLCanvasElement>;

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
        this.myDocs.set(this.mergeDocumentLists(this.myDocs(), docs));
        this.ensurePaginationBounds();
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
    for (const pdfDoc of this.pdfDocumentCache.values()) {
      pdfDoc.destroy?.();
    }
    this.pdfDocumentCache.clear();
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
    this.reindexRecipientZoneMapsAfterRecipientRemoval(i);
    setTimeout(() => this.refreshZonePreview(), 0);
  }

  onRecipientRoleChange(): void {
    setTimeout(() => this.refreshZonePreview(), 0);
  }

  toggleDoc(event: Event, id: number): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedDocs.update(ids => checked ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter(d => d !== id));
    if (checked) {
      this.selectedAttachments.update(ids => ids.filter(d => d !== id));
    }
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

  toggleAttachment(event: Event, id: number): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedAttachments.update(ids => checked ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter(d => d !== id));
    if (checked) {
      this.selectedDocs.update(ids => ids.filter(d => d !== id));
      this.normalizeZoneDocMap();
      setTimeout(() => this.refreshZonePreview(), 0);
    }
  }

  onDocumentFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    if (!files.length) return;

    this.documentsPage.set(1);
    this.uploadingDocuments.set(true);
    this.documentUploadError.set('');

    const uploadNext = (index: number) => {
      if (index >= files.length) {
        this.uploadingDocuments.set(false);
        input.value = '';
        this.normalizeZoneDocMap();
        setTimeout(() => this.refreshZonePreview(), 0);
        return;
      }

      this.api.uploadDocument(files[index]).subscribe({
        next: (doc) => {
          this.myDocs.update((docs) => [doc, ...docs]);
          this.ensurePaginationBounds();
          this.selectedDocs.update((ids) => (ids.includes(doc.id_document) ? ids : [...ids, doc.id_document]));
          this.selectedAttachments.update((ids) => ids.filter((id) => id !== doc.id_document));
          uploadNext(index + 1);
        },
        error: (err) => {
          this.documentUploadError.set(this.extractUploadErrorMessage(err));
          this.uploadingDocuments.set(false);
          input.value = '';
        },
      });
    };

    uploadNext(0);
  }

  onAttachmentFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    if (!files.length) return;

    this.attachmentsPage.set(1);
    this.uploadingAttachments.set(true);
    this.attachmentUploadError.set('');

    const uploadNext = (index: number) => {
      if (index >= files.length) {
        this.uploadingAttachments.set(false);
        input.value = '';
        return;
      }

      this.api.uploadDocument(files[index]).subscribe({
        next: (doc) => {
          this.myDocs.update((docs) => [doc, ...docs]);
          this.ensurePaginationBounds();
          this.selectedAttachments.update((ids) => (ids.includes(doc.id_document) ? ids : [...ids, doc.id_document]));
          this.selectedDocs.update((ids) => ids.filter((id) => id !== doc.id_document));
          uploadNext(index + 1);
        },
        error: (err) => {
          this.attachmentUploadError.set(this.extractUploadErrorMessage(err));
          this.uploadingAttachments.set(false);
          input.value = '';
        },
      });
    };

    uploadNext(0);
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
        return role === 'SIGNATORY';
      });
  }

  hasZones(): boolean { return this.selectedDocs().length > 0 && this.signatoryIndices().length > 0; }
  hasZone(i: number): boolean { return !!this.getZoneForCurrentDoc(i); }
  getZoneX(i: number): number { return (this.getZoneForCurrentDoc(i)?.x_ratio ?? 0) * 100; }
  getZoneY(i: number): number { return (this.getZoneForCurrentDoc(i)?.y_ratio ?? 0) * 100; }
  zonePercentX(i: number): number { return Math.round(this.getZoneX(i)); }
  zonePercentY(i: number): number { return Math.round(this.getZoneY(i)); }
  getZonePage(i: number): number {
    const docId = this.getRecipientSelectedDocId(i);
    if (!docId) return 1;
    const key = this.zoneKey(i, docId);
    return this.zonePageMap().get(key) || this.sigZones().get(key)?.page_number || 1;
  }

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

  getZonePdfPreviewDocUrl(recipientIdx: number): SafeResourceUrl | null {
    this.zonePreviewCacheTick();
    if (!this.isZonePdfPreview(recipientIdx)) return null;
    const objectUrl = this.getZonePreviewObjectUrl(recipientIdx);
    if (!objectUrl) return null;
    const page = Math.max(1, this.getZonePage(recipientIdx));
    const withPage = `${objectUrl}#page=${page}&zoom=page-fit&toolbar=0&navpanes=0&statusbar=0&messages=0`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(withPage);
  }

  onZonePlacerClick(event: MouseEvent, recipientIdx: number): void {
    const target  = event.currentTarget as HTMLElement;
    const rect    = target.getBoundingClientRect();
    const x_ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width,  0), 1);
    const y_ratio = Math.min(Math.max((event.clientY - rect.top)  / rect.height, 0), 1);
    const doc_id = this.getRecipientSelectedDocId(recipientIdx);
    if (!doc_id) return;
    const key = this.zoneKey(recipientIdx, doc_id);
    const page_number = this.zonePageMap().get(key) || 1;
    const updated  = new Map(this.sigZones());
    updated.set(key, { x_ratio, y_ratio, doc_id, page_number });
    this.sigZones.set(updated);
  }

  onZonePreviewClick(event: MouseEvent, recipientIdx: number): void {
    if (this.zonePdfRendering() || this.zoneDocxLoading() || this.zoneIframeLoading()) return;
    if (this.zoneDocxError() || this.zoneIframeError()) return;
    this.onZonePlacerClick(event, recipientIdx);
  }

  setZoneDocForRecipient(recipientIdx: number, docIndex: number): void {
    const safeIndex = this.clampDocIndex(docIndex);
    const updated = new Map(this.zoneDocMap());
    updated.set(recipientIdx, safeIndex);
    this.zoneDocMap.set(updated);
    setTimeout(() => this.refreshZonePreview(), 0);
  }

  setZonePageForRecipient(recipientIdx: number, pageValue: string): void {
    const page = Math.max(1, Math.floor(Number(pageValue) || 1));
    const doc_id = this.getRecipientSelectedDocId(recipientIdx);
    if (!doc_id) return;
    const key = this.zoneKey(recipientIdx, doc_id);
    const updated = new Map(this.zonePageMap());
    updated.set(key, page);
    this.zonePageMap.set(updated);

    const existing = this.sigZones().get(key);
    if (existing) {
      const updatedZ = new Map(this.sigZones());
      updatedZ.set(key, { ...existing, page_number: page });
      this.zoneScrollToTop();
      this.sigZones.set(updatedZ);
    }
    // Re-render PDF canvas for the new page
    if (this.isZonePdfPreview(recipientIdx)) {
      const docIndex = this.getRecipientDocIndex(recipientIdx);
      const docId = this.selectedDocs()[docIndex];
      if (docId && this.zoneDocBlobCache.has(docId)) {
        setTimeout(() => this.loadAndRenderZonePdf(docId, page), 0);
      }
    }
  }

  updateZoneXForRecipient(recipientIdx: number, xValue: string): void {
    const doc_id = this.getRecipientSelectedDocId(recipientIdx);
    if (!doc_id) return;
    const key = this.zoneKey(recipientIdx, doc_id);
    const current = this.sigZones().get(key);
    if (!current) return;
    const x_ratio = Math.min(Math.max(Number(xValue) / 100, 0), 1);
    const updated = new Map(this.sigZones());
    updated.set(key, { ...current, x_ratio });
    this.sigZones.set(updated);
  }

  updateZoneYForRecipient(recipientIdx: number, yValue: string): void {
    const doc_id = this.getRecipientSelectedDocId(recipientIdx);
    if (!doc_id) return;
    const key = this.zoneKey(recipientIdx, doc_id);
    const current = this.sigZones().get(key);
    if (!current) return;
    const y_ratio = Math.min(Math.max(Number(yValue) / 100, 0), 1);
    const updated = new Map(this.sigZones());
    updated.set(key, { ...current, y_ratio });
    this.sigZones.set(updated);
  }

  removeZone(recipientIdx: number): void {
    const doc_id = this.getRecipientSelectedDocId(recipientIdx);
    if (!doc_id) return;
    const key = this.zoneKey(recipientIdx, doc_id);
    const updated = new Map(this.sigZones());
    updated.delete(key);
    this.sigZones.set(updated);
  }

  saveDraft(): void {
    this.sendOnCreate = false;
    this.submit();
  }

  createAndSend(): void {
    this.sendOnCreate = true;
    this.submit();
  }

  submit(): void {
    this.submitted.set(true);
    this.error.set('');

    // Draft save is intentionally permissive: only title/circuit are required.
    // Full validation stays enforced for "Créer et envoyer".
    if (this.sendOnCreate && (this.form.invalid || this.recipientsArray.invalid || this.recipientsArray.length === 0 || this.selectedDocs().length === 0)) {
      this.form.markAllAsTouched();
      this.recipientsArray.markAllAsTouched();
      this.recipientsArray.controls.forEach(g => g.markAllAsTouched());
      return;
    }
    if (!this.sendOnCreate && (this.form.get('title')?.invalid || this.form.get('circuit_type')?.invalid)) {
      this.form.markAllAsTouched();
      return;
    }

    if (this.sendOnCreate && this.hasStrictSequentialOrderIssue()) {
      this.error.set('Pour un circuit séquentiel strict, l\'ordre doit être unique et successif (1, 2, 3...).');
      this.recipientsArray.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    const recipients = this.sendOnCreate
      ? this.normalizeRecipients()
      : this.normalizeRecipientsForDraft();

    const payload = {
      ...this.form.value,
      document_ids: this.selectedDocs(),
      attachment_ids: this.selectedAttachments(),
      recipients,
      expires_at:   this.form.value.expires_at || undefined,
    };
    if (this.sendOnCreate) {
      this.api.createAndSendEnvelope(payload).subscribe({
        next: (env) => {
          sessionStorage.setItem('envelope_flash', JSON.stringify({ type: 'success', msg: '✅ Enveloppe créée et envoyée avec succès !' }));
          this.router.navigate(['/envelopes', env.id_envelope]);
        },
        error: (err) => { this.error.set(this.extractErrorMessage(err)); this.saving.set(false); },
      });
    } else {
      this.api.createEnvelope(payload).subscribe({
        next: () => {
          sessionStorage.setItem('envelope_flash', JSON.stringify({ type: 'success', msg: '💾 Brouillon enregistré avec succès.' }));
          this.router.navigate(['/envelopes'], { queryParams: { filter: 'DRAFT' } });
        },
        error: (err) => { this.error.set(this.extractErrorMessage(err)); this.saving.set(false); },
      });
    }
  }

  cancel(): void { this.router.navigate(['/envelopes']); }

  formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  pagedDocuments(): Document[] {
    return this.getPagedDocs(this.documentsPage());
  }

  pagedAttachments(): Document[] {
    return this.getPagedDocs(this.attachmentsPage());
  }

  documentsTotalPages(): number {
    return this.getTotalPages();
  }

  attachmentsTotalPages(): number {
    return this.getTotalPages();
  }

  prevDocumentsPage(): void {
    this.documentsPage.set(Math.max(1, this.documentsPage() - 1));
  }

  nextDocumentsPage(): void {
    this.documentsPage.set(Math.min(this.documentsTotalPages(), this.documentsPage() + 1));
  }

  prevAttachmentsPage(): void {
    this.attachmentsPage.set(Math.max(1, this.attachmentsPage() - 1));
  }

  nextAttachmentsPage(): void {
    this.attachmentsPage.set(Math.min(this.attachmentsTotalPages(), this.attachmentsPage() + 1));
  }

  setDocsPerPage(value: string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const nextSize = this.pageSizeOptions.includes(parsed) ? parsed : this.pageSizeOptions[0];
    this.docsPerPage.set(nextSize);
    this.documentsPage.set(1);
    this.attachmentsPage.set(1);
    this.ensurePaginationBounds();
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
      const zones = this.getRecipientZones(i);
      const encodedZone = zones[0]
        ? {
            ...zones[0],
            // Encode selected page into y_ratio for backward-compatible persistence.
            y_ratio: (Math.max(1, zones[0].page_number || 1) - 1) + zones[0].y_ratio,
          }
        : undefined;
      const encodedZones = zones.map((zone) => ({
        ...zone,
        y_ratio: (Math.max(1, zone.page_number || 1) - 1) + zone.y_ratio,
      }));
      return {
        first_name:     (raw.first_name || '').trim() || fallbackFirst,
        last_name:      (raw.last_name  || '').trim() || fallbackLast,
        email,
        role:           raw.role,
        signing_order:  raw.signing_order,
        signature_zone: encodedZone,
        signature_zones: encodedZones,
      };
    });
  }

  private normalizeRecipientsForDraft() {
    return this.recipientsArray.controls
      .map((group, i) => {
        const raw = group.value as { first_name?: string; last_name?: string; email?: string; role?: string; signing_order?: number; };
        const email = (raw.email || '').trim().toLowerCase();
        if (!email) return null;
        if (!/^[^@]+@cgrae\.ci$/.test(email)) return null;

        const localPart = email.split('@')[0] || '';
        const parts = localPart.split(/[._-]+/).filter(Boolean);
        const fallbackFirst = parts[0] || 'Agent';
        const fallbackLast = parts.slice(1).join(' ') || 'CGRAE';
        const zones = this.getRecipientZones(i);
        const encodedZone = zones[0]
          ? {
              ...zones[0],
              y_ratio: (Math.max(1, zones[0].page_number || 1) - 1) + zones[0].y_ratio,
            }
          : undefined;
        const encodedZones = zones.map((zone) => ({
          ...zone,
          y_ratio: (Math.max(1, zone.page_number || 1) - 1) + zone.y_ratio,
        }));

        return {
          first_name: (raw.first_name || '').trim() || fallbackFirst,
          last_name: (raw.last_name || '').trim() || fallbackLast,
          email,
          role: raw.role || 'SIGNATORY',
          signing_order: Number(raw.signing_order) > 0 ? raw.signing_order : (i + 1),
          signature_zone: encodedZone,
          signature_zones: encodedZones,
        };
      })
      .filter((r): r is NonNullable<typeof r> => !!r);
  }

  private extractErrorMessage(err: any): string {
    return err?.error?.message || err?.message || 'Une erreur est survenue lors de l\'enregistrement.';
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

  private mergeDocumentLists(localDocs: Document[], serverDocs: Document[]): Document[] {
    const byId = new Map<number, Document>();

    // Keep locally uploaded docs first to avoid visual disappearance on late initial fetch.
    for (const doc of localDocs) byId.set(doc.id_document, doc);
    for (const doc of serverDocs) if (!byId.has(doc.id_document)) byId.set(doc.id_document, doc);

    return Array.from(byId.values()).sort((a, b) => {
      const aTime = new Date(a.created_at || 0).getTime();
      const bTime = new Date(b.created_at || 0).getTime();
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;
      return (b.id_document || 0) - (a.id_document || 0);
    });
  }

  private getTotalPages(): number {
    return Math.max(1, Math.ceil(this.myDocs().length / this.docsPerPage()));
  }

  private getPagedDocs(page: number): Document[] {
    const safePage = Math.min(Math.max(page, 1), this.getTotalPages());
    const pageSize = this.docsPerPage();
    const start = (safePage - 1) * pageSize;
    return this.myDocs().slice(start, start + pageSize);
  }

  private ensurePaginationBounds(): void {
    const total = this.getTotalPages();
    if (this.documentsPage() > total) this.documentsPage.set(total);
    if (this.attachmentsPage() > total) this.attachmentsPage.set(total);
  }


  private zoneScrollToTop(): void {
    const container = document.querySelector('.zdv-stage') as HTMLElement;
    if (!container) return;
    container.scrollTop = 0;
  }

    async loadAndRenderZonePdf(docId: number, page: number): Promise<void> {
      const seq = ++this.pdfRenderSeq;
      this.zonePdfRendering.set(true);
      this.cdr.detectChanges();

      try {
        const pdfjs = await import('pdfjs-dist');
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = 'assets/pdfjs/pdf.worker.min.mjs';
        }

        let pdfDoc = this.pdfDocumentCache.get(docId);
        if (!pdfDoc) {
          const blob = this.zoneDocBlobCache.get(docId);
          if (!blob) { this.zonePdfRendering.set(false); this.cdr.detectChanges(); return; }
          const ab = await blob.arrayBuffer();
          if (seq !== this.pdfRenderSeq) return;
          pdfDoc = await pdfjs.getDocument({ data: new Uint8Array(ab) }).promise;
          if (seq !== this.pdfRenderSeq) return;
          this.pdfDocumentCache.set(docId, pdfDoc);
          this.zonePdfTotalPages.set(pdfDoc.numPages);
          this.cdr.detectChanges();
        } else {
          this.zonePdfTotalPages.set(pdfDoc.numPages);
        }

        const clampedPage = Math.min(Math.max(page, 1), pdfDoc.numPages);
        const pdfPage = await pdfDoc.getPage(clampedPage);
        if (seq !== this.pdfRenderSeq) return;

        // Wait for canvas to appear in DOM (OnPush needs detectChanges)
        let canvas: HTMLCanvasElement | null = null;
        for (let i = 0; i < 15; i++) {
          if (seq !== this.pdfRenderSeq) return;
          canvas = this.pdfCanvasRef?.nativeElement ?? null;
          if (canvas) break;
          await new Promise(r => setTimeout(r, 50));
          this.cdr.detectChanges();
        }
        if (!canvas || seq !== this.pdfRenderSeq) return;

        const containerWidth = Math.max((canvas.parentElement?.clientWidth || 800) - 32, 300);
        const viewport  = pdfPage.getViewport({ scale: 1 });
        const scale     = containerWidth / viewport.width;
        const scaled    = pdfPage.getViewport({ scale });

        canvas.width  = scaled.width;
        canvas.height = scaled.height;

        const ctx = canvas.getContext('2d')!;
        if (this.zonePdfTaskRef) {
          try { this.zonePdfTaskRef.cancel(); } catch { /* ignore */ }
        }
        const task = pdfPage.render({ canvasContext: ctx, viewport: scaled });
        this.zonePdfTaskRef = task;
        await task.promise;
        if (seq !== this.pdfRenderSeq) return;

        this.zonePdfRendering.set(false);
        this.cdr.detectChanges();
      } catch (err: any) {
        if (seq !== this.pdfRenderSeq) return;
        if (err?.name === 'RenderingCancelledException') return;
        this.zonePdfRendering.set(false);
        this.zoneIframeError.set('Impossible de rendre ce PDF.');
        this.cdr.detectChanges();
      }
    }

    zonePdfPrevPage(): void {
      const current = this.getZonePage(this.zoneRecipientIdx());
      if (current <= 1) return;
      this.setZonePageForRecipient(this.zoneRecipientIdx(), String(current - 1));
    }

    zonePdfNextPage(): void {
      const current = this.getZonePage(this.zoneRecipientIdx());
      if (current >= this.zonePdfTotalPages()) return;
      this.setZonePageForRecipient(this.zoneRecipientIdx(), String(current + 1));
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

    const selectedDocIds = new Set(this.selectedDocs());

    const normalizedPages = new Map<string, number>();
    for (const [key, page] of this.zonePageMap().entries()) {
      const parsed = this.parseZoneKey(key);
      if (!parsed) continue;
      if (!selectedDocIds.has(parsed.docId)) continue;
      normalizedPages.set(key, Math.max(1, Math.floor(Number(page) || 1)));
    }
    this.zonePageMap.set(normalizedPages);

    const normalizedZones = new Map<string, { x_ratio: number; y_ratio: number; doc_id: number; page_number?: number }>();
    for (const [key, zone] of this.sigZones().entries()) {
      const parsed = this.parseZoneKey(key);
      if (!parsed) continue;
      if (!selectedDocIds.has(parsed.docId)) continue;
      normalizedZones.set(key, zone);
    }
    this.sigZones.set(normalizedZones);
  }

  private zoneKey(recipientIdx: number, docId: number): string {
    return `${recipientIdx}:${docId}`;
  }

  private parseZoneKey(key: string): { recipientIdx: number; docId: number } | null {
    const [recipientRaw, docRaw] = key.split(':');
    const recipientIdx = Number(recipientRaw);
    const docId = Number(docRaw);
    if (!Number.isFinite(recipientIdx) || !Number.isFinite(docId)) return null;
    return { recipientIdx, docId };
  }

  private getRecipientSelectedDocId(recipientIdx: number): number | null {
    const docIndex = this.getRecipientDocIndex(recipientIdx);
    const docId = this.selectedDocs()[docIndex];
    return Number.isFinite(Number(docId)) ? Number(docId) : null;
  }

  private getZoneForCurrentDoc(recipientIdx: number): { x_ratio: number; y_ratio: number; doc_id: number; page_number?: number } | null {
    const docId = this.getRecipientSelectedDocId(recipientIdx);
    if (!docId) return null;
    return this.sigZones().get(this.zoneKey(recipientIdx, docId)) || null;
  }

  private getRecipientZones(recipientIdx: number): Array<{ x_ratio: number; y_ratio: number; doc_id: number; page_number?: number }> {
    const zones: Array<{ x_ratio: number; y_ratio: number; doc_id: number; page_number?: number }> = [];
    for (const [key, zone] of this.sigZones().entries()) {
      const parsed = this.parseZoneKey(key);
      if (!parsed || parsed.recipientIdx !== recipientIdx) continue;
      zones.push(zone);
    }
    return zones;
  }

  private reindexRecipientZoneMapsAfterRecipientRemoval(removedIdx: number): void {
    const reindexedDocMap = new Map<number, number>();
    for (const [recipientIdx, docIndex] of this.zoneDocMap().entries()) {
      if (recipientIdx === removedIdx) continue;
      reindexedDocMap.set(recipientIdx > removedIdx ? recipientIdx - 1 : recipientIdx, docIndex);
    }
    this.zoneDocMap.set(reindexedDocMap);

    const reindexedPages = new Map<string, number>();
    for (const [key, page] of this.zonePageMap().entries()) {
      const parsed = this.parseZoneKey(key);
      if (!parsed || parsed.recipientIdx === removedIdx) continue;
      const targetRecipientIdx = parsed.recipientIdx > removedIdx ? parsed.recipientIdx - 1 : parsed.recipientIdx;
      reindexedPages.set(this.zoneKey(targetRecipientIdx, parsed.docId), page);
    }
    this.zonePageMap.set(reindexedPages);

    const reindexedZones = new Map<string, { x_ratio: number; y_ratio: number; doc_id: number; page_number?: number }>();
    for (const [key, zone] of this.sigZones().entries()) {
      const parsed = this.parseZoneKey(key);
      if (!parsed || parsed.recipientIdx === removedIdx) continue;
      const targetRecipientIdx = parsed.recipientIdx > removedIdx ? parsed.recipientIdx - 1 : parsed.recipientIdx;
      reindexedZones.set(this.zoneKey(targetRecipientIdx, parsed.docId), zone);
    }
    this.sigZones.set(reindexedZones);
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
      this.zonePdfTotalPages.set(1);
      this.zonePdfRendering.set(false);
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
      const isPdfNow = this.isZonePdfPreview(this.zoneRecipientIdx());
      if (this.lastZoneIframeDocId === doc.id_document) {
        const alreadyCached = isPdfNow
          ? this.pdfDocumentCache.has(doc.id_document) || this.zoneDocBlobCache.has(doc.id_document)
          : this.zonePreviewUrlCache.has(doc.id_document);
        if (alreadyCached) {
          this.zoneIframeLoading.set(false);
          this.zoneIframeError.set('');
          if (isPdfNow) {
            const page = this.getZonePage(this.zoneRecipientIdx());
            this.loadAndRenderZonePdf(doc.id_document, page);
          }
          return;
        }
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
    const isPdf = this.isZonePdfPreview(this.zoneRecipientIdx());

    // For images: reuse URL cache
    if (!isPdf && this.zonePreviewUrlCache.has(docId)) {
      return;
    }

    this.zoneIframeLoading.set(true);
    this.zoneIframeError.set('');

    const cachedBlob = this.zoneDocBlobCache.get(docId);
    if (cachedBlob) {
      if (seq !== this.zoneIframeRenderSeq) return;
      if (isPdf) {
        this.zoneIframeLoading.set(false);
        const page = this.getZonePage(this.zoneRecipientIdx());
        this.loadAndRenderZonePdf(docId, page);
      } else {
        this.setZoneIframeUrlFromBlob(docId, cachedBlob);
        this.zoneIframeLoading.set(false);
      }
      return;
    }

    this.api.getDocumentBlob(docId).subscribe({
      next: (blob) => {
        if (seq !== this.zoneIframeRenderSeq) return;
        this.zoneDocBlobCache.set(docId, blob);
        if (isPdf) {
          this.zoneIframeLoading.set(false);
          const page = this.getZonePage(this.zoneRecipientIdx());
          this.loadAndRenderZonePdf(docId, page);
        } else {
          this.setZoneIframeUrlFromBlob(docId, blob);
          this.zoneIframeLoading.set(false);
        }
      },
      error: () => {
        if (seq !== this.zoneIframeRenderSeq) return;
        this.zoneIframeLoading.set(false);
        this.zoneIframeError.set('Impossible de charger ce document.');
        this.cdr.detectChanges();
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
