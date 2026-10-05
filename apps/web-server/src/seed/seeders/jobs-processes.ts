import { syncJobProcesses } from '@kwtech/module-jobs/server';
import { ALL_PROCESSES } from '../registry.js';
import type { Seeder } from '../types.js';

/**
 * Mirrors every module's background processes into `job_process`, and writes
 * the queue lock's one row.
 *
 * The ALGORITHM is the module's — upsert every declaration, deprecate what is
 * gone, never delete, and never touch what an admin set (a pause, a schedule).
 * This file supplies the client and the registry and nothing else.
 *
 * Phase 'sync', and that is load-bearing: THE RUNNER RUNS NOTHING THAT HAS NO
 * ROW. Until this has run, a newly declared process is never queued — fail
 * closed — so it has to happen on every deploy, not when someone remembers.
 */
export const jobsProcessesSeeder: Seeder = {
  name: 'jobs:processes',
  phase: 'sync',
  description: 'Mirror every module’s background processes into job_process.',
  async run({ prisma, log }) {
    const result = await syncJobProcesses(prisma, ALL_PROCESSES);
    log(`${result.upserted} process(es) upserted`);
    if (result.deprecated.length > 0) log(`deprecated: ${result.deprecated.join(', ')}`);
  },
};
