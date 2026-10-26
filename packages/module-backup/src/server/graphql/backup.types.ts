import { Field, Float, ObjectType } from '@nestjs/graphql';

@ObjectType('BackupFile')
export class BackupFileType {
  @Field()
  name!: string;

  /** `manual`, `daily` or `before_restore`. */
  @Field()
  kind!: string;

  /** Float, not Int: a backup can pass GraphQL's 2 GB Int. */
  @Field(() => Float)
  sizeBytes!: number;

  /** ISO-8601. */
  @Field()
  createdAt!: string;
}

@ObjectType('BackupState')
export class BackupStateType {
  /** `idle`, `backing_up` or `restoring`. */
  @Field()
  activity!: string;

  @Field()
  maintenance!: boolean;

  /** What a restore asks to be typed. */
  @Field()
  database!: string;

  /** How many backups the folder keeps. */
  @Field()
  keep!: number;

  /** The zone file names and the daily backup are in. */
  @Field()
  timeZone!: string;

  @Field(() => [BackupFileType])
  files!: BackupFileType[];
}
