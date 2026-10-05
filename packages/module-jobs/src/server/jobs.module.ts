import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { JobsResolver } from './graphql/jobs.resolver.js';
import { type JobsModuleOptions, resolveJobsOptions } from './jobs.options.js';
import { JobsService } from './jobs.service.js';
import { JOBS_ACTOR_DIRECTORY, JOBS_ENTITLED_WORKSPACES, JOBS_OPTIONS, JOBS_PRISMA } from './jobs.tokens.js';
import { JobsQueueService } from './jobs-queue.service.js';
import { JobsRunnerService } from './jobs-runner.service.js';
import { JobsWriteService } from './jobs-write.service.js';

/**
 * Importing this module IS starting the runner: `JobsRunnerService` begins
 * waking when the application has booted, unless `runner: false`. And it IS
 * the registration of the admin page's operations: the resolver joins the
 * composed schema because the driver walks the container.
 *
 * The two are independent. `runner: false` still serves the admin page (an API
 * instance beside a worker), and `expose: { graphql: false }` still runs the
 * processes (a worker that serves no page).
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
     * ⚠ Every optional port is bound to `undefined` when the host says nothing,
     * rather than left out, so "nobody answered" is a stated configuration and
     * not a property of whatever else the container happens to hold. Each
     * absence has a documented meaning — see `JobsModuleOptions`.
     */
    const optional: Array<[unknown, string]> = [
      [options.entitledWorkspacesProvider, JOBS_ENTITLED_WORKSPACES],
      [options.actorDirectoryProvider, JOBS_ACTOR_DIRECTORY],
      // Not optional to the page, but bound either way so `JobsService` can name the fix instead of Nest.
      [options.prismaProvider, JOBS_PRISMA],
    ];
    for (const [provider, token] of optional) {
      providers.push(provider ? (provider as Provider) : { provide: token, useValue: undefined });
    }

    const exposed = options.expose?.graphql ?? true;
    // The page's services go with its resolver: a worker that serves no page needs no read client.
    if (exposed) providers.push(JobsService, JobsWriteService, JobsResolver);

    return {
      module: JobsModule,
      imports: (options.imports ?? []) as NonNullable<DynamicModule['imports']>,
      providers,
      exports: [JobsQueueService, JobsRunnerService, JOBS_OPTIONS, ...(exposed ? [JobsService, JobsWriteService] : [])],
    };
  }
}
