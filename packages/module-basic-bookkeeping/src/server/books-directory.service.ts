import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { BOOKS_MEMBER_DIRECTORY } from './books.tokens.js';
import type { BooksMemberDirectory } from './ports.js';

/**
 * Names for who recorded and who voided each entry — `auth_user`'s, which the
 * books may not read, so the app answers through `BooksMemberDirectory`.
 *
 * ⚠ A NAME IS A NICETY, NEVER A FAILURE. Unbound, or when the lookup throws,
 * nobody has a name and the ledger still opens: a page that failed because a
 * display name could not be found would hide the money it was asked to show.
 */
@Injectable()
export class BooksDirectoryService {
  private readonly logger = new Logger('BooksDirectory');

  constructor(@Optional() @Inject(BOOKS_MEMBER_DIRECTORY) private readonly directory?: BooksMemberDirectory) {}

  async names(userIds: readonly string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((id) => id.length > 0))];
    if (!this.directory || ids.length === 0) return new Map();
    try {
      const members = await this.directory.describe(ids);
      return new Map(members.map((member) => [member.userId, member.displayName]));
    } catch (error) {
      this.logger.warn(`Names could not be read for the books: ${(error as Error).message}`);
      return new Map();
    }
  }
}
