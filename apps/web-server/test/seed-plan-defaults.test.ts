import { APP_DEFAULT } from '@kwtech/module-permissions';
import { seedPlanDefaults } from '../src/seed/seeders/defaults.js';
import type { SeedContext } from '../src/seed/types.js';

/**
 * The plan defaults on a FRESH database (#92). The defaults seeder runs in the
 * sync phase, before the plans seeder creates any plan, so it must skip and the
 * plans seeder must set them afterwards — and neither may touch a row that
 * exists, a cleared one included.
 */
function fakeSeedPrisma(db: { defaults: { key: string; value: string | null }[]; plans: string[] }) {
  const prisma = {
    permDefault: {
      findMany: async () => db.defaults.map((row) => ({ key: row.key })),
      create: async (args: { data: { key: string; value: string } }) => {
        db.defaults.push({ key: args.data.key, value: args.data.value });
        return args.data;
      },
    },
    permPlan: {
      findMany: async () => db.plans.map((key) => ({ key, features: [] })),
      findFirst: async (args: { where: { key: string } }) =>
        db.plans.includes(args.where.key) ? { key: args.where.key } : null,
    },
  };
  // Structural: only the four delegate methods these two defaults use. The
  // generated client's full type is thousands of members no test would fill.
  return prisma as unknown as SeedContext['prisma'];
}

describe('seedPlanDefaults', () => {
  const log = () => {};

  it('skips both on a database with no plans yet, and sets them once the plans exist', async () => {
    const db = { defaults: [] as { key: string; value: string | null }[], plans: [] as string[] };
    expect(await seedPlanDefaults({ prisma: fakeSeedPrisma(db), log })).toBe(0);
    db.plans.push('free', 'starter');
    expect(await seedPlanDefaults({ prisma: fakeSeedPrisma(db), log })).toBe(2);
    expect(db.defaults).toEqual(
      expect.arrayContaining([
        { key: APP_DEFAULT.organizationPlan, value: 'free' },
        { key: APP_DEFAULT.organizationFallbackPlan, value: 'free' },
      ]),
    );
  });

  it('⚠ leaves a default somebody set or cleared, and runs twice like once', async () => {
    const db = {
      defaults: [{ key: APP_DEFAULT.organizationFallbackPlan, value: null }] as { key: string; value: string | null }[],
      plans: ['free'],
    };
    await seedPlanDefaults({ prisma: fakeSeedPrisma(db), log });
    await seedPlanDefaults({ prisma: fakeSeedPrisma(db), log });
    expect(db.defaults.filter((row) => row.key === APP_DEFAULT.organizationFallbackPlan)).toEqual([
      { key: APP_DEFAULT.organizationFallbackPlan, value: null },
    ]);
    expect(db.defaults.filter((row) => row.key === APP_DEFAULT.organizationPlan)).toHaveLength(1);
  });
});
