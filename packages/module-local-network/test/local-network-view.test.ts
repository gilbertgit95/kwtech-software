import { DEVICE_FINGERPRINT_STEPS, fingerprintsShown, formatExpiry } from '../src/react/view/local-network-view.js';

describe('fingerprintsShown', () => {
  it('⚠ hides them on a page opened over plain HTTP', () => {
    expect(fingerprintsShown('http:')).toBe(false);
    expect(fingerprintsShown('')).toBe(false);
  });

  it('shows them over HTTPS (with the rule to follow, which the page cannot check)', () => {
    expect(fingerprintsShown('https:')).toBe(true);
  });
});

describe('formatExpiry', () => {
  it('gives a date, and the input itself when it is not one', () => {
    expect(formatExpiry('2036-09-03T05:13:29.000Z', 'en-US')).toBe('September 3, 2036');
    expect(formatExpiry('soon', 'en-US')).toBe('soon');
  });
});

describe('DEVICE_FINGERPRINT_STEPS', () => {
  it('covers each device once, and Windows is the one that shows SHA-1', () => {
    const devices = DEVICE_FINGERPRINT_STEPS.map((step) => step.device);
    expect(new Set(devices).size).toBe(devices.length);
    expect(DEVICE_FINGERPRINT_STEPS.filter((step) => step.fingerprint === 'SHA-1').map((step) => step.device)).toEqual([
      'Windows',
    ]);
  });
});
