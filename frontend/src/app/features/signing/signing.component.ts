import { Component, ChangeDetectionStrategy, OnInit, signal, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeResourceUrl, SafeHtml } from '@angular/platform-browser';
import { ApiService } from '../../core/services/api.service';
import { Envelope, Recipient } from '../../core/models';

type Step = 'loading' | 'already-signed' | 'sign' | 'reject' | 'delegate' | 'return' | 'forward' | 'done' | 'error';

@Component({
  selector: 'app-signing',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  template: `
    <div class="signing-page">
      <div class="signing-header">
        <div class="brand-logo">CS</div>
        <div>
          <h1>CGRAE <span>Signature</span></h1>
          <p>Plateforme de Signature Électronique</p>
        </div>
      </div>

      <!-- Loading -->
      <div class="signing-card" *ngIf="step() === 'loading'">
        <div class="loading-center"><div class="spinner"></div></div>
        <p class="text-center text-muted mt-2">Chargement du document...</p>
      </div>

      <!-- Error -->
      <div class="signing-card" *ngIf="step() === 'error'">
        <div class="icon-big">⚠️</div>
        <h2>{{ errorTitle() }}</h2>
        <p>{{ errorDetail() }}</p>
      </div>

      <!-- Already signed -->
      <div class="signing-card success-card" *ngIf="step() === 'already-signed'">
        <div class="icon-big">✅</div>
        <h2>Déjà signé</h2>
        <p>Vous avez déjà signé ce document. Merci !</p>
        <div class="mt-2" style="display:flex;justify-content:center">
          <button type="button" class="btn btn-outline" (click)="goBackToViewer()">
            ← Voir le document
          </button>
        </div>
      </div>

      <!-- Done -->
      <div class="signing-card success-card" *ngIf="step() === 'done'">
        <div class="icon-big">🎉</div>
        <h2 *ngIf="doneMessage() === 'signed'">Document signé avec succès !</h2>
        <h2 *ngIf="doneMessage() === 'rejected'">Document rejeté</h2>
        <h2 *ngIf="doneMessage() === 'delegated'">Signature déléguée</h2>
        <h2 *ngIf="doneMessage() === 'returned'">Retour pour corrections envoyé</h2>
        <h2 *ngIf="doneMessage() === 'forwarded'">Document renvoyé à un nouveau destinataire</h2>
        <p *ngIf="doneMessage() !== 'returned'">L'émetteur du document a été notifié par email.</p>
        <p *ngIf="doneMessage() === 'returned'">L'émetteur a été notifié par email et va procéder aux corrections demandées.</p>
        <div class="mt-2" style="display:flex;flex-direction:column;gap:10px;align-items:center">
          <button type="button" class="btn btn-primary" (click)="step.set('forward')" *ngIf="doneMessage() === 'signed'">
            🔁 Renvoyer à un destinataire
          </button>
          <button type="button" class="btn btn-outline" (click)="goBackToViewer()">
            ← Retour
          </button>
        </div>
      </div>

      <!-- Sign step : layout 2 colonnes viewer + actions -->
      <div class="sign-layout" *ngIf="step() === 'sign' && envelope() && recipient()">

        <!-- LEFT : visualiseur de document -->
        <div class="viewer-panel">
          <div class="viewer-header">
            <span>📄 {{ displayDocName(activeDoc()?.original_name || 'Document') }}</span>
            <div class="doc-tabs" *ngIf="envelope()!.documents.length > 1">
              <button *ngFor="let doc of envelope()!.documents; let i = index"
                [class.active]="activeDocIndex() === i"
                (click)="selectDoc(i)" class="tab-btn">
                Doc {{ i + 1 }}
              </button>
            </div>
          </div>

          <!-- PDF viewer intégré -->
          <iframe *ngIf="activeDocUrl() && isPdf()"
            [src]="activeDocUrl()!"
            class="doc-iframe"
            title="Visualiseur de document">
          </iframe>

          <!-- Image viewer -->
          <div *ngIf="activeDocUrl() && isImage()" class="img-viewer">
            <img [src]="rawDocUrl()" alt="Document" />
          </div>

          <!-- DOCX viewer natif -->
          <div *ngIf="isDocx()" class="docx-viewer">
            <div #docxContainer class="docx-container"></div>
          </div>

          <!-- XLSX viewer via SheetJS -->
          <div *ngIf="isXlsx()" class="xlsx-viewer">
            <div *ngIf="xlsxLoading()" style="padding:24px;color:#64748b">Chargement du fichier Excel...</div>
            <div *ngIf="!xlsxLoading() && xlsxHtml()" [innerHTML]="xlsxHtml()" class="xlsx-table-wrap"></div>
            <div *ngIf="!xlsxLoading() && !xlsxHtml()" class="no-doc">
              <p>Impossible d'afficher ce fichier XLSX.</p>
              <a class="btn btn-outline btn-sm" [href]="rawDocUrl()" target="_blank" rel="noopener">Télécharger le document</a>
            </div>
          </div>

          <!-- Autres formats non supportés -->
          <div class="no-doc" *ngIf="activeDocUrl() && !isPdf() && !isImage() && !isDocx() && !isXlsx()">
            <p>Ce format ne peut pas être prévisualisé.</p>
            <a class="btn btn-outline btn-sm" [href]="rawDocUrl()" target="_blank" rel="noopener">Télécharger le document</a>
          </div>

          <!-- Aucun document -->
          <div class="no-doc" *ngIf="!activeDocUrl()">
            <p>Aucun document attaché à cette enveloppe.</p>
          </div>

          <div class="zone-overlay" *ngIf="activeDocUrl() && (isPdf() || isImage() || isDocx())"
            (click)="onViewerZoneClick($event)"
            (pointermove)="onOverlayPointerMove($event)"
            (pointerup)="onOverlayPointerUp()"
            (pointerleave)="onOverlayPointerUp()">
            <div class="zone-hint-label">
              {{ zoneTarget() === 'stamp' ? '🏷 Cliquez pour placer le cachet' : '📍 Cliquez pour positionner votre signature' }}
            </div>
            <!-- Marqueur signature -->
            <div class="zone-marker sig-zone-marker"
              [style.left.%]="(signatureZone()?.x ?? 0.82) * 100"
              [style.top.%]="(signatureZone()?.y ?? 0.88) * 100"
              (pointerdown)="startDragMarker('signature', $event)">
              <span class="zone-marker-label">✍ Signature</span>
            </div>
            <!-- Marqueur cachet (si activé) -->
            <div class="zone-marker stamp-zone-marker" *ngIf="useStamp()"
              [style.left.%]="stampZone().x * 100"
              [style.top.%]="stampZone().y * 100"
              (pointerdown)="startDragMarker('stamp', $event)">
              <span class="zone-marker-label">🏷 Cachet</span>
            </div>
          </div>
        </div>

        <!-- RIGHT : infos + signature + actions -->
        <div class="action-panel">
          <!-- Info enveloppe -->
          <div class="env-info-block">
            <h2>{{ envelope()!.title }}</h2>
            <p class="from-label">De : <strong>{{ envelope()!.creator_name }}</strong></p>
            <p *ngIf="envelope()!.message" class="doc-message">"{{ envelope()!.message }}"</p>
            <div class="recipient-badge">
              👤 <strong>{{ recipient()!.first_name }} {{ recipient()!.last_name }}</strong>
              &nbsp;·&nbsp; {{ roleLabel(recipient()!.role) }}
            </div>
          </div>

          <!-- Commentaire (facultatif) -->
          <div class="comment-section">
            <label class="field-label">💬 Commentaire <span class="optional">(facultatif)</span></label>
            <textarea [(ngModel)]="sigComment" [ngModelOptions]="{standalone: true}"
              rows="3"
              placeholder="Ajoutez un commentaire visible par l'émetteur..."
              style="width:100%;resize:vertical;font-size:13px;">
            </textarea>
          </div>

          <!-- Pad de signature -->
          <div class="sig-section" *ngIf="recipient()!.role === 'SIGNATORY' || recipient()!.role === 'APPROVER'">
            <div class="sig-header">
              <span class="field-label">✍️ Votre signature</span>
              <button type="button" class="btn btn-outline btn-sm" *ngIf="signatureMode() === 'draw'" (click)="clearCanvas()">🗑 Effacer</button>
              <button type="button" class="btn btn-outline btn-sm" *ngIf="signatureMode() === 'upload'" (click)="clearUploadedSignature()">🗑 Retirer</button>
            </div>
            <p class="hint-text" style="margin-bottom:4px;">📍 Cliquez sur le document (gauche) pour repositionner la zone de signature.</p>

            <div class="sig-mode-switch">
              <button type="button" class="btn btn-outline btn-sm" [class.active]="signatureMode() === 'draw'" (click)="setSignatureMode('draw')">✍️ Dessiner (stylet/souris)</button>
              <button type="button" class="btn btn-outline btn-sm" [class.active]="signatureMode() === 'upload'" (click)="setSignatureMode('upload')">📂 Télécharger image</button>
              <button type="button" class="btn btn-outline btn-sm" *ngIf="recipient()?.has_signature" (click)="useStoredSignature()">✍️ Ma signature</button>
            </div>

            <div class="position-controls">
              <label>Position signature X: {{ sigXPercent() }}%</label>
              <input type="range" min="0" max="100" [value]="sigXPercent()" (input)="updateSigX($any($event.target).value)">
              <label>Position signature Y: {{ sigYPercent() }}%</label>
              <input type="range" min="0" max="100" [value]="sigYPercent()" (input)="updateSigY($any($event.target).value)">
            </div>

          <!-- Section cachet -->
          <div class="stamp-section" *ngIf="recipient()!.role === 'SIGNATORY' || recipient()!.role === 'APPROVER'">
            <div class="stamp-toggle-row">
              <label class="stamp-toggle-label">
                <input type="checkbox" [checked]="useStamp()" (change)="toggleStamp($event)">
                <span>🏷 Apposer mon cachet officiel</span>
              </label>
              <span class="badge badge-success stamp-badge" *ngIf="hasStoredStamp()">✔ Cachet enregistré</span>
            </div>

            <div *ngIf="useStamp()" class="stamp-content">
              <div class="stamp-actions-row" *ngIf="hasStoredStamp()">
                <button type="button" class="btn btn-outline btn-sm" (click)="useStoredStamp()">🏷 Mon cachet</button>
              </div>

              <!-- Aperçu cachet existant -->
              <div *ngIf="hasStoredStamp() && !uploadedStampPreview()" class="stamp-existing">
                <img [src]="api.getPublicStampUrl(token)" alt="Cachet" class="stamp-img-preview">
                <button type="button" class="btn btn-outline btn-sm" (click)="clearStamp()">🔄 Changer</button>
              </div>

              <!-- Upload cachet -->
              <div *ngIf="!hasStoredStamp() || uploadedStampPreview()" class="stamp-upload">
                <div *ngIf="uploadedStampPreview()" class="stamp-existing">
                  <img [src]="uploadedStampPreview()!" alt="Cachet" class="stamp-img-preview">
                  <button type="button" class="btn btn-outline btn-sm" (click)="clearStamp()">🔄 Autre</button>
                </div>
                <label class="btn btn-outline btn-sm" style="cursor:pointer;margin:0" *ngIf="!uploadedStampPreview()">
                  📂 Charger mon cachet
                  <input type="file" accept="image/png,image/jpeg" style="display:none"
                    (change)="onStampFileChange($event)">
                </label>
                <p class="hint-text" *ngIf="!uploadedStampPreview()">PNG avec fond transparent recommandé.</p>
              </div>

              <!-- Bouton repositionner cachet -->
              <button type="button" class="btn btn-outline btn-sm stamp-reposition"
                [class.active]="zoneTarget() === 'stamp'"
                (click)="activateStampZonePicker()">
                {{ zoneTarget() === 'stamp' ? '🏷 Cliquez sur le document...' : '📍 Repositionner le cachet' }}
              </button>

              <div class="position-controls" *ngIf="useStamp()">
                <label>Position cachet X: {{ stampXPercent() }}%</label>
                <input type="range" min="0" max="100" [value]="stampXPercent()" (input)="updateStampX($any($event.target).value)">
                <label>Position cachet Y: {{ stampYPercent() }}%</label>
                <input type="range" min="0" max="100" [value]="stampYPercent()" (input)="updateStampY($any($event.target).value)">
              </div>
            </div>
          </div>
            <canvas *ngIf="signatureMode() === 'draw'" #sigCanvas width="600" height="140"
              style="width:100%;height:140px;border:2px dashed #0a7c4e;border-radius:8px;cursor:crosshair;touch-action:none;background:#f9fffe;display:block;"
              (pointerdown)="startDraw($event)"
              (pointermove)="draw($event)"
              (pointerup)="endDraw()"
              (pointerleave)="endDraw()">
            </canvas>

            <div *ngIf="signatureMode() === 'upload'" class="sig-upload-box">
              <label class="btn btn-outline btn-sm" style="cursor:pointer;margin:0">
                📂 Choisir un fichier signature
                <input type="file" accept="image/png,image/jpeg" style="display:none" (change)="onSignatureFileChange($event)">
              </label>
              <img *ngIf="uploadedSignaturePreview()" [src]="uploadedSignaturePreview()!" alt="Signature importée" class="sig-upload-preview" />
            </div>

            <p class="hint-text">Compatible stylet, souris et tactile.</p>
            <div class="error-msg" *ngIf="sigError()">{{ signatureMode() === 'upload' ? 'Veuillez importer une image de signature.' : 'Veuillez tracer votre signature avant de signer.' }}</div>
          </div>

          <div class="error-msg" *ngIf="signErrorMessage()" style="background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;padding:8px 10px;border-radius:6px;">
            {{ signErrorMessage() }}
          </div>

          <!-- Actions -->
          <div class="signing-actions">
            <button class="btn btn-success btn-lg" (click)="sign()" [disabled]="processing()">
              ✍️ {{ processing() ? 'Traitement...' : 'Confirmer la signature' }}
            </button>
            <button class="btn btn-return" (click)="step.set('return')" [disabled]="processing()">
              ↩️ Retour pour corrections
            </button>
            <button class="btn btn-outline" (click)="step.set('reject')" [disabled]="processing()">
              ❌ Rejeter le document
            </button>
            <button class="btn btn-outline" (click)="step.set('delegate')" [disabled]="processing()"
              *ngIf="recipient()!.role === 'DELEGATOR' || recipient()!.role === 'SIGNATORY'">
              🔀 Déléguer
            </button>
          </div>
        </div>
      </div>

      <!-- Return for corrections form -->
      <div class="signing-card" *ngIf="step() === 'return'">
        <div class="icon-big">↩️</div>
        <h2>Retour pour corrections</h2>
        <p>Précisez les corrections à apporter avant de signer :</p>
        <form [formGroup]="returnForm" (ngSubmit)="returnForCorrection()">
          <div class="form-group mt-2">
            <label>Corrections demandées *</label>
            <textarea formControlName="reason" rows="5"
              placeholder="Ex : Les montants page 3 ne correspondent pas au budget approuvé. Merci de corriger avant signature."></textarea>
          </div>
          <div class="d-flex gap-1 mt-2">
            <button type="button" class="btn btn-outline" (click)="step.set('sign')" [disabled]="processing()">← Retour</button>
            <button type="submit" class="btn btn-return" [disabled]="returnForm.invalid || processing()">
              {{ processing() ? 'Envoi...' : '↩️ Envoyer la demande de correction' }}
            </button>
          </div>
        </form>
      </div>

      <!-- Reject form -->
      <div class="signing-card" *ngIf="step() === 'reject'">
        <div class="icon-big">❌</div>
        <h2>Rejeter le document</h2>
        <p>Veuillez indiquer le motif du rejet :</p>
        <form [formGroup]="rejectForm" (ngSubmit)="reject()">
          <div class="form-group mt-2">
            <label>Motif *</label>
            <textarea formControlName="reason" rows="4" placeholder="Expliquez pourquoi vous rejetez ce document..."></textarea>
          </div>
          <div class="d-flex gap-1 mt-2">
            <button type="button" class="btn btn-outline" (click)="step.set('sign')">Retour</button>
            <button type="submit" class="btn btn-danger" [disabled]="rejectForm.invalid || processing()">
              Confirmer le rejet
            </button>
          </div>
        </form>
      </div>

      <!-- Delegate form -->
      <div class="signing-card" *ngIf="step() === 'delegate'">
        <div class="icon-big">🔀</div>
        <h2>Déléguer la signature</h2>
        <p>Saisissez les coordonnées du délégué :</p>
        <form [formGroup]="delegateForm" (ngSubmit)="delegate()">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group mt-2">
              <label>Prénom *</label>
              <input type="text" formControlName="delegate_first_name" />
            </div>
            <div class="form-group mt-2">
              <label>Nom *</label>
              <input type="text" formControlName="delegate_last_name" />
            </div>
          </div>
          <div class="form-group">
            <label>Email &#64;cgrae.ci *</label>
            <input type="email" formControlName="delegate_email" placeholder="delegue&#64;cgrae.ci" />
            <span class="error-msg" *ngIf="delegateForm.get('delegate_email')?.touched && delegateForm.get('delegate_email')?.errors">
              Email &#64;cgrae.ci requis
            </span>
          </div>
          <div class="d-flex gap-1 mt-2">
            <button type="button" class="btn btn-outline" (click)="step.set('sign')">Retour</button>
            <button type="submit" class="btn btn-primary" [disabled]="delegateForm.invalid || processing()">
              Déléguer
            </button>
          </div>
        </form>
      </div>

      <!-- Forward after sign form -->
      <div class="signing-card" *ngIf="step() === 'forward'">
        <div class="icon-big">🔁</div>
        <h2>Renvoyer à un destinataire</h2>
        <p>Le nouveau destinataire recevra le même lien de réception/signature.</p>
        <form [formGroup]="forwardForm" (ngSubmit)="forwardAfterSign()">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group mt-2">
              <label>Prénom *</label>
              <input type="text" formControlName="forward_first_name" />
            </div>
            <div class="form-group mt-2">
              <label>Nom *</label>
              <input type="text" formControlName="forward_last_name" />
            </div>
          </div>
          <div class="form-group">
            <label>Email &#64;cgrae.ci *</label>
            <input type="email" formControlName="forward_email" placeholder="nouveau.destinataire&#64;cgrae.ci" />
            <span class="error-msg" *ngIf="forwardForm.get('forward_email')?.touched && forwardForm.get('forward_email')?.errors">
              Email &#64;cgrae.ci requis
            </span>
          </div>
          <div class="d-flex gap-1 mt-2">
            <button type="button" class="btn btn-outline" (click)="step.set('done')" [disabled]="processing()">Retour</button>
            <button type="submit" class="btn btn-primary" [disabled]="forwardForm.invalid || processing()">
              {{ processing() ? 'Envoi...' : '🔁 Renvoyer maintenant' }}
            </button>
          </div>
        </form>
      </div>

      <div class="signing-footer">
        © {{ year }} CGRAE — Caisse Générale de Retraite des Agents de l'État
      </div>
    </div>
  `,
  styles: [`
    .signing-page {
      min-height: 100vh; display: flex; flex-direction: column; align-items: center;
      background: linear-gradient(135deg, #065c39 0%, #0a7c4e 60%, #12a867 100%);
      padding: 24px 16px;
    }
    .signing-header {
      display: flex; align-items: center; gap: 16px; color: #fff; margin-bottom: 24px; width: 100%; max-width: 1200px;
      .brand-logo { width: 48px; height: 48px; background: #fff; border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        font-weight: 900; font-size: 16px; color: #0a7c4e; flex-shrink: 0; }
      h1 { font-size: 20px; font-weight: 700; margin: 0; span { color: #fff; } }
      p  { color: rgba(255,255,255,0.75); font-size: 12px; margin: 0; }
    }

    /* 2-column layout */
    .sign-layout {
      display: grid; grid-template-columns: 1fr 380px; gap: 20px;
      width: 100%; max-width: 1200px; align-items: start;
    }
    @media (max-width: 900px) {
      .sign-layout { grid-template-columns: 1fr; }
    }

    /* Viewer panel */
    .viewer-panel {
      background: #fff; border-radius: 12px; overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      display: flex; flex-direction: column; position: relative;
    }
    .viewer-header {
      display: flex; align-items: center; justify-content: space-between;
      background: #f4f6f8; padding: 10px 16px; font-size: 13px; font-weight: 600;
      color: var(--text-secondary); border-bottom: 1px solid var(--border);
    }
    .doc-tabs { display: flex; gap: 4px; }
    .tab-btn {
      padding: 4px 10px; border-radius: 4px; border: 1px solid var(--border);
      background: #fff; font-size: 12px; cursor: pointer;
      &.active { background: #0a7c4e; color: #fff; border-color: #0a7c4e; }
    }
    .doc-iframe { width: 100%; height: calc(100vh - 200px); min-height: 500px; border: none; display: block; }
    .img-viewer { padding: 16px; text-align: center; img { max-width: 100%; border-radius: 8px; } }
    .docx-viewer { height: calc(100vh - 200px); min-height: 500px; overflow: auto; background: #f7f8fa; }
    .docx-container { padding: 16px; }
    .xlsx-viewer { height: calc(100vh - 200px); min-height: 500px; overflow: auto; background: #fff; }
    .xlsx-table-wrap { padding: 16px; table { border-collapse: collapse; font-size: 13px; } td, th { border: 1px solid #ddd; padding: 5px 10px; } tr:nth-child(even) { background: #f9f9f9; } }
    .no-doc { padding: 60px 20px; text-align: center; color: var(--text-muted); }
    .zone-overlay {
      position: absolute; inset: 44px 0 0 0; cursor: crosshair;
      pointer-events: auto;
    }
    .zone-hint-label {
      position: absolute; top: 6px; left: 50%; transform: translateX(-50%);
      background: rgba(10,124,78,0.85); color: #fff; font-size: 11px; font-weight: 600;
      padding: 4px 10px; border-radius: 20px; white-space: nowrap; pointer-events: none;
    }
    .zone-marker {
      position: absolute; width: 24px; height: 24px; border-radius: 50%;
      transform: translate(-50%, -50%);
      border: 2px solid #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      animation: pulse-zone 2s infinite;
      cursor: move;
      touch-action: none;
    }
    .sig-zone-marker  { background: #e65100; }
    .stamp-zone-marker { background: #1565c0; }
    .zone-marker-label {
      position: absolute; top: 28px; left: 50%; transform: translateX(-50%);
      white-space: nowrap; font-size: 11px; font-weight: 700;
      background: rgba(255,255,255,0.92); padding: 2px 7px; border-radius: 4px;
      border: 1px solid rgba(0,0,0,0.15); pointer-events: none;
    }
    .sig-zone-marker .zone-marker-label   { color: #e65100; }
    .stamp-zone-marker .zone-marker-label { color: #1565c0; }
    @keyframes pulse-zone {
      0%,100% { box-shadow: 0 0 0 3px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.25); }
      50%      { box-shadow: 0 0 0 8px rgba(0,0,0,0.07), 0 2px 8px rgba(0,0,0,0.25); }
    }

    /* Action panel */
    .action-panel {
      background: #fff; border-radius: 12px; padding: 28px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      display: flex; flex-direction: column; gap: 20px;
    }
    .env-info-block {
      h2 { font-size: 17px; font-weight: 700; color: var(--primary); margin: 0 0 6px; }
      .from-label { font-size: 13px; color: var(--text-muted); margin: 0 0 4px; }
      .doc-message { font-style: italic; background: #f0fff8; padding: 8px 10px; border-radius: 6px; font-size: 13px; margin: 8px 0 0; }
    }
    .recipient-badge {
      display: inline-block; background: #f0fff8; border: 1px solid #a8e6c9;
      border-radius: 20px; padding: 6px 14px; font-size: 13px; color: #065c39; margin-top: 10px;
    }
    .comment-section { display: flex; flex-direction: column; gap: 6px; }
    .field-label { font-size: 13px; font-weight: 600; color: var(--primary); }
    .optional { font-weight: 400; color: var(--text-muted); font-size: 12px; }
    .hint-text { font-size: 11px; color: var(--text-muted); margin: 4px 0 0; }
    .sig-section { display: flex; flex-direction: column; gap: 6px; }
    .sig-header { display: flex; justify-content: space-between; align-items: center; }
    .sig-mode-switch {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      .btn.active {
        background: #0a7c4e;
        color: #fff;
        border-color: #0a7c4e;
      }
    }
    .sig-upload-box {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px 0;
    }
    .sig-upload-preview {
      max-height: 120px;
      max-width: 100%;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      background: repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 0 0/10px 10px;
      padding: 6px;
      object-fit: contain;
    }
    .position-controls {
      display: grid;
      grid-template-columns: 1fr;
      gap: 4px;
      margin: 6px 0 8px;
      label { font-size: 11px; color: var(--text-muted); }
      input[type='range'] { width: 100%; accent-color: #0a7c4e; }
    }
    /* Section cachet */
    .stamp-section {
      border-top: 1px solid var(--border-color); padding-top: 14px;
    }
    .stamp-toggle-row {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    }
    .stamp-toggle-label {
      display: flex; align-items: center; gap: 6px; cursor: pointer;
      font-size: 13px; font-weight: 600; color: var(--primary);
      input[type=checkbox] { accent-color: var(--primary); width: 15px; height: 15px; }
    }
    .stamp-badge { font-size: 11px; padding: 2px 8px; }
    .stamp-content { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
    .stamp-actions-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .stamp-existing { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .stamp-img-preview {
      max-height: 64px; max-width: 150px;
      border: 1px solid var(--border-color); border-radius: 6px;
      background: repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 0 0/12px 12px;
      padding: 4px;
    }
    .stamp-upload { display: flex; flex-direction: column; gap: 6px; }
    .stamp-reposition {
      align-self: flex-start; font-size: 12px;
      &.active { background: #1565c0; color: #fff; border-color: #1565c0; }
    }
    .signing-actions { display: flex; flex-direction: column; gap: 10px; }
    .btn-return {
      background: #fff3e0; color: #e65100; border: 1px solid #ffb74d;
      padding: 10px 18px; border-radius: 8px; font-size: 14px; font-weight: 600;
      cursor: pointer; text-align: center;
      &:hover { background: #ffe0b2; }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }

    /* Single card (error, done, reject, delegate) */
    .signing-card {
      background: #fff; border-radius: 12px; padding: 40px; width: 100%; max-width: 560px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .success-card { text-align: center; }
    .icon-big { font-size: 56px; margin-bottom: 16px; display: block; text-align: center; }
    h2 { font-size: 20px; font-weight: 700; color: var(--primary); margin-bottom: 8px; }

    .signing-footer { color: rgba(255,255,255,0.4); font-size: 12px; margin-top: 24px; text-align: center; }
  `],
})
export class SigningComponent implements OnInit {
  step        = signal<Step>('loading');
  envelope    = signal<Envelope | null>(null);
  recipient   = signal<Recipient | null>(null);
  processing  = signal(false);
  signErrorMessage = signal('');
  errorTitle  = signal('Lien invalide ou expiré');
  errorDetail = signal('Ce lien de signature n\'est plus valide. Veuillez contacter l\'émetteur du document.');
  doneMessage = signal('');
  sigError    = signal(false);
  signatureMode = signal<'draw' | 'upload'>('draw');
  uploadedSignaturePreview = signal<string | null>(null);
  useSavedSignature = signal(false);
  activeDocIndex = signal(0);
  signatureZone = signal<{ x: number; y: number } | null>(null);
  xlsxHtml    = signal<SafeHtml | null>(null);
  xlsxLoading = signal(false);
  // Cachet
  useStamp          = signal(false);
  hasStoredStamp    = signal(false);
  uploadedStampPreview = signal<string | null>(null);
  stampZone         = signal<{ x: number; y: number }>({ x: 0.60, y: 0.88 });
  zoneTarget        = signal<'signature' | 'stamp'>('signature');
  draggingTarget    = signal<'signature' | 'stamp' | null>(null);
  year = new Date().getFullYear();
  token = '';
  sigComment = '';

  @ViewChild('sigCanvas') canvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('docxContainer') docxContainerRef?: ElementRef<HTMLDivElement>;
  private isDrawing = false;
  private lastX = 0;
  private lastY = 0;

  rejectForm = this.fb.group({ reason: ['', Validators.required] });
  returnForm = this.fb.group({ reason: ['', Validators.required] });
  delegateForm = this.fb.group({
    delegate_first_name: ['', Validators.required],
    delegate_last_name:  ['', Validators.required],
    delegate_email:      ['', [Validators.required, Validators.pattern(/^[^@]+@cgrae\.ci$/)]],
  });
  forwardForm = this.fb.group({
    forward_first_name: ['', Validators.required],
    forward_last_name:  ['', Validators.required],
    forward_email:      ['', [Validators.required, Validators.pattern(/^[^@]+@cgrae\.ci$/)]],
  });

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private fb: FormBuilder,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    this.api.getPublicEnvelope(this.token).subscribe({
      next: (env) => {
        this.signErrorMessage.set('');
        this.envelope.set(env);
        const r = env.recipients?.find(rec => rec.token === this.token) || null;
        this.recipient.set(r);
        // Initialiser le cachet
        if (r?.has_stamp) {
          this.hasStoredStamp.set(true);
          this.useStamp.set(true);
        }
        if (r?.has_signature) {
          this.useStoredSignature();
        }
        if (r?.status === 'SIGNED' || r?.status === 'APPROVED') {
          this.step.set('already-signed');
        } else {
          this.step.set('sign');
          this.cdr.detectChanges();
          setTimeout(() => { this.renderDocxPreviewIfNeeded(); this.renderXlsxIfNeeded(); }, 50);
        }
      },
      error: () => {
        this.errorTitle.set('Lien invalide ou expiré');
        this.errorDetail.set('Ce lien de signature n\'est plus valide. Veuillez contacter l\'émetteur du document.');
        this.step.set('error');
      },
    });
  }

  useStoredSignature(): void {
    if (!this.recipient()?.has_signature) {
      this.useSavedSignature.set(false);
      this.uploadedSignaturePreview.set(null);
      this.signErrorMessage.set('Aucune signature n\'est enregistrée dans votre profil. Ajoutez-en une dans Mon profil ou utilisez Dessiner / Télécharger image.');
      this.signatureMode.set('draw');
      return;
    }

    this.signatureMode.set('upload');
    this.useSavedSignature.set(true);
    this.uploadedSignaturePreview.set(this.api.getPublicSignatureUrl(this.token));
    this.sigError.set(false);
    this.signErrorMessage.set('');
    this.cdr.detectChanges();
  }

  useStoredStamp(): void {
    this.useStamp.set(true);
    this.uploadedStampPreview.set(null);
    this.signErrorMessage.set('');
    this.cdr.detectChanges();
  }

  // ── Document viewer helpers ───────────────────────────────
  activeDoc() { return this.envelope()?.documents?.[this.activeDocIndex()]; }

  selectDoc(i: number): void {
    this.activeDocIndex.set(i);
    this.cdr.detectChanges();
    setTimeout(() => { this.renderDocxPreviewIfNeeded(); this.renderXlsxIfNeeded(); }, 50);
  }

  rawDocUrl(): string {
    const doc = this.activeDoc();
    return doc ? this.api.getPublicDocumentUrl(this.token, doc.id_document) : '';
  }

  activeDocUrl(): SafeResourceUrl | null {
    const url = this.rawDocUrl();
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  }

  isPdf(): boolean { return this.activeDoc()?.mime_type === 'application/pdf'; }
  isImage(): boolean { return (this.activeDoc()?.mime_type || '').startsWith('image/'); }
  isDocx(): boolean {
    return this.activeDoc()?.mime_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  isXlsx(): boolean {
    return this.activeDoc()?.mime_type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }

  private async renderXlsxIfNeeded(): Promise<void> {
    if (!this.isXlsx()) return;
    const url = this.rawDocUrl();
    if (!url) return;
    this.xlsxHtml.set(null);
    this.xlsxLoading.set(true);
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('FETCH_FAILED');
      const ab = await resp.arrayBuffer();
      const XLSX = await import('xlsx');
      const wb = XLSX.read(ab, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const html = XLSX.utils.sheet_to_html(ws);
      this.xlsxHtml.set(this.sanitizer.bypassSecurityTrustHtml(html));
    } catch {
      this.xlsxHtml.set(null);
    }
    this.xlsxLoading.set(false);
  }

  // ── Actions ───────────────────────────────────────────────
  sign(): void {
    const role = this.recipient()?.role;
    const needsSignature = role === 'SIGNATORY' || role === 'APPROVER';
    if (needsSignature) {
      const hasDrawn = !this.isCanvasEmpty();
      const hasUploaded = !!this.uploadedSignaturePreview() || this.useSavedSignature();
      if ((this.signatureMode() === 'draw' && !hasDrawn) || (this.signatureMode() === 'upload' && !hasUploaded)) {
        this.sigError.set(true);
        return;
      }
    }
    this.sigError.set(false);
    this.signErrorMessage.set('');
    this.processing.set(true);
    const sig = needsSignature
      ? (this.signatureMode() === 'upload' && !this.useSavedSignature()
          ? (this.uploadedSignaturePreview() || undefined)
          : this.signatureMode() === 'draw'
            ? this.getSignatureBase64()
            : undefined)
      : undefined;
    const activeDocId = this.activeDoc()?.id_document;
    const position = (needsSignature && activeDocId)
      ? {
          doc_id: activeDocId,
          x_ratio: this.signatureZone()?.x ?? 0.82,
          y_ratio: this.signatureZone()?.y ?? 0.88,
        }
      : undefined;
    // Cachet
    const useStamp = this.useStamp();
    const stampImg = this.uploadedStampPreview() || undefined;
    const stampPos = (useStamp && activeDocId)
      ? { doc_id: activeDocId, x_ratio: this.stampZone().x, y_ratio: this.stampZone().y }
      : undefined;
    this.api.signDocument(
      this.token,
      sig,
      this.useSavedSignature(),
      this.sigComment || undefined,
      position,
      useStamp,
      stampImg,
      stampPos,
    ).subscribe({
      next: () => {
        // Recharger l'enveloppe pour obtenir le docId du document signé (avec signature intégrée)
        this.api.getPublicEnvelope(this.token).subscribe({
          next: (env) => {
            this.envelope.set(env);
            this.activeDocIndex.set(0);
            this.xlsxHtml.set(null);
            this.processing.set(false);
            this.doneMessage.set('signed');
            this.step.set('done');
            this.cdr.detectChanges();
          },
          error: () => {
            this.processing.set(false);
            this.doneMessage.set('signed');
            this.step.set('done');
          },
        });
      },
      error: (err: any) => {
        this.processing.set(false);
        const status = Number(err?.status || 0);
        const backendMessage =
          typeof err?.error === 'string'
            ? err.error
            : Array.isArray(err?.error?.message)
              ? err.error.message.join(' ')
              : String(err?.error?.message || err?.message || '');
        const msg = backendMessage.toLowerCase();

        console.error('[Sign] status:', status, 'message:', backendMessage);

        if (status === 400 && msg.includes('déjà signé')) {
          this.step.set('already-signed');
          return;
        }
        if (status === 400 && (msg.includes('aucune signature sauvegardée') || msg.includes('aucune signature'))) {
          this.useSavedSignature.set(false);
          this.uploadedSignaturePreview.set(null);
          this.signatureMode.set('draw');
          this.signErrorMessage.set('Aucune signature enregistrée dans votre profil. Dessinez votre signature dans la zone ci-dessous ou importez un fichier image.');
          return;
        }
        if (status === 400 && msg.includes('impossible d\'apposer')) {
          this.signErrorMessage.set('Impossible d\'apposer la signature sur le document. Vérifiez que votre image de signature est valide (PNG recommandé).');
          return;
        }
        if (status === 401 || status === 404 || status === 410) {
          this.errorTitle.set('Lien invalide ou expiré');
          this.errorDetail.set('Ce lien de signature n\'est plus valide. Veuillez contacter l\'émetteur du document.');
          this.step.set('error');
          return;
        }
        if (status === 413 || msg.includes('too large') || msg.includes('payload')) {
          this.signErrorMessage.set('Image de signature/cachet trop volumineuse. Réduisez la taille de l\'image puis réessayez.');
          return;
        }
        if (status === 0) {
          this.signErrorMessage.set('Impossible de joindre le serveur. Vérifiez que le backend est démarré et rechargez la page.');
          return;
        }

        this.signErrorMessage.set(
          backendMessage || 'La signature a échoué. Vérifiez votre cachet/signature puis réessayez.',
        );
      },
    });
  }

  goBackToViewer(): void {
    this.xlsxHtml.set(null);
    this.step.set('sign');
    this.cdr.detectChanges();
    setTimeout(() => { this.renderDocxPreviewIfNeeded(); this.renderXlsxIfNeeded(); }, 50);
  }

  onViewerZoneClick(event: MouseEvent): void {
    if (this.draggingTarget()) return;
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    const y = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1);
    if (this.zoneTarget() === 'stamp') {
      this.stampZone.set({ x, y });
      this.zoneTarget.set('signature'); // Retour au mode signature après placement
    } else {
      this.signatureZone.set({ x, y });
    }
  }

  private getRelativePosition(event: PointerEvent | MouseEvent, target: HTMLElement): { x: number; y: number } {
    const rect = target.getBoundingClientRect();
    const x = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    const y = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1);
    return { x, y };
  }

  startDragMarker(kind: 'signature' | 'stamp', event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.draggingTarget.set(kind);
  }

  onOverlayPointerMove(event: PointerEvent): void {
    const dragging = this.draggingTarget();
    if (!dragging) return;
    const target = event.currentTarget as HTMLElement;
    const { x, y } = this.getRelativePosition(event, target);
    if (dragging === 'stamp') {
      this.stampZone.set({ x, y });
    } else {
      this.signatureZone.set({ x, y });
    }
  }

  onOverlayPointerUp(): void {
    this.draggingTarget.set(null);
  }

  sigXPercent(): number { return Math.round((this.signatureZone()?.x ?? 0.82) * 100); }
  sigYPercent(): number { return Math.round((this.signatureZone()?.y ?? 0.88) * 100); }
  stampXPercent(): number { return Math.round(this.stampZone().x * 100); }
  stampYPercent(): number { return Math.round(this.stampZone().y * 100); }

  updateSigX(v: string): void {
    const cur = this.signatureZone() ?? { x: 0.82, y: 0.88 };
    this.signatureZone.set({ ...cur, x: Math.min(Math.max(Number(v) / 100, 0), 1) });
  }

  updateSigY(v: string): void {
    const cur = this.signatureZone() ?? { x: 0.82, y: 0.88 };
    this.signatureZone.set({ ...cur, y: Math.min(Math.max(Number(v) / 100, 0), 1) });
  }

  updateStampX(v: string): void {
    this.stampZone.set({ ...this.stampZone(), x: Math.min(Math.max(Number(v) / 100, 0), 1) });
  }

  updateStampY(v: string): void {
    this.stampZone.set({ ...this.stampZone(), y: Math.min(Math.max(Number(v) / 100, 0), 1) });
  }

  toggleStamp(event: Event): void {
    this.useStamp.set((event.target as HTMLInputElement).checked);
    if (this.useStamp() && this.hasStoredStamp() && !this.uploadedStampPreview()) {
      this.useStoredStamp();
    }
  }

  activateStampZonePicker(): void {
    this.zoneTarget.set(this.zoneTarget() === 'stamp' ? 'signature' : 'stamp');
  }

  onStampFileChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      this.uploadedStampPreview.set(reader.result as string);
      this.cdr.detectChanges();
    };
    reader.readAsDataURL(file);
  }

  clearStamp(): void {
    this.uploadedStampPreview.set(null);
    if (!this.hasStoredStamp()) {
      this.useStamp.set(false);
    }
  }

  async renderDocxPreviewIfNeeded(): Promise<void> {
    if (!this.isDocx()) return;
    let container = this.docxContainerRef?.nativeElement;
    // Retry jusqu'à 5 fois si le container n'est pas encore dans le DOM
    for (let i = 0; i < 5 && !container; i++) {
      await new Promise(r => setTimeout(r, 100));
      container = this.docxContainerRef?.nativeElement;
    }
    if (!container) return;

    try {
      container.innerHTML = '<p style="padding:12px;color:#64748b">Chargement de la prévisualisation DOCX...</p>';
      const response = await fetch(this.rawDocUrl());
      if (!response.ok) throw new Error('DOCX_NOT_FETCHED');
      const arrayBuffer = await response.arrayBuffer();
      const mod: any = await import('docx-preview');
      container.innerHTML = '';
      await mod.renderAsync(arrayBuffer, container, undefined, {
        inWrapper: true,
        ignoreHeight: false,
        ignoreWidth: false,
      });
    } catch {
      container.innerHTML = '<p style="padding:12px;color:#b91c1c">Impossible d\'afficher ce DOCX dans le navigateur. Ouvrez-le dans un nouvel onglet.</p>';
    }
  }

  reject(): void {
    if (this.rejectForm.invalid) return;
    this.processing.set(true);
    this.api.rejectDocument(this.token, this.rejectForm.value.reason!).subscribe({
      next: () => { this.processing.set(false); this.doneMessage.set('rejected'); this.step.set('done'); },
      error: () => this.processing.set(false),
    });
  }

  delegate(): void {
    if (this.delegateForm.invalid) return;
    this.processing.set(true);
    this.api.delegateSignature(this.token, this.delegateForm.value).subscribe({
      next: () => { this.processing.set(false); this.doneMessage.set('delegated'); this.step.set('done'); },
      error: () => this.processing.set(false),
    });
  }

  returnForCorrection(): void {
    if (this.returnForm.invalid) return;
    this.processing.set(true);
    this.api.returnForCorrection(this.token, this.returnForm.value.reason!).subscribe({
      next: () => { this.processing.set(false); this.doneMessage.set('returned'); this.step.set('done'); },
      error: () => this.processing.set(false),
    });
  }

  forwardAfterSign(): void {
    if (this.forwardForm.invalid) return;
    this.processing.set(true);
    this.api.forwardAfterSign(this.token, this.forwardForm.value).subscribe({
      next: () => { this.processing.set(false); this.doneMessage.set('forwarded'); this.step.set('done'); },
      error: () => this.processing.set(false),
    });
  }

  getDocUrl(docId: number): string { return this.api.getPublicDocumentUrl(this.token, docId); }

  // ── Canvas signature pad ──────────────────────────────────
  startDraw(e: PointerEvent): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    this.isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    this.lastX = (e.clientX - rect.left) * (canvas.width / rect.width);
    this.lastY = (e.clientY - rect.top)  * (canvas.height / rect.height);
  }

  draw(e: PointerEvent): void {
    if (!this.isDrawing) return;
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top)  * (canvas.height / rect.height);
    ctx.beginPath();
    ctx.moveTo(this.lastX, this.lastY);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = e.pressure > 0 ? Math.max(1.5, e.pressure * 5) : 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    this.lastX = x;
    this.lastY = y;
  }

  endDraw(): void { this.isDrawing = false; }

  setSignatureMode(mode: 'draw' | 'upload'): void {
    this.signatureMode.set(mode);
    // Toujours réinitialiser la signature sauvegardée quand on change de mode
    this.useSavedSignature.set(false);
    if (mode === 'upload') {
      // Réinitialiser le preview pour forcer l'upload d'un nouveau fichier
      this.uploadedSignaturePreview.set(null);
    }
    this.sigError.set(false);
  }

  clearCanvas(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    this.sigError.set(false);
  }

  clearUploadedSignature(): void {
    this.uploadedSignaturePreview.set(null);
    this.useSavedSignature.set(false);
    this.sigError.set(false);
  }

  onSignatureFileChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.useSavedSignature.set(false);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxWidth = 900;
        const scale = Math.min(1, maxWidth / Math.max(1, img.width));
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        this.uploadedSignaturePreview.set(canvas.toDataURL('image/png'));
        this.signatureMode.set('upload');
        this.sigError.set(false);
        this.cdr.detectChanges();
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  private isCanvasEmpty(): boolean {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return true;
    return !Array.from(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data).some(b => b !== 0);
  }

  private getSignatureBase64(): string | undefined {
    const canvas = this.canvasRef?.nativeElement;
    return canvas ? canvas.toDataURL('image/png') : undefined;
  }

  roleLabel(r: string): string {
    const m: Record<string, string> = { SIGNATORY: 'Signataire', APPROVER: 'Approbateur', VIEWER: 'Visualisateur', DELEGATOR: 'Délégateur' };
    return m[r] || r;
  }

  formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  displayDocName(name: string): string {
    if (!name || !/[ÃÂâðÌ]/.test(name)) return name;
    try {
      const bytes = Uint8Array.from(Array.from(name, (c) => c.charCodeAt(0) & 0xff));
      return new TextDecoder('utf-8').decode(bytes).normalize('NFC');
    } catch {
      return name;
    }
  }
}
