-- Migration 0004: Add sourceAccountId to payoutRequests
-- Enables internal wallet deduction before NIBSS transfer (QA-FIN-1 Offline Resilience)

ALTER TABLE payoutRequests ADD COLUMN sourceAccountId TEXT;
