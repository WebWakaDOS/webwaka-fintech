-- WebWaka Fintech Suite — Migration 0005
-- FT-001: Idempotency key on payout requests
-- FT-002: Loan repayment schedules
-- FT-003: KYC verifications audit trail
-- FT-004: Paystack events + refunds
-- FT-009: External bank accounts (Mono open banking)

-- ─── FT-001: Idempotency key column on payoutRequests ─────────────────────────
-- Safe to run multiple times; ALTER TABLE ignores if column already exists via
-- the workaround of checking sqlite_master first — handled at app startup.
-- For D1 we use a separate table to track processed idempotency keys.

CREATE TABLE IF NOT EXISTS payoutIdempotencyKeys (
  idempotencyKey TEXT NOT NULL,
  tenantId TEXT NOT NULL,
  payoutRequestId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (tenantId, idempotencyKey)
);

-- ─── FT-002: Loan repayment schedules ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loanRepaymentSchedules (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  loanId TEXT NOT NULL,
  installmentNumber INTEGER NOT NULL,
  dueDate TEXT NOT NULL,
  principalKobo INTEGER NOT NULL,
  interestKobo INTEGER NOT NULL,
  totalDueKobo INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  paidAt TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loanRepaymentSchedules_loanId ON loanRepaymentSchedules(loanId);
CREATE INDEX IF NOT EXISTS idx_loanRepaymentSchedules_tenantId ON loanRepaymentSchedules(tenantId);
CREATE INDEX IF NOT EXISTS idx_loanRepaymentSchedules_status ON loanRepaymentSchedules(status);
CREATE INDEX IF NOT EXISTS idx_loanRepaymentSchedules_dueDate ON loanRepaymentSchedules(dueDate);

-- ─── FT-003: KYC verification audit trail ────────────────────────────────────
CREATE TABLE IF NOT EXISTS kycVerifications (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  verificationType TEXT NOT NULL,
  provider TEXT NOT NULL,
  referenceId TEXT,
  identifierType TEXT NOT NULL,
  identifierValue TEXT NOT NULL,
  status TEXT NOT NULL,
  responseData TEXT,
  failureReason TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kycVerifications_tenantId ON kycVerifications(tenantId);
CREATE INDEX IF NOT EXISTS idx_kycVerifications_customerId ON kycVerifications(customerId);

-- ─── FT-004: Paystack payment events ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS paystackEvents (
  id TEXT PRIMARY KEY,
  tenantId TEXT,
  event TEXT NOT NULL,
  reference TEXT NOT NULL,
  amountKobo INTEGER,
  currency TEXT DEFAULT 'NGN',
  status TEXT NOT NULL,
  metadata TEXT,
  rawPayload TEXT NOT NULL,
  processedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_paystackEvents_reference ON paystackEvents(reference);
CREATE INDEX IF NOT EXISTS idx_paystackEvents_event ON paystackEvents(event);

CREATE TABLE IF NOT EXISTS paystackRefunds (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  originalReference TEXT NOT NULL,
  refundReference TEXT NOT NULL UNIQUE,
  amountKobo INTEGER NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  paystackRefundId TEXT,
  initiatedBy TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_paystackRefunds_tenantId ON paystackRefunds(tenantId);
CREATE INDEX IF NOT EXISTS idx_paystackRefunds_originalReference ON paystackRefunds(originalReference);

CREATE TABLE IF NOT EXISTS paystackChargebacks (
  id TEXT PRIMARY KEY,
  tenantId TEXT,
  reference TEXT NOT NULL,
  amountKobo INTEGER NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  rawPayload TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  resolvedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_paystackChargebacks_reference ON paystackChargebacks(reference);

-- ─── FT-009: External bank accounts (Mono open banking) ──────────────────────
CREATE TABLE IF NOT EXISTS monoConsents (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  consentToken TEXT,
  monoAccountId TEXT,
  status TEXT NOT NULL DEFAULT 'initiated',
  redirectUrl TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_monoConsents_tenantId ON monoConsents(tenantId);
CREATE INDEX IF NOT EXISTS idx_monoConsents_customerId ON monoConsents(customerId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_monoConsents_monoAccountId ON monoConsents(monoAccountId) WHERE monoAccountId IS NOT NULL;

CREATE TABLE IF NOT EXISTS externalBankAccounts (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  monoConsentId TEXT NOT NULL,
  monoAccountId TEXT NOT NULL,
  bankName TEXT NOT NULL,
  accountName TEXT NOT NULL,
  accountNumber TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  balanceMinorUnits INTEGER,
  balanceFetchedAt TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_externalBankAccounts_tenantId ON externalBankAccounts(tenantId);
CREATE INDEX IF NOT EXISTS idx_externalBankAccounts_customerId ON externalBankAccounts(customerId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_externalBankAccounts_monoAccountId ON externalBankAccounts(monoAccountId);
