import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { createFolderFileStore } from '../src/server/file-folder.store.js';

const KEY = '0123456789abcdef0123456789abcdef';
const WORKSPACE = 'cmworkspace1';

describe('the folder store', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kwtech-files-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes, opens, lists and removes a file under its key', async () => {
    const store = createFolderFileStore(root);
    expect(await store.write(WORKSPACE, KEY, Readable.from([Buffer.from('hello')]), 5)).toEqual({
      kind: 'stored',
      sizeBytes: 5,
    });
    const opened = await store.open(WORKSPACE, KEY);
    expect(opened?.sizeBytes).toBe(5);
    expect(opened ? await text(opened.stream) : null).toBe('hello');
    expect((await store.list(WORKSPACE)).map((entry) => [entry.storageKey, entry.partial])).toEqual([[KEY, false]]);
    await store.remove(WORKSPACE, KEY);
    expect(await store.open(WORKSPACE, KEY)).toBeNull();
  });

  it('⚠ stops an upload past its declared size and leaves nothing behind', async () => {
    const store = createFolderFileStore(root);
    expect(await store.write(WORKSPACE, KEY, Readable.from([Buffer.from('too long')]), 3)).toEqual({
      kind: 'too_large',
    });
    expect(await readdir(join(root, WORKSPACE))).toEqual([]);
  });

  it('⚠ leaves the request open when it stops one, so the refusal can still be sent', async () => {
    const store = createFolderFileStore(root);
    const source = Readable.from([Buffer.from('too long'), Buffer.from(' and more')]);
    expect(await store.write(WORKSPACE, KEY, source, 3)).toEqual({ kind: 'too_large' });
    expect(source.destroyed).toBe(false);
  });

  it('fails, and keeps nothing, when the browser goes away mid-upload', async () => {
    const store = createFolderFileStore(root);
    const source = new Readable({ read() {} });
    source.push(Buffer.from('ab'));
    const writing = store.write(WORKSPACE, KEY, source, 10);
    setImmediate(() => source.destroy(new Error('socket hang up')));
    await expect(writing).rejects.toThrow('socket hang up');
    expect(await readdir(join(root, WORKSPACE))).toEqual([]);
  });

  it('⚠ refuses a key or a workspace that could leave its folder', async () => {
    const store = createFolderFileStore(root);
    await expect(store.open(WORKSPACE, '../../etc/passwd')).rejects.toThrow('32 hex characters');
    await expect(store.list('../outside')).rejects.toThrow('must name a workspace');
  });

  it('lists nothing for a workspace that never uploaded', async () => {
    expect(await createFolderFileStore(root).list(WORKSPACE)).toEqual([]);
  });
});
