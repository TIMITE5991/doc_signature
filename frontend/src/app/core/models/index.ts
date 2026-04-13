export type UserRole = 'SIGNATORY' | 'APPROVER' | 'VIEWER' | 'DELEGATOR' | 'ADMIN' | 'SUPER_ADMIN';
export type EnvelopeStatus = 'DRAFT' | 'SENT' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED' | 'REVISION' | 'EXPIRED' | 'CANCELLED';
export type CircuitType = 'SEQUENTIAL' | 'PARALLEL' | 'MIXED' | 'CONDITIONAL';
export type RecipientRole = 'SIGNATORY' | 'APPROVER' | 'VIEWER' | 'DELEGATOR';
export type RecipientStatus = 'PENDING' | 'SENT' | 'VIEWED' | 'SIGNED' | 'APPROVED' | 'REJECTED' | 'DELEGATED' | 'RETURNED';

export interface User {
  id_user: number;
  email: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  is_active: boolean;
  mfa_enabled: boolean;
  has_stamp?: boolean;
  has_signature?: boolean;
  department?: string;
  phone?: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

export interface Document {
  id_document: number;
  name: string;
  original_name: string;
  path: string;
  mime_type: string;
  size: number;
  version: number;
  created_by: number;
  source_type?: 'OWN' | 'RECEIVED';
  source_envelope_id?: number | null;
  is_archived?: boolean;
  archived_at?: string;
  created_at: string;
}

export interface Template {
  id_template: number;
  name: string;
  description?: string;
  document_path?: string;
  fields?: any;
  created_by: number;
  creator_name?: string;
  is_active: boolean;
  created_at: string;
}

export interface Recipient {
  id_recipient: number;
  id_envelope: number;
  id_user?: number;
  has_stamp?: boolean;
  has_signature?: boolean;
  email: string;
  first_name: string;
  last_name: string;
  role: RecipientRole;
  signing_order: number;
  status: RecipientStatus;
  token?: string;
  signed_at?: string;
  rejection_reason?: string;
  signing_comment?: string;
  signature_path?: string;
}

export interface Envelope {
  id_envelope: number;
  title: string;
  subject?: string;
  message?: string;
  status: EnvelopeStatus;
  circuit_type: CircuitType;
  created_by: number;
  creator_name?: string;
  creator_email?: string;
  expires_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  recipients?: Recipient[];
  documents?: Document[];
}

export interface AuditLog {
  id_audit: number;
  id_envelope?: number;
  action: string;
  id_user?: number;
  user_email?: string;
  ip_address?: string;
  details?: any;
  created_at: string;
}

export interface Notification {
  id_notification: number;
  id_user: number;
  id_envelope?: number;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  user: User;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
