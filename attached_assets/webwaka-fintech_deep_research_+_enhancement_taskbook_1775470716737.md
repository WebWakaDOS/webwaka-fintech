 دروس WEB WAKA-FINTECH — DEEP RESEARCH + ENHANCEMENT TASKBOOK

**Repo:** webwaka-fintech
**Document Class:** Platform Taskbook — Implementation + QA Ready
**Date:** 2026-04-05
**Status:** EXECUTION READY

---

# WebWaka OS v4 — Ecosystem Scope & Boundary Document

**Status:** Canonical Reference
**Purpose:** To define the exact scope, ownership, and boundaries of all 17 WebWaka repositories to prevent scope drift, duplication, and architectural violations during parallel agent execution.

## 1. Core Platform & Infrastructure (The Foundation)

### 1.1 `webwaka-core` (The Primitives)
- **Scope:** The single source of truth for all shared platform primitives.
- **Owns:** Auth middleware, RBAC engine, Event Bus types, KYC/KYB logic, NDPR compliance, Rate Limiting, D1 Query Helpers, SMS/Notifications (Termii/Yournotify), Tax/Payment utilities.
- **Anti-Drift Rule:** NO OTHER REPO may implement its own auth, RBAC, or KYC logic. All repos MUST import from `@webwaka/core`.

### 1.2 `webwaka-super-admin-v2` (The Control Plane)
- **Scope:** The global control plane for the entire WebWaka OS ecosystem.
- **Owns:** Tenant provisioning, global billing metrics, module registry, feature flags, global health monitoring, API key management.
- **Anti-Drift Rule:** This repo manages *tenants*, not end-users. It does not handle vertical-specific business logic.

### 1.3 `webwaka-central-mgmt` (The Ledger & Economics)
- **Scope:** The central financial and operational brain.
- **Owns:** The immutable financial ledger, affiliate/commission engine, global fraud scoring, webhook DLQ (Dead Letter Queue), data retention pruning, tenant suspension enforcement.
- **Anti-Drift Rule:** All financial transactions from all verticals MUST emit events to this repo for ledger recording. Verticals do not maintain their own global ledgers.

### 1.4 `webwaka-ai-platform` (The AI Brain)
- **Scope:** The centralized, vendor-neutral AI capability registry.
- **Owns:** AI completions routing (OpenRouter/Cloudflare AI), BYOK (Bring Your Own Key) management, AI entitlement enforcement, usage billing events.
- **Anti-Drift Rule:** NO OTHER REPO may call OpenAI or Anthropic directly. All AI requests MUST route through this platform or use the `@webwaka/core` AI primitives.

### 1.5 `webwaka-ui-builder` (The Presentation Layer)
- **Scope:** Template management, branding, and deployment orchestration.
- **Owns:** Tenant website templates, CSS/branding configuration, PWA manifests, SEO/a11y services, Cloudflare Pages deployment orchestration.
- **Anti-Drift Rule:** This repo builds the *public-facing* storefronts and websites for tenants, not the internal SaaS dashboards.

### 1.6 `webwaka-cross-cutting` (The Shared Operations)
- **Scope:** Shared functional modules that operate across all verticals.
- **Owns:** CRM (Customer Relationship Management), HRM (Human Resources), Ticketing/Support, Internal Chat, Advanced Analytics.
- **Anti-Drift Rule:** Verticals should integrate with these modules rather than building their own isolated CRM or ticketing systems.

### 1.7 `webwaka-platform-docs` (The Governance)
- **Scope:** All platform documentation, architecture blueprints, and QA reports.
- **Owns:** ADRs, deployment guides, implementation plans, verification reports.
- **Anti-Drift Rule:** No code lives here.

## 2. The Vertical Suites (The Business Logic)

### 2.1 `webwaka-commerce` (Retail & E-Commerce)
- **Scope:** All retail, wholesale, and e-commerce operations.
- **Owns:** POS (Point of Sale), Single-Vendor storefronts, Multi-Vendor marketplaces, B2B commerce, Retail inventory, Pricing engines.
- **Anti-Drift Rule:** Does not handle logistics delivery execution (routes to `webwaka-logistics`).

### 2.2 `webwaka-fintech` (Financial Services)
- **Scope:** Core banking, lending, and consumer financial products.
- **Owns:** Banking, Insurance, Investment, Payouts, Lending, Cards, Savings, Overdraft, Bills, USSD, Wallets, Crypto, Agent Banking, Open Banking.
- **Anti-Drift Rule:** Relies on `webwaka-core` for KYC and `webwaka-central-mgmt` for the immutable ledger.

### 2.3 `webwaka-logistics` (Supply Chain & Delivery)
- **Scope:** Physical movement of goods and supply chain management.
- **Owns:** Parcels, Delivery Requests, Delivery Zones, 3PL Webhooks (GIG, Kwik, Sendbox), Fleet tracking, Proof of Delivery.
- **Anti-Drift Rule:** Does not handle passenger transport (routes to `webwaka-transport`).

### 2.4 `webwaka-transport` (Passenger & Mobility)
- **Scope:** Passenger transportation and mobility services.
- **Owns:** Seat Inventory, Agent Sales, Booking Portals, Operator Management, Ride-Hailing, EV Charging, Lost & Found.
- **Anti-Drift Rule:** Does not handle freight/cargo logistics (routes to `webwaka-logistics`).

### 2.5 `webwaka-real-estate` (Property & PropTech)
- **Scope:** Property listings, transactions, and agent management.
- **Owns:** Property Listings (sale/rent/shortlet), Transactions, ESVARBON-compliant Agent profiles.
- **Anti-Drift Rule:** Does not handle facility maintenance ticketing (routes to `webwaka-cross-cutting`).

### 2.6 `webwaka-production` (Manufacturing & ERP)
- **Scope:** Manufacturing workflows and production management.
- **Owns:** Production Orders, Bill of Materials (BOM), Quality Control, Floor Supervision.
- **Anti-Drift Rule:** Relies on `webwaka-commerce` for B2B sales of produced goods.

### 2.7 `webwaka-services` (Service Businesses)
- **Scope:** Appointment-based and project-based service businesses.
- **Owns:** Appointments, Scheduling, Projects, Clients, Invoices, Quotes, Deposits, Reminders, Staff scheduling.
- **Anti-Drift Rule:** Does not handle physical goods inventory (routes to `webwaka-commerce`).

### 2.8 `webwaka-institutional` (Education & Healthcare)
- **Scope:** Large-scale institutional management (Schools, Hospitals).
- **Owns:** Student Management (SIS), LMS, EHR (Electronic Health Records), Telemedicine, FHIR compliance, Campus Management, Alumni.
- **Anti-Drift Rule:** Highly specialized vertical; must maintain strict data isolation (NDPR/HIPAA) via `webwaka-core`.

### 2.9 `webwaka-civic` (Government, NGO & Religion)
- **Scope:** Civic engagement, non-profits, and religious organizations.
- **Owns:** Church/NGO Management, Political Parties, Elections/Voting, Volunteers, Fundraising.
- **Anti-Drift Rule:** Voting systems must use cryptographic verification; fundraising must route to the central ledger.

### 2.10 `webwaka-professional` (Legal & Events)
- **Scope:** Specialized professional services.
- **Owns:** Legal Practice (NBA compliance, trust accounts, matters), Event Management (ticketing, check-in).
- **Anti-Drift Rule:** Legal trust accounts must be strictly segregated from operating accounts.

## 3. The 7 Core Invariants (Enforced Everywhere)
1. **Build Once Use Infinitely:** Never duplicate primitives. Import from `@webwaka/core`.
2. **Mobile First:** UI/UX optimized for mobile before desktop.
3. **PWA First:** Support installation, background sync, and native-like capabilities.
4. **Offline First:** Functions without internet using IndexedDB and mutation queues.
5. **Nigeria First:** Paystack (kobo integers only), Termii, Yournotify, NGN default.
6. **Africa First:** i18n support for regional languages and currencies.
7. **Vendor Neutral AI:** OpenRouter abstraction — no direct provider SDKs.

---

## 4. REPOSITORY DEEP UNDERSTANDING & CURRENT STATE

Based on a thorough review of the live code, including `worker.ts` (or equivalent entry point), `src/` directory structure, `package.json`, and relevant migration files, the current state of the `webwaka-fintech` repository is as follows:

The `webwaka-fintech` repository currently exhibits a foundational structure for financial services, with several key modules identified. The `worker.ts` file appears to serve as the primary entry point, orchestrating various financial operations. The `src/` directory is organized into sub-modules such as `banking/`, `lending/`, `payments/`, and `kyc/`, reflecting the repository's broad scope.

**Identified Stubs and Partial Implementations:**
*   **Banking Core:** Basic account creation and balance inquiry endpoints are present, but complex transaction types (e.g., inter-bank transfers, recurring payments) are largely stubbed out or rely on placeholder logic.
*   **Lending Module:** A basic loan application intake form and a rudimentary credit scoring mechanism exist. However, the actual loan disbursement and repayment schedule management are incomplete.
*   **KYC/KYB Integration:** The repository correctly imports KYC primitives from `@webwaka/core` as per the Anti-Drift Rule. However, the integration with specific third-party identity verification services is partially implemented, with some API calls commented out or using mock data.
*   **Payment Gateway Integration:** Initial setup for a payment gateway (e.g., Paystack) is visible in `package.json` and some `payments/` files, but the full transaction lifecycle (initiation, callback handling, reconciliation) is not yet robust.
*   **Event Emission:** The repository correctly emits events to `webwaka-central-mgmt` for ledger recording, but the event payloads for certain complex financial products are still under definition.

**Architectural Patterns:**
*   **Modular Monolith:** The repository follows a modular monolith pattern, with clear separation of concerns within the `src/` directory, but deployed as a single unit.
*   **Event-Driven Architecture:** Heavy reliance on event emission for inter-service communication, particularly with `webwaka-central-mgmt` and `webwaka-core`.
*   **TypeScript First:** All new development and existing code are in TypeScript, ensuring type safety and maintainability.

**Discrepancies:**
*   The original taskbook mentions 
USSD, Wallets, Crypto, Agent Banking, Open Banking. While these are listed as owned by `webwaka-fintech`, the current codebase primarily focuses on Banking, Lending, and basic Payouts, with other areas existing as conceptual stubs or minimal interfaces.

## 5. MASTER TASK REGISTRY (NON-DUPLICATED)

This section lists all tasks specifically assigned to the `webwaka-fintech` repository. These tasks have been de-duplicated across the entire WebWaka OS v4 ecosystem and are considered the canonical work items for this repository. Tasks are prioritized based on their impact on platform stability, security, and core functionality.

| Task ID | Description | Rationale |
|---|---|---|
| FT-001 | Implement full transaction lifecycle for inter-bank transfers, including settlement and reconciliation with `webwaka-central-mgmt`. | Critical for core banking functionality and financial ledger integrity. |
| FT-002 | Develop comprehensive loan repayment scheduling and automated collection mechanisms. | Essential for robust lending product offerings and risk management. |
| FT-003 | Integrate with a secondary KYC/KYB provider to ensure redundancy and compliance. | Enhance regulatory compliance and reduce single point of failure for identity verification. |
| FT-004 | Complete full integration with Paystack (or similar) for all payment types, including refunds and chargebacks. | Enable seamless payment processing and improve user experience. |
| FT-005 | Implement the full suite of event emission for all financial products to `webwaka-central-mgmt`. | Ensure complete and accurate financial ledger recording across the ecosystem. |
| FT-006 | Develop the 
initial framework for the 'Wallets' module, allowing users to hold and manage multiple currencies. | Foundational for expanding into digital wallet services and supporting multi-currency operations. |
| FT-007 | Implement the 'Crypto' module, enabling basic cryptocurrency buy/sell and holding functionalities, adhering to local regulations. | Addresses emerging market demand and positions WebWaka as a forward-thinking financial platform. |
| FT-008 | Develop the 'Agent Banking' module, providing tools for agents to onboard customers and facilitate transactions on behalf of the platform. | Expands financial inclusion and reach into underserved areas. |
| FT-009 | Integrate with Open Banking APIs to allow users to link external bank accounts and initiate payments. | Enhances user convenience and aligns with modern financial ecosystem trends. |

## 6. TASK BREAKDOWN & IMPLEMENTATION PROMPTS

For each task listed in the Master Task Registry, this section provides a detailed breakdown, including implementation prompts, relevant code snippets, and architectural considerations. The goal is to provide a clear path for a Replit agent to execute the task.

### FT-001: Implement full transaction lifecycle for inter-bank transfers
**Breakdown:**
1.  **API Design:** Define new API endpoints for initiating, querying status, and confirming inter-bank transfers. Consider idempotency keys.
2.  **Core Logic:** Implement the business logic for validating transfer requests, debiting sender's account, and queuing the transfer for external processing.
3.  **External Integration:** Integrate with a third-party inter-bank transfer service (e.g., NIBSS in Nigeria). Handle success and failure callbacks.
4.  **Ledger Update:** Ensure proper event emission to `webwaka-central-mgmt` for both debit and credit legs of the transaction, including all relevant metadata.
5.  **Error Handling:** Implement robust error handling, retry mechanisms, and reconciliation processes for failed transfers.

**Implementation Prompt:**
```typescript
// src/banking/transfers/interBankTransferService.ts
import { CentralMgmtEventProducer } from '@webwaka/central-mgmt';
import { CoreBankingService } from '@webwaka/core';

interface InterBankTransferRequest {
  senderAccountId: string;
  recipientBankCode: string;
  recipientAccountNumber: string;
  amount: number;
  currency: string;
  narration: string;
  idempotencyKey: string;
}

class InterBankTransferService {
  constructor(private coreBanking: CoreBankingService, private eventProducer: CentralMgmtEventProducer) {}

  async initiateTransfer(request: InterBankTransferRequest): Promise<string> {
    // 1. Validate request and debit sender's account
    // 2. Call external inter-bank transfer API
    // 3. On success/failure, emit event to webwaka-central-mgmt
    // 4. Return transfer reference ID
  }

  async handleCallback(callbackData: any): Promise<void> {
    // 1. Process callback from external service
    // 2. Update transfer status in local database
    // 3. Emit final settlement event to webwaka-central-mgmt
  }
}
```

### FT-002: Develop comprehensive loan repayment scheduling and automated collection mechanisms
**Breakdown:**
1.  **Loan Schedule Generation:** Create a service to generate detailed repayment schedules based on loan terms (amount, interest rate, tenor, frequency).
2.  **Automated Collection:** Implement a cron job or scheduled task to automatically attempt collection from linked accounts on due dates.
3.  **Grace Periods & Penalties:** Define and implement logic for grace periods, late payment penalties, and their application.
4.  **Communication:** Integrate with `@webwaka/core` for SMS/Notifications to remind users of upcoming and overdue payments.
5.  **Ledger Update:** Ensure all repayment events (successful, failed, penalties) are accurately emitted to `webwaka-central-mgmt`.

**Implementation Prompt:**
```typescript
// src/lending/repayments/loanRepaymentService.ts
import { NotificationService } from '@webwaka/core';
import { CentralMgmtEventProducer } from '@webwaka/central-mgmt';

interface LoanRepaymentScheduleEntry {
  dueDate: Date;
  principalDue: number;
  interestDue: number;
  totalDue: number;
  status: 'SCHEDULED' | 'PAID' | 'OVERDUE' | 'FAILED';
}

class LoanRepaymentService {
  constructor(private notificationService: NotificationService, private eventProducer: CentralMgmtEventProducer) {}

  generateSchedule(loanId: string, loanTerms: any): LoanRepaymentScheduleEntry[] {
    // Logic to calculate and return repayment schedule
  }

  async processDuePayments(): Promise<void> {
    // 1. Fetch all loans with upcoming/overdue payments
    // 2. Attempt to debit linked accounts
    // 3. Apply penalties if applicable
    // 4. Send notifications via @webwaka/core
    // 5. Emit repayment events to webwaka-central-mgmt
  }
}
```

### FT-003: Integrate with a secondary KYC/KYB provider
**Breakdown:**
1.  **Provider Selection:** Research and select a suitable secondary KYC/KYB provider that offers redundancy and complements existing `@webwaka/core` integrations.
2.  **API Integration:** Implement the necessary API calls and data mapping for the chosen provider.
3.  **Fallback Logic:** Modify the `@webwaka/core` KYC logic (or extend it) to include fallback to the secondary provider if the primary fails or for specific risk profiles.
4.  **Data Storage:** Securely store verification results and audit trails.

**Implementation Prompt:**
```typescript
// src/kyc/secondaryKycProvider.ts
import { KycService } from '@webwaka/core';

interface SecondaryKycResult {
  // Define structure for secondary provider's verification result
}

class SecondaryKycProvider {
  async verifyIndividual(userData: any): Promise<SecondaryKycResult> {
    // Call secondary KYC provider API
  }

  async verifyBusiness(businessData: any): Promise<SecondaryKycResult> {
    // Call secondary KYB provider API
  }
}

// Extend @webwaka/core KYC service or create an adapter
// src/kyc/extendedKycService.ts
class ExtendedKycService extends KycService {
  constructor(private primaryKyc: KycService, private secondaryKyc: SecondaryKycProvider) {
    super(); // Call parent constructor if needed
  }

  async performKyc(userData: any): Promise<any> {
    try {
      return await this.primaryKyc.performKyc(userData);
    } catch (error) {
      console.warn('Primary KYC failed, attempting secondary provider:', error);
      return await this.secondaryKyc.verifyIndividual(userData);
    }
  }
}
```

### FT-004: Complete full integration with Paystack (or similar) for all payment types
**Breakdown:**
1.  **API Endpoints:** Create endpoints for initiating payments, handling webhooks (success, failure, chargeback), and querying transaction status.
2.  **Payment Initiation:** Implement logic to generate payment links/redirects for various payment methods (card, bank transfer, USSD).
3.  **Webhook Processing:** Develop robust webhook handlers to update transaction statuses, trigger ledger events, and manage refunds/chargebacks.
4.  **Refund/Chargeback Logic:** Implement the business logic and API calls for processing refunds and handling chargeback notifications.

**Implementation Prompt:**
```typescript
// src/payments/paystackService.ts
import { CentralMgmtEventProducer } from '@webwaka/central-mgmt';

interface PaystackPaymentInitiationResponse {
  authorization_url: string;
  reference: string;
}

class PaystackService {
  constructor(private eventProducer: CentralMgmtEventProducer) {}

  async initiatePayment(amount: number, email: string, metadata: any): Promise<PaystackPaymentInitiationResponse> {
    // Call Paystack initialize transaction API
  }

  async handleWebhook(event: any): Promise<void> {
    // 1. Verify webhook signature
    // 2. Process event type (success, failed, chargeback, refund)
    // 3. Update local transaction status
    // 4. Emit relevant events to webwaka-central-mgmt
  }

  async processRefund(transactionReference: string, amount: number): Promise<any> {
    // Call Paystack refund API
  }
}
```

### FT-005: Implement the full suite of event emission for all financial products to `webwaka-central-mgmt`
**Breakdown:**
1.  **Event Definition:** Define a comprehensive set of event types and their payloads for all financial operations (deposits, withdrawals, loans, repayments, investments, insurance claims, etc.).
2.  **Event Producer Integration:** Ensure all relevant services (Banking, Lending, Payments, Investment, etc.) correctly utilize the `CentralMgmtEventProducer` from `@webwaka/central-mgmt`.
3.  **Data Consistency:** Validate that event payloads contain all necessary information for `webwaka-central-mgmt` to maintain an immutable and accurate ledger.

**Implementation Prompt:**
```typescript
// Example: src/banking/accountService.ts
import { CentralMgmtEventProducer, FinancialEventType } from '@webwaka/central-mgmt';

class AccountService {
  constructor(private eventProducer: CentralMgmtEventProducer) {}

  async deposit(accountId: string, amount: number, currency: string, transactionRef: string): Promise<void> {
    // ... deposit logic ...
    await this.eventProducer.emitEvent({
      type: FinancialEventType.DEPOSIT,
      payload: { accountId, amount, currency, transactionRef, timestamp: new Date() }
    });
  }

  async withdraw(accountId: string, amount: number, currency: string, transactionRef: string): Promise<void> {
    // ... withdrawal logic ...
    await this.eventProducer.emitEvent({
      type: FinancialEventType.WITHDRAWAL,
      payload: { accountId, amount, currency, transactionRef, timestamp: new Date() }
    });
  }
}
```

### FT-006: Develop the initial framework for the 'Wallets' module
**Breakdown:**
1.  **Database Schema:** Design a database schema to support multiple wallets per user, each potentially holding different currencies.
2.  **API Endpoints:** Create API endpoints for wallet creation, balance inquiry, and internal transfers between wallets.
3.  **Currency Management:** Implement logic for handling different currencies, including conversion rates (if applicable, though initially focus on single-currency wallets).
4.  **Ledger Integration:** Ensure all wallet transactions (deposits, withdrawals, transfers) emit events to `webwaka-central-mgmt`.

**Implementation Prompt:**
```typescript
// src/wallets/walletService.ts
import { CentralMgmtEventProducer } from '@webwaka/central-mgmt';

interface Wallet {
  id: string;
  userId: string;
  currency: string;
  balance: number;
  createdAt: Date;
}

class WalletService {
  constructor(private eventProducer: CentralMgmtEventProducer) {}

  async createWallet(userId: string, currency: string): Promise<Wallet> {
    // 1. Create wallet in database
    // 2. Emit WALLET_CREATED event
  }

  async getWalletBalance(walletId: string): Promise<number> {
    // Fetch balance from database
  }

  async transferFunds(fromWalletId: string, toWalletId: string, amount: number): Promise<void> {
    // 1. Validate balances and perform transfer
    // 2. Emit WALLET_TRANSFER event to webwaka-central-mgmt
  }
}
```

### FT-007: Implement the 'Crypto' module
**Breakdown:**
1.  **Provider Integration:** Research and integrate with a reputable cryptocurrency exchange API for buy/sell functionality.
2.  **Wallet Management:** Integrate with the newly developed 'Wallets' module to manage crypto holdings.
3.  **Regulatory Compliance:** Ensure all crypto transactions adhere to local regulations (e.g., AML/KYC for crypto).
4.  **Ledger Integration:** Emit all crypto transactions (buy, sell, transfer) to `webwaka-central-mgmt`.

**Implementation Prompt:**
```typescript
// src/crypto/cryptoService.ts
import { CentralMgmtEventProducer } from '@webwaka/central-mgmt';
import { WalletService } from '../wallets/walletService';

interface CryptoTransactionResult {
  transactionId: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
}

class CryptoService {
  constructor(private eventProducer: CentralMgmtEventProducer, private walletService: WalletService) {}

  async buyCrypto(userId: string, fiatAmount: number, cryptoCurrency: string): Promise<CryptoTransactionResult> {
    // 1. Convert fiat to crypto amount using exchange rate API
    // 2. Debit fiat wallet via walletService
    // 3. Execute buy order on crypto exchange
    // 4. Credit crypto wallet via walletService
    // 5. Emit CRYPTO_BUY event to webwaka-central-mgmt
  }

  async sellCrypto(userId: string, cryptoAmount: number, cryptoCurrency: string): Promise<CryptoTransactionResult> {
    // 1. Debit crypto wallet via walletService
    // 2. Execute sell order on crypto exchange
    // 3. Credit fiat wallet via walletService
    // 4. Emit CRYPTO_SELL event to webwaka-central-mgmt
  }
}
```

### FT-008: Develop the 'Agent Banking' module
**Breakdown:**
1.  **Agent Onboarding:** Create a secure process for onboarding and verifying agents, leveraging `@webwaka/core` KYC/KYB.
2.  **Agent Dashboard:** Develop a dashboard for agents to view their transactions, commissions, and customer details.
3.  **Customer Transactions:** Implement functionalities for agents to facilitate deposits, withdrawals, and bill payments for customers.
4.  **Commission Engine Integration:** Integrate with `webwaka-central-mgmt`'s affiliate/commission engine for agent payouts.

**Implementation Prompt:**
```typescript
// src/agentBanking/agentService.ts
import { KycService } from '@webwaka/core';
import { CentralMgmtEventProducer } from '@webwaka/central-mgmt';

interface Agent {
  id: string;
  userId: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  commissionRate: number;
}

class AgentService {
  constructor(private kycService: KycService, private eventProducer: CentralMgmtEventProducer) {}

  async onboardAgent(agentData: any): Promise<Agent> {
    // 1. Perform KYC/KYB via @webwaka/core
    // 2. Create agent record in database
    // 3. Emit AGENT_ONBOARDED event
  }

  async facilitateDeposit(agentId: string, customerAccountId: string, amount: number): Promise<void> {
    // 1. Record deposit by agent
    // 2. Credit customer account
    // 3. Emit AGENT_DEPOSIT event to webwaka-central-mgmt (including commission calculation)
  }
}
```

### FT-009: Integrate with Open Banking APIs
**Breakdown:**
1.  **API Selection:** Research and select relevant Open Banking APIs (e.g., Plaid, Mono, or local bank APIs).
2.  **Consent Management:** Implement a secure consent flow for users to authorize linking their external bank accounts.
3.  **Account Linking:** Develop logic to link external bank accounts and retrieve account information (balances, transactions).
4.  **Payment Initiation:** Implement functionality to initiate payments from linked external accounts.

**Implementation Prompt:**
```typescript
// src/openBanking/openBankingService.ts
import { CentralMgmtEventProducer } from '@webwaka/central-mgmt';

interface ExternalAccount {
  id: string;
  userId: string;
  bankName: string;
  accountNumber: string;
  balance: number;
}

class OpenBankingService {
  constructor(private eventProducer: CentralMgmtEventProducer) {}

  async initiateConsent(userId: string): Promise<string> {
    // Generate and return consent URL for user redirection
  }

  async handleCallback(callbackData: any): Promise<ExternalAccount[]> {
    // 1. Process callback from Open Banking provider
    // 2. Link external accounts to user
    // 3. Emit EXTERNAL_ACCOUNT_LINKED event
  }

  async initiatePaymentFromExternalAccount(userId: string, externalAccountId: string, amount: number, recipient: any): Promise<string> {
    // 1. Call Open Banking API to initiate payment
    // 2. Emit EXTERNAL_PAYMENT_INITIATED event to webwaka-central-mgmt
  }
}
```

## 7. QA PLANS & PROMPTS

This section outlines the Quality Assurance (QA) plan for each task, including acceptance criteria, testing methodologies, and QA prompts for verification.

### FT-001: Inter-bank transfers
**Acceptance Criteria:**
*   Users can successfully initiate inter-bank transfers.
*   Sender's account is debited accurately.
*   Recipient's account is credited accurately (verified via external system).
*   All transfer states (pending, success, failed) are correctly reflected.
*   Events are emitted to `webwaka-central-mgmt` for all stages of the transfer.
*   Failed transfers trigger appropriate error handling and notifications.

**Testing Methodologies:** Unit tests, Integration tests (with mock external service), End-to-End tests.

**QA Prompt:**
"Verify that an inter-bank transfer of NGN 10,000 from Account A to Account B (external bank) completes successfully. Confirm debit from Account A, credit to Account B, and verify all corresponding events in `webwaka-central-mgmt`'s ledger. Test a scenario where the external bank declines the transaction and ensure proper error handling and reversal."

### FT-002: Loan repayment scheduling and automated collection
**Acceptance Criteria:**
*   Loan repayment schedules are generated correctly based on loan terms.
*   Automated collection attempts debit linked accounts on due dates.
*   Grace periods and penalties are applied accurately.
*   Users receive timely notifications for upcoming and overdue payments.
*   All repayment events (successful, failed, penalties) are recorded in `webwaka-central-mgmt`.

**Testing Methodologies:** Unit tests, Scheduled task simulation, Integration tests.

**QA Prompt:**
"Create a loan with a 3-month repayment schedule and verify that the schedule is generated correctly. Simulate the passage of time to trigger automated collection for the first installment. Confirm successful debit and event emission. Then, simulate a failed collection attempt and verify penalty application and overdue notifications."

### FT-003: Secondary KYC/KYB provider integration
**Acceptance Criteria:**
*   Primary KYC/KYB provider functions as expected.
*   If primary provider fails, the system seamlessly falls back to the secondary provider.
*   Verification results from both providers are securely stored.
*   User experience during KYC/KYB process remains smooth.

**Testing Methodologies:** Unit tests, Integration tests (with primary and secondary mock services), Failure injection tests.

**QA Prompt:**
"Test the KYC process for a new user. First, simulate a failure from the primary KYC provider and ensure the secondary provider is invoked and successfully verifies the user. Verify that the verification status and source are correctly recorded."

### FT-004: Paystack integration for all payment types
**Acceptance Criteria:**
*   Users can initiate payments via various Paystack methods (card, bank transfer, USSD).
*   Successful payments update transaction status and trigger ledger events.
*   Webhooks for success, failure, chargeback, and refund are correctly processed.
*   Refunds can be successfully initiated and processed.

**Testing Methodologies:** Unit tests, Integration tests (with Paystack sandbox/mock), End-to-End tests.

**QA Prompt:**
"Initiate a NGN 5,000 payment via card using Paystack. Verify successful completion and that the transaction status is updated locally and an event is sent to `webwaka-central-mgmt`. Then, initiate a refund for this transaction and confirm the refund status and corresponding ledger event."

### FT-005: Full suite of event emission to `webwaka-central-mgmt`
**Acceptance Criteria:**
*   All financial operations (deposits, withdrawals, loans, repayments, investments, etc.) emit appropriate events.
*   Event payloads are complete and accurate, containing all necessary ledger information.
*   Event emission is reliable and resilient to temporary failures.

**Testing Methodologies:** Unit tests, Integration tests (with mock `webwaka-central-mgmt` event consumer), Event log analysis.

**QA Prompt:**
"Perform a series of diverse financial transactions: a deposit, a withdrawal, a loan disbursement, and a loan repayment. For each transaction, verify that the correct event type with a complete and accurate payload is emitted to `webwaka-central-mgmt`."

### FT-006: Initial framework for the 'Wallets' module
**Acceptance Criteria:**
*   Users can create multiple wallets with different currencies.
*   Wallet balances are accurately maintained.
*   Internal transfers between user's wallets are successful.
*   All wallet transactions emit events to `webwaka-central-mgmt`.

**Testing Methodologies:** Unit tests, Integration tests.

**QA Prompt:**
"Create two wallets for a user: one in NGN and one in USD. Deposit NGN 5,000 into the NGN wallet. Transfer NGN 2,000 from the NGN wallet to the USD wallet (assuming a fixed conversion rate for testing). Verify balances in both wallets and confirm event emission to `webwaka-central-mgmt`."

### FT-007: Implement the 'Crypto' module
**Acceptance Criteria:**
*   Users can buy and sell supported cryptocurrencies.
*   Crypto holdings are accurately reflected in the 'Wallets' module.
*   All crypto transactions adhere to regulatory requirements.
*   All crypto transactions emit events to `webwaka-central-mgmt`.

**Testing Methodologies:** Unit tests, Integration tests (with mock crypto exchange API).

**QA Prompt:**
"For a user with sufficient fiat balance, initiate a purchase of 0.001 BTC. Verify that the fiat wallet is debited, the crypto wallet is credited with BTC, and the corresponding `CRYPTO_BUY` event is emitted to `webwaka-central-mgmt`. Then, sell 0.0005 BTC and verify the reverse."

### FT-008: Develop the 'Agent Banking' module
**Acceptance Criteria:**
*   Agents can be securely onboarded and verified.
*   Agents can view their transactions and commissions.
*   Agents can facilitate deposits, withdrawals, and bill payments for customers.
*   Agent commissions are correctly calculated and integrated with `webwaka-central-mgmt`.

**Testing Methodologies:** Unit tests, Integration tests, Role-based access control tests.

**QA Prompt:**
"Onboard a new agent and verify their KYC status. As the agent, facilitate a NGN 1,000 deposit for a customer. Verify that the customer's account is credited, the agent's commission is calculated, and all relevant events are emitted to `webwaka-central-mgmt`."

### FT-009: Integrate with Open Banking APIs
**Acceptance Criteria:**
*   Users can securely link external bank accounts after providing consent.
*   The system can retrieve account balances and transaction history from linked accounts.
*   Users can initiate payments from linked external accounts.
*   All Open Banking related events are emitted to `webwaka-central-mgmt`.

**Testing Methodologies:** Unit tests, Integration tests (with mock Open Banking provider), Security tests for consent flow.

**QA Prompt:**
"Simulate a user linking an external bank account via Open Banking. Verify that the consent flow is secure and the account is successfully linked. Retrieve the account balance and a sample of recent transactions. Then, initiate a NGN 500 payment from this linked external account to a WebWaka internal account and verify the transaction and event emission."

## 8. EXECUTION READINESS NOTES

*   **Prioritization:** Tasks are listed in a general order of priority, but agents should consult with the project lead for any dynamic re-prioritization.
*   **Dependency Management:** Pay close attention to dependencies between tasks. For example, FT-006 (Wallets) is a prerequisite for FT-007 (Crypto).
*   **Security First:** All implementations MUST adhere to the highest security standards, including input validation, secure API key management, and protection against common vulnerabilities (OWASP Top 10).
*   **Performance:** Optimize for performance, especially for high-volume transactions. Consider caching strategies and efficient database queries.
*   **Observability:** Ensure all new features are adequately logged, monitored, and traceable. Implement metrics for key business operations.
*   **Code Review:** All completed tasks will undergo a thorough code review process. Adhere to established coding standards and best practices.
*   **Documentation:** Update relevant internal documentation (e.g., API docs, architectural diagrams) as features are implemented.
*   **Anti-Drift Enforcement:** Continuously verify that all Anti-Drift Rules outlined in Section 1 and 2 are strictly followed. Any deviation requires explicit approval.
*   **Testing:** Comprehensive unit, integration, and end-to-end tests are expected for each implemented feature. Aim for high test coverage.
*   **Collaboration:** For any ambiguities or complex architectural decisions, collaborate with the core platform team or relevant vertical leads.
