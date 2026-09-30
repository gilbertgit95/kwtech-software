import { normaliseEmail } from '@kwtech/module-auth';
import {
  checkPosPrice,
  type PosRefusal,
  preparePosCode,
  preparePosDescription,
  preparePosName,
} from '@kwtech/module-basic-pos';
import { POS_SEED_CATALOGUE } from '../pos-catalogue.js';
import type { Seeder } from '../types.js';

/**
 * The printing shop's price list (`../pos-catalogue.ts`) into ONE store's
 * point of sale: `SEED_POS_CATALOGUE_WORKSPACE_ID`.
 *
 * ## Why it only creates
 *
 * Once seeded, the catalogue is the store's. A price changed on the item
 * screen must survive the next `pnpm db:seed`, so a row that already exists —
 * found by its code, or a category by its name — is left exactly as it is. To
 * push a changed price from the list, change it in the app.
 *
 * ## Why one workspace, named in the environment
 *
 * A catalogue is per store. Seeding every workspace would put a printing
 * shop's price list into a software company's till; skipped when unset, so the
 * seed task stays safe to run anywhere.
 *
 * ## The module's rules, not a copy of them
 *
 * Names, codes, descriptions and prices go through the module's own `prepare*`
 * and `check*`, so a seeded row is one the item screen would have accepted. It
 * writes with Prisma rather than through the service because a seeder has no
 * Nest container; the `pos:items` cap is not counted, and this list is far
 * below it.
 */
export const posCatalogueSeeder: Seeder = {
  name: 'pos:catalogue',
  phase: 'seed',
  description:
    'Create the printing price list in the SEED_POS_CATALOGUE_WORKSPACE_ID point of sale (missing rows only).',
  async run({ prisma, log }) {
    const workspaceId = process.env.SEED_POS_CATALOGUE_WORKSPACE_ID;
    if (!workspaceId) {
      log('skipped — set SEED_POS_CATALOGUE_WORKSPACE_ID');
      return;
    }
    const workspace = await prisma.permWorkspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, organizationId: true, name: true },
    });
    if (!workspace) throw new Error(`SEED_POS_CATALOGUE_WORKSPACE_ID: no workspace ${workspaceId}`);

    /*
     * `createdById` is a bare user id (PLAN §9). The first operator, whom
     * `first-user` made earlier in this phase, rather than a made-up id that
     * would show as "unknown" wherever the item's author is named.
     */
    const email = process.env.SEED_USER_EMAIL;
    const actor = email
      ? await prisma.authUser.findUnique({ where: { email: normaliseEmail(email) }, select: { id: true } })
      : null;
    if (!actor) throw new Error('pos:catalogue needs SEED_USER_EMAIL to name an existing account');

    const scope = { organizationId: workspace.organizationId, workspaceId: workspace.id };
    let created = 0;
    let kept = 0;

    for (const [sortOrder, category] of POS_SEED_CATALOGUE.entries()) {
      const name = checked(preparePosName(category.name), category.name).name;
      const nameKey = name.toLowerCase();
      const row = await prisma.posCategory.upsert({
        where: { workspaceId_nameKey: { workspaceId: workspace.id, nameKey } },
        create: { ...scope, name, nameKey, sortOrder },
        update: {},
        select: { id: true },
      });

      for (const item of category.items) {
        const code = checked(preparePosCode(item.code), item.code).code;
        if (!code) throw new Error(`pos:catalogue: ${item.name} has no code`);
        const existing = await prisma.posItem.findUnique({
          where: { workspaceId_code: { workspaceId: workspace.id, code } },
          select: { id: true },
        });
        if (existing) {
          kept++;
          continue;
        }
        const variants = (item.variants ?? []).map((variant, index) => ({
          ...scope,
          name: checked(preparePosName(variant.name), variant.name).name,
          code: checked(preparePosCode(variant.code), variant.code).code,
          price: centavos(variant.price, variant.code),
          sortOrder: index,
        }));
        /*
         * One transaction per item, so a till never loads an item whose
         * variants are half made — the same promise the service keeps.
         */
        await prisma.posItem.create({
          data: {
            ...scope,
            categoryId: row.id,
            kind: item.kind,
            name: checked(preparePosName(item.name), item.name).name,
            code,
            description: checked(preparePosDescription(item.description), item.name).description,
            price: centavos(item.price, item.code),
            createdById: actor.id,
            updatedById: actor.id,
            variants: { create: variants },
          },
        });
        created++;
      }
    }
    log(`${workspace.name}: created ${created} item(s), left ${kept} already there`);
  },
};

/** A `prepare*` result, or a loud failure naming the entry: a bad list must stop the run. */
function checked<T extends object>(result: T | { refused: PosRefusal }, what: string): T {
  if ('refused' in result) throw new Error(`pos:catalogue: "${what}" refused (${result.refused})`);
  return result;
}

/** Pesos in the list, centavos in the table. */
function centavos(pesos: number, what: string): number {
  const price = Math.round(pesos * 100);
  const refusal = checkPosPrice(price);
  if (refusal) throw new Error(`pos:catalogue: ${what} price refused (${refusal})`);
  return price;
}
