import { Field, Int, ObjectType } from '@nestjs/graphql';

/**
 * The public shapes. Code-first, so these classes ARE the schema.
 *
 * ⚠ Dates cross as ISO STRINGS, matching every other type in this schema.
 */

@ObjectType('QueueSettings')
export class QueueSettingsType {
  @Field()
  enabled!: boolean;

  /** Whether public displays show a staff nickname. Never an account name. */
  @Field()
  showStaffNames!: boolean;
}

/** The open session. ⚠ Carries no code — `queueDisplayCode` is bound to `queue:start`. */
@ObjectType('QueueSession')
export class QueueSessionType {
  @Field()
  id!: string;

  @Field()
  startedAt!: string;

  @Field()
  startedById!: string;

  @Field()
  continuedNumbering!: boolean;

  /** "Too many wrong codes — stop and restart to get a new one." */
  @Field()
  codeLocked!: boolean;
}

@ObjectType('QueueLine')
export class QueueLineType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field()
  prefix!: string;

  @Field(() => Int)
  startNumber!: number;

  @Field(() => Int)
  endNumber!: number;

  @Field(() => Int)
  padTo!: number;

  @Field(() => Int)
  sortOrder!: number;

  @Field()
  archived!: boolean;
}

@ObjectType('QueueWindow')
export class QueueWindowType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field(() => Int)
  sortOrder!: number;

  @Field()
  archived!: boolean;

  /** The lines this window calls from. Empty means all of them. */
  @Field(() => [String])
  lineIds!: string[];
}

@ObjectType('QueueSeat')
export class QueueSeatType {
  @Field()
  windowId!: string;

  @Field()
  userId!: string;

  /** The ACCOUNT name, for staff. Never shown on a public display. */
  @Field()
  displayName!: string;

  /**
   * False when the holder can no longer serve here — the console flags the seat.
   * Null when the host bound no staff check.
   */
  @Field(() => Boolean, { nullable: true })
  canServe!: boolean | null;
}

@ObjectType('QueueTicket')
export class QueueTicketType {
  @Field()
  id!: string;

  @Field()
  lineId!: string;

  /** "C-042", as the customer was told. */
  @Field()
  label!: string;

  @Field(() => Int)
  number!: number;

  @Field(() => Int)
  cycle!: number;

  /** 'called' | 'done' | 'no_show'. */
  @Field()
  status!: string;

  @Field()
  windowId!: string;

  /** The window's name at the call. */
  @Field()
  windowName!: string;

  @Field()
  calledAt!: string;

  @Field(() => Int)
  recallCount!: number;
}

@ObjectType('QueueConsole')
export class QueueConsoleType {
  @Field(() => QueueSettingsType)
  settings!: QueueSettingsType;

  @Field(() => QueueSessionType, { nullable: true })
  session!: QueueSessionType | null;

  @Field(() => [QueueLineType])
  lines!: QueueLineType[];

  @Field(() => [QueueWindowType])
  windows!: QueueWindowType[];

  @Field(() => [QueueSeatType])
  seats!: QueueSeatType[];

  @Field(() => String, { nullable: true })
  myWindowId!: string | null;

  @Field(() => String, { nullable: true })
  myNickname!: string | null;

  /** What each window is serving right now. */
  @Field(() => [QueueTicketType])
  serving!: QueueTicketType[];

  @Field(() => [QueueTicketType])
  recent!: QueueTicketType[];
}

@ObjectType('QueueDisplayCode')
export class QueueDisplayCodeType {
  /** Formatted for reading aloud: `K7QM-4XHT`. */
  @Field()
  code!: string;

  @Field(() => Int)
  activeDisplays!: number;

  @Field(() => Int)
  maxDisplays!: number;

  @Field(() => Int)
  failedCodeAttempts!: number;

  @Field()
  locked!: boolean;
}

@ObjectType('QueueStaffMember')
export class QueueStaffMemberType {
  @Field()
  userId!: string;

  @Field()
  displayName!: string;
}

/** What a TV receives once: its pass, and the name it may now show. */
@ObjectType('QueueDisplayPass')
export class QueueDisplayPassType {
  @Field()
  pass!: string;

  @Field()
  workspaceName!: string;
}

/**
 * One event on the staff console's stream.
 *
 * `sync` arrives first on every (re)subscribe and means "re-read the console":
 * the socket had a gap, and the in-memory engine has no replay. `call` carries
 * the ticket; `session` and `changed` say what to re-read.
 */
@ObjectType('QueueEvent')
export class QueueEventType {
  /** 'sync' | 'call' | 'session' | 'changed'. */
  @Field()
  kind!: string;

  /** For 'call': called | recalled | done | no_show. 'session': started | stopped. 'changed': lines | windows | seats | settings | staff. */
  @Field(() => String, { nullable: true })
  change!: string | null;

  @Field(() => QueueTicketType, { nullable: true })
  ticket!: QueueTicketType | null;
}

@ObjectType('QueueBoardLine')
export class QueueBoardLineType {
  @Field()
  id!: string;

  @Field()
  prefix!: string;

  @Field()
  name!: string;
}

@ObjectType('QueueBoardCall')
export class QueueBoardCallType {
  @Field()
  ticketId!: string;

  @Field()
  lineId!: string;

  @Field()
  label!: string;

  @Field()
  windowId!: string;

  @Field()
  windowName!: string;

  @Field()
  calledAt!: string;

  @Field(() => Int)
  recallCount!: number;

  /** A nickname the person chose, and only while the workspace shows names. Never an account name. */
  @Field(() => String, { nullable: true })
  nickname!: string | null;
}

@ObjectType('QueueBoard')
export class QueueBoardType {
  @Field()
  showStaffNames!: boolean;

  @Field(() => [QueueBoardLineType])
  lines!: QueueBoardLineType[];

  /** One row per window that has called a number this session. */
  @Field(() => [QueueBoardCallType])
  serving!: QueueBoardCallType[];

  @Field(() => [QueueBoardCallType])
  recent!: QueueBoardCallType[];
}

/**
 * One event on a public display's stream.
 *
 * 'board' is the WHOLE board, every time, with `announce` set to the call to
 * chime for when there is one. 'stopped' is the last event a TV receives: the
 * session is over, and the stream ends.
 */
@ObjectType('QueueDisplayEvent')
export class QueueDisplayEventType {
  /** 'board' | 'stopped'. */
  @Field()
  kind!: string;

  @Field(() => QueueBoardType, { nullable: true })
  board!: QueueBoardType | null;

  @Field(() => QueueBoardCallType, { nullable: true })
  announce!: QueueBoardCallType | null;
}
