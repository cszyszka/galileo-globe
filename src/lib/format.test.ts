import { describe, expect, it } from 'vitest';
import { compassPoint, formatEpoch, formatLatLon, formatPeriod, formatRepeat, formatUtc } from './format';

describe('formatting', () => {
  const d = new Date('2026-10-10T08:05:09.123Z');

  it('formats UTC to the second and epochs to the minute', () => {
    expect(formatUtc(d)).toBe('2026-10-10 08:05:09 UTC');
    expect(formatEpoch(d)).toBe('2026-10-10 08:05');
  });

  it('writes hemispheres instead of signs', () => {
    expect(formatLatLon(52.23, 21.01)).toBe('52.2°N 21.0°E');
    expect(formatLatLon(-33.87, -70.66)).toBe('33.9°S 70.7°W');
  });

  it('shows hours only for periods of an hour or more', () => {
    expect(formatPeriod(844.7)).toBe('14 h 5 min');
    expect(formatPeriod(95.2)).toBe('1 h 35 min');
    expect(formatPeriod(42)).toBe('42 min');
  });

  it('says "sidereal day" for a one-day repeat', () => {
    expect(formatRepeat({ days: 10, orbits: 17 })).toBe('every 10 days (17 orbits)');
    expect(formatRepeat({ days: 1, orbits: 2 })).toBe('every sidereal day (2 orbits)');
  });

  it('rounds azimuths to the nearest compass point', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(22)).toBe('N');
    expect(compassPoint(23)).toBe('NE');
    expect(compassPoint(180)).toBe('S');
    expect(compassPoint(350)).toBe('N');
    expect(compassPoint(-90)).toBe('W');
  });
});
