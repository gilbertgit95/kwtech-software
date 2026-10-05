import { Field, InputType, Int, ObjectType } from '@nestjs/graphql';

/*
 * The print studio's GraphQL shapes. Code-first, rendered from rows by the
 * resolver's `render*` functions. Visibility, orientation and log values cross
 * as documented STRINGS (no `registerEnumType`), dates as ISO strings.
 *
 * ⚠ EVERY LENGTH IS AN `Int` OF HUNDREDTHS OF A MILLIMETRE. The schema itself
 * then refuses a fractional length before any code runs.
 *
 * A layout's spec is STRUCTURED here rather than one JSON string, so the
 * schema types it and `module-operations.test.ts` validates the documents that
 * read it. The service still passes it through `prepareLayoutSpec`: the schema
 * says a margin is an integer, not that the cells fit the paper.
 */

// ── a layout's spec, out ─────────────────────────────────────────────────────

@ObjectType('StudioPaperSpec')
export class StudioPaperSpecType {
  /** A built-in paper's key, or null for a typed size. */
  @Field(() => String, { nullable: true })
  key!: string | null;

  @Field()
  label!: string;

  /** Portrait: never wider than it is tall. */
  @Field(() => Int)
  width!: number;

  @Field(() => Int)
  height!: number;
}

@ObjectType('StudioMargins')
export class StudioMarginsType {
  @Field(() => Int)
  top!: number;

  @Field(() => Int)
  right!: number;

  @Field(() => Int)
  bottom!: number;

  @Field(() => Int)
  left!: number;
}

@ObjectType('StudioCell')
export class StudioCellType {
  /** From the printable area's top left, not the sheet's. */
  @Field(() => Int)
  x!: number;

  @Field(() => Int)
  y!: number;

  @Field(() => Int)
  width!: number;

  @Field(() => Int)
  height!: number;

  /** What the person called this size ("2 × 2"). */
  @Field(() => String, { nullable: true })
  label!: string | null;
}

@ObjectType('StudioBorder')
export class StudioBorderType {
  /** `solid` or `dashed`. */
  @Field()
  style!: string;

  /** The line's thickness, in hundredths of a millimetre. */
  @Field(() => Int)
  width!: number;

  /** `grey` or `black`. */
  @Field()
  color!: string;
}

@ObjectType('StudioLayoutSpec')
export class StudioLayoutSpecType {
  @Field(() => Int)
  version!: number;

  @Field(() => StudioPaperSpecType)
  paper!: StudioPaperSpecType;

  /** `portrait` or `landscape`. */
  @Field()
  orientation!: string;

  @Field(() => StudioMarginsType)
  margins!: StudioMarginsType;

  @Field(() => [StudioCellType])
  cells!: StudioCellType[];

  @Field()
  guides!: boolean;

  /** How the border around the cells is drawn. Null: the default hairline. */
  @Field(() => StudioBorderType, { nullable: true })
  border!: StudioBorderType | null;
}

@ObjectType('StudioLayout')
export class StudioLayoutType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  /** `private` or `workspace`. */
  @Field()
  visibility!: string;

  /** Send it back with the next save; a save from an older one is refused. */
  @Field(() => Int)
  version!: number;

  /** Made by the viewer — who alone may share, unshare or change it without `studio:manage_all`. */
  @Field()
  mine!: boolean;

  @Field()
  ownerId!: string;

  /** Null when the app cannot name them; show "a member". */
  @Field(() => String, { nullable: true })
  ownerName!: string | null;

  @Field()
  updatedAt!: string;

  @Field()
  createdAt!: string;

  @Field(() => StudioLayoutSpecType)
  spec!: StudioLayoutSpecType;
}

// ── a layout's spec, in ──────────────────────────────────────────────────────

@InputType('StudioPaperSpecInput')
export class StudioPaperSpecInputType {
  @Field(() => String, { nullable: true })
  key?: string | null;

  @Field()
  label!: string;

  @Field(() => Int)
  width!: number;

  @Field(() => Int)
  height!: number;
}

@InputType('StudioMarginsInput')
export class StudioMarginsInputType {
  @Field(() => Int)
  top!: number;

  @Field(() => Int)
  right!: number;

  @Field(() => Int)
  bottom!: number;

  @Field(() => Int)
  left!: number;
}

@InputType('StudioCellInput')
export class StudioCellInputType {
  @Field(() => Int)
  x!: number;

  @Field(() => Int)
  y!: number;

  @Field(() => Int)
  width!: number;

  @Field(() => Int)
  height!: number;

  @Field(() => String, { nullable: true })
  label?: string | null;
}

@InputType('StudioBorderInput')
export class StudioBorderInputType {
  @Field()
  style!: string;

  @Field(() => Int)
  width!: number;

  @Field()
  color!: string;
}

@InputType('StudioLayoutSpecInput')
export class StudioLayoutSpecInputType {
  @Field(() => Int)
  version!: number;

  @Field(() => StudioPaperSpecInputType)
  paper!: StudioPaperSpecInputType;

  @Field()
  orientation!: string;

  @Field(() => StudioMarginsInputType)
  margins!: StudioMarginsInputType;

  @Field(() => [StudioCellInputType])
  cells!: StudioCellInputType[];

  @Field()
  guides!: boolean;

  @Field(() => StudioBorderInputType, { nullable: true })
  border?: StudioBorderInputType | null;
}

@InputType('CreateStudioLayoutInput')
export class CreateStudioLayoutInputType {
  @Field()
  name!: string;

  /** `private` (the default) or `workspace`. */
  @Field(() => String, { nullable: true })
  visibility?: string | null;

  @Field(() => StudioLayoutSpecInputType)
  spec!: StudioLayoutSpecInputType;
}

/** Only the fields that changed. An absent one is left as it is. */
@InputType('UpdateStudioLayoutInput')
export class UpdateStudioLayoutInputType {
  @Field(() => String, { nullable: true })
  name?: string | null;

  @Field(() => StudioLayoutSpecInputType, { nullable: true })
  spec?: StudioLayoutSpecInputType | null;
}

// ── calibration ──────────────────────────────────────────────────────────────

@ObjectType('StudioCalibration')
export class StudioCalibrationType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  /** Ten-thousandths: 10000 is exactly 100%. */
  @Field(() => Int)
  scaleX!: number;

  @Field(() => Int)
  scaleY!: number;

  /** Hundredths of a millimetre; positive is right and down. */
  @Field(() => Int)
  offsetX!: number;

  @Field(() => Int)
  offsetY!: number;

  @Field()
  updatedAt!: string;
}

@InputType('StudioCalibrationInput')
export class StudioCalibrationInputType {
  /** Omit to create a profile; give it to change one of your own. */
  @Field(() => String, { nullable: true })
  id?: string | null;

  @Field()
  name!: string;

  @Field(() => Int)
  scaleX!: number;

  @Field(() => Int)
  scaleY!: number;

  @Field(() => Int)
  offsetX!: number;

  @Field(() => Int)
  offsetY!: number;
}

// ── settings ─────────────────────────────────────────────────────────────────

@ObjectType('StudioSettings')
export class StudioSettingsType {
  /** A `StudioKeymap` as JSON text: each action's shortcut key. Always complete — defaults are filled in. */
  @Field()
  keymap!: string;

  /** 0 when nothing was ever saved. */
  @Field(() => Int)
  version!: number;
}

// ── the print log ────────────────────────────────────────────────────────────

@ObjectType('StudioLogEntry')
export class StudioLogEntryType {
  @Field()
  id!: string;

  /** `downloaded` or `sent_to_print`. Neither means paper came out. */
  @Field()
  action!: string;

  /** `layout` or `pages`. */
  @Field()
  kind!: string;

  @Field()
  userId!: string;

  @Field(() => String, { nullable: true })
  userName!: string | null;

  @Field()
  mine!: boolean;

  @Field(() => String, { nullable: true })
  layoutId!: string | null;

  /** The layout's name when it was used; still here after a rename or a delete. */
  @Field(() => String, { nullable: true })
  layoutName!: string | null;

  @Field()
  paperLabel!: string;

  @Field(() => Int)
  paperWidth!: number;

  @Field(() => Int)
  paperHeight!: number;

  @Field(() => Int)
  pages!: number;

  @Field(() => Int)
  copies!: number;

  @Field(() => [String])
  fileNames!: string[];

  @Field()
  createdAt!: string;
}

@ObjectType('StudioLogPage')
export class StudioLogPageType {
  @Field(() => [StudioLogEntryType])
  entries!: StudioLogEntryType[];

  /** Pass back as `cursor` for the next page; null at the end. */
  @Field(() => String, { nullable: true })
  nextCursor!: string | null;

  /** Whether this is everybody's history. False when it was asked for and not allowed. */
  @Field()
  everyone!: boolean;
}

@InputType('StudioPrintInput')
export class StudioPrintInputType {
  /** `downloaded` or `sent_to_print`. */
  @Field()
  action!: string;

  /** `layout` or `pages`. */
  @Field()
  kind!: string;

  @Field(() => String, { nullable: true })
  layoutId?: string | null;

  @Field(() => String, { nullable: true })
  layoutName?: string | null;

  @Field()
  paperLabel!: string;

  @Field(() => Int)
  paperWidth!: number;

  @Field(() => Int)
  paperHeight!: number;

  @Field(() => Int)
  pages!: number;

  @Field(() => Int)
  copies!: number;

  /** Names only. Any folder path is dropped by the server. */
  @Field(() => [String])
  fileNames!: string[];
}
