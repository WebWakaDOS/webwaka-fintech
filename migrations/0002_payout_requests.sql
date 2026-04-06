-- Migration: 0002_payout_requests
-- Adds fint_payoutRequests table for NIBSS NIP instant transfer tracking
-- Invariant 5: Nigeria First — amountKobo is always kobo integers

CREATE TABLE IF NOT EXISTS fint_payoutRequests (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  initiatorId TEXT NOT NULL,
  payoutType TEXT NOT NULL,
  amountKobo INTEGER NOT NULL,
  destinationAccountNumber TEXT NOT NULL,
  destinationBankCode TEXT NOT NULL,
  destinationAccountName TEXT NOT NULL,
  narration TEXT NOT NULL,
  nibssReference TEXT NOT NULL UNIQUE,
  nibssSessionId TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  settledAt TEXT,
  failureReason TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payoutRequests_tenantId ON fint_payoutRequests(tenantId);
CREATE INDEX IF NOT EXISTS idx_payoutRequests_status ON fint_payoutRequests(status);
CREATE INDEX IF NOT EXISTS idx_payoutRequests_nibssReference ON fint_payoutRequests(nibssReference);
CREATE INDEX IF NOT EXISTS idx_payoutRequests_initiatorId ON fint_payoutRequests(initiatorId);
