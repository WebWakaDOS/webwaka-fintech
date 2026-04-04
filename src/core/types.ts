/**
 * Shared types for WebWaka Fintech Suite
 * All monetary values are in kobo (NGN × 100) — Invariant 5: Nigeria First
 */

import type { AuthUser } from '@webwaka/core';

export interface Bindings {
  DB: D1Database;
  SESSIONS_KV: KVNamespace;
  RATE_LIMIT_KV: KVNamespace;
  MEDIA_BUCKET: R2Bucket;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  PAYSTACK_SECRET_KEY: string;
  OPENROUTER_API_KEY: string;
  TERMII_API_KEY: string;
  /** NIBSS NIP bank partner credentials */
  NIBSS_BASE_URL: string;
  NIBSS_CLIENT_ID: string;
  NIBSS_CLIENT_SECRET: string;
  NIBSS_SOURCE_BANK_CODE: string;
  NIBSS_SOURCE_ACCOUNT_NUMBER: string;
  /** Event Bus URL for cross-repo events (optional: silently skipped if absent) */
  EVENT_BUS_URL?: string;
  EVENT_BUS_SECRET?: string;
  /** AI Platform (optional: falls back to direct OpenRouter call) */
  AI_PLATFORM_URL?: string;
  INTER_SERVICE_SECRET?: string;
  /** VTPass for bill payments (optional) */
  VTPASS_API_KEY?: string;
  VTPASS_BASE_URL?: string;
  /** USSD Gateway (optional) */
  USSD_GATEWAY_URL?: string;
  USSD_GATEWAY_SECRET?: string;
  /** Virtual card issuer — Paystack or other (optional) */
  CARD_ISSUER_KEY?: string;
  CARD_ISSUER_URL?: string;
  /** Crypto exchange partner (optional) */
  CRYPTO_EXCHANGE_URL?: string;
  CRYPTO_EXCHANGE_KEY?: string;
}

/**
 * Hono Variables — typed context values injected by jwtAuthMiddleware.
 */
export interface AppVariables {
  user: AuthUser;
  tenantId: string;
}

// ─── Core Banking ─────────────────────────────────────────────────────────────

export type AccountType = 'savings' | 'current' | 'corporate' | 'fixed_deposit';
export type AccountStatus = 'active' | 'dormant' | 'frozen' | 'closed';
export type TransactionType = 'deposit' | 'withdrawal' | 'transfer' | 'fee' | 'interest';
export type TransactionStatus = 'pending' | 'success' | 'failed' | 'reversed';

export interface BankAccount {
  id: string;
  tenantId: string;
  accountNumber: string;
  customerId: string;
  accountType: AccountType;
  balanceKobo: number;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  tenantId: string;
  accountId: string;
  type: TransactionType;
  amountKobo: number;
  reference: string;
  status: TransactionStatus;
  description: string;
  createdAt: string;
}

export interface InsurancePolicy {
  id: string;
  tenantId: string;
  customerId: string;
  policyType: 'life' | 'health' | 'vehicle' | 'property';
  premiumKobo: number;
  coverageKobo: number;
  status: 'active' | 'lapsed' | 'cancelled' | 'claimed';
  startDate: string;
  endDate: string;
  createdAt: string;
}

export interface InvestmentPortfolio {
  id: string;
  tenantId: string;
  customerId: string;
  assetClass: 'stocks' | 'bonds' | 'real_estate' | 'crypto';
  principalKobo: number;
  currentValueKobo: number;
  status: 'active' | 'liquidated';
  createdAt: string;
}

// ─── NIBSS NIP Payout Types ───────────────────────────────────────────────────

export type PayoutStatus = 'pending' | 'processing' | 'confirmed' | 'failed' | 'reversed';

export interface PayoutRequest {
  id: string;
  tenantId: string;
  initiatorId: string;
  payoutType: string;
  amountKobo: number;
  destinationAccountNumber: string;
  destinationBankCode: string;
  destinationAccountName: string;
  narration: string;
  nibssReference: string;
  nibssSessionId?: string;
  status: PayoutStatus;
  settledAt?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InitiatePayoutBody {
  initiatorId: string;
  payoutType: string;
  amountKobo: number;
  destinationAccountNumber: string;
  destinationBankCode: string;
  narration: string;
}

export interface NibssWebhookPayload {
  paymentReference: string;
  sessionId: string;
  status: 'successful' | 'failed' | 'reversed';
  settledAmountKobo: number;
  responseCode: string;
  responseMessage: string;
  settledAt: string;
}

// ─── KYC Tier Enforcement (#16) ───────────────────────────────────────────────

export type KycTier = 1 | 2 | 3;

export interface KycProfile {
  id: string;
  tenantId: string;
  customerId: string;
  tier: KycTier;
  bvn?: string;
  nin?: string;
  addressVerified: boolean;
  corporateVerified: boolean;
  dailyLimitKobo: number;
  singleTxLimitKobo: number;
  monthlyLimitKobo: number;
  status: 'active' | 'suspended';
  createdAt: string;
  updatedAt: string;
}

/** CBN-defined limits by KYC tier */
export const KYC_TIER_LIMITS: Record<KycTier, { daily: number; singleTx: number; monthly: number }> = {
  1: { daily: 5_000_000, singleTx: 5_000_000, monthly: 30_000_000 },      // Tier 1: ₦50k/day, ₦300k/month
  2: { daily: 30_000_000, singleTx: 30_000_000, monthly: 200_000_000 },   // Tier 2: ₦300k/day, ₦2M/month
  3: { daily: 1_000_000_000, singleTx: 500_000_000, monthly: 0 },         // Tier 3: ₦10M/day, no monthly cap
};

// ─── AI Credit Scoring (#2) ───────────────────────────────────────────────────

export type CreditGrade = 'A' | 'B' | 'C' | 'D' | 'E';

export interface CreditScore {
  id: string;
  tenantId: string;
  customerId: string;
  score: number;        // 0–1000
  grade: CreditGrade;
  rationale?: string;
  txCountAnalyzed: number;
  modelUsed?: string;
  computedAt: string;
  expiresAt: string;
}

// ─── Loan Origination System (#18) ───────────────────────────────────────────

export type LoanStatus = 'pending' | 'approved' | 'disbursed' | 'active' | 'settled' | 'defaulted' | 'rejected';

export interface Loan {
  id: string;
  tenantId: string;
  customerId: string;
  accountId: string;
  principalKobo: number;
  interestRateBps: number;
  termDays: number;
  totalRepayableKobo: number;
  amountRepaidKobo: number;
  status: LoanStatus;
  creditScoreAtOrigination?: number;
  disbursedAt?: string;
  dueAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoanRepayment {
  id: string;
  tenantId: string;
  loanId: string;
  amountKobo: number;
  reference: string;
  status: string;
  paidAt: string;
}

// ─── Savings Goals / Ajo / Esusu (#5) ─────────────────────────────────────────

export type SavingsGoalType = 'personal' | 'group';
export type SavingsGoalStatus = 'active' | 'completed' | 'cancelled';

export interface SavingsGoal {
  id: string;
  tenantId: string;
  ownerId: string;
  name: string;
  type: SavingsGoalType;
  targetAmountKobo: number;
  currentAmountKobo: number;
  contributionKobo: number;
  cycleDays: number;
  status: SavingsGoalStatus;
  targetDate?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Virtual Cards (#3) ───────────────────────────────────────────────────────

export type CardCurrency = 'NGN' | 'USD';
export type CardStatus = 'active' | 'frozen' | 'terminated';

export interface VirtualCard {
  id: string;
  tenantId: string;
  customerId: string;
  accountId: string;
  currency: CardCurrency;
  maskedPan: string;
  expiryMonth: string;
  expiryYear: string;
  cardHolderName: string;
  status: CardStatus;
  spendingLimitKobo?: number;
  externalCardId?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Multi-Currency Wallets (#10) ─────────────────────────────────────────────

export type WalletCurrency = 'NGN' | 'USD' | 'GBP';

export interface MultiCurrencyWallet {
  id: string;
  tenantId: string;
  customerId: string;
  currency: WalletCurrency;
  balanceMinorUnits: number;
  status: 'active' | 'frozen';
  createdAt: string;
  updatedAt: string;
}

// ─── Bill Payments (#7) ───────────────────────────────────────────────────────

export type BillType = 'airtime' | 'data' | 'electricity' | 'tv' | 'water';
export type BillStatus = 'pending' | 'success' | 'failed';

export interface BillPayment {
  id: string;
  tenantId: string;
  customerId: string;
  accountId: string;
  billType: BillType;
  provider: string;
  amountKobo: number;
  phone?: string;
  meterNumber?: string;
  smartcardNumber?: string;
  reference: string;
  externalReference?: string;
  status: BillStatus;
  responseMessage?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Standing Orders (#14) ────────────────────────────────────────────────────

export interface StandingOrder {
  id: string;
  tenantId: string;
  customerId: string;
  sourceAccountId: string;
  destinationAccountNumber: string;
  destinationBankCode: string;
  destinationAccountName: string;
  amountKobo: number;
  narration: string;
  frequencyDays: number;
  status: 'active' | 'paused' | 'cancelled';
  nextExecutionAt: string;
  lastExecutedAt?: string;
  executionCount: number;
  maxExecutions?: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Split Payments (#15) ─────────────────────────────────────────────────────

export interface SplitPaymentRule {
  id: string;
  tenantId: string;
  name: string;
  sourceAccountId: string;
  status: 'active' | 'inactive';
  recipients: SplitPaymentRecipient[];
  createdAt: string;
  updatedAt: string;
}

export interface SplitPaymentRecipient {
  id: string;
  ruleId: string;
  destinationAccountId: string;
  sharePercent: number;
}

// ─── Fraud Detection (#9) ─────────────────────────────────────────────────────

export type FraudSeverity = 'low' | 'medium' | 'high' | 'critical';
export type FraudAlertStatus = 'open' | 'reviewed' | 'dismissed' | 'escalated';

export interface FraudAlert {
  id: string;
  tenantId: string;
  customerId: string;
  accountId: string;
  transactionId?: string;
  ruleTriggered: string;
  severity: FraudSeverity;
  status: FraudAlertStatus;
  details: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

// ─── Agent Banking (#12) ──────────────────────────────────────────────────────

export type AgentTxType = 'cash_in' | 'cash_out' | 'transfer';

export interface AgentTransaction {
  id: string;
  tenantId: string;
  agentId: string;
  customerId: string;
  accountId: string;
  type: AgentTxType;
  amountKobo: number;
  feeKobo: number;
  reference: string;
  posTerminalId?: string;
  status: string;
  createdAt: string;
}

// ─── Crypto On/Off Ramps (#11) ────────────────────────────────────────────────

export type CryptoDirection = 'on_ramp' | 'off_ramp';
export type CryptoCurrency = 'USDT' | 'USDC' | 'BTC';

export interface CryptoTransaction {
  id: string;
  tenantId: string;
  customerId: string;
  accountId: string;
  direction: CryptoDirection;
  cryptoCurrency: CryptoCurrency;
  cryptoAmountUnits: string;
  fiatAmountKobo: number;
  exchangeRate: string;
  externalTxHash?: string;
  status: 'pending' | 'confirmed' | 'failed';
  reference: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Debt Collection (#19) ────────────────────────────────────────────────────

export type DebtCollectionEventType = 'sms_reminder' | 'auto_debit_attempt' | 'email_reminder';

export interface DebtCollectionEvent {
  id: string;
  tenantId: string;
  loanId: string;
  customerId: string;
  type: DebtCollectionEventType;
  status: string;
  amountKobo?: number;
  message?: string;
  scheduledAt: string;
  executedAt?: string;
  createdAt: string;
}

// ─── Open Banking (#20) ───────────────────────────────────────────────────────

export type OpenBankingScope =
  | 'accounts.read'
  | 'transactions.read'
  | 'balances.read'
  | 'payments.initiate';

export interface OpenBankingApp {
  id: string;
  tenantId: string;
  appName: string;
  description?: string;
  webhookUrl?: string;
  status: 'active' | 'suspended' | 'revoked';
  scopes: OpenBankingScope[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Interest Accruals (#17) ──────────────────────────────────────────────────

export interface InterestAccrual {
  id: string;
  tenantId: string;
  accountId: string;
  customerId: string;
  accrualDate: string;
  principalKobo: number;
  annualRateBps: number;
  dailyInterestKobo: number;
  credited: boolean;
  creditedAt?: string;
  createdAt: string;
}

// ─── Overdraft (#6) ───────────────────────────────────────────────────────────

export interface OverdraftEvent {
  id: string;
  tenantId: string;
  accountId: string;
  customerId: string;
  originalTransactionRef: string;
  overdraftAmountKobo: number;
  repaymentDueAt: string;
  repaidAt?: string;
  status: 'active' | 'repaid' | 'defaulted';
  feesKobo: number;
  createdAt: string;
  updatedAt: string;
}
