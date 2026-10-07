import {
  cleanReportedText,
  isAgentOnline,
  PRINT_AGENT_NAME_MAX,
  PRINT_AGENT_ONLINE_SECONDS,
  prepareAgentName,
} from '../src/domain/agents.js';
import {
  formatPairingCode,
  isAgentSecretShaped,
  isPairingCodeUsable,
  normalisePairingCode,
  PRINT_PAIRING_ALPHABET,
  PRINT_PAIRING_CODE_LENGTH,
  PRINT_PAIRING_TTL_MINUTES,
  pairingCodeFromBytes,
  pairingExpiry,
} from '../src/domain/pairing.js';
import {
  PRINT_PAPER_MATCH_TOLERANCE,
  PRINT_PAPERS_MAX,
  PRINT_PRINTERS_MAX,
  paperForSize,
  planPrinterReport,
  preparePapers,
  prepareReportedPrinters,
  prepareSettings,
  toPrinterStatus,
} from '../src/domain/printers.js';

const NOW = new Date('2026-10-07T05:00:00.000Z');

describe('a pairing code', () => {
  it('is ten symbols from an alphabet with nothing to misread', () => {
    const code = pairingCodeFromBytes(Uint8Array.from({ length: 10 }, (_, index) => index * 25));
    expect(code).toHaveLength(PRINT_PAIRING_CODE_LENGTH);
    expect([...code].every((symbol) => PRINT_PAIRING_ALPHABET.includes(symbol))).toBe(true);
    expect(/[01OIL]/.test(PRINT_PAIRING_ALPHABET)).toBe(false);
  });

  it('refuses to be made from too few bytes rather than come out short', () => {
    expect(() => pairingCodeFromBytes(new Uint8Array(9))).toThrow();
  });

  it('is read back however it was grouped or cased', () => {
    const code = 'ABCDEFGHJK';
    expect(formatPairingCode(code)).toBe('ABCDE-FGHJK');
    for (const typed of ['ABCDE-FGHJK', 'abcde-fghjk', ' ABCDE FGHJK ', 'ABCDEFGHJK']) {
      expect([typed, normalisePairingCode(typed)]).toEqual([typed, code]);
    }
  });

  it('⚠ refuses anything that cannot be one, before any query', () => {
    for (const typed of [
      '',
      'ABCDE-FGHJ',
      'ABCDE-FGHJKM',
      'ABCDE-FGHJ0',
      'ABCDE-FGHJI',
      'A'.repeat(33),
      42,
      null,
      undefined,
    ]) {
      expect([typed, normalisePairingCode(typed)]).toEqual([typed, null]);
    }
  });

  it('is usable until it is used or its ten minutes are up', () => {
    const expiresAt = pairingExpiry(NOW);
    expect(expiresAt.getTime() - NOW.getTime()).toBe(PRINT_PAIRING_TTL_MINUTES * 60_000);
    expect(isPairingCodeUsable({ expiresAt, usedAt: null }, NOW)).toBe(true);
    expect(isPairingCodeUsable({ expiresAt, usedAt: NOW }, NOW)).toBe(false);
    expect(isPairingCodeUsable({ expiresAt, usedAt: null }, expiresAt)).toBe(false);
    expect(isPairingCodeUsable(null, NOW)).toBe(false);
  });
});

describe('an agent secret', () => {
  it('is recognised only as 32 bytes of unpadded base64url', () => {
    expect(isAgentSecretShaped('A'.repeat(43))).toBe(true);
    expect(isAgentSecretShaped(`${'a-_'.repeat(14)}Z`)).toBe(true);
    for (const value of [
      'A'.repeat(42),
      'A'.repeat(44),
      `${'A'.repeat(42)}=`,
      `${'A'.repeat(42)}+`,
      7,
      null,
      undefined,
    ]) {
      expect([value, isAgentSecretShaped(value)]).toEqual([value, false]);
    }
  });
});

describe('a computer’s name', () => {
  it('is one clean line', () => {
    expect(prepareAgentName('  Front\tdesk \n PC ')).toEqual({ name: 'Front desk PC' });
  });

  it('is refused when empty, too long or not text', () => {
    for (const value of ['', '   ', 'x'.repeat(PRINT_AGENT_NAME_MAX + 1), 7, null]) {
      expect([value, prepareAgentName(value)]).toEqual([value, { refused: 'invalid_name' }]);
    }
    expect(prepareAgentName('x'.repeat(PRINT_AGENT_NAME_MAX))).toEqual({ name: 'x'.repeat(PRINT_AGENT_NAME_MAX) });
  });

  it('what a computer says about itself is cleaned and cut, never refused', () => {
    expect(cleanReportedText(' DESK\u0007TOP-1 ')).toBe('DESK TOP-1');
    expect(cleanReportedText('x'.repeat(500))).toHaveLength(120);
    expect(cleanReportedText('   ')).toBeNull();
    expect(cleanReportedText(undefined)).toBeNull();
  });
});

describe('online', () => {
  const seen = (secondsAgo: number) => new Date(NOW.getTime() - secondsAgo * 1000);

  it('is three heartbeats of grace, worked out from the last one', () => {
    expect(isAgentOnline({ lastSeenAt: seen(PRINT_AGENT_ONLINE_SECONDS), revokedAt: null }, NOW)).toBe(true);
    expect(isAgentOnline({ lastSeenAt: seen(PRINT_AGENT_ONLINE_SECONDS + 1), revokedAt: null }, NOW)).toBe(false);
  });

  it('⚠ is never true for a revoked computer or one that has not connected', () => {
    expect(isAgentOnline({ lastSeenAt: seen(1), revokedAt: NOW }, NOW)).toBe(false);
    expect(isAgentOnline({ lastSeenAt: null, revokedAt: null }, NOW)).toBe(false);
  });
});

const A4 = { name: 'A4', width: 21000, height: 29700, margins: { top: 300, right: 300, bottom: 300, left: 300 } };
const NO_SETTINGS = { mediaTypes: [], mediaType: null, qualities: [], quality: null };
const printer = (overrides: Record<string, unknown> = {}) => ({
  name: 'L5290 Series(Network)',
  driver: 'EPSON L5290 Series',
  isDefault: true,
  status: 'ready',
  papers: [A4],
  settings: NO_SETTINGS,
  ...overrides,
});

describe('a report of printers', () => {
  it('passes a well-formed list through, cleaned', () => {
    const result = prepareReportedPrinters([printer({ name: ' L5290\n Series ' })]);
    expect(result).toEqual({ printers: [{ ...printer(), name: 'L5290 Series' }] });
  });

  it('reads an unrecognised status as unknown — a newer agent may know more words', () => {
    expect(toPrinterStatus('ready')).toBe('ready');
    expect(toPrinterStatus('on_fire')).toBe('unknown');
    expect(prepareReportedPrinters([printer({ status: 'on_fire' })])).toEqual({
      printers: [{ ...printer(), status: 'unknown' }],
    });
  });

  it('keeps margins that were not sent as null — “the driver did not say”', () => {
    const result = prepareReportedPrinters([printer({ papers: [{ name: 'A4', width: 21000, height: 29700 }] })]);
    expect(result).toEqual({ printers: [{ ...printer(), papers: [{ ...A4, margins: null }] }] });
  });

  it.each([
    ['not a list', 'nope'],
    ['too many printers', Array.from({ length: PRINT_PRINTERS_MAX + 1 }, (_, index) => printer({ name: `P${index}` }))],
    ['a printer with no name', [printer({ name: '  ' })]],
    ['⚠ two printers with one name', [printer(), printer()]],
    ['too many papers', [printer({ papers: Array.from({ length: PRINT_PAPERS_MAX + 1 }, () => A4) })]],
    ['a fractional length', [printer({ papers: [{ ...A4, width: 21000.5 }] })]],
    ['a paper of no size', [printer({ papers: [{ ...A4, height: 0 }] })]],
    ['a length past two metres', [printer({ papers: [{ ...A4, width: 200_001 }] })]],
    [
      'margins that leave nothing to print on',
      [printer({ papers: [{ ...A4, margins: { top: 0, right: 10500, bottom: 0, left: 10500 } }] })],
    ],
    [
      'margins sent and malformed',
      [printer({ papers: [{ ...A4, margins: { top: -1, right: 0, bottom: 0, left: 0 } }] })],
    ],
  ])('refuses %s', (_label, value) => {
    expect(prepareReportedPrinters(value)).toEqual({ refused: 'invalid_printers' });
  });

  it('reads papers back out of the Json column through the same check', () => {
    expect(preparePapers([A4])).toEqual([A4]);
    expect(preparePapers('corrupt')).toBeNull();
  });

  it('marks as gone what is known and no longer reported', () => {
    const plan = planPrinterReport(['A', 'B', 'C'], [printer({ name: 'B' }) as never, printer({ name: 'D' }) as never]);
    expect(plan.gone).toEqual(['A', 'C']);
    expect(plan.write.map((entry) => entry.name)).toEqual(['B', 'D']);
  });
});

describe('the paper for a page', () => {
  const paper = (name: string, width: number, height: number) => ({ name, width, height, margins: null });
  const papers = [paper('A4', 21000, 29700), paper('4 x 6 in', 10160, 15240), paper('A5', 14800, 21000)];

  it('finds the paper of the page’s size', () => {
    expect(paperForSize(papers, 21000, 29700)?.name).toBe('A4');
  });

  it('takes a size typed in millimetres for the paper a driver measures in inches', () => {
    expect(paperForSize(papers, 10200, 15200)?.name).toBe('4 x 6 in');
  });

  it('finds it for a page turned on its side: a landscape sheet is still that paper', () => {
    expect(paperForSize(papers, 29700, 21000)?.name).toBe('A4');
  });

  it('⚠ answers null, never a near miss or a default, when the printer has no such paper', () => {
    expect(paperForSize(papers, 8900, 12700)).toBeNull();
    expect(paperForSize(papers, 21000 + PRINT_PAPER_MATCH_TOLERANCE + 1, 29700)).toBeNull();
    expect(paperForSize([], 21000, 29700)).toBeNull();
  });

  it('prefers the closest, so a custom size a little off does not beat the standard one', () => {
    const both = [paper('Custom', 21050, 29700), paper('A4', 21000, 29700)];
    expect(paperForSize(both, 21000, 29700)?.name).toBe('A4');
  });
});

describe('a printer’s settings', () => {
  const plain = { id: 'psk:Plain', label: 'Plain paper' };
  const glossy = { id: 'psk:PhotographicHighGloss', label: 'Epson Premium Glossy' };

  it('keeps the driver’s paper types and qualities, and its current choice of each', () => {
    expect(
      prepareSettings({
        mediaTypes: [plain, glossy],
        mediaType: 'psk:Plain',
        qualities: [{ id: 'ns0000:HighQuality', label: 'High' }],
        quality: 'ns0000:HighQuality',
      }),
    ).toEqual({
      mediaTypes: [plain, glossy],
      mediaType: 'psk:Plain',
      qualities: [{ id: 'ns0000:HighQuality', label: 'High' }],
      quality: 'ns0000:HighQuality',
    });
  });

  it('⚠ never refuses: an older agent sends none, and what cannot be read is left out', () => {
    expect(prepareSettings(undefined)).toEqual(NO_SETTINGS);
    expect(prepareSettings({})).toEqual(NO_SETTINGS);
    expect(prepareSettings('nonsense')).toEqual(NO_SETTINGS);
    expect(
      prepareSettings({
        mediaTypes: [plain, plain, { id: "x'/><y", label: 'markup' }, { id: 7 }, null, { id: 'psk:NoName' }],
        mediaType: 'psk:Gone',
        qualities: 'nonsense',
      }),
    ).toEqual({
      mediaTypes: [plain, { id: 'psk:NoName', label: 'psk:NoName' }],
      mediaType: null,
      qualities: [],
      quality: null,
    });
  });

  it('comes through a report, and a report without any reads as none', () => {
    const withSettings = prepareReportedPrinters([printer({ settings: { ...NO_SETTINGS, mediaTypes: [plain] } })]);
    expect(withSettings).toMatchObject({ printers: [{ settings: { mediaTypes: [plain] } }] });
    const { settings: _settings, ...old } = printer();
    expect(prepareReportedPrinters([old])).toMatchObject({ printers: [{ settings: NO_SETTINGS }] });
  });
});
