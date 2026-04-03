-- WebWaka Fintech Suite — D1 Database Schema
-- Invariant 5: Nigeria First — All amounts in kobo integers

CREATE TABLE IF NOT EXISTS bankAccounts (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  accountNumber TEXT NOT NULL,
  customerId TEXT NOT NULL,
  accountType TEXT NOT NULL,
  balanceKobo INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bankAccounts_tenantId ON bankAccounts(tenantId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bankAccounts_accountNumber ON bankAccounts(accountNumber);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  type TEXT NOT NULL,
  amountKobo INTEGER NOT NULL,
  reference TEXT NOT NULL,
  status TEXT NOT NULL,
  description TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_tenantId ON transactions(tenantId);
CREATE INDEX IF NOT EXISTS idx_transactions_accountId ON transactions(accountId);

CREATE TABLE IF NOT EXISTS insurancePolicies (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  policyType TEXT NOT NULL,
  premiumKobo INTEGER NOT NULL,
  coverageKobo INTEGER NOT NULL,
  status TEXT NOT NULL,
  startDate TEXT NOT NULL,
  endDate TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_insurancePolicies_tenantId ON insurancePolicies(tenantId);

CREATE TABLE IF NOT EXISTS investmentPortfolios (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  assetClass TEXT NOT NULL,
  principalKobo INTEGER NOT NULL,
  currentValueKobo INTEGER NOT NULL,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_investmentPortfolios_tenantId ON investmentPortfolios(tenantId);

-- ─── NIBSS NIP Payout Requests ────────────────────────────────────────────────
-- Tracks all platform-initiated NIP transfers (vendor payouts, rider commissions, driver settlements)
-- Invariant 5: Nigeria First — amountKobo is always kobo integers

CREATE TABLE IF NOT EXISTS payoutRequests (
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

CREATE INDEX IF NOT EXISTS idx_payoutRequests_tenantId ON payoutRequests(tenantId);
CREATE INDEX IF NOT EXISTS idx_payoutRequests_status ON payoutRequests(status);
CREATE INDEX IF NOT EXISTS idx_payoutRequests_nibssReference ON payoutRequests(nibssReference);
CREATE INDEX IF NOT EXISTS idx_payoutRequests_initiatorId ON payoutRequests(initiatorId);
