import { Readable } from 'node:stream';
import { FILE_LIMIT } from '../src/feature-keys.js';
import { FILE_NOT_FOUND_MESSAGE } from '../src/index.js';
import {
  FILE_TICKETS_PER_PERSON_MAX,
  FileTransferService,
  fileTicketHash,
} from '../src/server/file-transfer.service.js';
import { ANA, BEN, CAL, fixedCaps, harness, OTHER_WORKSPACE, SCOPE, uploadAs } from './harness.js';

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { reason?: string }).reason ?? 'threw without a reason';
  }
  return 'did not refuse';
}

describe('listing files', () => {
  it('shows a person their own files, the workspace’s, and those shared with them — newest first', async () => {
    const h = harness();
    await uploadAs(h, ANA, 'mine.txt', 'a');
    h.client.now = new Date('2026-11-16T05:00:00.000Z');
    await uploadAs(h, BEN, 'everyone.txt', 'b', { visibility: 'workspace' });
    h.client.now = new Date('2026-11-16T06:00:00.000Z');
    await uploadAs(h, BEN, 'for-ana.txt', 'c', { visibility: 'people', sharedWith: [ANA] });
    await uploadAs(h, BEN, 'for-cal.txt', 'd', { visibility: 'people', sharedWith: [CAL] });
    await uploadAs(h, BEN, 'bens.txt', 'e');

    const names = (await h.files.list(SCOPE, ANA)).map((entry) => entry.file.name);
    expect(names).toEqual(['for-ana.txt', 'everyone.txt', 'mine.txt']);
  });

  it('⚠ never shows another workspace’s files', async () => {
    const h = harness();
    await uploadAs(h, ANA, 'there.txt', 'x', { visibility: 'workspace' }, OTHER_WORKSPACE);
    expect(await h.files.list(SCOPE, ANA)).toEqual([]);
  });

  it('⚠ answers not_found, in one message, for a private file somebody else owns', async () => {
    const h = harness();
    const saved = await uploadAs(h, BEN, 'private.txt', 'x');
    await expect(h.files.visible(SCOPE, ANA, saved.file.id)).rejects.toMatchObject({
      reason: 'not_found',
      message: FILE_NOT_FOUND_MESSAGE,
    });
    await expect(h.files.visible(SCOPE, ANA, 'no-such-file')).rejects.toMatchObject({
      reason: 'not_found',
      message: FILE_NOT_FOUND_MESSAGE,
    });
  });
});

describe('uploading', () => {
  it('stores the bytes and the row, and tells the people it was shared with', async () => {
    const h = harness();
    const saved = await uploadAs(h, ANA, 'plan.pdf', 'hello', { visibility: 'people', sharedWith: [BEN] });
    expect(saved.file).toMatchObject({ name: 'plan.pdf', sizeBytes: 5, ownerId: ANA, visibility: 'people' });
    expect(saved.sharedWith).toEqual([BEN]);
    expect(h.store.bytes.get(`${SCOPE.workspaceId}/${saved.file.storageKey}`)?.toString()).toBe('hello');
    expect(h.notifier.sent).toEqual([expect.objectContaining({ recipientIds: [BEN], fileName: 'plan.pdf' })]);
  });

  it('spends a ticket once', async () => {
    const h = harness();
    const { ticket } = await h.transfers.startUpload(
      SCOPE,
      ANA,
      { name: 'a.txt', sizeBytes: 1, visibility: 'private', sharedWith: [] },
      h.client.now,
    );
    await h.transfers.upload(ticket, Readable.from([Buffer.from('a')]), h.client.now);
    expect(await refusal(h.transfers.upload(ticket, Readable.from([Buffer.from('a')]), h.client.now))).toBe(
      'ticket_invalid',
    );
  });

  it('refuses an expired ticket', async () => {
    const h = harness();
    const { ticket } = await h.transfers.startUpload(
      SCOPE,
      ANA,
      { name: 'a.txt', sizeBytes: 1, visibility: 'private', sharedWith: [] },
      h.client.now,
    );
    const later = new Date(h.client.now.getTime() + 301_000);
    expect(await refusal(h.transfers.upload(ticket, Readable.from([Buffer.from('a')]), later))).toBe('ticket_invalid');
  });

  it('⚠ refuses an upload that sends more than it declared, and keeps none of it', async () => {
    const h = harness();
    const { ticket } = await h.transfers.startUpload(
      SCOPE,
      ANA,
      { name: 'a.txt', sizeBytes: 2, visibility: 'private', sharedWith: [] },
      h.client.now,
    );
    expect(await refusal(h.transfers.upload(ticket, Readable.from([Buffer.from('abc')]), h.client.now))).toBe(
      'size_mismatch',
    );
    expect(h.store.bytes.size).toBe(0);
    expect(h.client.state.fileEntry).toEqual([]);
  });

  it('refuses a file larger than the plan allows one file to be, naming the cap', async () => {
    const h = harness({ limits: fixedCaps({ [FILE_LIMIT.fileSize]: 1, [FILE_LIMIT.storage]: 100 }) });
    const start = h.transfers.startUpload(
      SCOPE,
      ANA,
      { name: 'big.bin', sizeBytes: 2 * 1024 * 1024, visibility: 'private', sharedWith: [] },
      h.client.now,
    );
    await expect(start).rejects.toMatchObject({
      reason: 'file_too_large',
      message: expect.stringContaining('1 MB per file'),
    });
  });

  it('refuses a file the workspace has no room left for', async () => {
    const h = harness({ limits: fixedCaps({ [FILE_LIMIT.fileSize]: 10, [FILE_LIMIT.storage]: 1 }) });
    h.client.state.fileEntry.push({
      ...SCOPE,
      id: 'old',
      ownerId: BEN,
      name: 'old.bin',
      contentType: 'application/octet-stream',
      sizeBytes: 1024 * 1024,
      storageKey: 'a'.repeat(32),
      visibility: 'private',
      createdAt: h.client.now,
      updatedAt: h.client.now,
    });
    const start = h.transfers.startUpload(
      SCOPE,
      ANA,
      { name: 'one-more.txt', sizeBytes: 1, visibility: 'private', sharedWith: [] },
      h.client.now,
    );
    expect(await refusal(start)).toBe('storage_full');
  });

  it('⚠ checks the room again once the bytes arrive, and discards them when it is gone', async () => {
    const h = harness({ limits: fixedCaps({ [FILE_LIMIT.fileSize]: 10, [FILE_LIMIT.storage]: 1 }) });
    const size = 600 * 1024;
    const content = 'x'.repeat(size);
    const first = await h.transfers.startUpload(
      SCOPE,
      ANA,
      { name: 'a.bin', sizeBytes: size, visibility: 'private', sharedWith: [] },
      h.client.now,
    );
    const second = await h.transfers.startUpload(
      SCOPE,
      BEN,
      { name: 'b.bin', sizeBytes: size, visibility: 'private', sharedWith: [] },
      h.client.now,
    );
    await h.transfers.upload(first.ticket, Readable.from([Buffer.from(content)]), h.client.now);
    expect(await refusal(h.transfers.upload(second.ticket, Readable.from([Buffer.from(content)]), h.client.now))).toBe(
      'storage_full',
    );
    expect(h.store.bytes.size).toBe(1);
  });

  it('refuses everything when no store is bound — files are not set up', async () => {
    const h = harness({ store: null });
    const start = h.transfers.startUpload(
      SCOPE,
      ANA,
      { name: 'a.txt', sizeBytes: 1, visibility: 'private', sharedWith: [] },
      h.client.now,
    );
    expect(await refusal(start)).toBe('not_configured');
  });

  it('refuses sharing with people when nobody can be named', async () => {
    const h = harness({ members: null });
    const start = h.transfers.startUpload(
      SCOPE,
      ANA,
      { name: 'a.txt', sizeBytes: 1, visibility: 'people', sharedWith: [BEN] },
      h.client.now,
    );
    expect(await refusal(start)).toBe('not_shareable');
  });
});

describe('downloading', () => {
  it('hands the bytes to somebody the file is shared with, once', async () => {
    const h = harness();
    const saved = await uploadAs(h, ANA, 'plan.pdf', 'hello', { visibility: 'people', sharedWith: [BEN] });
    const ticket = await h.transfers.issueDownload(SCOPE, BEN, saved.file.id, h.client.now);
    const download = await h.transfers.redeem(ticket, h.client.now);
    expect(download).toMatchObject({ name: 'plan.pdf', sizeBytes: 5 });
    expect(await h.transfers.redeem(ticket, h.client.now)).toBeNull();
  });

  it('⚠ gives no ticket for a file not shared with you', async () => {
    const h = harness();
    const saved = await uploadAs(h, ANA, 'plan.pdf', 'hello', { visibility: 'people', sharedWith: [BEN] });
    expect(await refusal(h.transfers.issueDownload(SCOPE, CAL, saved.file.id, h.client.now))).toBe('not_found');
  });

  it('answers nothing for a file deleted after its ticket was given', async () => {
    const h = harness();
    const saved = await uploadAs(h, ANA, 'plan.pdf', 'hello');
    const ticket = await h.transfers.issueDownload(SCOPE, ANA, saved.file.id, h.client.now);
    await h.writes.delete(SCOPE, ANA, saved.file.id);
    expect(await h.transfers.redeem(ticket, h.client.now)).toBeNull();
  });
});

describe('tickets, with several API servers', () => {
  /** A second API instance: its own service object, the same database and store. */
  const otherServer = (h: ReturnType<typeof harness>) =>
    new FileTransferService(h.client, h.files, h.writes, {}, h.store);

  it('spends an upload ticket on a server other than the one that gave it', async () => {
    const h = harness();
    const { ticket } = await h.transfers.startUpload(
      SCOPE,
      ANA,
      { name: 'a.txt', sizeBytes: 1, visibility: 'private', sharedWith: [] },
      h.client.now,
    );
    const saved = await otherServer(h).upload(ticket, Readable.from([Buffer.from('a')]), h.client.now);
    expect(saved.file).toMatchObject({ name: 'a.txt', ownerId: ANA });
    expect(h.client.state.fileTicket).toEqual([]);
  });

  it('⚠ lets only one of two servers racing for a download ticket have the file', async () => {
    const h = harness();
    const saved = await uploadAs(h, ANA, 'plan.pdf', 'hello');
    const ticket = await h.transfers.issueDownload(SCOPE, ANA, saved.file.id, h.client.now);
    const results = await Promise.all([
      h.transfers.redeem(ticket, h.client.now),
      otherServer(h).redeem(ticket, h.client.now),
    ]);
    expect(results.filter((result) => result !== null)).toHaveLength(1);
  });

  it('⚠ keeps only the ticket’s hash', async () => {
    const h = harness();
    const { ticket } = await h.transfers.startUpload(
      SCOPE,
      ANA,
      { name: 'a.txt', sizeBytes: 1, visibility: 'private', sharedWith: [] },
      h.client.now,
    );
    expect(JSON.stringify(h.client.state.fileTicket)).not.toContain(ticket);
    expect(h.client.state.fileTicket).toEqual([expect.objectContaining({ tokenHash: fileTicketHash(ticket) })]);
  });

  it('does not open a file with an upload ticket', async () => {
    const h = harness();
    const { ticket } = await h.transfers.startUpload(
      SCOPE,
      ANA,
      { name: 'a.txt', sizeBytes: 1, visibility: 'private', sharedWith: [] },
      h.client.now,
    );
    expect(await h.transfers.redeem(ticket, h.client.now)).toBeNull();
  });

  it('refuses one ticket past the per-person cap, and forgets expired ones when the next is asked for', async () => {
    const h = harness();
    const saved = await uploadAs(h, ANA, 'plan.pdf', 'hello');
    for (let i = 0; i < FILE_TICKETS_PER_PERSON_MAX; i += 1) {
      await h.transfers.issueDownload(SCOPE, ANA, saved.file.id, h.client.now);
    }
    expect(await refusal(h.transfers.issueDownload(SCOPE, ANA, saved.file.id, h.client.now))).toBe('ticket_invalid');

    const later = new Date(h.client.now.getTime() + 61_000);
    await h.transfers.issueDownload(SCOPE, ANA, saved.file.id, later);
    expect(h.client.state.fileTicket).toHaveLength(1);
  });
});

describe('sharing and deleting', () => {
  it('lets the owner share with more people, and tells only the new ones', async () => {
    const h = harness();
    const saved = await uploadAs(h, ANA, 'plan.pdf', 'x', { visibility: 'people', sharedWith: [BEN] });
    h.notifier.sent.length = 0;
    const after = await h.writes.setSharing(SCOPE, ANA, saved.file.id, {
      visibility: 'people',
      sharedWith: [BEN, CAL],
    });
    expect(after.sharedWith).toEqual([BEN, CAL]);
    expect(h.notifier.sent.map((notice) => notice.recipientIds)).toEqual([[CAL]]);
  });

  it('⚠ refuses a re-share from somebody who can see the file but does not own it', async () => {
    const h = harness();
    const saved = await uploadAs(h, ANA, 'plan.pdf', 'x', { visibility: 'workspace' });
    expect(
      await refusal(h.writes.setSharing(SCOPE, BEN, saved.file.id, { visibility: 'private', sharedWith: [] })),
    ).toBe('not_owner');
    expect(await refusal(h.writes.delete(SCOPE, BEN, saved.file.id))).toBe('not_owner');
  });

  it('removes the share rows when a file is made private', async () => {
    const h = harness();
    const saved = await uploadAs(h, ANA, 'plan.pdf', 'x', { visibility: 'people', sharedWith: [BEN] });
    await h.writes.setSharing(SCOPE, ANA, saved.file.id, { visibility: 'private', sharedWith: [] });
    expect(h.client.state.fileShare).toEqual([]);
    expect(await refusal(h.files.visible(SCOPE, BEN, saved.file.id))).toBe('not_found');
  });

  it('deletes the row, its shares and its bytes', async () => {
    const h = harness();
    const saved = await uploadAs(h, ANA, 'plan.pdf', 'x', { visibility: 'people', sharedWith: [BEN] });
    await h.writes.delete(SCOPE, ANA, saved.file.id);
    expect(h.client.state.fileEntry).toEqual([]);
    expect(h.client.state.fileShare).toEqual([]);
    expect(h.store.bytes.size).toBe(0);
  });
});

describe('settings', () => {
  it('keeps files 24 hours until a workspace chooses otherwise', async () => {
    const h = harness();
    expect((await h.files.settings(SCOPE, ANA)).retentionHours).toBe(24);
    await h.writes.setSettings(SCOPE, ANA, 48);
    expect((await h.files.settings(SCOPE, ANA)).retentionHours).toBe(48);
    expect((await h.files.settings(OTHER_WORKSPACE, ANA)).retentionHours).toBe(24);
  });

  it('refuses a retention outside 1 hour to a week', async () => {
    const h = harness();
    expect(await refusal(h.writes.setSettings(SCOPE, ANA, 0))).toBe('invalid_retention');
    expect(await refusal(h.writes.setSettings(SCOPE, ANA, 200))).toBe('invalid_retention');
  });

  it('reports the room used and the caps, with the declared defaults when no checker is bound', async () => {
    const h = harness();
    await uploadAs(h, ANA, 'a.txt', 'abc');
    const view = await h.files.settings(SCOPE, ANA);
    expect(view.room).toMatchObject({ maxFileBytes: 25 * 1024 * 1024, storageBytes: 500 * 1024 * 1024, usedBytes: 3 });
  });
});
