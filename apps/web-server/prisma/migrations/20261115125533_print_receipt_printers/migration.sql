-- CreateTable
CREATE TABLE "print_receipt_printer" (
    "printerId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "label" TEXT,
    "paperWidth" INTEGER NOT NULL,
    "cutter" BOOLEAN NOT NULL,
    "drawer" BOOLEAN NOT NULL,
    "qr" BOOLEAN NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_receipt_printer_pkey" PRIMARY KEY ("printerId")
);

-- CreateTable
CREATE TABLE "print_receipt_default" (
    "workspaceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "printerId" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_receipt_default_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateIndex
CREATE INDEX "print_receipt_printer_workspaceId_idx" ON "print_receipt_printer"("workspaceId");

-- CreateIndex
CREATE INDEX "print_receipt_printer_organizationId_idx" ON "print_receipt_printer"("organizationId");

-- CreateIndex
CREATE INDEX "print_receipt_default_organizationId_idx" ON "print_receipt_default"("organizationId");

-- AddForeignKey
ALTER TABLE "print_receipt_printer" ADD CONSTRAINT "print_receipt_printer_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "print_printer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
