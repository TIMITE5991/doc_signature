import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  AuthResponse, User, Document, Template, Envelope,
  AuditLog, Notification, PaginatedResult,
} from '../models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = environment.apiUrl;

  /** Compteur partagé de notifications non lues */
  readonly unreadNotifCount = signal(0);

  constructor(private http: HttpClient) {}

  // ── Auth ─────────────────────────────────────────────────
  login(email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.base}/auth/login`, { email, password });
  }

  register(payload: any): Observable<User> {
    return this.http.post<User>(`${this.base}/auth/register`, payload);
  }

  getProfile(): Observable<User> {
    return this.http.get<User>(`${this.base}/auth/profile`);
  }

  // ── Users ─────────────────────────────────────────────────
  getUsers(): Observable<User[]> {
    return this.http.get<User[]>(`${this.base}/users`);
  }

  getUser(id: number): Observable<User> {
    return this.http.get<User>(`${this.base}/users/${id}`);
  }

  createUser(payload: any): Observable<User> {
    return this.http.post<User>(`${this.base}/users`, payload);
  }

  updateUser(id: number, payload: any): Observable<User> {
    return this.http.put<User>(`${this.base}/users/${id}`, payload);
  }

  deleteUser(id: number): Observable<any> {
    return this.http.delete(`${this.base}/users/${id}`);
  }

  uploadMyStamp(base64: string): Observable<any> {
    return this.http.post(`${this.base}/users/me/stamp`, { stamp_image: base64 });
  }

  uploadMySignature(base64: string): Observable<any> {
    return this.http.post(`${this.base}/users/me/signature`, { signature_image: base64 });
  }

  getMyStampUrl(): string {
    const token = localStorage.getItem('ds_token') || '';
    return `${this.base}/users/me/stamp?token=${encodeURIComponent(token)}`;
  }

  getMySignatureUrl(): string {
    const token = localStorage.getItem('ds_token') || '';
    return `${this.base}/users/me/signature?token=${encodeURIComponent(token)}`;
  }

  // ── Documents ─────────────────────────────────────────────
  getDocuments(): Observable<Document[]> {
    return this.http.get<Document[]>(`${this.base}/documents`);
  }

  getDocumentViewUrl(docId: number): string {
    const token = localStorage.getItem('ds_token') || '';
    return `${this.base}/documents/${docId}/view?token=${encodeURIComponent(token)}`;
  }

  getDocumentBlob(docId: number): Observable<Blob> {
    return this.http.get(`${this.base}/documents/${docId}/view`, { responseType: 'blob' });
  }

  uploadDocument(file: File): Observable<Document> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<Document>(`${this.base}/documents/upload`, fd);
  }

  deleteDocument(id: number): Observable<any> {
    return this.http.delete(`${this.base}/documents/${id}`);
  }

  archiveDocument(id: number): Observable<Document> {
    return this.http.patch<Document>(`${this.base}/documents/${id}/archive`, {});
  }

  unarchiveDocument(id: number): Observable<Document> {
    return this.http.patch<Document>(`${this.base}/documents/${id}/unarchive`, {});
  }

  // ── Templates ─────────────────────────────────────────────
  getTemplates(): Observable<Template[]> {
    return this.http.get<Template[]>(`${this.base}/templates`);
  }

  createTemplate(payload: any): Observable<Template> {
    return this.http.post<Template>(`${this.base}/templates`, payload);
  }

  updateTemplate(id: number, payload: any): Observable<Template> {
    return this.http.put<Template>(`${this.base}/templates/${id}`, payload);
  }

  deleteTemplate(id: number): Observable<any> {
    return this.http.delete(`${this.base}/templates/${id}`);
  }

  // ── Envelopes ─────────────────────────────────────────────
  getEnvelopes(): Observable<Envelope[]> {
    return this.http.get<Envelope[]>(`${this.base}/envelopes`);
  }

  getEnvelope(id: number): Observable<Envelope> {
    return this.http.get<Envelope>(`${this.base}/envelopes/${id}`);
  }

  createEnvelope(payload: any): Observable<Envelope> {
    return this.http.post<Envelope>(`${this.base}/envelopes`, payload);
  }

  sendEnvelope(id: number): Observable<Envelope> {
    return this.http.post<Envelope>(`${this.base}/envelopes/${id}/send`, {});
  }

  cancelEnvelope(id: number): Observable<any> {
    return this.http.post(`${this.base}/envelopes/${id}/cancel`, {});
  }

  // Public signing endpoints (no auth token)
  getPublicEnvelope(token: string): Observable<Envelope> {
    return this.http.get<Envelope>(`${this.base}/envelopes/sign/${token}`);
  }

  getPublicDocumentUrl(token: string, docId: number): string {
    return `${this.base}/envelopes/sign/${token}/document/${docId}`;
  }

  getPublicStampUrl(token: string): string {
    return `${this.base}/envelopes/sign/${token}/stamp`;
  }

  getPublicSignatureUrl(token: string): string {
    return `${this.base}/envelopes/sign/${token}/signature`;
  }

  signDocument(
    token: string,
    signatureImage?: string,
    useSavedSignature?: boolean,
    comment?: string,
    signaturePosition?: { doc_id: number; x_ratio: number; y_ratio: number },
    useStamp?: boolean,
    stampImage?: string,
    stampPosition?: { doc_id: number; x_ratio: number; y_ratio: number },
  ): Observable<any> {
    return this.http.post(`${this.base}/envelopes/sign/${token}/confirm`,
      {
        signature_image: signatureImage || undefined,
        use_saved_signature: useSavedSignature || undefined,
        comment: comment || undefined,
        signature_position: signaturePosition || undefined,
        use_stamp: useStamp || undefined,
        stamp_image: stampImage || undefined,
        stamp_position: stampPosition || undefined,
      },
    );
  }

  rejectDocument(token: string, reason: string): Observable<any> {
    return this.http.post(`${this.base}/envelopes/sign/${token}/reject`, { reason });
  }

  delegateSignature(token: string, payload: any): Observable<any> {
    return this.http.post(`${this.base}/envelopes/sign/${token}/delegate`, payload);
  }

  forwardAfterSign(token: string, payload: any): Observable<any> {
    return this.http.post(`${this.base}/envelopes/sign/${token}/forward`, payload);
  }

  returnForCorrection(token: string, reason: string): Observable<any> {
    return this.http.post(`${this.base}/envelopes/sign/${token}/return`, { reason });
  }

  // ── Audit ─────────────────────────────────────────────────
  getAuditLogs(page = 1, limit = 50): Observable<PaginatedResult<AuditLog>> {
    return this.http.get<PaginatedResult<AuditLog>>(
      `${this.base}/audit?page=${page}&limit=${limit}`,
    );
  }

  getEnvelopeAudit(id: number): Observable<AuditLog[]> {
    return this.http.get<AuditLog[]>(`${this.base}/audit/envelope/${id}`);
  }

  // ── Notifications ─────────────────────────────────────────
  getNotifications(): Observable<Notification[]> {
    return this.http.get<Notification[]>(`${this.base}/notifications`);
  }

  getUnreadCount(): Observable<number> {
    return this.http.get<number>(`${this.base}/notifications/unread-count`).pipe(
      tap(n => this.unreadNotifCount.set(n)),
    );
  }

  markNotificationRead(id: number): Observable<any> {
    return this.http.put(`${this.base}/notifications/${id}/read`, {}).pipe(
      tap(() => this.unreadNotifCount.update(c => Math.max(0, c - 1))),
    );
  }

  markAllNotificationsRead(): Observable<any> {
    return this.http.put(`${this.base}/notifications/read-all`, {}).pipe(
      tap(() => this.unreadNotifCount.set(0)),
    );
  }
}
