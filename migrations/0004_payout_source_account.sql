-- Migration 0004: Add sourceAccountId to fint_payoutRequests
-- Enables internal wallet deduction before NIBSS transfer (QA-FIN-1 Offline Resilience)

ALTER TABLE fint_payoutRequests ADD COLUMN sourceAccountId TEXT;
