import { Field, InputType, Int, ObjectType } from '@nestjs/graphql';

/*
 * The printing side's GraphQL shapes. Code-first, rendered from rows by the
 * resolvers' `render*` functions. A printer's status crosses as a documented
 * STRING (no `registerEnumType`), dates as ISO strings.
 *
 * ⚠ EVERY LENGTH IS AN `Int` OF HUNDREDTHS OF A MILLIMETRE, the print studio's
 * unit. The schema itself then refuses a fractional length before any code runs.
 */

// ── out, to a person ─────────────────────────────────────────────────────────

@ObjectType('PrintPaperMargins')
export class PrintPaperMarginsType {
  @Field(() => Int)
  top!: number;

  @Field(() => Int)
  right!: number;

  @Field(() => Int)
  bottom!: number;

  @Field(() => Int)
  left!: number;
}

@ObjectType('PrintPaper')
export class PrintPaperType {
  @Field()
  name!: string;

  @Field(() => Int)
  width!: number;

  @Field(() => Int)
  height!: number;

  /** The unprintable strip at each edge. ⚠ Null is "the driver did not say", never "borderless". */
  @Field(() => PrintPaperMarginsType, { nullable: true })
  margins!: PrintPaperMarginsType | null;
}

/** One choice of a printer setting: the driver's id for it, and its name for a person. */
@ObjectType('PrintSettingOption')
export class PrintSettingOptionType {
  @Field()
  id!: string;

  @Field()
  label!: string;
}

@ObjectType('PrintPrinter')
export class PrintPrinterType {
  @Field()
  id!: string;

  /** The queue's name on that computer, which is what a job is sent to. */
  @Field()
  name!: string;

  @Field()
  driver!: string;

  @Field()
  isDefault!: boolean;

  /** `ready` | `offline` | `error` | `unknown`. The spooler's word, not a promise of paper. */
  @Field()
  status!: string;

  /** The computer's last report no longer lists it. */
  @Field()
  gone!: boolean;

  @Field(() => [PrintPaperType])
  papers!: PrintPaperType[];

  /** The kinds of paper this driver knows, as it names them. Empty: it did not say. */
  @Field(() => [PrintSettingOptionType])
  mediaTypes!: PrintSettingOptionType[];

  /** The printer's own current paper type, one of `mediaTypes` by id. */
  @Field(() => String, { nullable: true })
  mediaType!: string | null;

  @Field(() => [PrintSettingOptionType])
  qualities!: PrintSettingOptionType[];

  @Field(() => String, { nullable: true })
  quality!: string | null;
}

@ObjectType('PrintAgent')
export class PrintAgentType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  /** What the computer calls itself. */
  @Field(() => String, { nullable: true })
  hostName!: string | null;

  @Field(() => String, { nullable: true })
  agentVersion!: string | null;

  /** Heard from within `PRINT_AGENT_ONLINE_SECONDS`. */
  @Field()
  online!: boolean;

  @Field(() => String, { nullable: true })
  lastSeenAt!: string | null;

  @Field()
  pairedAt!: string;

  @Field(() => [PrintPrinterType])
  printers!: PrintPrinterType[];
}

/** ⚠ The only place a pairing code is ever returned. */
@ObjectType('PrintPairingCode')
export class PrintPairingCodeType {
  /** Formatted for reading aloud: `ABCDE-FGHJK`. */
  @Field()
  code!: string;

  @Field()
  expiresAt!: string;
}

/** ⚠ The only place a job's ticket is ever returned. */
@ObjectType('PrintJobStart')
export class PrintJobStartType {
  @Field()
  jobId!: string;

  /** Presented once, by the browser, with the file — on the relay's route, never here. */
  @Field()
  ticket!: string;
}

@ObjectType('PrintJob')
export class PrintJobType {
  @Field()
  id!: string;

  /** `waiting` | `sending` | `printing` | `printed` | `failed`. ⚠ `printed` is the spooler's word, not paper. */
  @Field()
  status!: string;

  /** Why it failed, as a `PrintJobFailure`. Null unless `status` is `failed`. */
  @Field(() => String, { nullable: true })
  failure!: string | null;

  /** What the computer said went wrong, in its own words. */
  @Field(() => String, { nullable: true })
  message!: string | null;
}

// ── out, to a computer ───────────────────────────────────────────────────────

/** A job a computer is asked to print. The file itself is fetched from the relay's route. */
@ObjectType('PrintAgentJob')
export class PrintAgentJobType {
  @Field()
  jobId!: string;

  /** The queue's name on that computer. */
  @Field()
  printerName!: string;

  /** Null: whatever the printer is set to. */
  @Field(() => PrintPaperType, { nullable: true })
  paper!: PrintPaperType | null;

  @Field(() => Int)
  copies!: number;

  /** The file's exact length. */
  @Field(() => Int)
  size!: number;

  /** One of that printer's paper types, by id. Null: as the printer is set. */
  @Field(() => String, { nullable: true })
  mediaType!: string | null;

  @Field(() => String, { nullable: true })
  quality!: string | null;
}

/** ⚠ The only place an agent's secret is ever returned. */
@ObjectType('PrintAgentPairing')
export class PrintAgentPairingType {
  @Field()
  secret!: string;

  @Field()
  agentId!: string;

  /** The name the person gave this computer, for its own log. */
  @Field()
  name!: string;
}

// ── in, from a computer ──────────────────────────────────────────────────────

@InputType('PrintReportedMarginsInput')
export class PrintReportedMarginsInputType {
  @Field(() => Int)
  top!: number;

  @Field(() => Int)
  right!: number;

  @Field(() => Int)
  bottom!: number;

  @Field(() => Int)
  left!: number;
}

@InputType('PrintReportedPaperInput')
export class PrintReportedPaperInputType {
  @Field()
  name!: string;

  @Field(() => Int)
  width!: number;

  @Field(() => Int)
  height!: number;

  @Field(() => PrintReportedMarginsInputType, { nullable: true })
  margins?: PrintReportedMarginsInputType | null;
}

/**
 * The schema says these are strings and whole numbers. `prepareReportedPrinters`
 * says whether they are a list of printers: how many, how long, and whether a
 * paper's margins leave anything to print on.
 */
@InputType('PrintReportedSettingOptionInput')
export class PrintReportedSettingOptionInputType {
  @Field()
  id!: string;

  @Field()
  label!: string;
}

/** What the driver offers besides papers. `prepareSettings` decides what of it is kept. */
@InputType('PrintReportedSettingsInput')
export class PrintReportedSettingsInputType {
  @Field(() => [PrintReportedSettingOptionInputType])
  mediaTypes!: PrintReportedSettingOptionInputType[];

  @Field(() => String, { nullable: true })
  mediaType?: string | null;

  @Field(() => [PrintReportedSettingOptionInputType])
  qualities!: PrintReportedSettingOptionInputType[];

  @Field(() => String, { nullable: true })
  quality?: string | null;
}

@InputType('PrintReportedPrinterInput')
export class PrintReportedPrinterInputType {
  @Field()
  name!: string;

  @Field()
  driver!: string;

  @Field()
  isDefault!: boolean;

  /** `ready` | `offline` | `error` | `unknown`. Anything else is read as `unknown`. */
  @Field()
  status!: string;

  @Field(() => [PrintReportedPaperInputType])
  papers!: PrintReportedPaperInputType[];

  /** Left out by an agent older than settings: the printer then offers none. */
  @Field(() => PrintReportedSettingsInputType, { nullable: true })
  settings?: PrintReportedSettingsInputType | null;
}
