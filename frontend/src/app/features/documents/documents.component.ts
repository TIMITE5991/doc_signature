import { Component, ChangeDetectionStrategy, OnInit, signal, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl, SafeHtml } from '@angular/platform-browser';
import { ApiService } from '../../core/services/api.service';
import { Document } from '../../core/models';

@Component({
  selector: 'app-documents',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="page-header">
      <div>
        <h1>Documents</h1>
        <p>Gérez vos fichiers à signer</p>
      </div>
      <label class="btn btn-primary" style="cursor:pointer">
        ＋ Ajouter
        <input type="file" hidden accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png" (change)="onFileChange($event)" />
      </label>
    </div>

    <div *ngIf="error()" class="alert alert-danger">{{ error() }}</div>
    <div *ngIf="uploading()" class="alert alert-info">⏳ Upload en cours...</div>

    <div class="card" style="padding:12px 16px;margin-bottom:12px" *ngIf="!loading()">
      <div class="d-flex gap-1 align-center">
        <button class="btn btn-sm" [class.btn-primary]="viewMode() === 'active'" [class.btn-outline]="viewMode() !== 'active'"
          (click)="viewMode.set('active')">
          GED active
        </button>
        <button class="btn btn-sm" [class.btn-primary]="viewMode() === 'archived'" [class.btn-outline]="viewMode() !== 'archived'"
          (click)="viewMode.set('archived')">
          Archives
        </button>
      </div>
    </div>

    <div class="loading-center" *ngIf="loading()"><div class="spinner"></div></div>

    <div class="card" *ngIf="!loading()">
      <div class="empty-state" *ngIf="filteredDocuments().length === 0">
        <div class="icon">📂</div>
        <p *ngIf="viewMode() === 'active'">Aucun document actif</p>
        <p *ngIf="viewMode() === 'archived'">Aucun document archivé</p>
        <p style="font-size:12px;margin-top:6px">Formats acceptés : PDF, DOCX, XLSX, JPG, PNG</p>
      </div>

      <div class="table-wrapper" *ngIf="filteredDocuments().length > 0">
        <table class="data-table">
          <thead>
            <tr>
              <th>Nom du fichier</th>
              <th>Type</th>
              <th>Taille</th>
              <th>Version</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let doc of filteredDocuments()">
              <td>
                <span style="font-weight:500">{{ doc.original_name }}</span>
                <span *ngIf="doc.source_type === 'RECEIVED'" class="badge badge-warning" style="margin-left:8px">Reçu signé</span>
              </td>
              <td><span class="badge badge-sent">{{ mimeLabel(doc.mime_type) }}</span></td>
              <td style="color:var(--text-muted);font-size:13px">{{ formatSize(doc.size) }}</td>
              <td style="color:var(--text-muted);font-size:13px">v{{ doc.version }}</td>
              <td style="color:var(--text-muted);font-size:13px">{{ doc.created_at | date:'dd/MM/yyyy' }}</td>
              <td>
                <button class="btn-icon" title="Visualiser" (click)="openViewer(doc)">👁</button>
                <button class="btn-icon" title="Archiver" *ngIf="!doc.is_archived" (click)="archive(doc)">🗃️</button>
                <button class="btn-icon" title="Désarchiver" *ngIf="doc.is_archived" (click)="unarchive(doc)">📤</button>
                <button class="btn-icon" title="Supprimer" (click)="remove(doc)">🗑️</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- === VIEWER MODAL === -->
    <div class="viewer-overlay" *ngIf="viewingDoc()" (click)="closeViewer()">
      <div class="viewer-modal" (click)="$event.stopPropagation()">
        <div class="viewer-header">
          <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">
            <span class="viewer-title">{{ viewingDoc()?.original_name }}</span>
            <span class="doc-type-badge" *ngIf="viewingDoc()">
              <span *ngIf="isPdfViewing()">📑 PDF</span>
              <span *ngIf="isImageViewing()">🖼️ Image</span>
              <span *ngIf="isDocxViewing()">📝 Word</span>
              <span *ngIf="isXlsxViewing()">📊 Excel</span>
            </span>
          </div>
          <!-- Viewer controls -->
          <div class="viewer-controls" *ngIf="!viewerLoading() && (isPdfViewing() || isImageViewing())">
            <button type="button" class="btn btn-outline btn-sm" (click)="viewerZoomOut()" [disabled]="viewerZoom() <= 50">🔍−</button>
            <span style="font-size:12px;font-weight:600;min-width:40px;text-align:center">{{ viewerZoom() }}%</span>
            <button type="button" class="btn btn-outline btn-sm" (click)="viewerZoomIn()" [disabled]="viewerZoom() >= 300">🔍+</button>
            <button type="button" class="btn btn-outline btn-sm" (click)="viewerResetZoom()" title="Réinitialiser">↺</button>
          </div>
          <div class="d-flex gap-1 align-center">
            <a [href]="api.getDocumentViewUrl(viewingDoc()!.id_document)" target="_blank"
               rel="noopener" class="btn btn-outline btn-sm" title="Télécharger">⬇</a>
            <button class="btn btn-outline btn-sm" (click)="closeViewer()" title="Fermer">✕</button>
          </div>
        </div>
        <div class="viewer-body">
          <div class="loading-center" *ngIf="viewerLoading()"><div class="spinner"></div></div>

          <!-- PDF -->
          <div *ngIf="!viewerLoading() && isPdfViewing()" class="doc-wrapper pdf-wrapper"
            [style.transform]="'scale(' + (viewerZoom() / 100) + ') translate(' + viewerPanX() + 'px, ' + viewerPanY() + 'px)'"
            (wheel)="onViewerWheel($event)"
            (scroll)="onViewerContainerScroll($event)">
            <iframe [src]="viewerSafeUrl()!" class="viewer-iframe" title="Visionneuse PDF"></iframe>
          </div>

          <!-- Image -->
          <div *ngIf="!viewerLoading() && isImageViewing()" class="doc-wrapper img-wrapper"
            [style.transform]="'scale(' + (viewerZoom() / 100) + ') translate(' + viewerPanX() + 'px, ' + viewerPanY() + 'px)'"
            (wheel)="onViewerWheel($event)"
            (scroll)="onViewerContainerScroll($event)">
            <img [src]="viewerBlobUrl()" [alt]="viewingDoc()?.original_name" class="viewer-img" />
          </div>

          <!-- DOCX -->
          <div *ngIf="!viewerLoading() && isDocxViewing()" class="doc-wrapper docx-wrap">
            <div #docxContainer class="docx-inner"></div>
          </div>

          <!-- XLSX -->
          <div *ngIf="!viewerLoading() && isXlsxViewing()" class="doc-wrapper xlsx-wrap"
               [innerHTML]="xlsxHtml()"></div>

          <!-- Unsupported -->
          <div *ngIf="!viewerLoading() && !isPdfViewing() && !isImageViewing() && !isDocxViewing() && !isXlsxViewing()" class="unsupported-wrap">
            <p>📎 Ce type de fichier ne peut pas être affiché.</p>
            <a [href]="api.getDocumentViewUrl(viewingDoc()!.id_document)" target="_blank"
               rel="noopener" class="btn btn-primary">⬇ Télécharger</a>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .viewer-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.65);
      display: flex; align-items: center; justify-content: center;
      z-index: 2000; padding: 16px;
    }
    .viewer-modal {
      background: #fff; border-radius: 12px; width: 100%; max-width: 960px;
      max-height: 90vh; display: flex; flex-direction: column;
      box-shadow: 0 24px 80px rgba(0,0,0,0.4); overflow: hidden;
    }
    .viewer-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0;
      position: relative;
    }
    .doc-type-badge {
      position: absolute; top: 50%; right: 72px; transform: translateY(-50%);
      background: #f0f2f5; color: #1a1a1a; padding: 4px 10px;
      border-radius: 16px; font-size: 12px; font-weight: 500;
    }
    .viewer-controls {
      display: flex; align-items: center; gap: 8px; flex-shrink: 0;
    }
    .viewer-controls button {
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border: 1px solid var(--border);
      background: #fff; border-radius: 6px; cursor: pointer;
      font-size: 12px; font-weight: 500; color: var(--text-primary);
      transition: all 0.2s ease;
    }
    .viewer-controls button:hover {
      background: #f5f5f5; border-color: var(--text-muted);
    }
    .zoom-display {
      display: flex; align-items: center; justify-content: center;
      width: 50px; height: 32px; font-size: 12px; font-weight: 500;
      color: var(--text-secondary);
    }
    .viewer-title {
      font-weight: 600; font-size: 14px; color: var(--text-primary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      max-width: 40%;
    }
    .viewer-body {
      flex: 1; overflow: auto; min-height: 0;
      display: flex; align-items: center; justify-content: center;
    }
    .doc-wrapper {
      display: flex; align-items: center; justify-content: center;
      width: 100%; min-height: 100%;
      transform-origin: 0 0;
      transition: transform 0.1s ease-out;
    }
    .pdf-wrapper {
      background: #f0f0f0; padding: 24px; display: flex;
      align-items: center; justify-content: center;
    }
    .img-wrapper {
      background: #f5f5f5; padding: 24px; display: flex;
      align-items: center; justify-content: center;
    }
    .docx-wrap {
      background: #fff; padding: 0; width: 100%;
    }
    .docx-inner {
      padding: 32px; line-height: 1.6;
    }
    .xlsx-wrap {
      background: #fff; padding: 16px; overflow: auto;
      max-height: 100%;
      table { border-collapse: collapse; font-size: 13px; }
      td, th { border: 1px solid #ddd; padding: 6px 10px; }
      tr:nth-child(even) { background: #f9f9f9; }
    }
    .viewer-iframe {
      width: 100%; height: 100%; border: none; display: block;
    }
    .img-viewer-wrap {
      display: flex; align-items: center; justify-content: center;
      width: 100%; height: 100%; padding: 0;
    }
    .viewer-img {
      max-width: 100%; max-height: 100%;
      object-fit: contain; border-radius: 4px;
    }
    .loading-msg {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 16px; padding: 48px;
      color: var(--text-muted);
    }
    .loading-spinner {
      width: 40px; height: 40px; border: 3px solid #e0e0e0;
      border-top-color: var(--primary); border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .error-msg {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 16px; padding: 48px;
      color: #d32f2f; text-align: center;
    }
    .unsupported-wrap {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 16px; padding: 48px;
      color: var(--text-muted);
    }
  `],
})
export class DocumentsComponent implements OnInit {
  loading   = signal(true);
  uploading = signal(false);
  documents = signal<Document[]>([]);
  viewMode  = signal<'active' | 'archived'>('active');
  error     = signal('');

  // Viewer state
  viewingDoc    = signal<Document | null>(null);
  viewerLoading = signal(false);
  viewerBlobUrl = signal<string>('');
  viewerSafeUrl = signal<SafeResourceUrl | null>(null);
  xlsxHtml      = signal<SafeHtml | null>(null);
  // Viewer controls (zoom/pan)
  viewerZoom    = signal(100);
  viewerPanX    = signal(0);
  viewerPanY    = signal(0);
  viewerPanning = signal(false);
  viewerScrollY = signal(0);
  viewerHeight  = signal(0);
  @ViewChild('docxContainer') docxContainerRef?: ElementRef<HTMLDivElement>;
  @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;

  constructor(private api: ApiService, private sanitizer: DomSanitizer, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void { this.load(); }

  // ── Viewer ────────────────────────────────────────────────
  openViewer(doc: Document): void {
    this.viewingDoc.set(doc);
    this.viewerBlobUrl.set('');
    this.viewerSafeUrl.set(null);
    this.xlsxHtml.set(null);
    this.viewerLoading.set(true);

    this.api.getDocumentBlob(doc.id_document).subscribe({
      next: async (blob) => {
        const mime = doc.mime_type;
        if (mime === 'application/pdf' || mime.startsWith('image/')) {
          const url = URL.createObjectURL(blob);
          this.viewerBlobUrl.set(url);
          this.viewerSafeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
          this.viewerLoading.set(false);
        } else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          this.viewerLoading.set(false);
          this.cdr.detectChanges();
          // Retry jusqu'à 5 fois si le container n'est pas encore dans le DOM
          const getContainer = async () => {
            for (let i = 0; i < 5; i++) {
              const c = this.docxContainerRef?.nativeElement;
              if (c) return c;
              await new Promise(r => setTimeout(r, 100));
            }
            return null;
          };
          const container = await getContainer();
          if (!container) return;
          container.innerHTML = '<p style="padding:12px;color:#64748b">Chargement DOCX...</p>';
          try {
            const ab = await blob.arrayBuffer();
            const mod: any = await import('docx-preview');
            container.innerHTML = '';
            await mod.renderAsync(ab, container, undefined, { inWrapper: true });
          } catch {
            container.innerHTML = '<p style="color:#b91c1c;padding:12px">Impossible d\'afficher ce DOCX.</p>';
          }
        } else if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
          try {
            const ab = await blob.arrayBuffer();
            const XLSX = await import('xlsx');
            const wb = XLSX.read(ab, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const html = XLSX.utils.sheet_to_html(ws);
            this.xlsxHtml.set(this.sanitizer.bypassSecurityTrustHtml(html));
          } catch {
            this.xlsxHtml.set(this.sanitizer.bypassSecurityTrustHtml('<p style="color:#b91c1c">Impossible d\'afficher ce fichier XLSX.</p>'));
          }
          this.viewerLoading.set(false);
        } else {
          this.viewerLoading.set(false);
        }
      },
      error: () => {
        this.viewerLoading.set(false);
      },
    });
  }

  closeViewer(): void {
    const url = this.viewerBlobUrl();
    if (url) URL.revokeObjectURL(url);
    this.viewingDoc.set(null);
    this.viewerZoom.set(100);
    this.viewerPanX.set(0);
    this.viewerPanY.set(0);
    this.viewerPanning.set(false);
    this.viewerScrollY.set(0);
  }

  isPdfViewing():        boolean { return this.viewingDoc()?.mime_type === 'application/pdf'; }
  isImageViewing():     boolean { return (this.viewingDoc()?.mime_type || '').startsWith('image/'); }
  isDocxViewing():      boolean { return this.viewingDoc()?.mime_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }
  isXlsxViewing():      boolean { return this.viewingDoc()?.mime_type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; }
  isUnsupportedViewing(): boolean {
    return !this.isPdfViewing() && !this.isImageViewing() && !this.isDocxViewing() && !this.isXlsxViewing();
  }


  load(): void {
    this.loading.set(true);
    this.api.getDocuments().subscribe({
      next: (docs) => { this.documents.set(docs); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploading.set(true);
    this.error.set('');
    this.api.uploadDocument(file).subscribe({
      next: (doc) => {
        this.documents.update(list => [doc, ...list]);
        this.uploading.set(false);
        // Reset input file
        input.value = '';
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.error.set(err?.error?.message || err.message || 'Erreur lors du téléchargement');
        this.uploading.set(false);
        // Reset input file even on error
        input.value = '';
        this.cdr.detectChanges();
      },
      complete: () => {
        this.uploading.set(false);
      },
    });
  }

  remove(doc: Document): void {
    if (!confirm(`Supprimer "${doc.original_name}" ?`)) return;
    this.api.deleteDocument(doc.id_document).subscribe({
      next: () => this.documents.update(list => list.filter(d => d.id_document !== doc.id_document)),
      error: (err) => this.error.set(err.message),
    });
  }

  archive(doc: Document): void {
    this.api.archiveDocument(doc.id_document).subscribe({
      next: (updated) => this.documents.update(list => list.map(d => d.id_document === updated.id_document ? updated : d)),
      error: (err) => this.error.set(err.message),
    });
  }

  unarchive(doc: Document): void {
    this.api.unarchiveDocument(doc.id_document).subscribe({
      next: (updated) => this.documents.update(list => list.map(d => d.id_document === updated.id_document ? updated : d)),
      error: (err) => this.error.set(err.message),
    });
  }

  filteredDocuments(): Document[] {
    const archived = this.viewMode() === 'archived';
    return this.documents().filter((doc) => !!doc.is_archived === archived);
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  mimeLabel(mime: string): string {
    const map: Record<string, string> = {
      'application/pdf': 'PDF',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
      'image/jpeg': 'JPEG',
      'image/png': 'PNG',
    };
    return map[mime] || mime;
  }

  // ── Viewer zoom/pan controls ──────────────────────────────
  viewerZoomIn(): void { this.viewerZoom.update(z => Math.min(z + 25, 300)); }
  viewerZoomOut(): void { this.viewerZoom.update(z => Math.max(z - 25, 50)); }
  viewerResetZoom(): void { this.viewerZoom.set(100); this.viewerPanX.set(0); this.viewerPanY.set(0); }
  
  onViewerWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -25 : 25;
    this.viewerZoom.update(z => Math.min(Math.max(z + delta, 50), 300));
  }

  onViewerPan(event: PointerEvent, container: HTMLElement): void {
    if (!this.viewerPanning()) {
      this.viewerPanning.set(true);
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      return;
    }
  }

  onViewerPointerMove(event: PointerEvent, container: HTMLElement): void {
    if (!this.viewerPanning()) return;
    const deltaX = event.clientX - (this.lastPointerX || 0);
    const deltaY = event.clientY - (this.lastPointerY || 0);
    this.viewerPanX.update(x => x + deltaX);
    this.viewerPanY.update(y => y + deltaY);
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
  }

  onViewerPointerUp(): void { this.viewerPanning.set(false); }

  onViewerContainerScroll(event: Event): void {
    const container = event.target as HTMLElement;
    this.viewerScrollY.set(container.scrollTop);
    this.viewerHeight.set(container.clientHeight);
  }

  private lastPointerX = 0;
  private lastPointerY = 0;
}
