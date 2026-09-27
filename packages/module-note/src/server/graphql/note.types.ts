import { Field, InputType, Int, ObjectType } from '@nestjs/graphql';

/*
 * The notes GraphQL shapes. Code-first, rendered from rows by the resolver's
 * `render*` functions. Presets, visibility and view names cross as documented
 * STRINGS (no `registerEnumType`), dates as ISO strings.
 */

/**
 * A note as the index shows it — everything but the body.
 *
 * ⚠ NO BODY HERE, on purpose: the index reads `preview`, a short plain-text
 * start of the body. `Note` adds the body, from `note(noteId)`.
 */
@ObjectType('NoteSummary')
export class NoteSummaryType {
  @Field()
  id!: string;

  /** As typed; may be empty. */
  @Field()
  title!: string;

  /** What to call it: the title, else the body's first line, else "Untitled". */
  @Field()
  displayTitle!: string;

  @Field()
  preview!: string;

  /** `private` or `workspace`. */
  @Field()
  visibility!: string;

  /** One of the note colours — a tint of the app's theme. */
  @Field()
  color!: string;

  @Field(() => [String])
  tags!: string[];

  /** Send it back with the next save; a save from an older one is refused. */
  @Field(() => Int)
  version!: number;

  /** Pinned by the viewer. Nobody else's pins show. */
  @Field()
  pinned!: boolean;

  /** Written by the viewer — who alone may share, unshare or bin it without `note:manage_all`. */
  @Field()
  mine!: boolean;

  @Field()
  authorId!: string;

  /** Null when the app cannot name them; show "a member". */
  @Field(() => String, { nullable: true })
  authorName!: string | null;

  /** Who wrote the text last. */
  @Field()
  updatedById!: string;

  @Field(() => String, { nullable: true })
  updatedByName!: string | null;

  @Field()
  updatedAt!: string;

  @Field()
  createdAt!: string;

  /** When it went in the trash; null while live. */
  @Field(() => String, { nullable: true })
  trashedAt!: string | null;
}

@ObjectType('Note')
export class NoteType extends NoteSummaryType {
  /** Markdown, as typed. */
  @Field()
  body!: string;
}

@ObjectType('NoteList')
export class NoteListType {
  /** The viewer's pinned notes that match, above the list. First page only; never in the trash. */
  @Field(() => [NoteSummaryType])
  pinned!: NoteSummaryType[];

  @Field(() => [NoteSummaryType])
  notes!: NoteSummaryType[];

  /** Pass back as `cursor` for the next page; null at the end. */
  @Field(() => String, { nullable: true })
  nextCursor!: string | null;

  /** The tags on notes the viewer can see, for the filter. First page only; null after it. */
  @Field(() => [String], { nullable: true })
  tags!: string[] | null;
}

@ObjectType('NoteRevision')
export class NoteRevisionType {
  @Field()
  id!: string;

  @Field()
  title!: string;

  @Field()
  body!: string;

  /** Who wrote this text — the person whose work a later save replaced. */
  @Field()
  editedById!: string;

  @Field(() => String, { nullable: true })
  editedByName!: string | null;

  /** When it was replaced. */
  @Field()
  createdAt!: string;
}

@ObjectType('NoteSettings')
export class NoteSettingsType {
  /** `notebook`, `plain`, `paper`, `sticky` or `grid`. */
  @Field()
  look!: string;

  /** `hand`, `script`, `sans`, `serif` or `mono`. */
  @Field()
  font!: string;

  /** The colour a new note starts with. */
  @Field()
  defaultColor!: string;
}

/**
 * One change, as the viewer should take it.
 *
 *   sync    — sent first on every (re)subscribe: read the index again
 *   changed — read `noteId` again (new, edited, shared, binned, back)
 *   removed — drop `noteId`: deleted, or no longer shared with you
 *
 * ⚠ No content, ever: the client reads again through the guarded query.
 */
@ObjectType('NoteEvent')
export class NoteEventType {
  @Field()
  kind!: string;

  @Field(() => String, { nullable: true })
  noteId!: string | null;

  /** The version after the change — equal to your own save's means it is your save coming back. */
  @Field(() => Int, { nullable: true })
  version!: number | null;

  /** Who made the change. */
  @Field(() => String, { nullable: true })
  actorId!: string | null;
}

// ── inputs ──────────────────────────────────────────────────────────────────

/** Which notes to list. Grouped, because optional inline args fail at boot. */
@InputType('NoteFilterInput')
export class NoteFilterInputType {
  /** `all` (the default), `mine`, `shared` or `trash`. */
  @Field(() => String, { nullable: true })
  view?: string | null;

  @Field(() => String, { nullable: true })
  search?: string | null;

  @Field(() => String, { nullable: true })
  tag?: string | null;

  /** From the previous page's `nextCursor`. */
  @Field(() => String, { nullable: true })
  cursor?: string | null;

  @Field(() => Int, { nullable: true })
  limit?: number | null;
}

@InputType('CreateNoteInput')
export class CreateNoteInputType {
  @Field(() => String, { nullable: true })
  title?: string | null;

  @Field(() => String, { nullable: true })
  body?: string | null;

  /** Omitted: the author's default colour. */
  @Field(() => String, { nullable: true })
  color?: string | null;

  @Field(() => [String], { nullable: true })
  tags?: string[] | null;

  /** Omitted: `private`. */
  @Field(() => String, { nullable: true })
  visibility?: string | null;
}

/** Only the fields that changed. An omitted field is left as it is. */
@InputType('UpdateNoteInput')
export class UpdateNoteInputType {
  @Field(() => String, { nullable: true })
  title?: string | null;

  @Field(() => String, { nullable: true })
  body?: string | null;

  @Field(() => String, { nullable: true })
  color?: string | null;

  @Field(() => [String], { nullable: true })
  tags?: string[] | null;
}

/** All three, always: the row is replaced. */
@InputType('NoteSettingsInput')
export class NoteSettingsInputType {
  @Field()
  look!: string;

  @Field()
  font!: string;

  @Field()
  defaultColor!: string;
}
