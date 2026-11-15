import { Field, Float, InputType, Int, ObjectType } from '@nestjs/graphql';

/** A person, by account name. ⚠ Shown only to signed-in members of the workspace. */
@ObjectType('FilePerson')
export class FilePersonType {
  @Field() userId!: string;
  @Field() displayName!: string;
}

/** One file, as the list shows it. Never the storage key: where the bytes are is nobody's business. */
@ObjectType('FileEntry')
export class FileEntryType {
  @Field() id!: string;
  @Field() name!: string;
  @Field() contentType!: string;
  /** Exact, in bytes. `Int` is enough: one file is capped below 2 GiB (`FILE_SIZE_CEILING_MB`). */
  @Field(() => Int) sizeBytes!: number;
  @Field() ownerId!: string;
  /** Null for a former member, or with no member directory. */
  @Field(() => String, { nullable: true }) ownerName!: string | null;
  @Field() mine!: boolean;
  /** `private`, `workspace` or `people`. */
  @Field() visibility!: string;
  /** Who a `people` file is shared with — ⚠ shown to its OWNER only; empty for everybody else. */
  @Field(() => [FilePersonType]) sharedWith!: FilePersonType[];
  /** ISO. When it was uploaded: the clean-up counts its age from here. */
  @Field() createdAt!: string;
}

@ObjectType('FileSettings')
export class FileSettingsType {
  /** How old a file must be before the nightly clean-up deletes it. */
  @Field(() => Int) retentionHours!: number;
  /** The clean-up's time of day, `HH:MM`, in the workspace's time zone. */
  @Field() cleanupTime!: string;
  /** The largest one file may be here, in bytes. */
  @Field(() => Int) maxFileBytes!: number;
  /** The room all files may take together, in bytes. `Float`: past 2 GiB. Null: no cap. */
  @Field(() => Float, { nullable: true }) storageBytes!: number | null;
  /** The room the workspace's files take now, in bytes. */
  @Field(() => Float) usedBytes!: number;
}

@ObjectType('FileUploadTicket')
export class FileUploadTicketType {
  /** One-time: send the file to the upload route with it, in `x-file-upload-ticket`. */
  @Field() ticket!: string;
  /** ISO. The upload must START before this. */
  @Field() expiresAt!: string;
}

@InputType('StartFileUploadInput')
export class StartFileUploadInputType {
  @Field() name!: string;
  /** What will be sent, exactly. An upload of any other size is refused. */
  @Field(() => Int) sizeBytes!: number;
  @Field(() => String, { nullable: true }) contentType?: string | null;
  /** `private`, `workspace` or `people`. */
  @Field() visibility!: string;
  /** For `people`: who. Ignored otherwise. */
  @Field(() => [String]) sharedWith!: string[];
}

/**
 * One change to the workspace's files, for one subscriber.
 *   sync    — sent first (there is no replay): read your list
 *   changed — something you can see, or could, changed: read your list again
 */
@ObjectType('FileEvent')
export class FileEventType {
  @Field() kind!: string;
  @Field(() => String, { nullable: true }) fileId!: string | null;
  @Field(() => String, { nullable: true }) actorId!: string | null;
}
