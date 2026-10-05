import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { type JobsModuleOptions, resolveJobsOptions } from './jobs.options.js';
import { JOBS_ENTITLED_WORKSPACES, JOBS_OPTIONS } from './jobs.tokens.js';
import { JobsQueueService } from './jobs-queue.service.js';
import { JobsRunnerService } from './jobs-runner.service.js';

/**
 * Importing this module IS starting the runner: `JobsRunnerService` begins
 * waking when the application has booted, unless `runner: false`.
 *
 * No resolver and no controller yet — the admin page is JOBS-PLAN phase 2. Until
 * then the runner is watched in the server log and in `job_run`.
 */
@Module({})
export class JobsModule {
  static forRoot(options: JobsModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [
      // Resolved HERE, so a process above the ceiling fails the boot, not its first run.
      { provide: JOBS_OPTIONS, useValue: resolveJobsOptions(options) },
      JobsQueueService,
      JobsRunnerService,
    ];
    if (options.prismaWriteProvider) providers.push(options.prismaWriteProvider as Provider);

    /*
     * ⚠ Bound to `undefined` when the host says nothing, rather than left out,
     * so "nobody answered" is a stated configuration — see `JobsModuleOptions`.
     */
    providers.push(
      options.entitledWorkspacesProvider
        ? (options.entitledWorkspacesProvider as Provider)
        : { provide: JOBS_ENTITLED_WORKSPACES, useValue: undefined },
    );

    return {
      module: JobsModule,
      imports: (options.imports ?? []) as NonNullable<DynamicModule['imports']>,
      providers,
      exports: [JobsQueueService, JobsRunnerService, JOBS_OPTIONS],
    };
  }
}
