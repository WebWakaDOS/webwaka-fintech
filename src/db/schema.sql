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

-- ─── NIBSS NIP Payout Requests ────────────────────────────────────────────────
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
  sourceAccountId TEXT,
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

-- ─── KYC Profiles (#16: KYC Tier Enforcement) ────────────────────────────────
-- tier: 1 (BVN only), 2 (BVN + address), 3 (full corporate verification)
-- Daily/monthly limits enforced per tier per CBN guidelines
CREATE TABLE IF NOT EXISTS fint_kycProfiles (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL UNIQUE,
  tier INTEGER NOT NULL DEFAULT 1,  -- 1, 2, or 3
  bvn TEXT,
  nin TEXT,
  addressVerified INTEGER NOT NULL DEFAULT 0,
  corporateVerified INTEGER NOT NULL DEFAULT 0,
  dailyLimitKobo INTEGER NOT NULL DEFAULT 5000000,    -- Tier 1: ₦50,000/day
  singleTxLimitKobo INTEGER NOT NULL DEFAULT 5000000, -- Tier 1: ₦50,000/tx
  monthlyLimitKobo INTEGER NOT NULL DEFAULT 30000000, -- Tier 1: ₦300,000/month
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kycProfiles_tenantId ON fint_kycProfiles(tenantId);
CREATE INDEX IF NOT EXISTS idx_kycProfiles_customerId ON fint_kycProfiles(customerId);

-- ─── Credit Scores (#2: AI Credit Scoring) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_creditScores (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  score INTEGER NOT NULL,  -- 0–1000
  grade TEXT NOT NULL,     -- A, B, C, D, E
  rationale TEXT,          -- AI-generated explanation
  txCountAnalyzed INTEGER NOT NULL DEFAULT 0,
  modelUsed TEXT,
  computedAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL  -- Scores expire after 90 days
);
CREATE INDEX IF NOT EXISTS idx_creditScores_tenantId ON fint_creditScores(tenantId);
CREATE INDEX IF NOT EXISTS idx_creditScores_customerId ON fint_creditScores(customerId);

-- ─── Loans (#18: Loan Origination System) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_loans (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  accountId TEXT NOT NULL,     -- disbursement account
  principalKobo INTEGER NOT NULL,
  interestRateBps INTEGER NOT NULL,  -- basis points (100 bps = 1%)
  termDays INTEGER NOT NULL,
  totalRepayableKobo INTEGER NOT NULL,
  amountRepaidKobo INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, approved, disbursed, active, settled, defaulted, rejected
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

-- ─── Savings Goals (#5: Ajo/Esusu) ───────────────────────────────────────────
-- type: personal | group (Ajo/Esusu)
CREATE TABLE IF NOT EXISTS fint_savingsGoals (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  ownerId TEXT NOT NULL,       -- customerId of creator
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'personal',  -- personal | group
  targetAmountKobo INTEGER NOT NULL,
  currentAmountKobo INTEGER NOT NULL DEFAULT 0,
  contributionKobo INTEGER NOT NULL,   -- expected contribution per cycle
  cycleDays INTEGER NOT NULL DEFAULT 30,  -- contribution frequency in days
  status TEXT NOT NULL DEFAULT 'active',  -- active | completed | cancelled
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

-- ─── Virtual Cards (#3: Virtual Card Issuance) ───────────────────────────────
CREATE TABLE IF NOT EXISTS fint_virtualCards (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  accountId TEXT NOT NULL,     -- linked bank account for funding
  currency TEXT NOT NULL DEFAULT 'NGN',  -- NGN | USD
  maskedPan TEXT NOT NULL,     -- e.g. 5399 **** **** 1234
  expiryMonth TEXT NOT NULL,
  expiryYear TEXT NOT NULL,
  cardHolderName TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active | frozen | terminated
  spendingLimitKobo INTEGER,   -- optional daily limit
  externalCardId TEXT,         -- ID from card issuer (Paystack, etc.)
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
  currency TEXT NOT NULL,      -- NGN, USD, GBP
  balanceMinorUnits INTEGER NOT NULL DEFAULT 0,  -- kobo for NGN, cents for USD/GBP
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_multiCurrencyWallets_unique ON fint_multiCurrencyWallets(tenantId, customerId, currency);

-- ─── Bill Payments (#7: VTPass Integration) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_billPayments (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  billType TEXT NOT NULL,      -- airtime | data | electricity | tv | water
  provider TEXT NOT NULL,      -- MTN, DSTV, EKEDC, etc.
  amountKobo INTEGER NOT NULL,
  phone TEXT,                  -- for airtime/data
  meterNumber TEXT,            -- for electricity
  smartcardNumber TEXT,        -- for TV
  reference TEXT NOT NULL UNIQUE,
  externalReference TEXT,      -- from VTPass
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | success | failed
  responseMessage TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_billPayments_tenantId ON fint_billPayments(tenantId);
CREATE INDEX IF NOT EXISTS idx_billPayments_customerId ON fint_billPayments(customerId);

-- ─── Standing Orders (#14: Direct Debits) ─────────────────────────────────────
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
  frequencyDays INTEGER NOT NULL,  -- 1=daily, 7=weekly, 30=monthly
  status TEXT NOT NULL DEFAULT 'active',  -- active | paused | cancelled
  nextExecutionAt TEXT NOT NULL,
  lastExecutedAt TEXT,
  executionCount INTEGER NOT NULL DEFAULT 0,
  maxExecutions INTEGER,  -- null = indefinite
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_standingOrders_tenantId ON fint_standingOrders(tenantId);
CREATE INDEX IF NOT EXISTS idx_standingOrders_nextExecution ON fint_standingOrders(nextExecutionAt);

-- ─── Split Payment Rules (#15) ────────────────────────────────────────────────
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
  sharePercent INTEGER NOT NULL,  -- 0–100, all recipients must sum to 100
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_splitPaymentRecipients_ruleId ON fint_splitPaymentRecipients(ruleId);

-- ─── Fraud Alerts (#9: Fraud Detection Rules Engine) ─────────────────────────
CREATE TABLE IF NOT EXISTS fint_fraudAlerts (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  transactionId TEXT,
  ruleTriggered TEXT NOT NULL,   -- e.g. 'velocity_breach', 'large_amount', 'odd_hours'
  severity TEXT NOT NULL,        -- low | medium | high | critical
  status TEXT NOT NULL DEFAULT 'open',  -- open | reviewed | dismissed | escalated
  details TEXT NOT NULL,         -- JSON string of alert details
  reviewedBy TEXT,
  reviewedAt TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fraudAlerts_tenantId ON fint_fraudAlerts(tenantId);
CREATE INDEX IF NOT EXISTS idx_fraudAlerts_status ON fint_fraudAlerts(status);

-- ─── Agent Banking / POS (#12) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_agentTransactions (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  agentId TEXT NOT NULL,        -- customerId of the agent
  customerId TEXT NOT NULL,     -- end customer
  accountId TEXT NOT NULL,
  type TEXT NOT NULL,           -- cash_in | cash_out | transfer
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
  direction TEXT NOT NULL,      -- on_ramp (NGN→crypto) | off_ramp (crypto→NGN)
  cryptoCurrency TEXT NOT NULL, -- USDT, USDC, BTC
  cryptoAmountUnits TEXT NOT NULL,  -- stored as string to preserve precision
  fiatAmountKobo INTEGER NOT NULL,
  exchangeRate TEXT NOT NULL,   -- rate at time of transaction
  externalTxHash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | confirmed | failed
  reference TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cryptoTransactions_tenantId ON fint_cryptoTransactions(tenantId);
CREATE INDEX IF NOT EXISTS idx_cryptoTransactions_customerId ON fint_cryptoTransactions(customerId);

-- ─── Debt Collection Reminders (#19) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_debtCollectionEvents (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  loanId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  type TEXT NOT NULL,           -- sms_reminder | auto_debit_attempt | email_reminder
  status TEXT NOT NULL,         -- sent | delivered | failed | deducted | debit_failed
  amountKobo INTEGER,           -- for auto_debit_attempt
  message TEXT,
  scheduledAt TEXT NOT NULL,
  executedAt TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_debtCollectionEvents_loanId ON fint_debtCollectionEvents(loanId);
CREATE INDEX IF NOT EXISTS idx_debtCollectionEvents_tenantId ON fint_debtCollectionEvents(tenantId);

-- ─── Open Banking API (#20) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_openBankingApps (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  appName TEXT NOT NULL,
  description TEXT,
  webhookUrl TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  scopes TEXT NOT NULL DEFAULT '[]',  -- JSON array: ["accounts.read", "fint_transactions.read"]
  createdBy TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_openBankingApps_tenantId ON fint_openBankingApps(tenantId);

CREATE TABLE IF NOT EXISTS fint_openBankingApiKeys (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  appId TEXT NOT NULL,
  keyHash TEXT NOT NULL UNIQUE,  -- bcrypt/SHA-256 hash of the API key
  keyPrefix TEXT NOT NULL,       -- first 8 chars for identification
  status TEXT NOT NULL DEFAULT 'active',  -- active | revoked
  lastUsedAt TEXT,
  expiresAt TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_openBankingApiKeys_appId ON fint_openBankingApiKeys(appId);

-- ─── Reconciliation Reports (#13) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_reconciliationReports (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  reportDate TEXT NOT NULL,     -- YYYY-MM-DD
  totalTransactions INTEGER NOT NULL DEFAULT 0,
  totalDebitsKobo INTEGER NOT NULL DEFAULT 0,
  totalCreditsKobo INTEGER NOT NULL DEFAULT 0,
  discrepanciesFound INTEGER NOT NULL DEFAULT 0,
  discrepancies TEXT,           -- JSON array of discrepancy records
  status TEXT NOT NULL DEFAULT 'completed',
  generatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reconciliationReports_tenantId ON fint_reconciliationReports(tenantId);
CREATE INDEX IF NOT EXISTS idx_reconciliationReports_date ON fint_reconciliationReports(reportDate);

-- ─── CBN Regulatory Reports (#4) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fint_cbnReports (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  reportType TEXT NOT NULL,     -- daily_tx_summary | suspicious_tx | large_cash
  periodStart TEXT NOT NULL,
  periodEnd TEXT NOT NULL,
  payload TEXT NOT NULL,        -- JSON serialized report data
  status TEXT NOT NULL DEFAULT 'generated',  -- generated | submitted | acknowledged
  generatedAt TEXT NOT NULL,
  submittedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_cbnReports_tenantId ON fint_cbnReports(tenantId);
CREATE INDEX IF NOT EXISTS idx_cbnReports_type ON fint_cbnReports(reportType);

-- ─── Interest Accruals (#17: Interest-Bearing Accounts) ──────────────────────
CREATE TABLE IF NOT EXISTS fint_interestAccruals (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  accrualDate TEXT NOT NULL,    -- YYYY-MM-DD
  principalKobo INTEGER NOT NULL,
  annualRateBps INTEGER NOT NULL,  -- basis points
  dailyInterestKobo INTEGER NOT NULL,
  credited INTEGER NOT NULL DEFAULT 0,  -- 1 = credited to account
  creditedAt TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interestAccruals_accountId ON fint_interestAccruals(accountId);
CREATE INDEX IF NOT EXISTS idx_interestAccruals_tenantId ON fint_interestAccruals(tenantId);

-- ─── Overdraft Events (#6: Overdraft Protection) ─────────────────────────────
CREATE TABLE IF NOT EXISTS fint_overdraftEvents (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  originalTransactionRef TEXT NOT NULL,
  overdraftAmountKobo INTEGER NOT NULL,    -- amount covered by overdraft
  repaymentDueAt TEXT NOT NULL,
  repaidAt TEXT,
  status TEXT NOT NULL DEFAULT 'active',   -- active | repaid | defaulted
  feesKobo INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_overdraftEvents_accountId ON fint_overdraftEvents(accountId);
CREATE INDEX IF NOT EXISTS idx_overdraftEvents_tenantId ON fint_overdraftEvents(tenantId);

-- ─── USSD Sessions (#8: USSD Banking Interface) ───────────────────────────────
CREATE TABLE IF NOT EXISTS fint_ussdSessions (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  sessionCode TEXT NOT NULL UNIQUE,
  msisdn TEXT NOT NULL,         -- mobile number
  customerId TEXT,              -- resolved after PIN entry
  state TEXT NOT NULL,          -- current menu state
  menuPath TEXT NOT NULL DEFAULT '[]',  -- JSON array of navigation history
  pendingAction TEXT,           -- JSON: action awaiting confirmation
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ussdSessions_tenantId ON fint_ussdSessions(tenantId);
CREATE INDEX IF NOT EXISTS idx_ussdSessions_msisdn ON fint_ussdSessions(msisdn);
