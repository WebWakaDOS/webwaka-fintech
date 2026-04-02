# PHASE 7 PROMPTS — Financial, Professional, Civic & Institutional Domains

This file contains all copy-paste implementation and QA prompts for Phase 7 (remaining verticals).

**Tasks in this phase:** T-FIN-01, T-PRO-01, T-CIV-01, T-RES-01, T-INS-01

**Execution targets:** Replit (`webwaka-fintech`, `webwaka-professional`, `webwaka-civic`, `webwaka-real-estate`, `webwaka-institutional`)

---


---

## TASK T-FIN-01 — Implement NIBSS NIP Instant Transfer Integration

### PROMPT 1 — IMPLEMENTATION
```markdown
You are a Replit execution agent responsible for implementing a new feature in the `webwaka-fintech` repository.

**Task ID:** T-FIN-01
**Task Title:** Implement NIBSS NIP Instant Transfer Integration

**Context & Objective:**
Vendor payouts and rider commissions must reach any Nigerian bank account instantly. NIBSS NIP (Nigeria Inter-Bank Settlement System) is the only way to achieve this at scale. We must integrate NIBSS NIP to enable real-time bank transfers from the platform wallet to any Nigerian bank account.

**WebWaka Invariants to Honor:**
1. **Event-Driven Architecture:** You must publish `payout.completed` to the Event Bus after a successful transfer, so that Commerce (vendor payouts), Logistics (rider commissions), and Transport (driver settlements) can update their own ledgers.
2. **Build Once Use Infinitely:** This payout mechanism is the single source of truth for all platform disbursements. Do not build separate payout logic in other repos.

**Execution Steps:**
1. Read the `webwaka_11_repos_research_report.md` (Fintech enhancements section) for context.
2. Inspect the current `webwaka-fintech` schema and wallet logic.
3. Update the Drizzle schema to add `payout_requests` table with status tracking.
4. Implement the NIBSS NIP API integration using the licensed bank partner credentials (configurable via environment variables).
5. Build the payout request workflow (initiation, pending, confirmed, failed states).
6. Implement the webhook handler for transfer confirmations from the bank partner.
7. Emit the `payout.completed` event upon confirmation.
8. Write tests covering the full payout lifecycle.
9. Report completion, summarizing the files changed and confirming adherence to the invariants.
```

### PROMPT 2 — QA / TEST / BUG-FIX
```markdown
You are a Replit QA and Bug-Fix agent responsible for verifying the implementation of Task T-FIN-01 (Implement NIBSS NIP Instant Transfer Integration) in the `webwaka-fintech` repository.

**Verification Steps:**
1. Review the intended scope: NIBSS NIP API integration, payout lifecycle state machine, webhook confirmation handler, and `payout.completed` event emission.
2. Inspect the actual codebase changes.
3. **Audit Event Emission:** Verify that `payout.completed` is emitted to the Event Bus with the correct payload (including `tenant_id`, `recipient_account`, and `amount`).
4. **Audit Security:** Verify that bank partner credentials are stored in environment variables and never hardcoded.
5. If any omissions, bugs, or invariant violations are found, **FIX THE CODE DIRECTLY**. Do not merely report the issue.
6. Re-test after applying fixes.
7. Provide a final certification report.
```

---

## TASK T-PRO-01 — Implement NBA Trust Account Ledger

### PROMPT 1 — IMPLEMENTATION
```markdown
You are a Replit execution agent responsible for implementing a new feature in the `webwaka-professional` repository.

**Task ID:** T-PRO-01
**Task Title:** Implement NBA Trust Account Ledger

**Context & Objective:**
Commingling client funds with operating funds is a serious NBA (Nigerian Bar Association) violation. Lawyers need a compliant, auditable trust account system. We must build a dedicated, double-entry ledger for law firm client trust accounts.

**WebWaka Invariants to Honor:**
1. **Thoroughness Over Speed:** All trust account transactions must be immutable. You must NEVER allow UPDATE or DELETE operations on trust transaction records. Use append-only inserts.
2. **Multi-Tenant Tenant-as-Code:** Enforce strict `tenant_id` isolation. A lawyer at Firm A must never see Firm B's trust accounts.

**Execution Steps:**
1. Read the `webwaka_11_repos_research_report.md` (Professional enhancements section) for context.
2. Update the Drizzle schema to add `trust_accounts` and `trust_transactions` tables. Ensure `trust_transactions` has no `UPDATE` or `DELETE` routes.
3. Build the Admin UI for creating trust accounts, recording deposits, and recording disbursements.
4. Implement the balance calculation logic using a running sum of transactions.
5. Build the audit log view showing the full immutable history for each account.
6. Write tests verifying that the balance is always correct and that no transaction can be modified.
7. Report completion, summarizing the files changed and confirming adherence to the invariants.
```

### PROMPT 2 — QA / TEST / BUG-FIX
```markdown
You are a Replit QA and Bug-Fix agent responsible for verifying the implementation of Task T-PRO-01 (Implement NBA Trust Account Ledger) in the `webwaka-professional` repository.

**Verification Steps:**
1. Review the intended scope: Immutable double-entry ledger for trust accounts, Admin UI for deposits/disbursements, and an audit log view.
2. Inspect the actual codebase changes.
3. **Audit Immutability:** Verify that there are NO API endpoints or database routes that allow updating or deleting trust transaction records.
4. **Audit Tenancy:** Verify strict `tenant_id` isolation on all trust account queries.
5. If any omissions, bugs, or invariant violations are found, **FIX THE CODE DIRECTLY**. Do not merely report the issue.
6. Re-test after applying fixes.
7. Provide a final certification report.
```

---

## TASK T-CIV-01 — Implement Offline Tithe & Offering Logging

### PROMPT 1 — IMPLEMENTATION
```markdown
You are a Replit execution agent responsible for implementing a new feature in the `webwaka-civic` repository.

**Task ID:** T-CIV-01
**Task Title:** Implement Offline Tithe & Offering Logging

**Context & Objective:**
Church halls often have poor Wi-Fi. Ushers cannot stop collecting during the service. We must allow church ushers to record cash donations offline during the service, with automatic sync to the server when the service ends and network is restored.

**WebWaka Invariants to Honor:**
1. **Mobile/PWA/Offline First:** The entire donation logging workflow must function without any network connection. All records must be queued in Dexie and synced via a background sync manager.

**Execution Steps:**
1. Read the `webwaka_11_repos_research_report.md` (Civic enhancements section) for context.
2. Inspect the current `webwaka-civic` Dexie schema and sync engine.
3. Add a `pending_donations` table to the Dexie schema.
4. Build the Usher PWA UI for quick denomination entry (e.g., large denomination buttons for ₦500, ₦1,000, ₦5,000).
5. Implement the background sync manager to flush pending donations to the server.
6. Write tests covering the offline logging and bulk sync logic.
7. Report completion, summarizing the files changed and confirming adherence to the invariants.
```

### PROMPT 2 — QA / TEST / BUG-FIX
```markdown
You are a Replit QA and Bug-Fix agent responsible for verifying the implementation of Task T-CIV-01 (Implement Offline Tithe & Offering Logging) in the `webwaka-civic` repository.

**Verification Steps:**
1. Review the intended scope: Offline Dexie queuing, usher PWA UI, and background sync manager.
2. Inspect the actual codebase changes.
3. **Audit Offline Resilience:** Verify that the donation logging UI does not make any network requests during the recording process. It must write directly to Dexie.
4. **Audit Sync:** Verify that the background sync manager correctly flushes all pending donations and handles partial sync failures gracefully.
5. If any omissions, bugs, or invariant violations are found, **FIX THE CODE DIRECTLY**. Do not merely report the issue.
6. Re-test after applying fixes.
7. Provide a final certification report.
```

---

## TASK T-RES-01 — Implement ESVARBON Agent Verification

### PROMPT 1 — IMPLEMENTATION
```markdown
You are a Replit execution agent responsible for implementing a new feature in the `webwaka-real-estate` repository.

**Task ID:** T-RES-01
**Task Title:** Implement ESVARBON Agent Verification

**Context & Objective:**
Fake agents are a massive problem in Nigerian real estate. Verifying ESVARBON (Estate Surveyors and Valuers Registration Board of Nigeria) registration builds trust and protects buyers. We must automatically verify real estate agent registration numbers during onboarding.

**WebWaka Invariants to Honor:**
1. **Nigeria-First, Africa-Ready:** The ESVARBON API may not be publicly available. You MUST implement a fallback where the admin manually verifies uploaded documents if the API is unavailable.
2. **Multi-Tenant Tenant-as-Code:** Enforce strict `tenant_id` isolation.

**Execution Steps:**
1. Read the `webwaka_11_repos_research_report.md` (Real Estate enhancements section) for context.
2. Update the Drizzle schema to add `agent_verification_status` to the agents table.
3. Build the agent onboarding UI with an ESVARBON number field and document upload capability.
4. Implement the backend integration with the ESVARBON API (or the manual admin override flow).
5. Implement the logic to display a "Verified Agent" badge on listings for verified agents.
6. Implement the logic to prevent unverified agents from publishing listings.
7. Write tests covering both the automated and manual verification paths.
8. Report completion, summarizing the files changed and confirming adherence to the invariants.
```

### PROMPT 2 — QA / TEST / BUG-FIX
```markdown
You are a Replit QA and Bug-Fix agent responsible for verifying the implementation of Task T-RES-01 (Implement ESVARBON Agent Verification) in the `webwaka-real-estate` repository.

**Verification Steps:**
1. Review the intended scope: Agent onboarding UI, ESVARBON API integration (with manual fallback), verified badge, and listing publication gate.
2. Inspect the actual codebase changes.
3. **Audit Fallback:** Verify that a manual admin override path exists for when the ESVARBON API is unavailable.
4. **Audit Publication Gate:** Verify that unverified agents are actually blocked from publishing listings, not just warned.
5. If any omissions, bugs, or invariant violations are found, **FIX THE CODE DIRECTLY**. Do not merely report the issue.
6. Re-test after applying fixes.
7. Provide a final certification report.
```

---

## TASK T-INS-01 — Implement JAMB/WAEC Result Verification

### PROMPT 1 — IMPLEMENTATION
```markdown
You are a Replit execution agent responsible for implementing a new feature in the `webwaka-institutional` repository.

**Task ID:** T-INS-01
**Task Title:** Implement JAMB/WAEC Result Verification

**Context & Objective:**
Manual verification of certificates is slow and prone to fraud. Automated verification speeds up admissions and ensures integrity. We must allow institutions to verify student entry qualifications by integrating with JAMB and WAEC result verification APIs.

**WebWaka Invariants to Honor:**
1. **Nigeria-First, Africa-Ready:** JAMB and WAEC APIs may require institutional partnerships. You MUST implement a fallback for manual document upload and admin review if the APIs are unavailable.
2. **Multi-Tenant Tenant-as-Code:** Enforce strict `tenant_id` isolation.

**Execution Steps:**
1. Read the `webwaka_11_repos_research_report.md` (Institutional enhancements section) for context.
2. Update the Drizzle schema to add `qualification_verifications` table.
3. Build the student application UI with JAMB registration number and WAEC scratch card fields.
4. Implement the backend integration with the JAMB and WAEC verification APIs.
5. Implement the manual document upload fallback for when APIs are unavailable.
6. Write tests covering both the automated and manual verification paths.
7. Report completion, summarizing the files changed and confirming adherence to the invariants.
```

### PROMPT 2 — QA / TEST / BUG-FIX
```markdown
You are a Replit QA and Bug-Fix agent responsible for verifying the implementation of Task T-INS-01 (Implement JAMB/WAEC Result Verification) in the `webwaka-institutional` repository.

**Verification Steps:**
1. Review the intended scope: Student application UI, JAMB/WAEC API integration (with manual fallback), and verification record storage.
2. Inspect the actual codebase changes.
3. **Audit Fallback:** Verify that a manual document upload and admin review path exists for when the APIs are unavailable.
4. **Audit Tenancy:** Verify strict `tenant_id` isolation on all verification queries.
5. If any omissions, bugs, or invariant violations are found, **FIX THE CODE DIRECTLY**. Do not merely report the issue.
6. Re-test after applying fixes.
7. Provide a final certification report.
```
