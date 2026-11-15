import {
  checkUploadDraft,
  cleanupTimeLabel,
  deletionLabel,
  retentionLabel,
  sharingLabel,
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
