import { escapeLikePattern } from '@kwtech/module-kit';
import { Inject, Injectable } from '@nestjs/common';
import {
  POS_CUSTOMER_SEARCH_MAX,
  preparePosEmail,
  preparePosFacebookUrl,
  preparePosPhone,
} from '../domain/customers.js';
import { POS_NOTE_MAX, preparePosLine, preparePosName } from '../domain/text.js';
import { refusalError, unwrap } from './pos.errors.js';
import { PosEventPublisher } from './pos.events.js';
import type { InScope, PosCustomerRow, PosTransaction, PosWriteClient } from './pos.repository.js';
import { POS_PRISMA_WRITE } from './pos.tokens.js';

export interface SavePosCustomerInput {
  /** Omitted: a new customer. */
  id?: string | null | undefined;
  name: string;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  facebookUrl?: string | null | undefined;
  note?: string | null | undefined;
}

/**
 * The store's recorded customers (D5). Reading them is `pos:read`; creating
 * and editing them is `pos:sell`, because the till is where customers are met.
 * A walk-in has no row at all — only free text on its order.
 */
@Injectable()
export class PosCustomerService {
  constructor(
    @Inject(POS_PRISMA_WRITE) private readonly prisma: PosWriteClient,
    private readonly events: PosEventPublisher,
  ) {}

  /**
   * Customers matching `search` in name, phone, e-mail or Facebook link, by name — the till's
   * picker. An empty search lists the first ones by name.
   *
   * ⚠ The term is ESCAPED for LIKE: Prisma's `contains` escapes nothing, and
   * "100%" would otherwise match everyone.
   */
  async search(scope: InScope, search: string, includeArchived: boolean): Promise<PosCustomerRow[]> {
    const term = search.trim();
    const match = term ? { contains: escapeLikePattern(term), mode: 'insensitive' as const } : null;
    return this.prisma.posCustomer.findMany({
      where: {
        ...scope,
        ...(includeArchived ? {} : { archivedAt: null }),
        ...(match ? { OR: [{ name: match }, { phone: match }, { email: match }, { facebookUrl: match }] } : {}),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: POS_CUSTOMER_SEARCH_MAX,
    });
  }

  async get(scope: InScope, id: string): Promise<PosCustomerRow | null> {
    return this.prisma.posCustomer.findFirst({ where: { ...scope, id } });
  }

  /** A new customer, or an edited one. Editing never changes an old receipt: orders keep their copy. */
  async save(scope: InScope, actorId: string, input: SavePosCustomerInput): Promise<PosCustomerRow> {
    const { name } = unwrap(preparePosName(input.name));
    const { phone } = unwrap(preparePosPhone(input.phone ?? ''));
    const { email } = unwrap(preparePosEmail(input.email ?? ''));
    const { facebookUrl } = unwrap(preparePosFacebookUrl(input.facebookUrl ?? ''));
    const note = preparePosLine(input.note ?? '', POS_NOTE_MAX, { allowEmpty: true });
    if (note === null) throw refusalError('invalid_note');
    const fields = { name, phone, email, facebookUrl, note: note || null };

    const saved = await this.prisma.$transaction(async (tx) => {
      if (!input.id) {
        return tx.posCustomer.create({ data: { ...scope, ...fields, createdById: actorId } });
      }
      const updated = await tx.posCustomer.updateMany({
        where: { ...scope, id: input.id },
        data: fields,
      });
      if (updated.count === 0) throw refusalError('not_found');
      return requireCustomer(tx, scope, input.id);
    });
    await this.events.changed(scope, 'customers', actorId);
    return saved;
  }

  /** Archives a customer — they leave the picker — or restores one. Never deleted: their orders point at them. */
  async setArchived(scope: InScope, actorId: string, id: string, archived: boolean): Promise<PosCustomerRow> {
    const saved = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.posCustomer.updateMany({
        where: { ...scope, id },
        data: { archivedAt: archived ? new Date() : null },
      });
      if (updated.count === 0) throw refusalError('not_found');
      return requireCustomer(tx, scope, id);
    });
    await this.events.changed(scope, 'customers', actorId);
    return saved;
  }
}

async function requireCustomer(tx: PosTransaction, scope: InScope, id: string): Promise<PosCustomerRow> {
  const customer = await tx.posCustomer.findFirst({ where: { ...scope, id } });
  if (!customer) throw refusalError('not_found');
  return customer;
}
