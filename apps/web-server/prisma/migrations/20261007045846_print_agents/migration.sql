-- CreateTable
CREATE TABLE "print_agent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostName" TEXT,
    "agentVersion" TEXT,
    "secretHash" TEXT NOT NULL,
    "pairedById" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_pairing_code" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "print_pairing_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_printer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "driver" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "papers" JSONB NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL,
    "goneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_printer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "print_agent_secretHash_key" ON "print_agent"("secretHash");

-- CreateIndex
CREATE INDEX "print_agent_organizationId_idx" ON "print_agent"("organizationId");

-- CreateIndex
CREATE INDEX "print_agent_workspaceId_idx" ON "print_agent"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "print_pairing_code_codeHash_key" ON "print_pairing_code"("codeHash");

-- CreateIndex
CREATE INDEX "print_pairing_code_organizationId_idx" ON "print_pairing_code"("organizationId");

-- CreateIndex
CREATE INDEX "print_pairing_code_workspaceId_idx" ON "print_pairing_code"("workspaceId");

-- CreateIndex
CREATE INDEX "print_printer_organizationId_idx" ON "print_printer"("organizationId");

-- CreateIndex
CREATE INDEX "print_printer_workspaceId_idx" ON "print_printer"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "print_printer_agentId_name_key" ON "print_printer"("agentId", "name");

-- AddForeignKey
ALTER TABLE "print_printer" ADD CONSTRAINT "print_printer_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "print_agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
