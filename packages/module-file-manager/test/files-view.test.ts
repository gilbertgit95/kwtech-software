import {
  checkUploadDraft,
  cleanupTimeLabel,
  deletionLabel,
  deletionWhen,
  emptyListWords,
  fileFilterCounts,
  fileKindOf,
  filterFiles,
  retentionLabel,
  sharingLabel,
  uploadedLabel,
  usageFraction,
  usageLabel,
} from '../src/react/view/files-view.js';

const ROOM = { maxFileBytes: 1024 * 1024, storageBytes: 2 * 1024 * 1024, usedBytes: 1024 * 1024 };
const PRIVATE = { visibility: 'private', sharedWith: [] };

describe('the page’s words', () => {
  it('says who a file is shared with, from the viewer’s side', () => {
    expect(sharingLabel({ mine: true, visibility: 'people', sharedWith: [{ displayName: 'Ben' }] })).toBe(
      'Shared with Ben',
    );
    expect(
      sharingLabel({ mine: true, visibility: 'people', sharedWith: [{ displayName: 'Ben' }, { displayName: 'Cal' }] }),
    ).toBe('Shared with Ben and 1 other');
    expect(sharingLabel({ mine: false, visibility: 'people', sharedWith: [] })).toBe('Shared with you');
    expect(sharingLabel({ mine: false, visibility: 'workspace', sharedWith: [] })).toBe('Shared with the workspace');
  });

  it('says when a file is deleted, in the workspace’s zone', () => {
    const label = deletionLabel('2026-11-16T13:00:00.000Z', 24, 'Asia/Manila', '22:00');
    expect(label).toMatch(/^Deleted at 10:00\sPM on Tue, (17 Nov|Nov 17)$/u);
  });

  it('says how long files are kept, and when the clean-up runs', () => {
    expect(retentionLabel(1)).toBe('1 hour');
    expect(retentionLabel(24)).toBe('24 hours');
    expect(retentionLabel(72)).toBe('3 days');
    expect(cleanupTimeLabel('22:00')).toMatch(/^10:00\sPM$/u);
  });

  it('says how much room is used', () => {
    expect(usageLabel(1024 * 1024, 2 * 1024 * 1024)).toBe('1 MB of 2 MB used');
    expect(usageLabel(1024, null)).toBe('1 KB used');
    expect(usageFraction(5, 10)).toBe(0.5);
    expect(usageFraction(5, null)).toBeNull();
  });
});

describe('checking an upload before sending it', () => {
  it('asks for a file', () => {
    expect(checkUploadDraft(null, ROOM, PRIVATE)).toBe('Choose a file to upload.');
  });

  it('refuses a file larger than one file may be, naming both sizes', () => {
    expect(checkUploadDraft({ name: 'big.bin', size: 2 * 1024 * 1024 }, ROOM, PRIVATE)).toBe(
      'That file is 2 MB. Files here can be at most 1 MB.',
    );
  });

  it('refuses a file there is no room for, naming what is left', () => {
    const full = { ...ROOM, usedBytes: 1.5 * 1024 * 1024 };
    expect(checkUploadDraft({ name: 'a.bin', size: 1024 * 1024 }, full, PRIVATE)).toMatch(/^Only 512 KB of room/u);
  });

  it('asks for people when sharing with chosen people', () => {
    expect(checkUploadDraft({ name: 'a.txt', size: 1 }, ROOM, { visibility: 'people', sharedWith: [] })).toMatch(
      /^Choose at least one person/u,
    );
  });

  it('passes a file that fits', () => {
    expect(checkUploadDraft({ name: 'a.txt', size: 1 }, ROOM, PRIVATE)).toBeNull();
  });
});

describe('the new layout’s rules (#142)', () => {
  it('tells a file’s kind from its type, then its extension', () => {
    expect(fileKindOf('image/heic', 'IMG_0001.HEIC')).toBe('image');
    expect(fileKindOf('application/pdf', 'x')).toBe('pdf');
    expect(fileKindOf('', 'Budget.XLSX')).toBe('sheet');
    expect(fileKindOf('application/octet-stream', 'backup.tar.gz')).toBe('archive');
    expect(fileKindOf('', '.env')).toBe('other');
    expect(fileKindOf('', 'README')).toBe('other');
  });

  const files = [
    { mine: true, name: 'Résumé.pdf', ownerName: 'Ana' },
    { mine: false, name: 'menu.png', ownerName: 'Ben Cruz' },
    { mine: false, name: 'notes.txt', ownerName: null },
  ];

  it('counts and filters by whose the file is', () => {
    expect(fileFilterCounts(files)).toEqual({ all: 3, mine: 1, shared: 2 });
    expect(filterFiles(files, 'mine', '').map((file) => file.name)).toEqual(['Résumé.pdf']);
    expect(filterFiles(files, 'shared', '').map((file) => file.name)).toEqual(['menu.png', 'notes.txt']);
  });

  it('searches names and owners, ignoring case and accents', () => {
    expect(filterFiles(files, 'all', 'RESUME').map((file) => file.name)).toEqual(['Résumé.pdf']);
    expect(filterFiles(files, 'all', 'cruz').map((file) => file.name)).toEqual(['menu.png']);
    expect(filterFiles(files, 'mine', 'menu')).toEqual([]);
  });

  /*
   * 15:00Z on 16 Nov is 11 PM on the 16th in Manila and 3 PM in London: the
   * same instant is a different evening in each, so "tonight" must follow
   * the workspace's zone.
   */
  it('says tonight, tomorrow or the date, in the workspace’s zone', () => {
    const uploaded = '2026-11-16T01:00:00.000Z'; // 9 AM Manila, 1 AM London, both on the 16th
    const morning = new Date('2026-11-16T02:00:00.000Z');
    // Manila: 24 h later is 9 AM on the 17th, so the 10 PM of the 17th: tomorrow.
    expect(deletionWhen(uploaded, 24, 'Asia/Manila', '22:00', morning)).toEqual({
      label: expect.stringMatching(/^Deleted tomorrow at /u),
      soon: false,
    });
    // With 1 hour kept, tonight's 10 PM takes it in both zones.
    expect(deletionWhen(uploaded, 1, 'Asia/Manila', '22:00', morning).soon).toBe(true);
    expect(deletionWhen(uploaded, 1, 'Europe/London', '22:00', morning).soon).toBe(true);
    // Two days later it is a date.
    expect(deletionWhen(uploaded, 48, 'Asia/Manila', '22:00', morning).label).toMatch(/^Deleted \w{3}, /u);
  });

  it('says today or yesterday for the upload, by the workspace’s day', () => {
    const at = '2026-11-16T15:00:00.000Z';
    const next = new Date('2026-11-17T03:00:00.000Z');
    // 11 PM on the 16th in Manila, read on the 17th: yesterday.
    expect(uploadedLabel(at, 'Asia/Manila', next)).toMatch(/^Yesterday, /u);
    // 3 PM on the 16th in London, read at 3 AM on the 17th: also yesterday.
    expect(uploadedLabel(at, 'Europe/London', next)).toMatch(/^Yesterday, /u);
    expect(uploadedLabel(at, 'Europe/London', new Date('2026-11-16T20:00:00.000Z'))).toMatch(/^Today, /u);
  });

  it('words an empty list by what emptied it', () => {
    expect(emptyListWords('all', true, true).title).toBe('No files match that search');
    expect(emptyListWords('shared', false, true).title).toBe('Nothing is shared with you yet');
    expect(emptyListWords('all', false, false).detail).toBe('Files shared with you here appear in this list.');
  });
});
