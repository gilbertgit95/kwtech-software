-- CreateIndex
CREATE INDEX "print_receipt_default_printerId_idx" ON "print_receipt_default"("printerId");

-- AddForeignKey
ALTER TABLE "print_receipt_default" ADD CONSTRAINT "print_receipt_default_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "print_receipt_printer"("printerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- A receipt printer's paper is 58 or 80 mm (`RECEIPT_PAPER_WIDTHS`): any other width has no column count, and a
-- receipt laid out for it would be empty. Kept by the database, not only by `prepareReceiptSettings`.
ALTER TABLE "print_receipt_printer" ADD CONSTRAINT "print_receipt_printer_paperWidth_check" CHECK ("paperWidth" IN (58, 80));
