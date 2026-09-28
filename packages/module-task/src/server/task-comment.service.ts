import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { checkEditComment, checkWorkWithTask, planRemoveComment } from '../domain/access.js';
import { prepareCommentBody, TASK_COMMENTS_MAX } from '../domain/tasks.js';
import type { TaskAccessCheck, TaskNotifier } from './ports.js';
import { refusalError, taskNotFound } from './task.errors.js';
import { TaskEventPublisher } from './task.events.js';
import { loadTask, type TaskScope } from './task.lookup.js';
import type { TaskCommentRow, TaskWriteClient } from './task.repository.js';
import { TASK_ACCESS_CHECK, TASK_NOTIFIER, TASK_PRISMA_WRITE } from './task.tokens.js';

/** How much of a comment a notification quotes. */
const PREVIEW_MAX = 140;

/**
 * Comments on a task (decision 18): plain text, edited only by their author,
 * removed by their author, the board's owner, or `task:manage_all`.
 *
 * A comment is found by id AND scope, and then THROUGH its task and board
 * (`loadTask`): a comment on a task the actor cannot see is not found.
 */
@Injectable()
export class TaskCommentService {
  private readonly logger = new Logger('TaskComments');

  constructor(
    @Inject(TASK_PRISMA_WRITE) private readonly prisma: TaskWriteClient,
    private readonly events: TaskEventPublisher,
    @Optional() @Inject(TASK_ACCESS_CHECK) private readonly access?: TaskAccessCheck,
    @Optional() @Inject(TASK_NOTIFIER) private readonly notifier?: TaskNotifier,
  ) {}

  /**
   * A new comment, counted on the task in the same transaction. The task's
   * assignees and creator are told, never the commenter (TASK-PLAN §0 D).
   */
  async add(scope: TaskScope, actorId: string, taskId: string, rawBody: string): Promise<TaskCommentRow> {
    const prepared = prepareCommentBody(rawBody);
    if ('refused' in prepared) throw refusalError(prepared.refused);
    const { task, board } = await loadTask(this.prisma, scope, taskId, actorId);
    const refusal = checkWorkWithTask(board, task, actorId);
    if (refusal) throw refusalError(refusal);

    const comment = await this.prisma.$transaction(async (tx) => {
      if ((await tx.taskComment.count({ where: { taskId: task.id } })) >= TASK_COMMENTS_MAX) {
        throw refusalError('too_many_comments');
      }
      const created = await tx.taskComment.create({
        data: { ...scope, taskId: task.id, authorId: actorId, body: prepared.body },
      });
      await tx.task.updateMany({ where: { ...scope, id: task.id }, data: { commentCount: { increment: 1 } } });
      return created;
    });

    await this.events.changed(board, 'comment', actorId, task.id);
    const assignees = await this.prisma.taskAssignee.findMany({ where: { taskId: task.id } });
    const recipientIds = [...new Set([task.creatorId, ...assignees.map((row) => row.userId)])].filter(
      (userId) => userId !== actorId,
    );
    if (this.notifier && recipientIds.length > 0) {
      await this.notifier
        .commented({
          recipientIds,
          actorId,
          organizationId: board.organizationId,
          workspaceId: board.workspaceId,
          boardId: board.id,
          boardName: board.name,
          taskId: task.id,
          taskTitle: task.title,
          commentPreview: preview(prepared.body),
        })
        .catch((error: unknown) =>
          this.logger.warn(`Could not tell people about a comment: ${(error as Error).message}`),
        );
    }
    return comment;
  }

  /** Its author's alone, whatever keys anybody else holds. */
  async update(scope: TaskScope, actorId: string, commentId: string, rawBody: string): Promise<TaskCommentRow> {
    const prepared = prepareCommentBody(rawBody);
    if ('refused' in prepared) throw refusalError(prepared.refused);
    const { comment, board, task } = await this.find(scope, commentId, actorId);
    const refusal = checkEditComment(board, comment, actorId);
    if (refusal) throw refusalError(refusal);

    await this.prisma.taskComment.updateMany({
      where: { ...scope, id: comment.id },
      data: { body: prepared.body, editedAt: new Date() },
    });
    await this.events.changed(board, 'comment', actorId, task.id);
    return { ...comment, body: prepared.body, editedAt: new Date() };
  }

  async remove(scope: TaskScope, actorId: string, commentId: string): Promise<void> {
    const { comment, board, task } = await this.find(scope, commentId, actorId);
    const plan = planRemoveComment(board, comment, actorId);
    if (plan.kind === 'refused') throw refusalError(plan.reason);
    if (plan.kind === 'needs_manage_all') {
      const allowed = (await this.access?.holdsManageAll(scope.organizationId, scope.workspaceId, actorId)) ?? false;
      if (!allowed) throw refusalError('not_permitted');
    }
    await this.prisma.$transaction(async (tx) => {
      const gone = await tx.taskComment.deleteMany({ where: { ...scope, id: comment.id } });
      if (gone.count > 0) {
        await tx.task.updateMany({ where: { ...scope, id: task.id }, data: { commentCount: { decrement: 1 } } });
      }
    });
    await this.events.changed(board, 'comment', actorId, task.id);
  }

  private async find(scope: TaskScope, commentId: string, actorId: string) {
    const comment = await this.prisma.taskComment.findFirst({ where: { ...scope, id: commentId } });
    if (!comment) throw taskNotFound();
    const { task, board } = await loadTask(this.prisma, scope, comment.taskId, actorId);
    return { comment, task, board };
  }
}

function preview(body: string): string {
  const text = body.replace(/\s+/gu, ' ').trim();
  const points = [...text];
  return points.length <= PREVIEW_MAX ? text : `${points.slice(0, PREVIEW_MAX - 1).join('')}…`;
}
