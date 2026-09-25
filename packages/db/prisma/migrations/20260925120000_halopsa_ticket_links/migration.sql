-- CreateEnum
CREATE TYPE "HaloTicketLinkState" AS ENUM ('pending_create', 'open', 'resolved', 'closed_externally');

-- CreateEnum
CREATE TYPE "HaloOutboxStatus" AS ENUM ('pending', 'processing', 'done', 'dead');

-- CreateTable
CREATE TABLE "HaloTicketLink" (
    "id" TEXT NOT NULL DEFAULT generate_prefixed_cuid('htl'::text),
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "refToken" TEXT NOT NULL,
    "haloTicketId" INTEGER,
    "state" "HaloTicketLinkState" NOT NULL DEFAULT 'pending_create',
    "resolvedAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HaloTicketLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HaloOutboxEvent" (
    "id" TEXT NOT NULL DEFAULT generate_prefixed_cuid('hob'::text),
    "organizationId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "HaloOutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HaloOutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HaloTicketLink_refToken_key" ON "HaloTicketLink"("refToken");

-- CreateIndex
CREATE INDEX "HaloTicketLink_state_idx" ON "HaloTicketLink"("state");

-- CreateIndex
CREATE UNIQUE INDEX "HaloTicketLink_organizationId_dedupKey_key" ON "HaloTicketLink"("organizationId", "dedupKey");

-- CreateIndex
CREATE INDEX "HaloOutboxEvent_status_nextAttemptAt_idx" ON "HaloOutboxEvent"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "HaloTicketLink" ADD CONSTRAINT "HaloTicketLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HaloTicketLink" ADD CONSTRAINT "HaloTicketLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HaloOutboxEvent" ADD CONSTRAINT "HaloOutboxEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

