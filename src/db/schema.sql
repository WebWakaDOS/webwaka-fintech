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
  sourceAccountId TEXT,
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

-- ─── KYC Profiles (#16: KYC Tier Enforcement) ────────────────────────────────
-- tier: 1 (BVN only), 2 (BVN + address), 3 (full corporate verification)
-- Daily/monthly limits enforced per tier per CBN guidelines
CREATE TABLE IF NOT EXISTS kycProfiles (
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
CREATE INDEX IF NOT EXISTS idx_kycProfiles_tenantId ON kycProfiles(tenantId);
CREATE INDEX IF NOT EXISTS idx_kycProfiles_customerId ON kycProfiles(customerId);

-- ─── Credit Scores (#2: AI Credit Scoring) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS creditScores (
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
CREATE INDEX IF NOT EXISTS idx_creditScores_tenantId ON creditScores(tenantId);
CREATE INDEX IF NOT EXISTS idx_creditScores_customerId ON creditScores(customerId);

-- ─── Loans (#18: Loan Origination System) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS loans (
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
CREATE INDEX IF NOT EXISTS idx_loans_tenantId ON loans(tenantId);
CREATE INDEX IF NOT EXISTS idx_loans_customerId ON loans(customerId);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);

CREATE TABLE IF NOT EXISTS loanRepayments (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  loanId TEXT NOT NULL,
  amountKobo INTEGER NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'success',
  paidAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loanRepayments_loanId ON loanRepayments(loanId);

-- ─── Savings Goals (#5: Ajo/Esusu) ───────────────────────────────────────────
-- type: personal | group (Ajo/Esusu)
CREATE TABLE IF NOT EXISTS savingsGoals (
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
CREATE INDEX IF NOT EXISTS idx_savingsGoals_tenantId ON savingsGoals(tenantId);
CREATE INDEX IF NOT EXISTS idx_savingsGoals_ownerId ON savingsGoals(ownerId);

CREATE TABLE IF NOT EXISTS savingsGoalMembers (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  goalId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  joinedAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_savingsGoalMembers_unique ON savingsGoalMembers(goalId, customerId);

CREATE TABLE IF NOT EXISTS savingsGoalContributions (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  goalId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  amountKobo INTEGER NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_savingsGoalContributions_goalId ON savingsGoalContributions(goalId);

-- ─── Virtual Cards (#3: Virtual Card Issuance) ───────────────────────────────
CREATE TABLE IF NOT EXISTS virtualCards (
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
CREATE INDEX IF NOT EXISTS idx_virtualCards_tenantId ON virtualCards(tenantId);
CREATE INDEX IF NOT EXISTS idx_virtualCards_customerId ON virtualCards(customerId);

-- ─── Multi-Currency Wallets (#10) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS multiCurrencyWallets (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  customerId TEXT NOT NULL,
  currency TEXT NOT NULL,      -- NGN, USD, GBP
  balanceMinorUnits INTEGER NOT NULL DEFAULT 0,  -- kobo for NGN, cents for USD/GBP
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_multiCurrencyWallets_unique ON multiCurrencyWallets(tenantId, customerId, currency);

-- ─── Bill Payments (#7: VTPass Integration) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS billPayments (
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
CREATE INDEX IF NOT EXISTS idx_billPayments_tenantId ON billPayments(tenantId);
CREATE INDEX IF NOT EXISTS idx_billPayments_customerId ON billPayments(customerId);

-- ─── Standing Orders (#14: Direct Debits) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS standingOrders (
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
CREATE INDEX IF NOT EXISTS idx_standingOrders_tenantId ON standingOrders(tenantId);
CREATE INDEX IF NOT EXISTS idx_standingOrders_nextExecution ON standingOrders(nextExecutionAt);

-- ─── Split Payment Rules (#15) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS splitPaymentRules (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  name TEXT NOT NULL,
  sourceAccountId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_splitPaymentRules_tenantId ON splitPaymentRules(tenantId);

CREATE TABLE IF NOT EXISTS splitPaymentRecipients (
  id TEXT PRIMARY KEY,
  ruleId TEXT NOT NULL,
  tenantId TEXT NOT NULL,
  destinationAccountId TEXT NOT NULL,
  sharePercent INTEGER NOT NULL,  -- 0–100, all recipients must sum to 100
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_splitPaymentRecipients_ruleId ON splitPaymentRecipients(ruleId);

-- ─── Fraud Alerts (#9: Fraud Detection Rules Engine) ─────────────────────────
CREATE TABLE IF NOT EXISTS fraudAlerts (
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
CREATE INDEX IF NOT EXISTS idx_fraudAlerts_tenantId ON fraudAlerts(tenantId);
CREATE INDEX IF NOT EXISTS idx_fraudAlerts_status ON fraudAlerts(status);

-- ─── Agent Banking / POS (#12) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agentTransactions (
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
CREATE INDEX IF NOT EXISTS idx_agentTransactions_tenantId ON agentTransactions(tenantId);
CREATE INDEX IF NOT EXISTS idx_agentTransactions_agentId ON agentTransactions(agentId);

-- ─── Crypto On/Off Ramps (#11) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cryptoTransactions (
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
CREATE INDEX IF NOT EXISTS idx_cryptoTransactions_tenantId ON cryptoTransactions(tenantId);
CREATE INDEX IF NOT EXISTS idx_cryptoTransactions_customerId ON cryptoTransactions(customerId);

-- ─── Debt Collection Reminders (#19) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS debtCollectionEvents (
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
CREATE INDEX IF NOT EXISTS idx_debtCollectionEvents_loanId ON debtCollectionEvents(loanId);
CREATE INDEX IF NOT EXISTS idx_debtCollectionEvents_tenantId ON debtCollectionEvents(tenantId);

-- ─── Open Banking API (#20) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS openBankingApps (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  appName TEXT NOT NULL,
  description TEXT,
  webhookUrl TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  scopes TEXT NOT NULL DEFAULT '[]',  -- JSON array: ["accounts.read", "transactions.read"]
  createdBy TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_openBankingApps_tenantId ON openBankingApps(tenantId);

CREATE TABLE IF NOT EXISTS openBankingApiKeys (
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
CREATE INDEX IF NOT EXISTS idx_openBankingApiKeys_appId ON openBankingApiKeys(appId);

-- ─── Reconciliation Reports (#13) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reconciliationReports (
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
CREATE INDEX IF NOT EXISTS idx_reconciliationReports_tenantId ON reconciliationReports(tenantId);
CREATE INDEX IF NOT EXISTS idx_reconciliationReports_date ON reconciliationReports(reportDate);

-- ─── CBN Regulatory Reports (#4) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cbnReports (
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
CREATE INDEX IF NOT EXISTS idx_cbnReports_tenantId ON cbnReports(tenantId);
CREATE INDEX IF NOT EXISTS idx_cbnReports_type ON cbnReports(reportType);

-- ─── Interest Accruals (#17: Interest-Bearing Accounts) ──────────────────────
CREATE TABLE IF NOT EXISTS interestAccruals (
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
CREATE INDEX IF NOT EXISTS idx_interestAccruals_accountId ON interestAccruals(accountId);
CREATE INDEX IF NOT EXISTS idx_interestAccruals_tenantId ON interestAccruals(tenantId);

-- ─── Overdraft Events (#6: Overdraft Protection) ─────────────────────────────
CREATE TABLE IF NOT EXISTS overdraftEvents (
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
CREATE INDEX IF NOT EXISTS idx_overdraftEvents_accountId ON overdraftEvents(accountId);
CREATE INDEX IF NOT EXISTS idx_overdraftEvents_tenantId ON overdraftEvents(tenantId);

-- ─── USSD Sessions (#8: USSD Banking Interface) ───────────────────────────────
CREATE TABLE IF NOT EXISTS ussdSessions (
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
CREATE INDEX IF NOT EXISTS idx_ussdSessions_tenantId ON ussdSessions(tenantId);
CREATE INDEX IF NOT EXISTS idx_ussdSessions_msisdn ON ussdSessions(msisdn);
