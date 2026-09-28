import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { TaskBoardService } from './board.service.js';
import { TaskResolver } from './graphql/task.resolver.js';
import { TaskEventPublisher } from './task.events.js';
import type { TaskModuleOptions } from './task.options.js';
import { TaskService } from './task.service.js';
import {
  TASK_ACCESS_CHECK,
  TASK_LIMIT_CHECKER,
  TASK_MEMBER_DIRECTORY,
  TASK_NOTIFIER,
  TASK_OPTIONS,
  TASK_PUBSUB,
} from './task.tokens.js';
import { TaskCommentService } from './task-comment.service.js';
import { TaskWriteService } from './task-write.service.js';

/**
 * Importing this module IS the registration: the resolver joins the composed
 * schema because the driver walks the container.
 */
@Module({})
export class TaskModule {
  static forRoot(options: TaskModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: TASK_OPTIONS, useValue: options },
      TaskBoardService,
      TaskService,
      TaskWriteService,
      TaskCommentService,
      TaskEventPublisher,
    ];
    if (options.prismaProvider) providers.push(options.prismaProvider as Provider);
    if (options.prismaWriteProvider) providers.push(options.prismaWriteProvider as Provider);

    /*
     * ⚠ Every optional port is bound to `undefined` when the host says nothing,
     * rather than left out, so "nobody answered" is a stated configuration and
     * not a property of whatever else the container happens to hold. Each
     * absence has a documented meaning — see `TaskModuleOptions`.
     */
    const optional: Array<[unknown, string]> = [
      [options.limitCheckerProvider, TASK_LIMIT_CHECKER],
      [options.accessCheckProvider, TASK_ACCESS_CHECK],
      [options.memberDirectoryProvider, TASK_MEMBER_DIRECTORY],
      [options.notifierProvider, TASK_NOTIFIER],
      [options.pubsubProvider, TASK_PUBSUB],
    ];
    for (const [provider, token] of optional) {
      providers.push(provider ? (provider as Provider) : { provide: token, useValue: undefined });
    }

    if (options.expose?.graphql ?? true) providers.push(TaskResolver);

    return {
      module: TaskModule,
      imports: (options.imports ?? []) as NonNullable<DynamicModule['imports']>,
      providers,
      exports: [TaskBoardService, TaskService, TaskWriteService, TaskCommentService, TaskEventPublisher, TASK_OPTIONS],
    };
  }
}
