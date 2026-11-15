import { Inject, Injectable } from '@nestjs/common';
import { PRINT_PRINTERS_MAX } from '../domain/printers.js';
import type {
  InScope,
  PrintAgentRow,
  PrintPrinterRow,
  PrintPrismaClient,
  PrintReceiptPrinterRow,
} from './print.repository.js';
import { PRINT_PRISMA } from './print.tokens.js';

/** Which workspace, always both ids — every row carries both (see the schema). */
export type PrintScope = InScope;

/**
 * How many computers the page lists. The cap (`print:agents`) is a handful;
 * this only bounds a cap somebody configured absurdly high.
 */
export const PRINT_AGENTS_MAX = 200;

export interface PrintAgentWithPrinters {
  agent: PrintAgentRow;
  /** By name. Ones the computer no longer reports are included, marked by `goneAt`. */
  printers: readonly PrintPrinterWithReceipt[];
}

/** A printer, with its receipt settings when a person marked it a receipt printer (#144). */
export interface PrintPrinterWithReceipt extends PrintPrinterRow {
  receipt: PrintReceiptPrinterRow | null;
}

/** How many receipt printers one workspace's list reads. More is a mistake, not a shop. */
export const PRINT_RECEIPT_PRINTERS_MAX = 100;

const BY_NAME = [{ name: 'asc' }, { id: 'asc' }] as const;

/**
 * Reading a workspace's paired computers and their printers.
 *
 * ⚠ REVOKED COMPUTERS ARE NEVER READ HERE. The row stays as a record, and
 * nothing a person sees lists it.
 */
@Injectable()
export class PrintService {
  constructor(@Inject(PRINT_PRISMA) private readonly prisma: PrintPrismaClient) {}

  /**
   * Two queries rather than a relation include: the structural client stays a
   * list of plain delegate calls, which is what lets the tests' fake keep the
   * same promise the database does.
   */
  async agents(scope: PrintScope): Promise<PrintAgentWithPrinters[]> {
    const agents = await this.prisma.printAgent.findMany({
      where: { ...scope, revokedAt: null },
      orderBy: [...BY_NAME],
      take: PRINT_AGENTS_MAX,
    });
    if (agents.length === 0) return [];

    const printers = await this.prisma.printPrinter.findMany({
      where: { agentId: { in: agents.map((agent) => agent.id) } },
      orderBy: [...BY_NAME],
      take: PRINT_AGENTS_MAX * PRINT_PRINTERS_MAX,
    });
    const receipts = await this.prisma.printReceiptPrinter.findMany({
      where: scope,
      take: PRINT_RECEIPT_PRINTERS_MAX,
    });
    const receiptOf = new Map(receipts.map((receipt) => [receipt.printerId, receipt]));
    return agents.map((agent) => ({
      agent,
      printers: printers
        .filter((printer) => printer.agentId === agent.id)
        .map((printer) => ({ ...printer, receipt: receiptOf.get(printer.id) ?? null })),
    }));
  }

  /** The workspace's default receipt printer, by id, or null when none is set. */
  async receiptDefault(scope: PrintScope): Promise<string | null> {
    const row = await this.prisma.printReceiptDefault.findUnique({ where: { workspaceId: scope.workspaceId } });
    return row?.printerId ?? null;
  }
}
