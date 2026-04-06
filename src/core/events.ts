/**
 * WebWaka Event Bus Publisher — FT-005 Enhanced
 *
 * Invariant 1 (Event-Driven Architecture): All cross-repo state changes are
 * communicated via events, not direct API calls.
 *
 * Full event coverage for all financial products:
 *   Banking:     banking.deposit, banking.withdrawal, banking.transfer
 *   Payouts:     payout.completed, payout.failed
 *   Lending:     lending.disbursed, lending.repayment, lending.defaulted
 *   Wallets:     wallet.funded, wallet.debited, wallet.converted
 *   Insurance:   insurance.policy_created, insurance.claim_filed
 *   Investment:  investment.deposited, investment.liquidated
 *   Crypto:      crypto.on_ramp, crypto.off_ramp
 *   Agent:       agent.cash_in, agent.cash_out
 *   KYC:         kyc.verified, kyc.tier_upgraded
 *   OpenBanking: open_banking.account_linked, open_banking.payment_initiated
 *   Paystack:    paystack.payment_success, paystack.refund_initiated
 *
 * Consumers:
 *   - webwaka-central-mgmt — immutable financial ledger recording
 *   - webwaka-commerce     — vendor payout ledger updates
 *   - webwaka-logistics    — rider commission ledger updates
 *   - webwaka-transport    — driver settlement ledger updates
 *
 * The Event Bus URL and secret are optional bindings. When absent (e.g. local
 * dev), events are logged to console and silently skipped — the originating
 * operation still succeeds.
 */

// ─── Payout Events ────────────────────────────────────────────────────────────

export interface PayoutCompletedEvent {
  event: 'payout.completed';
  payoutRequestId: string;
  tenantId: string;
  initiatorId: string;
  payoutType: string;
  amountKobo: number;
  destinationAccountNumber: string;
  destinationBankCode: string;
  destinationAccountName: string;
  nibssReference: string;
  nibssSessionId: string;
  settledAt: string;
}

export interface PayoutFailedEvent {
  event: 'payout.failed';
  payoutRequestId: string;
  tenantId: string;
  initiatorId: string;
  payoutType: string;
  amountKobo: number;
  nibssReference: string;
  failureReason: string;
  failedAt: string;
}

// ─── Banking Events ────────────────────────────────────────────────────────────

export interface BankingDepositEvent {
  event: 'banking.deposit';
  transactionId: string;
  tenantId: string;
  accountId: string;
  customerId: string;
  amountKobo: number;
  reference: string;
  description?: string;
  occurredAt: string;
}

export interface BankingWithdrawalEvent {
  event: 'banking.withdrawal';
  transactionId: string;
  tenantId: string;
  accountId: string;
  customerId: string;
  amountKobo: number;
  reference: string;
  description?: string;
  occurredAt: string;
}

export interface BankingTransferEvent {
  event: 'banking.transfer';
  transactionId: string;
  tenantId: string;
  accountId: string;
  customerId: string;
  amountKobo: number;
  reference: string;
  description?: string;
  occurredAt: string;
}

// ─── Lending Events ───────────────────────────────────────────────────────────

export interface LendingDisbursedEvent {
  event: 'lending.disbursed';
  loanId: string;
  tenantId: string;
  customerId: string;
  accountId: string;
  principalKobo: number;
  interestRateBps: number;
  termDays: number;
  totalRepayableKobo: number;
  disbursedAt: string;
  dueAt: string;
}

export interface LendingRepaymentEvent {
  event: 'lending.repayment';
  repaymentId: string;
  loanId: string;
  tenantId: string;
  customerId: string;
  amountKobo: number;
  reference: string;
  newStatus: string;
  remainingKobo: number;
  paidAt: string;
}

export interface LendingDefaultedEvent {
  event: 'lending.defaulted';
  loanId: string;
  tenantId: string;
  customerId: string;
  outstandingKobo: number;
  occurredAt: string;
}

// ─── Wallet Events ────────────────────────────────────────────────────────────

export interface WalletFundedEvent {
  event: 'wallet.funded';
  walletId: string;
  tenantId: string;
  customerId: string;
  currency: string;
  amountMinorUnits: number;
  newBalanceMinorUnits: number;
  description?: string;
  occurredAt: string;
}

export interface WalletDebitedEvent {
  event: 'wallet.debited';
  walletId: string;
  tenantId: string;
  customerId: string;
  currency: string;
  amountMinorUnits: number;
  newBalanceMinorUnits: number;
  description?: string;
  occurredAt: string;
}

export interface WalletConvertedEvent {
  event: 'wallet.converted';
  tenantId: string;
  customerId: string;
  fromCurrency: string;
  toCurrency: string;
  fromAmountMinorUnits: number;
  toAmountMinorUnits: number;
  exchangeRate: number;
  occurredAt: string;
}

// ─── Insurance Events ─────────────────────────────────────────────────────────

export interface InsurancePolicyCreatedEvent {
  event: 'insurance.policy_created';
  policyId: string;
  tenantId: string;
  customerId: string;
  policyType: string;
  premiumKobo: number;
  coverageKobo: number;
  startDate: string;
  endDate: string;
  createdAt: string;
}

export interface InsuranceClaimFiledEvent {
  event: 'insurance.claim_filed';
  claimId: string;
  policyId: string;
  tenantId: string;
  customerId: string;
  claimAmountKobo: number;
  filedAt: string;
}

// ─── Investment Events ────────────────────────────────────────────────────────

export interface InvestmentDepositedEvent {
  event: 'investment.deposited';
  portfolioId: string;
  tenantId: string;
  customerId: string;
  assetClass: string;
  principalKobo: number;
  occurredAt: string;
}

export interface InvestmentLiquidatedEvent {
  event: 'investment.liquidated';
  portfolioId: string;
  tenantId: string;
  customerId: string;
  assetClass: string;
  valueKobo: number;
  occurredAt: string;
}

// ─── Crypto Events ────────────────────────────────────────────────────────────

export interface CryptoOnRampEvent {
  event: 'crypto.on_ramp';
  transactionId: string;
  tenantId: string;
  customerId: string;
  cryptoCurrency: string;
  cryptoAmountUnits: string;
  fiatAmountKobo: number;
  occurredAt: string;
}

export interface CryptoOffRampEvent {
  event: 'crypto.off_ramp';
  transactionId: string;
  tenantId: string;
  customerId: string;
  cryptoCurrency: string;
  cryptoAmountUnits: string;
  fiatAmountKobo: number;
  occurredAt: string;
}

// ─── Agent Banking Events ─────────────────────────────────────────────────────

export interface AgentCashInEvent {
  event: 'agent.cash_in';
  transactionId: string;
  tenantId: string;
  agentId: string;
  customerId: string;
  amountKobo: number;
  feeKobo: number;
  reference: string;
  occurredAt: string;
}

export interface AgentCashOutEvent {
  event: 'agent.cash_out';
  transactionId: string;
  tenantId: string;
  agentId: string;
  customerId: string;
  amountKobo: number;
  feeKobo: number;
  reference: string;
  occurredAt: string;
}

// ─── KYC Events ───────────────────────────────────────────────────────────────

export interface KycVerifiedEvent {
  event: 'kyc.verified';
  verificationId: string;
  tenantId: string;
  customerId: string;
  verificationType: string;
  provider: string;
  occurredAt: string;
}

export interface KycTierUpgradedEvent {
  event: 'kyc.tier_upgraded';
  tenantId: string;
  customerId: string;
  previousTier: number;
  newTier: number;
  occurredAt: string;
}

// ─── Open Banking Events ──────────────────────────────────────────────────────

export interface OpenBankingAccountLinkedEvent {
  event: 'open_banking.account_linked';
  consentId: string;
  externalAccountId: string;
  tenantId: string;
  customerId: string;
  bankName: string;
  currency: string;
  occurredAt: string;
}

export interface OpenBankingPaymentInitiatedEvent {
  event: 'open_banking.payment_initiated';
  tenantId: string;
  customerId: string;
  externalAccountId: string;
  amountMinorUnits: number;
  currency: string;
  reference: string;
  occurredAt: string;
}

// ─── Paystack Events ──────────────────────────────────────────────────────────

export interface PaystackPaymentSuccessEvent {
  event: 'paystack.payment_success';
  tenantId?: string;
  reference: string;
  amountKobo: number;
  currency: string;
  email?: string;
  occurredAt: string;
}

export interface PaystackRefundInitiatedEvent {
  event: 'paystack.refund_initiated';
  refundId: string;
  tenantId: string;
  originalReference: string;
  amountKobo: number;
  occurredAt: string;
}

// ─── Union type ───────────────────────────────────────────────────────────────

export type WebWakaEvent =
  | PayoutCompletedEvent
  | PayoutFailedEvent
  | BankingDepositEvent
  | BankingWithdrawalEvent
  | BankingTransferEvent
  | LendingDisbursedEvent
  | LendingRepaymentEvent
  | LendingDefaultedEvent
  | WalletFundedEvent
  | WalletDebitedEvent
  | WalletConvertedEvent
  | InsurancePolicyCreatedEvent
  | InsuranceClaimFiledEvent
  | InvestmentDepositedEvent
  | InvestmentLiquidatedEvent
  | CryptoOnRampEvent
  | CryptoOffRampEvent
  | AgentCashInEvent
  | AgentCashOutEvent
  | KycVerifiedEvent
  | KycTierUpgradedEvent
  | OpenBankingAccountLinkedEvent
  | OpenBankingPaymentInitiatedEvent
  | PaystackPaymentSuccessEvent
  | PaystackRefundInitiatedEvent;

/**
 * Publish an event to the WebWaka Event Bus.
 *
 * Delivery is fire-and-forget (no retry) — the Event Bus is responsible for
 * durability and fan-out to subscribers. This function never throws; failures
 * are logged so the caller's financial operation is never blocked by bus errors.
 */
export async function publishEvent(
  eventBusUrl: string | undefined,
  eventBusSecret: string | undefined,
  event: WebWakaEvent,
): Promise<void> {
  if (!eventBusUrl) {
    console.warn(`[EventBus] No EVENT_BUS_URL configured — skipping event: ${event.event}`, event);
    return;
  }

  try {
    const resp = await fetch(`${eventBusUrl}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(eventBusSecret ? { 'X-Bus-Secret': eventBusSecret } : {}),
      },
      body: JSON.stringify(event),
    });

    if (!resp.ok) {
      console.error(`[EventBus] Failed to publish ${event.event}: HTTP ${resp.status}`);
    } else {
      console.info(`[EventBus] Published ${event.event} successfully`);
    }
  } catch (err) {
    console.error(`[EventBus] Exception publishing ${event.event}:`, err);
  }
}
