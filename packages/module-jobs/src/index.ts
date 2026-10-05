/**
 * `@kwtech/module-jobs` — the background runner (docs/JOBS-PLAN.md).
 *
 * THIS ENTRY POINT IS PURE DOMAIN. No Prisma, no Nest: the queue's decisions,
 * testable with a literal. What a PROCESS is — the declaration, the schedule,
 * the handler — lives in `@kwtech/module-kit`, because every module declares
 * them and may import nothing else.
 *
 * ⚠ CORE, NOT A FEATURE MODULE (JOBS-PLAN D9): every application composes it.
 * It imports no feature module and runs with none composed.
 */

export * from './domain/queue.js';
export * from './types.js';
