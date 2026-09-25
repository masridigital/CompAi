-- CreateTable
CREATE TABLE "ClientPostureSnapshot" (
    "id" TEXT NOT NULL DEFAULT generate_prefixed_cuid('cps'::text),
    "organizationId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frameworkScores" JSONB NOT NULL DEFAULT '[]',
    "overallScore" INTEGER NOT NULL DEFAULT 0,
    "controlsPassing" INTEGER NOT NULL DEFAULT 0,
    "controlsTotal" INTEGER NOT NULL DEFAULT 0,
    "failingChecks" INTEGER NOT NULL DEFAULT 0,
    "overdueTasks" INTEGER NOT NULL DEFAULT 0,
    "openFindings" INTEGER NOT NULL DEFAULT 0,
    "evidenceExpiring30d" INTEGER NOT NULL DEFAULT 0,
    "policiesUnpublished" INTEGER NOT NULL DEFAULT 0,
    "integrationErrors" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3),

    CONSTRAINT "ClientPostureSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientPostureSnapshot_organizationId_capturedAt_idx" ON "ClientPostureSnapshot"("organizationId", "capturedAt");

-- AddForeignKey
ALTER TABLE "ClientPostureSnapshot" ADD CONSTRAINT "ClientPostureSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

