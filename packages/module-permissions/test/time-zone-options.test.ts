import { describeZone, filterTimeZones, timeZoneOptions, zoneOffset } from '../src/react/view/time-zone-options.js';

// A January instant: New York is on standard time (GMT-5).
const WINTER = new Date('2026-01-15T12:00:00Z');
const SUMMER = new Date('2026-07-15T12:00:00Z');

describe('zoneOffset', () => {
  it('reads whole and half-hour offsets', () => {
    expect(zoneOffset('Asia/Manila', WINTER)).toEqual({ offset: 'GMT+8', offsetMinutes: 480 });
    expect(zoneOffset('Asia/Kolkata', WINTER)).toEqual({ offset: 'GMT+5:30', offsetMinutes: 330 });
    expect(zoneOffset('UTC', WINTER)).toEqual({ offset: 'GMT', offsetMinutes: 0 });
  });

  it('⚠ is the offset at that moment: daylight saving moves it', () => {
    expect(zoneOffset('America/New_York', WINTER).offsetMinutes).toBe(-300);
    expect(zoneOffset('America/New_York', SUMMER).offsetMinutes).toBe(-240);
  });

  it('does not throw on a zone the runtime does not know', () => {
    expect(zoneOffset('Mars/Olympus', WINTER)).toEqual({ offset: 'GMT', offsetMinutes: 0 });
  });
});

describe('describeZone', () => {
  it('names the place and its region, with spaces for underscores', () => {
    expect(describeZone('America/Argentina/Buenos_Aires', WINTER)).toMatchObject({
      city: 'Buenos Aires',
      region: 'America / Argentina',
    });
    expect(describeZone('UTC', WINTER)).toMatchObject({ city: 'UTC', region: '' });
  });
});

describe('timeZoneOptions', () => {
  it('lists west to east, then by name', () => {
    const zones = timeZoneOptions(['Asia/Manila', 'America/New_York', 'Asia/Singapore', 'UTC'], 'UTC', WINTER).map(
      (option) => option.zone,
    );
    expect(zones).toEqual(['America/New_York', 'UTC', 'Asia/Manila', 'Asia/Singapore']);
  });

  it('⚠ always includes the saved zone, even when the browser does not list it', () => {
    const zones = timeZoneOptions(['Asia/Manila'], 'Asia/Rangoon', WINTER).map((option) => option.zone);
    expect(zones).toContain('Asia/Rangoon');
  });

  it('lists a zone once when it is both saved and known', () => {
    expect(timeZoneOptions(['Asia/Manila'], 'Asia/Manila', WINTER)).toHaveLength(1);
  });
});

describe('filterTimeZones', () => {
  const options = timeZoneOptions(
    ['Asia/Manila', 'Asia/Kolkata', 'America/New_York', 'America/Argentina/Buenos_Aires'],
    'Asia/Manila',
    WINTER,
  );
  const found = (query: string) => filterTimeZones(options, query).map((option) => option.zone);

  it('finds a place by name, in any case, with spaces or underscores', () => {
    expect(found('manila')).toEqual(['Asia/Manila']);
    expect(found('New York')).toEqual(['America/New_York']);
    expect(found('buenos_aires')).toEqual(['America/Argentina/Buenos_Aires']);
  });

  it('finds by offset', () => {
    expect(found('gmt+8')).toEqual(['Asia/Manila']);
    expect(found('+5:30')).toEqual(['Asia/Kolkata']);
  });

  it('needs every word to match', () => {
    expect(found('asia man')).toEqual(['Asia/Manila']);
    expect(found('america york')).toEqual(['America/New_York']);
  });

  it('lists everything for an empty search', () => {
    expect(found('  ')).toHaveLength(options.length);
  });
});
