import { Field, InputType, Int, ObjectType } from '@nestjs/graphql';

/*
 * The tasks GraphQL shapes. Code-first, rendered from rows by the resolver's
 * `render*` functions. Visibility, priority, view and event kinds cross as
 * documented STRINGS (no `registerEnumType`), days as `YYYY-MM-DD`, moments as
 * ISO strings.
 */

@ObjectType('TaskPerson')
export class TaskPersonType {
  @Field()
  userId!: string;

  /** Null when the app cannot name them — a former member; show "a former member". */
  @Field(() => String, { nullable: true })
  displayName!: string | null;
}

@ObjectType('TaskColumn')
export class TaskColumnType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  /** A task in a done column is finished. */
  @Field()
  done!: boolean;
}

/** A board as the switcher lists it. */
@ObjectType('TaskBoardSummary')
export class TaskBoardSummaryType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  /** `private` (the owner alone) or `workspace`. */
  @Field()
  visibility!: string;

  /** Owned by the viewer — who alone configures it. */
  @Field()
  mine!: boolean;

  @Field()
  ownerId!: string;

  @Field(() => String, { nullable: true })
  ownerName!: string | null;

  @Field(() => Int)
  version!: number;

  @Field(() => String, { nullable: true })
  archivedAt!: string | null;
}

@ObjectType('TaskBoard')
export class TaskBoardType extends TaskBoardSummaryType {
  /** In the board's order. */
  @Field(() => [TaskColumnType])
  columns!: TaskColumnType[];

  /**
   * How many assignments of OTHER people making this board private would
   * remove — for the owner's confirm. Null for anybody but the owner of a
   * shared board.
   */
  @Field(() => Int, { nullable: true })
  assignmentsOfOthers!: number | null;
}

@ObjectType('TaskChecklistItem')
export class TaskChecklistItemType {
  @Field()
  id!: string;

  @Field()
  text!: string;

  @Field()
  done!: boolean;
}

/** A task as a card shows it — everything but its description and comments. */
@ObjectType('TaskCard')
export class TaskCardType {
  @Field()
  id!: string;

  @Field()
  boardId!: string;

  /** Its board's name — for My tasks, which gathers cards from several. */
  @Field()
  boardName!: string;

  @Field()
  columnId!: string;

  @Field()
  title!: string;

  /** `low`, `normal`, `high` or `urgent`. */
  @Field()
  priority!: string;

  /** A day, `YYYY-MM-DD`, or null. The day somebody plans to work on it. */
  @Field(() => String, { nullable: true })
  scheduledOn!: string | null;

  /** A day, `YYYY-MM-DD`, or null. The deadline. */
  @Field(() => String, { nullable: true })
  dueOn!: string | null;

  @Field(() => [String])
  labels!: string[];

  /** In the order they were assigned. */
  @Field(() => [TaskPersonType])
  assignees!: TaskPersonType[];

  @Field(() => Int)
  checklistDone!: number;

  @Field(() => Int)
  checklistTotal!: number;

  @Field(() => Int)
  commentCount!: number;

  /** Send it back with the next title or description save. */
  @Field(() => Int)
  version!: number;

  /** Created by the viewer. */
  @Field()
  mine!: boolean;

  @Field(() => String, { nullable: true })
  completedAt!: string | null;

  @Field(() => String, { nullable: true })
  archivedAt!: string | null;
}

@ObjectType('Task')
export class TaskType extends TaskCardType {
  @Field()
  description!: string;

  @Field(() => [TaskChecklistItemType])
  checklist!: TaskChecklistItemType[];

  @Field()
  creatorId!: string;

  @Field(() => String, { nullable: true })
  creatorName!: string | null;

  @Field()
  updatedById!: string;

  @Field(() => String, { nullable: true })
  updatedByName!: string | null;

  @Field()
  createdAt!: string;

  @Field()
  updatedAt!: string;
}

/** One board's tasks, read at once. */
@ObjectType('TaskBoardTasks')
export class TaskBoardTasksType {
  @Field(() => TaskBoardType)
  board!: TaskBoardType;

  /** Column by column, each in the board's order. */
  @Field(() => [TaskCardType])
  tasks!: TaskCardType[];

  /** Labels on the board's live tasks, for the filter. */
  @Field(() => [String])
  labels!: string[];

  /** More tasks matched than one read returns. The app says the list was cut. */
  @Field()
  truncated!: boolean;
}

@ObjectType('TaskComment')
export class TaskCommentType {
  @Field()
  id!: string;

  @Field()
  taskId!: string;

  @Field()
  authorId!: string;

  @Field(() => String, { nullable: true })
  authorName!: string | null;

  /** Plain text, as typed. */
  @Field()
  body!: string;

  /** Written by the viewer — who alone may edit it. */
  @Field()
  mine!: boolean;

  @Field(() => String, { nullable: true })
  editedAt!: string | null;

  @Field()
  createdAt!: string;
}

@ObjectType('TaskSettings')
export class TaskSettingsType {
  /** `board` or `list`. */
  @Field()
  view!: string;

  @Field(() => String, { nullable: true })
  lastBoardId!: string | null;
}

/** A board whose owner has left: its NAME AND SIZE only (TASK-PLAN §0 C). */
@ObjectType('OrphanedTaskBoard')
export class OrphanedTaskBoardType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field(() => Int)
  taskCount!: number;
}

/**
 * Something changed; read again. `sync` on every (re)subscribe; `changed` —
 * read the board (and the task, if named) again; `removed` — drop the board.
 */
@ObjectType('TaskEvent')
export class TaskEventType {
  @Field()
  kind!: string;

  @Field(() => String, { nullable: true })
  boardId!: string | null;

  @Field(() => String, { nullable: true })
  taskId!: string | null;

  @Field(() => String, { nullable: true })
  actorId!: string | null;
}

// ── inputs ──────────────────────────────────────────────────────────────────

@InputType('TaskColumnInput')
export class TaskColumnInputType {
  @Field()
  name!: string;

  @Field(() => Boolean, { nullable: true })
  done?: boolean | null;
}

@InputType('CreateTaskBoardInput')
export class CreateTaskBoardInputType {
  @Field()
  name!: string;

  /** `private` or `workspace`. Default: `workspace`. */
  @Field(() => String, { nullable: true })
  visibility?: string | null;

  /** The creator's own columns. Omitted: To do · Doing · Done. */
  @Field(() => [TaskColumnInputType], { nullable: true })
  columns?: TaskColumnInputType[] | null;
}

@InputType('UpdateTaskColumnInput')
export class UpdateTaskColumnInputType {
  @Field(() => String, { nullable: true })
  name?: string | null;

  @Field(() => Boolean, { nullable: true })
  done?: boolean | null;
}

@InputType('CreateTaskInput')
export class CreateTaskInputType {
  @Field()
  title!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  /** Omitted: the board's first column. */
  @Field(() => String, { nullable: true })
  columnId?: string | null;

  @Field(() => String, { nullable: true })
  priority?: string | null;

  @Field(() => String, { nullable: true })
  scheduledOn?: string | null;

  @Field(() => String, { nullable: true })
  dueOn?: string | null;

  @Field(() => [String], { nullable: true })
  labels?: string[] | null;

  @Field(() => [String], { nullable: true })
  assigneeIds?: string[] | null;
}

@InputType('UpdateTaskInput')
export class UpdateTaskInputType {
  @Field(() => String, { nullable: true })
  title?: string | null;

  @Field(() => String, { nullable: true })
  description?: string | null;
}

@InputType('TaskFilterInput')
export class TaskFilterInputType {
  @Field(() => String, { nullable: true })
  search?: string | null;

  @Field(() => String, { nullable: true })
  label?: string | null;

  @Field(() => String, { nullable: true })
  priority?: string | null;

  @Field(() => Boolean, { nullable: true })
  assignedToMe?: boolean | null;

  /** The archive instead of the live board. */
  @Field(() => Boolean, { nullable: true })
  archived?: boolean | null;
}

@InputType('TaskSettingsInput')
export class TaskSettingsInputType {
  @Field()
  view!: string;

  @Field(() => String, { nullable: true })
  lastBoardId?: string | null;
}
