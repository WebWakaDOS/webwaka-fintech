-- WebWaka Fintech Suite — Enhancement Migration
-- Phase 1: Core Banking & Compliance + All Enhancement Backlog Tables

-- ─── KYC Profiles (#16) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_kycProfiles (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL UNIQUE,
  tier INTEGER NOT NULL DEFAULT 1,
  bvn TEXT,
  nin TEXT,
  addressVerified INTEGER NOT NULL DEFAULT 0,
  corporateVerified INTEGER NOT NULL DEFAULT 0,
  dailyLimitKobo INTEGER NOT NULL DEFAULT 5000000,
  singleTxLimitKobo INTEGER NOT NULL DEFAULT 5000000,
  monthlyLimitKobo INTEGER NOT NULL DEFAULT 30000000,
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kycProfiles_tenantId ON fint_kycProfiles(tenantId);
CREATE INDEX IF NOT EXISTS idx_kycProfiles_customerId ON fint_kycProfiles(customerId);

-- ─── Credit Scores (#2) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_creditScores (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  score INTEGER NOT NULL,
  grade TEXT NOT NULL,
  rationale TEXT,
  txCountAnalyzed INTEGER NOT NULL DEFAULT 0,
  modelUsed TEXT,
  computedAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creditScores_tenantId ON fint_creditScores(tenantId);
CREATE INDEX IF NOT EXISTS idx_creditScores_customerId ON fint_creditScores(customerId);

-- ─── Loans (#18) ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_loans (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  principalKobo INTEGER NOT NULL,
  interestRateBps INTEGER NOT NULL,
  termDays INTEGER NOT NULL,
  totalRepayableKobo INTEGER NOT NULL,
  amountRepaidKobo INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  creditScoreAtOrigination INTEGER,
  disbursedAt TEXT,
  dueAt TEXT,
  rejectionReason TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loans_tenantId ON fint_loans(tenantId);
CREATE INDEX IF NOT EXISTS idx_loans_customerId ON fint_loans(customerId);
CREATE INDEX IF NOT EXISTS idx_loans_status ON fint_loans(status);

CREATE TABLE IF NOT EXISTS fint_loanRepayments (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  loanId TEXT NOT NULL,
  amountKobo INTEGER NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'success',
  paidAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loanRepayments_loanId ON fint_loanRepayments(loanId);

-- ─── Savings Goals (#5) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_savingsGoals (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  ownerId TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'personal',
  targetAmountKobo INTEGER NOT NULL,
  currentAmountKobo INTEGER NOT NULL DEFAULT 0,
  contributionKobo INTEGER NOT NULL,
  cycleDays INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'active',
  targetDate TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_savingsGoals_tenantId ON fint_savingsGoals(tenantId);
CREATE INDEX IF NOT EXISTS idx_savingsGoals_ownerId ON fint_savingsGoals(ownerId);

CREATE TABLE IF NOT EXISTS fint_savingsGoalMembers (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  goalId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  joinedAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_savingsGoalMembers_unique ON fint_savingsGoalMembers(goalId, customerId);

CREATE TABLE IF NOT EXISTS fint_savingsGoalContributions (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  goalId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  amountKobo INTEGER NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_savingsGoalContributions_goalId ON fint_savingsGoalContributions(goalId);

-- ─── Virtual Cards (#3) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_virtualCards (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  maskedPan TEXT NOT NULL,
  expiryMonth TEXT NOT NULL,
  expiryYear TEXT NOT NULL,
  cardHolderName TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  spendingLimitKobo INTEGER,
  externalCardId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_virtualCards_tenantId ON fint_virtualCards(tenantId);
CREATE INDEX IF NOT EXISTS idx_virtualCards_customerId ON fint_virtualCards(customerId);

-- ─── Multi-Currency Wallets (#10) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_multiCurrencyWallets (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  currency TEXT NOT NULL,
  balanceMinorUnits INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_multiCurrencyWallets_unique ON fint_multiCurrencyWallets(tenantId, customerId, currency);

-- ─── Bill Payments (#7) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_billPayments (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  billType TEXT NOT NULL,
  provider TEXT NOT NULL,
  amountKobo INTEGER NOT NULL,
  phone TEXT,
  meterNumber TEXT,
  smartcardNumber TEXT,
  reference TEXT NOT NULL UNIQUE,
  externalReference TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  responseMessage TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_billPayments_tenantId ON fint_billPayments(tenantId);
CREATE INDEX IF NOT EXISTS idx_billPayments_customerId ON fint_billPayments(customerId);

-- ─── Standing Orders (#14) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_standingOrders (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  sourceAccountId TEXT NOT NULL,
  destinationAccountNumber TEXT NOT NULL,
  destinationBankCode TEXT NOT NULL,
  destinationAccountName TEXT NOT NULL,
  amountKobo INTEGER NOT NULL,
  narration TEXT NOT NULL,
  frequencyDays INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  nextExecutionAt TEXT NOT NULL,
  lastExecutedAt TEXT,
  executionCount INTEGER NOT NULL DEFAULT 0,
  maxExecutions INTEGER,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_standingOrders_tenantId ON fint_standingOrders(tenantId);
CREATE INDEX IF NOT EXISTS idx_standingOrders_nextExecution ON fint_standingOrders(nextExecutionAt);

-- ─── Split Payments (#15) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_splitPaymentRules (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  name TEXT NOT NULL,
  sourceAccountId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_splitPaymentRules_tenantId ON fint_splitPaymentRules(tenantId);

CREATE TABLE IF NOT EXISTS fint_splitPaymentRecipients (
  id TEXT PRIMARY KEY,
  ruleId TEXT NOT NULL,
  tenantId TEXT NOT NULL,
  destinationAccountId TEXT NOT NULL,
  sharePercent INTEGER NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_splitPaymentRecipients_ruleId ON fint_splitPaymentRecipients(ruleId);

-- ─── Fraud Alerts (#9) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_fraudAlerts (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  transactionId TEXT,
  ruleTriggered TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  details TEXT NOT NULL,
  reviewedBy TEXT,
  reviewedAt TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fraudAlerts_tenantId ON fint_fraudAlerts(tenantId);
CREATE INDEX IF NOT EXISTS idx_fraudAlerts_status ON fint_fraudAlerts(status);

-- ─── Agent Banking (#12) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_agentTransactions (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  agentId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  type TEXT NOT NULL,
  amountKobo INTEGER NOT NULL,
  feeKobo INTEGER NOT NULL DEFAULT 0,
  reference TEXT NOT NULL UNIQUE,
  posTerminalId TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agentTransactions_tenantId ON fint_agentTransactions(tenantId);
CREATE INDEX IF NOT EXISTS idx_agentTransactions_agentId ON fint_agentTransactions(agentId);

-- ─── Crypto On/Off Ramps (#11) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_cryptoTransactions (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  direction TEXT NOT NULL,
  cryptoCurrency TEXT NOT NULL,
  cryptoAmountUnits TEXT NOT NULL,
  fiatAmountKobo INTEGER NOT NULL,
  exchangeRate TEXT NOT NULL,
  externalTxHash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reference TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cryptoTransactions_tenantId ON fint_cryptoTransactions(tenantId);
CREATE INDEX IF NOT EXISTS idx_cryptoTransactions_customerId ON fint_cryptoTransactions(customerId);

-- ─── Debt Collection (#19) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_debtCollectionEvents (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  loanId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  amountKobo INTEGER,
  message TEXT,
  scheduledAt TEXT NOT NULL,
  executedAt TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_debtCollectionEvents_loanId ON fint_debtCollectionEvents(loanId);
CREATE INDEX IF NOT EXISTS idx_debtCollectionEvents_tenantId ON fint_debtCollectionEvents(tenantId);

-- ─── Open Banking (#20) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_openBankingApps (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  appName TEXT NOT NULL,
  description TEXT,
  webhookUrl TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  scopes TEXT NOT NULL DEFAULT '[]',
  createdBy TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_openBankingApps_tenantId ON fint_openBankingApps(tenantId);

CREATE TABLE IF NOT EXISTS fint_openBankingApiKeys (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  appId TEXT NOT NULL,
  keyHash TEXT NOT NULL UNIQUE,
  keyPrefix TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  lastUsedAt TEXT,
  expiresAt TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_openBankingApiKeys_appId ON fint_openBankingApiKeys(appId);

-- ─── Reconciliation (#13) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_reconciliationReports (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  reportDate TEXT NOT NULL,
  totalTransactions INTEGER NOT NULL DEFAULT 0,
  totalDebitsKobo INTEGER NOT NULL DEFAULT 0,
  totalCreditsKobo INTEGER NOT NULL DEFAULT 0,
  discrepanciesFound INTEGER NOT NULL DEFAULT 0,
  discrepancies TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  generatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reconciliationReports_tenantId ON fint_reconciliationReports(tenantId);
CREATE INDEX IF NOT EXISTS idx_reconciliationReports_date ON fint_reconciliationReports(reportDate);

-- ─── CBN Reports (#4) ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_cbnReports (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  reportType TEXT NOT NULL,
  periodStart TEXT NOT NULL,
  periodEnd TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'generated',
  generatedAt TEXT NOT NULL,
  submittedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_cbnReports_tenantId ON fint_cbnReports(tenantId);
CREATE INDEX IF NOT EXISTS idx_cbnReports_type ON fint_cbnReports(reportType);

-- ─── Interest Accruals (#17) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_interestAccruals (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  accrualDate TEXT NOT NULL,
  principalKobo INTEGER NOT NULL,
  annualRateBps INTEGER NOT NULL,
  dailyInterestKobo INTEGER NOT NULL,
  credited INTEGER NOT NULL DEFAULT 0,
  creditedAt TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interestAccruals_accountId ON fint_interestAccruals(accountId);
CREATE INDEX IF NOT EXISTS idx_interestAccruals_tenantId ON fint_interestAccruals(tenantId);

-- ─── Overdraft Events (#6) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_overdraftEvents (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  originalTransactionRef TEXT NOT NULL,
  overdraftAmountKobo INTEGER NOT NULL,
  repaymentDueAt TEXT NOT NULL,
  repaidAt TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  feesKobo INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_overdraftEvents_accountId ON fint_overdraftEvents(accountId);
CREATE INDEX IF NOT EXISTS idx_overdraftEvents_tenantId ON fint_overdraftEvents(tenantId);

-- ─── USSD Sessions (#8) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_ussdSessions (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  sessionCode TEXT NOT NULL UNIQUE,
  msisdn TEXT NOT NULL,
  customerId TEXT,
  state TEXT NOT NULL,
  menuPath TEXT NOT NULL DEFAULT '[]',
  pendingAction TEXT,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ussdSessions_tenantId ON fint_ussdSessions(tenantId);
CREATE INDEX IF NOT EXISTS idx_ussdSessions_msisdn ON fint_ussdSessions(msisdn);
