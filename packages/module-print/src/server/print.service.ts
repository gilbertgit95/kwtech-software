import { Inject, Injectable } from '@nestjs/common';
import { PRINT_PRINTERS_MAX } from '../domain/printers.js';
import type { InScope, PrintAgentRow, PrintPrinterRow, PrintPrismaClient } from './print.repository.js';
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
  printers: readonly PrintPrinterRow[];
}

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
    return agents.map((agent) => ({ agent, printers: printers.filter((printer) => printer.agentId === agent.id) }));
  }
}
