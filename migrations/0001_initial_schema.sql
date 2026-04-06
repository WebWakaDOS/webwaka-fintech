-- WebWaka Fintech Suite — D1 Database Schema
-- Invariant 5: Nigeria First — All amounts in kobo integers

CREATE TABLE IF NOT EXISTS fint_bankAccounts (
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
CREATE INDEX IF NOT EXISTS idx_bankAccounts_tenantId ON fint_bankAccounts(tenantId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bankAccounts_accountNumber ON fint_bankAccounts(accountNumber);

CREATE TABLE IF NOT EXISTS fint_transactions (
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
CREATE INDEX IF NOT EXISTS idx_transactions_tenantId ON fint_transactions(tenantId);
CREATE INDEX IF NOT EXISTS idx_transactions_accountId ON fint_transactions(accountId);

CREATE TABLE IF NOT EXISTS fint_insurancePolicies (
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
CREATE INDEX IF NOT EXISTS idx_insurancePolicies_tenantId ON fint_insurancePolicies(tenantId);

CREATE TABLE IF NOT EXISTS fint_investmentPortfolios (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  assetClass TEXT NOT NULL,
  principalKobo INTEGER NOT NULL,
  currentValueKobo INTEGER NOT NULL,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_investmentPortfolios_tenantId ON fint_investmentPortfolios(tenantId);
