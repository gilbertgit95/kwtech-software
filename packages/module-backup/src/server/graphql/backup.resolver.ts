import { CREDENTIAL_SURFACE_METADATA } from '@kwtech/module-kit';
import { Inject, SetMetadata } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { BackupWriteError } from '../backup.errors.js';
import type { ResolvedBackupOptions } from '../backup.options.js';
import { BackupService } from '../backup.service.js';
import { BACKUP_OPTIONS } from '../backup.tokens.js';
import { BackupFileType, BackupStateType } from './backup.types.js';

/**
 * The Backups page's surface. App level, like the runner's: the guard checks
 * each operation's `backup:*` key (feature-keys.ts) against the caller's
 * app-level grants, so no scope is declared.
 */
@Resolver()
export class BackupResolver {
  constructor(
    private readonly backups: BackupService,
    @Inject(BACKUP_OPTIONS) private readonly options: ResolvedBackupOptions,
  ) {}

  @Query(() => BackupStateType, { name: 'backups' })
  async state(@Context() gql: { req?: unknown }): Promise<BackupStateType> {
    this.actor(gql.req);
    return this.backups.state();
  }

  @Mutation(() => BackupFileType, { name: 'createBackup' })
  async create(@Context() gql: { req?: unknown }): Promise<BackupFileType> {
    return this.backups.create(this.actor(gql.req), 'manual', new Date());
  }

  @Mutation(() => Boolean, { name: 'deleteBackup' })
  async remove(@Context() gql: { req?: unknown }, @Args('name') name: string): Promise<boolean> {
    await this.backups.remove(this.actor(gql.req), name);
    return true;
  }

  /** A one-time ticket for `/api/backups/download?ticket=…`, valid for a minute. */
  @Mutation(() => String, { name: 'issueBackupDownload' })
  async issueDownload(@Context() gql: { req?: unknown }, @Args('name') name: string): Promise<string> {
    return this.backups.issueDownload(this.actor(gql.req), name, new Date());
  }

  /**
   * ⚠ A CREDENTIAL SURFACE: it takes the caller's password, so it gets the
   * tight throttle — a stolen session must not be a way to guess it.
   * Answers once the database is restored; the caller is signed out with
   * everybody else.
   */
  @SetMetadata(CREDENTIAL_SURFACE_METADATA, 'The caller’s password is checked before the database is replaced')
  @Mutation(() => Boolean, { name: 'restoreBackup' })
  async restore(
    @Context() gql: { req?: unknown },
    @Args('name') name: string,
    @Args('confirmation') confirmation: string,
    @Args('password') password: string,
  ): Promise<boolean> {
    await this.backups.restore(this.actor(gql.req), name, confirmation, password, new Date());
    return true;
  }

  /** The actor, proven by the app's guard. The module never resolves identity itself. */
  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw new BackupWriteError('not_signed_in');
    return actorId;
  }
}
