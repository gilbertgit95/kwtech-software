import {
  canSeeFile,
  FILE_SHARE_PEOPLE_MAX,
  fileContentDisposition,
  formatFileSize,
  isFileStorageKey,
  isFileTicketShaped,
  newlySharedWith,
  prepareContentType,
  prepareFileName,
  prepareFileSharing,
} from '../src/index.js';

const ANA = 'ana';
const BEN = 'ben';
const CAL = 'cal';

describe('who can see a file', () => {
  it('shows a private file to its owner alone', () => {
    const file = { ownerId: ANA, visibility: 'private' as const, sharedWith: [BEN] };
    expect(canSeeFile(file, ANA)).toBe(true);
    // ⚠ A stale share row never opens a private file.
    expect(canSeeFile(file, BEN)).toBe(false);
  });

  it('shows a workspace file to everybody', () => {
    expect(canSeeFile({ ownerId: ANA, visibility: 'workspace', sharedWith: [] }, CAL)).toBe(true);
  });

  it('shows a people file to the people named, and nobody else', () => {
    const file = { ownerId: ANA, visibility: 'people' as const, sharedWith: [BEN] };
    expect(canSeeFile(file, BEN)).toBe(true);
    expect(canSeeFile(file, CAL)).toBe(false);
  });
});

describe('preparing the sharing', () => {
  const everybody = new Set([ANA, BEN, CAL]);

  it('drops the people for private and workspace', () => {
    expect(prepareFileSharing({ visibility: 'workspace', sharedWith: [BEN] }, ANA, everybody)).toEqual({
      visibility: 'workspace',
      sharedWith: [],
    });
  });

  it('removes the owner and duplicates from the people', () => {
    expect(prepareFileSharing({ visibility: 'people', sharedWith: [CAL, ANA, BEN, CAL] }, ANA, everybody)).toEqual({
      visibility: 'people',
      sharedWith: [BEN, CAL],
    });
  });

  it('refuses people with nobody chosen', () => {
    expect(prepareFileSharing({ visibility: 'people', sharedWith: [ANA] }, ANA, everybody)).toEqual({
      refused: 'invalid_people',
    });
  });

  it('refuses somebody who is not shareable', () => {
    expect(prepareFileSharing({ visibility: 'people', sharedWith: ['stranger'] }, ANA, everybody)).toEqual({
      refused: 'not_shareable',
    });
  });

  it('refuses naming people when nobody can be named', () => {
    expect(prepareFileSharing({ visibility: 'people', sharedWith: [BEN] }, ANA, null)).toEqual({
      refused: 'not_shareable',
    });
  });

  it('refuses more people than a file may name', () => {
    const many = Array.from({ length: FILE_SHARE_PEOPLE_MAX + 1 }, (_, i) => `user-${i}`);
    expect(prepareFileSharing({ visibility: 'people', sharedWith: many }, ANA, new Set(many))).toEqual({
      refused: 'too_many_people',
    });
  });

  it('refuses a visibility that is not one', () => {
    expect(prepareFileSharing({ visibility: 'public', sharedWith: [] }, ANA, everybody)).toEqual({
      refused: 'invalid_visibility',
    });
  });
});

describe('who to tell', () => {
  it('tells the people newly able to see it, never the owner', () => {
    const after = { ownerId: ANA, visibility: 'people' as const, sharedWith: [BEN, CAL] };
    expect(newlySharedWith({ ownerId: ANA, visibility: 'people', sharedWith: [BEN] }, after)).toEqual([CAL]);
    expect(newlySharedWith(null, after)).toEqual([BEN, CAL]);
  });

  it('tells nobody when the file was already the workspace’s', () => {
    const after = { ownerId: ANA, visibility: 'people' as const, sharedWith: [BEN] };
    expect(newlySharedWith({ ownerId: ANA, visibility: 'workspace', sharedWith: [] }, after)).toEqual([]);
  });

  it('tells nobody about a file shared with the whole workspace', () => {
    expect(newlySharedWith(null, { ownerId: ANA, visibility: 'workspace', sharedWith: [] })).toEqual([]);
  });
});

describe('names and types', () => {
  it('keeps a name trimmed, slashes and all — it is never a path', () => {
    expect(prepareFileName('  reports/2026 Q4.pdf ')).toBe('reports/2026 Q4.pdf');
  });

  it('refuses an empty name, a dot name, and invisible formatting', () => {
    expect(prepareFileName('   ')).toEqual({ refused: 'invalid_name' });
    expect(prepareFileName('..')).toEqual({ refused: 'invalid_name' });
    expect(prepareFileName(`invoice${String.fromCodePoint(0x202e)}fdp.exe`)).toEqual({ refused: 'invalid_name' });
    expect(prepareFileName(`a${String.fromCodePoint(0)}b`)).toEqual({ refused: 'invalid_name' });
  });

  it('keeps a content type only when it looks like one', () => {
    expect(prepareContentType('Image/PNG')).toBe('image/png');
    expect(prepareContentType('not a type')).toBe('application/octet-stream');
    expect(prepareContentType(null)).toBe('application/octet-stream');
  });

  it('sizes in plain words', () => {
    expect(formatFileSize(1)).toBe('1 byte');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(25 * 1024 * 1024)).toBe('25 MB');
  });
});

describe('the transfer handshake', () => {
  it('always downloads as an attachment, with a name that cannot break the header', () => {
    const header = fileContentDisposition('a"b\r\nSet-Cookie: x.pdf');
    expect(header.startsWith('attachment; filename="a_b__Set-Cookie: x.pdf"')).toBe(true);
    expect(header).not.toMatch(/[\r\n]/u);
  });

  it('keeps a UTF-8 name in the encoded half', () => {
    expect(fileContentDisposition('résumé.pdf')).toBe(
      `attachment; filename="r_sum_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf`,
    );
  });

  it('knows a ticket and a storage key by their shape', () => {
    expect(isFileTicketShaped('A'.repeat(43))).toBe(true);
    expect(isFileTicketShaped('A'.repeat(42))).toBe(false);
    expect(isFileStorageKey('0123456789abcdef0123456789abcdef')).toBe(true);
    expect(isFileStorageKey('../../etc/passwd')).toBe(false);
  });
});
