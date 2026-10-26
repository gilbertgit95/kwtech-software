import { Readable } from 'node:stream';
import type { ProcessRunContext } from '@kwtech/module-kit';
import type { BackupFileEntry } from '../src/domain/files.js';
import { BackupWriteError } from '../src/server/backup.errors.js';
import { resolveBackupOptions } from '../src/server/backup.options.js';
import { BackupService } from '../src/server/backup.service.js';
import type { BackupStore } from '../src/server/ports.js';

/** A folder in memory, recording what was done to it, in order. */
function fakeStore(initial: BackupFileEntry[] = []) {
  const files = new Map(initial.map((file) => [file.name, file]));
  const steps: string[] = [];
  let failRestore = false;
  const store: BackupStore = {
    database: () => 'kwtech',
    list: async () => [...files.values()],
    create: async (name) => {
      steps.push(`create ${name}`);
      const file = { name, sizeBytes: 100, modifiedAt: new Date(Date.parse('2026-10-26T13:00:00Z') + files.size) };
      files.set(name, file);
      return file;
    },
    remove: async (name) => {
      steps.push(`remove ${name}`);
      return files.delete(name);
    },
    open: async (name) => (files.has(name) ? { stream: Readable.from(['x']), sizeBytes: 1 } : null),
    restore: async (name) => {
      steps.push(`restore ${name}`);
      if (failRestore) throw new Error('pg_restore exited with 1');
    },
  };
  return { store, files, steps, failNextRestore: () => (failRestore = true) };
}

const OLD = { name: 'kwtech-2026-10-01-210000-daily.dump', sizeBytes: 5, modifiedAt: new Date('2026-10-01T13:00:00Z') };
const NOW = new Date('2026-10-26T13:00:00Z'); // 21:00 in Manila

function service(store: BackupStore, ports: { password?: boolean; endSessions?: () => Promise<number> } = {}) {
  return new BackupService(
    resolveBackupOptions({ timeZone: 'Asia/Manila', keep: 3 }),
    store,
    ports.password === undefined ? async () => true : async () => ports.password ?? false,
    ports.endSessions ?? (async () => 4),
  );
}

function dailyContext(now: Date): ProcessRunContext {
  return {
    now,
    schedule: { kind: 'daily', times: ['21:00'], weekdays: [0, 1, 2, 3, 4, 5, 6] },
    tooLateAfterMinutes: 180,
  } as unknown as ProcessRunContext;
}

describe('backing up', () => {
  it('makes a backup, then deletes the oldest past the limit', async () => {
    const { store, files } = fakeStore([OLD]);
    const backups = service(store);
    for (let i = 0; i < 3; i += 1) await backups.create('u1', 'manual', new Date(NOW.getTime() + i * 1000));
    expect([...files.keys()]).not.toContain(OLD.name);
    expect(files.size).toBe(3);
  });

  it('⚠ refuses a second backup while one runs, rather than queueing it', async () => {
    const { store } = fakeStore();
    let release: () => void = () => {};
    store.create = (name) =>
      new Promise((done) => {
        release = () => done({ name, sizeBytes: 1, modifiedAt: NOW });
      });
    const backups = service(store);
    const first = backups.create('u1', 'manual', NOW);
    await expect(backups.create('u1', 'manual', NOW)).rejects.toMatchObject({ reason: 'busy' });
    release();
    await first;
  });

  it('says it is not set up when the app bound no store', async () => {
    const backups = new BackupService(resolveBackupOptions({}));
    await expect(backups.state()).rejects.toMatchObject({ reason: 'not_configured' });
  });
});

describe('the daily backup', () => {
  it('makes one at 21:00 in the backup zone, and a second run that day makes nothing', async () => {
    const { store, files } = fakeStore();
    const backups = service(store);
    await expect(backups.runDaily(dailyContext(NOW))).resolves.toMatchObject({ handled: 1 });
    await expect(backups.runDaily(dailyContext(new Date(NOW.getTime() + 15 * 60_000)))).resolves.toMatchObject({
      handled: 0,
    });
    expect([...files.keys()]).toEqual(['kwtech-2026-10-26-210000-daily.dump']);
  });

  it('does nothing before 21:00 — 20:45 in Manila is not yet', async () => {
    const { store, steps } = fakeStore();
    await service(store).runDaily(dailyContext(new Date('2026-10-26T12:45:00Z')));
    expect(steps).toEqual([]);
  });

  it('makes the evening’s backup late after an outage, and skips it past the window', async () => {
    const { store, steps } = fakeStore();
    // 23:30 is 2½ hours late: inside the 3-hour window it is made; with a 1-hour window it is skipped and counted.
    await expect(service(store).runDaily(dailyContext(new Date('2026-10-26T15:30:00Z')))).resolves.toMatchObject({
      handled: 1,
    });
    const late = fakeStore();
    const lateRun = { ...dailyContext(new Date('2026-10-26T15:30:00Z')), tooLateAfterMinutes: 60 } as ProcessRunContext;
    await expect(service(late.store).runDaily(lateRun)).resolves.toMatchObject({ handled: 0, skippedLate: 1 });
    expect(late.steps).toEqual([]);
    expect(steps).toHaveLength(1);
  });
});

describe('restoring', () => {
  it('makes a safety backup first, restores, then signs everybody out — in that order', async () => {
    const { store, steps } = fakeStore([OLD]);
    const ended: string[] = [];
    const backups = service(store, {
      endSessions: async () => {
        ended.push('all');
        return 3;
      },
    });
    let maintenanceDuringRestore = false;
    const restore = store.restore;
    store.restore = async (name) => {
      maintenanceDuringRestore = backups.inMaintenance();
      await restore(name);
    };
    await backups.restore('u1', OLD.name, 'kwtech', 'secret', NOW);
    expect(steps).toEqual(['create kwtech-2026-10-26-210000-before-restore.dump', `restore ${OLD.name}`]);
    expect(maintenanceDuringRestore).toBe(true);
    expect(backups.inMaintenance()).toBe(false);
    expect(ended).toEqual(['all']);
  });

  it('⚠ refuses before touching anything: a wrong confirmation, a wrong password', async () => {
    const { store, steps } = fakeStore([OLD]);
    await expect(service(store).restore('u1', OLD.name, 'kwtch', 'secret', NOW)).rejects.toMatchObject({
      reason: 'wrong_confirmation',
    });
    await expect(
      service(store, { password: false }).restore('u1', OLD.name, 'kwtech', 'nope', NOW),
    ).rejects.toMatchObject({ reason: 'wrong_password' });
    expect(steps).toEqual([]);
  });

  it('⚠ is refused as not set up without the sign-out port, never run with a step missing', async () => {
    const { store } = fakeStore([OLD]);
    const backups = new BackupService(resolveBackupOptions({}), store, async () => true, undefined);
    await expect(backups.restore('u1', OLD.name, 'kwtech', 'secret', NOW)).rejects.toMatchObject({
      reason: 'not_configured',
    });
  });

  it('ends maintenance when the restore fails, and signs nobody out', async () => {
    const { store, failNextRestore } = fakeStore([OLD]);
    failNextRestore();
    let signedOut = false;
    const backups = service(store, {
      endSessions: async () => {
        signedOut = true;
        return 0;
      },
    });
    await expect(backups.restore('u1', OLD.name, 'kwtech', 'secret', NOW)).rejects.toBeInstanceOf(BackupWriteError);
    expect(backups.inMaintenance()).toBe(false);
    expect(signedOut).toBe(false);
  });
});

describe('downloads', () => {
  it('spends a ticket once', async () => {
    const { store } = fakeStore([OLD]);
    const backups = service(store);
    const ticket = await backups.issueDownload('u1', OLD.name, NOW);
    await expect(backups.redeem(ticket, NOW)).resolves.toMatchObject({ name: OLD.name });
    await expect(backups.redeem(ticket, NOW)).resolves.toBeNull();
  });

  it('expires a ticket after a minute', async () => {
    const { store } = fakeStore([OLD]);
    const backups = service(store);
    const ticket = await backups.issueDownload('u1', OLD.name, NOW);
    await expect(backups.redeem(ticket, new Date(NOW.getTime() + 61_000))).resolves.toBeNull();
  });

  it('⚠ never issues one for a name it did not make', async () => {
    const { store } = fakeStore([OLD]);
    await expect(service(store).issueDownload('u1', '../../etc/passwd', NOW)).rejects.toMatchObject({
      reason: 'invalid_name',
    });
  });
});
