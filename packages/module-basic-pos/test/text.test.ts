import {
  POS_NAME_MAX,
  preparePosCode,
  preparePosContact,
  preparePosLabel,
  preparePosName,
  preparePosNote,
  preparePosReason,
} from '../src/domain/text.js';

describe('POS text', () => {
  it('needs a name, one line, within the cap', () => {
    expect(preparePosName('  Lamination \n A4 ')).toEqual({ name: 'Lamination A4' });
    expect(preparePosName(' ')).toEqual({ refused: 'invalid_name' });
    expect(preparePosName('x'.repeat(POS_NAME_MAX + 1))).toEqual({ refused: 'invalid_name' });
  });

  it('⚠ refuses invisible characters — two names that look alike must be alike', () => {
    expect(preparePosName('Lami​nation')).toEqual({ refused: 'invalid_name' });
  });

  it('⚠ stores one spelling per code: "lam a4", "LAM-a4" and "LAMA4" differ only as typed', () => {
    expect(preparePosCode(' lam-a4 ')).toEqual({ code: 'LAM-A4' });
    expect(preparePosCode('lam a4')).toEqual({ code: 'LAMA4' });
    expect(preparePosCode('')).toEqual({ code: null });
    expect(preparePosCode('LAM#A4')).toEqual({ refused: 'invalid_code' });
  });

  it('treats an empty note, label or contact as none', () => {
    expect(preparePosNote('  ')).toEqual({ note: null });
    expect(preparePosNote('no ice')).toEqual({ note: 'no ice' });
    expect(preparePosLabel('table 3')).toEqual({ label: 'table 3' });
    expect(preparePosContact('')).toEqual({ contact: null });
  });

  it('⚠ requires a reason where one is asked for', () => {
    expect(preparePosReason('  ')).toEqual({ refused: 'reason_required' });
    expect(preparePosReason('suki')).toEqual({ reason: 'suki' });
    expect(preparePosReason('x'.repeat(201))).toEqual({ refused: 'invalid_reason' });
  });
});
