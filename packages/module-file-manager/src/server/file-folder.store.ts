import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isFileStorageKey } from '../domain/transfer.js';
import type { FileStore, FileStoreEntry, FileStoreWrite } from './ports.js';

/** A part file's suffix: an upload still arriving, or one that died. Never served, and swept by the clean-up. */
const PART = '.part';

/** A workspace id as a folder name: a cuid, or anything as plain. Anything else is refused, never joined. */
function isFolderName(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/u.test(value);
}

class FileTooLargeError extends Error {
  constructor() {
    super('The upload passed its declared size.');
    this.name = 'FileTooLargeError';
  }
}

/**
 * The temporary store (issue #138): a folder on the server's disk, one folder
 * per workspace, one file per upload named by its random storage key.
 *
 *   <root>/<workspaceId>/<storageKey>        a file
 *   <root>/<workspaceId>/<storageKey>.part   an upload still arriving, or one that died
 *
 * ⚠ NO NAME FROM A PERSON IS EVER PART OF A PATH. The file's name lives in the
 * database; on disk it is 32 hex characters. And every path is resolved and
 * checked to stay inside `root` before it is touched.
 *
 * When the blob server arrives, it is another `FileStore` the app binds
 * instead of this one; nothing else changes.
 */
export function createFolderFileStore(root: string): FileStore {
  const base = resolve(root);

  function pathOf(workspaceId: string, name?: string): string {
    if (!isFolderName(workspaceId)) throw new Error('A file store path must name a workspace.');
    const path = name === undefined ? join(base, workspaceId) : join(base, workspaceId, name);
    const inside = relative(base, path);
    if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('A file store path left its folder.');
    return path;
  }

  function keyPath(workspaceId: string, storageKey: string, suffix = ''): string {
    if (!isFileStorageKey(storageKey)) throw new Error('A file store key must be 32 hex characters.');
    return pathOf(workspaceId, `${storageKey}${suffix}`);
  }

  return {
    async write(workspaceId, storageKey, source, maxBytes): Promise<FileStoreWrite> {
      const part = keyPath(workspaceId, storageKey, PART);
      let sizeBytes = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          sizeBytes += chunk.length;
          // Stops at the first byte too many: a lying upload never fills the disk.
          if (sizeBytes > maxBytes) done(new FileTooLargeError());
          else done(null, chunk);
        },
      });
      /*
       * ⚠ The source is PIPED in, not part of the pipeline. `pipeline` destroys
       * every stream on an error, and destroying the request destroys its
       * socket: the 400 "did not arrive whole" could then never be sent. Piped,
       * the counter's refusal only unpipes it, and the controller answers.
       *
       * The source's own failure (the browser went away) is therefore forwarded
       * by hand, and listened for FIRST: it can happen while the folder is
       * still being made, and missed there, the write would wait forever.
       */
      let gone: Error | null = null;
      let piping = false;
      const forward = (error?: Error) => {
        gone ??= error ?? new Error('The upload ended before its last byte.');
        if (piping) counter.destroy(gone);
      };
      const onClose = () => {
        if (!source.readableEnded) forward();
      };
      source.once('error', forward);
      source.once('close', onClose);
      try {
        await mkdir(pathOf(workspaceId), { recursive: true });
        if (gone) throw gone;
        piping = true;
        source.pipe(counter);
        // `wx`: never overwrite — a key is random, and a collision is a fault, not a replacement.
        await pipeline(counter, createWriteStream(part, { flags: 'wx' }));
      } catch (error) {
        await rm(part, { force: true });
        if (error instanceof FileTooLargeError) return { kind: 'too_large' };
        throw error;
      } finally {
        source.off('error', forward);
        source.off('close', onClose);
        source.unpipe(counter);
      }
      await rename(part, keyPath(workspaceId, storageKey));
      return { kind: 'stored', sizeBytes };
    },

    async open(workspaceId, storageKey) {
      const path = keyPath(workspaceId, storageKey);
      try {
        const info = await stat(path);
        if (!info.isFile()) return null;
        return { stream: createReadStream(path), sizeBytes: info.size };
      } catch {
        return null;
      }
    },

    async remove(workspaceId, storageKey) {
      // Both: the stray sweep removes an upload that died as readily as a finished file.
      await Promise.all([
        rm(keyPath(workspaceId, storageKey), { force: true }),
        rm(keyPath(workspaceId, storageKey, PART), { force: true }),
      ]);
    },

    async list(workspaceId) {
      // Outside the try: a workspace that would leave the folder is refused, never read as "nothing here".
      const folder = pathOf(workspaceId);
      let names: string[];
      try {
        names = await readdir(folder);
      } catch {
        // No folder yet: nothing was ever uploaded here.
        return [];
      }
      const entries: FileStoreEntry[] = [];
      // One at a time: a folder can hold thousands, and a stat each in parallel would open them all at once.
      for (const name of names) {
        const storageKey = name.endsWith(PART) ? name.slice(0, -PART.length) : name;
        if (!isFileStorageKey(storageKey)) continue;
        try {
          const info = await stat(pathOf(workspaceId, name));
          entries.push({ storageKey, partial: name.endsWith(PART), modifiedAt: info.mtime });
        } catch {
          // Removed while listing: nothing to report.
        }
      }
      return entries;
    },
  };
}
