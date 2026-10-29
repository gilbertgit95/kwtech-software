import { formatBackupSize, keptLine, restoreCommand } from '../src/react/view/backups-view.js';

describe('the Backups page’s words', () => {
  it('sizes a file the way people read them', () => {
    expect(formatBackupSize(900)).toBe('900 B');
    expect(formatBackupSize(512 * 1024)).toBe('512 KB');
    expect(formatBackupSize(3.4 * 1024 * 1024)).toBe('3.4 MB');
  });

  it('says when the next backup deletes the oldest', () => {
    expect(keptLine(12, 30)).toBe('12 of 30 kept.');
    expect(keptLine(30, 30)).toBe('30 of 30 kept — the next backup deletes the oldest.');
  });

  it('gives the command-line restore for one file', () => {
    expect(restoreCommand('kwtech-2026-10-26-210003-daily.dump')).toBe(
      'pnpm --filter @kwtech/web-server backup:restore kwtech-2026-10-26-210003-daily.dump',
    );
  });
});
