import {
  backupFileName,
  checkRestoreConfirmation,
  hasDailyBackupFor,
  parseBackupFileName,
  planRetention,
} from '../src/domain/files.js';

// 13:00Z is 21:00 in Manila the same day, and still the morning in London.
const NINE_PM_MANILA = new Date('2026-10-26T13:00:03Z');

describe('backup file names', () => {
  it('names a backup by the database, the zone’s day and time, and why it was made', () => {
    expect(backupFileName('kwtech', NINE_PM_MANILA, 'Asia/Manila', 'daily')).toBe(
      'kwtech-2026-10-26-210003-daily.dump',
    );
    expect(backupFileName('kwtech', NINE_PM_MANILA, 'Europe/London', 'manual')).toBe(
      'kwtech-2026-10-26-130003-manual.dump',
    );
  });

  it('reads everything back from the name', () => {
    expect(parseBackupFileName('kwtech-2026-10-26-210003-before-restore.dump')).toEqual({
      database: 'kwtech',
      dayKey: '2026-10-26',
      time: '21:00:03',
      kind: 'before_restore',
    });
  });

  it('⚠ makes a database name safe to be part of a file name', () => {
    expect(backupFileName('My-Shop/../db', NINE_PM_MANILA, 'Asia/Manila', 'manual')).toBe(
      'my_shop____db-2026-10-26-210003-manual.dump',
    );
  });

  it('⚠ refuses any name it did not make — a path, a traversal, another file', () => {
    for (const name of [
      '../kwtech-2026-10-26-210003-daily.dump',
      'sub/kwtech-2026-10-26-210003-daily.dump',
      'kwtech-2026-10-26-210003-daily.dump.partial',
      'kwtech-2026-10-26-210003-weekly.dump',
      'notes.txt',
      '',
    ]) {
      expect(parseBackupFileName(name)).toBeNull();
    }
  });
});

describe('keeping 30', () => {
  const file = (day: number, kind = 'daily') => ({
    name: `kwtech-2026-10-${String(day).padStart(2, '0')}-210000-${kind}.dump`,
    sizeBytes: 1,
    modifiedAt: new Date(Date.UTC(2026, 9, day, 13)),
  });

  it('deletes the oldest once the 31st arrives, whatever kind it is', () => {
    const files = [file(1, 'manual'), ...Array.from({ length: 30 }, (_, index) => file(index + 2))];
    expect(planRetention(files, 30).map((one) => one.name)).toEqual(['kwtech-2026-10-01-210000-manual.dump']);
    expect(planRetention(files.slice(1), 30)).toEqual([]);
  });

  it('never deletes a file it did not name, nor the one a restore is reading', () => {
    const stray = { name: 'notes.txt', sizeBytes: 1, modifiedAt: new Date(0) };
    const files = [stray, file(1), file(2), file(3)];
    expect(planRetention(files, 2).map((one) => one.name)).toEqual(['kwtech-2026-10-01-210000-daily.dump']);
    expect(planRetention(files, 2, ['kwtech-2026-10-01-210000-daily.dump'])).toEqual([]);
  });

  it('⚠ keeps at least the newest, whatever it is told', () => {
    expect(planRetention([file(1), file(2)], 0).map((one) => one.name)).toEqual([
      'kwtech-2026-10-01-210000-daily.dump',
    ]);
  });
});

describe('the daily backup’s "done" record is the folder', () => {
  it('counts only a daily backup named for that day', () => {
    const files = [{ name: 'kwtech-2026-10-26-093000-manual.dump' }, { name: 'kwtech-2026-10-25-210000-daily.dump' }];
    expect(hasDailyBackupFor(files, '2026-10-26')).toBe(false);
    expect(hasDailyBackupFor([...files, { name: 'kwtech-2026-10-26-210500-daily.dump' }], '2026-10-26')).toBe(true);
  });
});

describe('restore confirmation', () => {
  it('is the database’s name exactly, pasted spaces aside', () => {
    expect(checkRestoreConfirmation(' kwtech ', 'kwtech')).toBe(true);
    expect(checkRestoreConfirmation('KWTECH', 'kwtech')).toBe(false);
  });
});
