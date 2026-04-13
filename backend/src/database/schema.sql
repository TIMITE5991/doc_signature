-- ============================================================
-- DocuSign CGRAE - Database Schema
-- Version 1.0 | Avril 2025
-- ============================================================

CREATE DATABASE IF NOT EXISTS doc_signature CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE doc_signature;

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE t_users (
  id_user       INT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password      VARCHAR(255) NOT NULL,
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100) NOT NULL,
  role          ENUM('SIGNATORY','APPROVER','VIEWER','DELEGATOR','ADMIN','SUPER_ADMIN') NOT NULL DEFAULT 'SIGNATORY',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  mfa_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  avatar_url    VARCHAR(500),
  department    VARCHAR(150),
  phone         VARCHAR(30),
  stamp_path    VARCHAR(500),
  signature_path VARCHAR(500),
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================================
-- DOCUMENTS
-- ============================================================
CREATE TABLE t_documents (
  id_document   INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  path          VARCHAR(500) NOT NULL,
  mime_type     VARCHAR(100) NOT NULL,
  size          INT NOT NULL,
  version       INT NOT NULL DEFAULT 1,
  created_by    INT NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES t_users(id_user) ON DELETE RESTRICT
);

-- ============================================================
-- TEMPLATES
-- ============================================================
CREATE TABLE t_templates (
  id_template   INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  document_path VARCHAR(500),
  fields        JSON,
  created_by    INT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES t_users(id_user) ON DELETE RESTRICT
);

-- ============================================================
-- ENVELOPES
-- ============================================================
CREATE TABLE t_envelopes (
  id_envelope   INT AUTO_INCREMENT PRIMARY KEY,
  title         VARCHAR(255) NOT NULL,
  subject       VARCHAR(500),
  message       TEXT,
  status        ENUM('DRAFT','SENT','IN_PROGRESS','COMPLETED','REJECTED','REVISION','EXPIRED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  circuit_type  ENUM('SEQUENTIAL','PARALLEL','MIXED','CONDITIONAL') NOT NULL DEFAULT 'SEQUENTIAL',
  created_by    INT NOT NULL,
  expires_at    TIMESTAMP NULL,
  completed_at  TIMESTAMP NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES t_users(id_user) ON DELETE RESTRICT
);

-- ============================================================
-- ENVELOPE <-> DOCUMENT (many-to-many)
-- ============================================================
CREATE TABLE t_envelope_documents (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  id_envelope   INT NOT NULL,
  id_document   INT NOT NULL,
  FOREIGN KEY (id_envelope) REFERENCES t_envelopes(id_envelope) ON DELETE CASCADE,
  FOREIGN KEY (id_document) REFERENCES t_documents(id_document) ON DELETE RESTRICT
);

-- ============================================================
-- RECIPIENTS
-- ============================================================
CREATE TABLE t_recipients (
  id_recipient      INT AUTO_INCREMENT PRIMARY KEY,
  id_envelope       INT NOT NULL,
  id_user           INT,
  email             VARCHAR(255) NOT NULL,
  first_name        VARCHAR(100),
  last_name         VARCHAR(100),
  role              ENUM('SIGNATORY','APPROVER','VIEWER','DELEGATOR') NOT NULL DEFAULT 'SIGNATORY',
  signing_order     INT NOT NULL DEFAULT 1,
  status            ENUM('PENDING','SENT','VIEWED','SIGNED','APPROVED','REJECTED','DELEGATED','RETURNED') NOT NULL DEFAULT 'PENDING',
  token             VARCHAR(255),
  signed_at         TIMESTAMP NULL,
  rejection_reason  TEXT,
  signature_path    VARCHAR(500),
  signing_comment   TEXT,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (id_envelope) REFERENCES t_envelopes(id_envelope) ON DELETE CASCADE,
  FOREIGN KEY (id_user) REFERENCES t_users(id_user) ON DELETE SET NULL
);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE t_audit_logs (
  id_audit      INT AUTO_INCREMENT PRIMARY KEY,
  id_envelope   INT,
  action        VARCHAR(100) NOT NULL,
  id_user       INT,
  user_email    VARCHAR(255),
  ip_address    VARCHAR(45),
  details       JSON,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_envelope) REFERENCES t_envelopes(id_envelope) ON DELETE SET NULL,
  FOREIGN KEY (id_user) REFERENCES t_users(id_user) ON DELETE SET NULL
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE t_notifications (
  id_notification INT AUTO_INCREMENT PRIMARY KEY,
  id_user         INT NOT NULL,
  id_envelope     INT,
  type            VARCHAR(100) NOT NULL,
  title           VARCHAR(255) NOT NULL,
  message         TEXT NOT NULL,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_user) REFERENCES t_users(id_user) ON DELETE CASCADE,
  FOREIGN KEY (id_envelope) REFERENCES t_envelopes(id_envelope) ON DELETE SET NULL
);

-- ============================================================
-- DELEGATIONS
-- ============================================================
CREATE TABLE t_delegations (
  id_delegation INT AUTO_INCREMENT PRIMARY KEY,
  id_from_user  INT NOT NULL,
  id_to_user    INT NOT NULL,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  reason        VARCHAR(500),
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_from_user) REFERENCES t_users(id_user) ON DELETE CASCADE,
  FOREIGN KEY (id_to_user) REFERENCES t_users(id_user) ON DELETE CASCADE
);
