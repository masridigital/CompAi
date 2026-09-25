-- HaloPSA reconcile cursor: poll the least recently reconciled open links
-- first so every open link is covered over time, not just the first batch.
-- AlterTable
ALTER TABLE "HaloTicketLink" ADD COLUMN     "lastReconciledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "HaloTicketLink_state_lastReconciledAt_idx" ON "HaloTicketLink"("state", "lastReconciledAt");

-- Data note (no SQL needed): HaloPSA client bindings now live only in
-- IntegrationConnection.metadata.halopsaBinding, written by the platform-admin
-- bind flow. Existing halopsa connections (client id in credentials, variables
-- or top-level metadata) are treated as unbound until a platform admin
-- re-binds them on the admin HaloPSA page.
