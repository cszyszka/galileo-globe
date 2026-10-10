import { describe, expect, it } from 'vitest';
import galileoTle from './__fixtures__/galileo.tle?raw';
import leopntTle from './__fixtures__/leopnt.tle?raw';
import {
  EARTH_RADIUS_KM,
  countStatuses,
  eciAt,
  eciToLonLatR,
  footprintRadiusDeg,
  groundTrackRepeat,
  gstime,
  healthOf,
  isShown,
  lonLatRAt,
  parseTle,
  sampleEarthFixed,
  sampleOrbit,
  sortSats,
  statusCategory,
  subsolarPoint,
} from './satellites';
import type { GalileoStatus } from './satellites';

describe('statusCategory', () => {
  it.each([
    ['USABLE', 'ok'],
    ['NOT USABLE', 'bad'],
    ['NOT AVAILABLE', 'bad'],
    ['TESTING', 'testing'],
    ['IN COMMISSIONING', 'testing'],
    ['SOMETHING ELSE', 'unknown'],
    ['', 'unknown'],
    [undefined, 'unknown'],
  ])('%j -> %s', (input, expected) => {
    expect(statusCategory(input)).toBe(expected);
  });
});

describe('parseTle', () => {
  const galileo = parseTle(galileoTle, 'galileo');

  it('parses every satellite in the file', () => {
    expect(galileo.map(s => s.short)).toEqual(['GSAT0101', 'GSAT0103', 'GSAT0206', 'GSAT0201']);
  });

  it('splits the name into short name and alias', () => {
    expect(galileo[0]).toMatchObject({ name: expect.stringContaining('GSAT0101'), short: 'GSAT0101', alias: 'GALILEO-PFM', id: '37846' });
  });

  it('derives orbital elements in degrees and minutes', () => {
    const s = galileo[0];
    expect(s.inclination).toBeCloseTo(56.95, 1);
    expect(s.raan).toBeCloseTo(338.86, 1);
    expect(s.periodMin).toBeCloseTo(844.7, 0); // ~14 h 05 min
    expect(s.epoch.getUTCFullYear()).toBe(2026);
  });

  it('puts the three nominal planes in distinct groups and flags the elliptical pair', () => {
    const nominal = galileo.filter(s => !s.elliptical);
    expect(nominal.map(s => s.plane).sort()).toEqual([0, 1, 2]);
    const eccentric = galileo.find(s => s.short === 'GSAT0201')!;
    expect(eccentric.elliptical).toBe(true);
    expect(eccentric.plane).toBe(3);
    expect(eccentric.layer).toBe('galileoElliptical');
    expect(nominal.every(s => s.layer === 'galileo')).toBe(true);
  });

  it('assigns colours per plane', () => {
    expect(new Set(galileo.map(s => s.color)).size).toBe(4);
  });

  it('puts LEO-PNT satellites in their own group and layer', () => {
    const leo = parseTle(leopntTle, 'leopnt');
    expect(leo.length).toBeGreaterThan(0);
    for (const s of leo) {
      expect(s.plane).toBe(4);
      expect(s.layer).toBe('leopnt');
      expect(s.constellation).toBe('leopnt');
    }
    expect(leo[0].alias).toBe('IOD-1');
  });

  it('handles CRLF line endings and trailing blank lines', () => {
    const crlf = galileoTle.replace(/\n/g, '\r\n') + '\r\n\r\n';
    expect(parseTle(crlf, 'galileo')).toHaveLength(4);
  });

  it('returns nothing for empty or malformed input', () => {
    expect(parseTle('', 'galileo')).toEqual([]);
    expect(parseTle('just a name\nnot a tle\nat all', 'galileo')).toEqual([]);
  });
});

describe('sortSats', () => {
  it('orders by plane then name without mutating the input', () => {
    const sats = parseTle(galileoTle, 'galileo');
    const before = [...sats];
    const sorted = sortSats(sats);
    expect(sats).toEqual(before);
    for (let i = 1; i < sorted.length; i++) {
      const [a, b] = [sorted[i - 1], sorted[i]];
      expect(a.plane < b.plane || (a.plane === b.plane && a.short.localeCompare(b.short) <= 0)).toBe(true);
    }
  });
});

describe('propagation', () => {
  const [sat] = parseTle(galileoTle, 'galileo');

  it('places Galileo at MEO altitude near the TLE epoch', () => {
    const pv = eciAt(sat, sat.epoch)!;
    const r = Math.hypot(pv.position.x, pv.position.y, pv.position.z);
    expect(r).toBeGreaterThan(29000);
    expect(r).toBeLessThan(30000); // ~29,600 km orbital radius
    const speed = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z);
    expect(speed).toBeCloseTo(3.67, 1);
  });

  it('samples one closed revolution', () => {
    const pts = sampleOrbit(sat, sat.epoch, 60);
    expect(pts).toHaveLength(61);
    const [first, last] = [pts[0], pts[60]];
    expect(Math.hypot(first[0] - last[0], first[1] - last[1], first[2] - last[2])).toBeLessThan(150);
  });
});

describe('eciToLonLatR', () => {
  it('is the identity rotation at gmst = 0', () => {
    const [lon, lat, r] = eciToLonLatR([7000, 0, 0], 0);
    expect(lon).toBeCloseTo(0);
    expect(lat).toBeCloseTo(0);
    expect(r).toBeCloseTo(7000);
  });

  it('subtracts gmst from the longitude', () => {
    const [lon] = eciToLonLatR([0, 7000, 0], Math.PI / 2);
    expect(lon).toBeCloseTo(0);
  });

  it('reports latitude for a point over the pole', () => {
    const [, lat, r] = eciToLonLatR([0, 0, 7000], 1.234);
    expect(lat).toBeCloseTo(90);
    expect(r).toBeCloseTo(7000);
  });
});

describe('subsolarPoint', () => {
  it('has declination near +23.4° at the June solstice and -23.4° in December', () => {
    expect(subsolarPoint(new Date('2026-06-21T12:00:00Z'))[1]).toBeCloseTo(23.4, 0);
    expect(subsolarPoint(new Date('2026-12-21T12:00:00Z'))[1]).toBeCloseTo(-23.4, 0);
  });

  it('is near the equator at the equinox', () => {
    expect(Math.abs(subsolarPoint(new Date('2026-03-20T12:00:00Z'))[1])).toBeLessThan(1);
  });

  it('sits near longitude 0 at noon UTC, moving west through the day', () => {
    const noon = subsolarPoint(new Date('2026-03-20T12:00:00Z'))[0];
    const six = subsolarPoint(new Date('2026-03-20T18:00:00Z'))[0];
    expect(Math.abs(noon)).toBeLessThan(5);
    expect(six).toBeCloseTo(noon - 90, 0);
  });

  it('keeps longitude within [-180, 180)', () => {
    for (let h = 0; h < 48; h += 5) {
      const lon = subsolarPoint(new Date(Date.UTC(2026, 0, 1, h)))[0];
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThan(180);
    }
  });
});

describe('footprintRadiusDeg', () => {
  it('shrinks as the minimum elevation rises', () => {
    const r = EARTH_RADIUS_KM + 23222;
    expect(footprintRadiusDeg(r, 0)).toBeGreaterThan(footprintRadiusDeg(r, 10));
    expect(footprintRadiusDeg(r, 10)).toBeGreaterThan(footprintRadiusDeg(r, 30));
  });

  it('is acos(Re/r) at zero elevation (horizon-to-horizon)', () => {
    const r = EARTH_RADIUS_KM + 23222;
    expect(footprintRadiusDeg(r, 0)).toBeCloseTo((Math.acos(EARTH_RADIUS_KM / r) * 180) / Math.PI, 6);
  });

  it('is ~0 when the elevation mask is the zenith', () => {
    expect(footprintRadiusDeg(EARTH_RADIUS_KM + 800, 90)).toBeCloseTo(0, 6);
  });
});

describe('groundTrackRepeat', () => {
  it('finds the Galileo cycle: 17 orbits in 10 sidereal days', () => {
    expect(groundTrackRepeat(844.7)).toEqual({ days: 10, orbits: 17 });
  });

  it('finds a GPS-style cycle: 2 orbits in 1 sidereal day', () => {
    expect(groundTrackRepeat(717.97)).toEqual({ days: 1, orbits: 2 });
  });

  it('returns null when there is no short repeat', () => {
    expect(groundTrackRepeat(600)).toBeNull();
  });

  it('matches the regular Galileo satellites in the fixture', () => {
    const regular = parseTle(galileoTle, 'galileo').filter(s => !s.elliptical);
    expect(regular.length).toBeGreaterThan(0);
    for (const s of regular) expect(groundTrackRepeat(s.periodMin)).toEqual({ days: 10, orbits: 17 });
  });
});

describe('service status', () => {
  const galileo = parseTle(galileoTle, 'galileo');
  const [leo] = parseTle(leopntTle, 'leopnt');
  const status: GalileoStatus = {
    source: 'https://example.test',
    fetchedAt: '2026-10-01T00:00:00Z',
    satellites: {
      GSAT0101: { svid: 'E11', status: 'USABLE', nagu: null },
      GSAT0103: { svid: 'E19', status: 'NOT USABLE', nagu: null },
      GSAT0206: { svid: 'E30', status: 'TESTING', nagu: null },
      // GSAT0201 is left out: "not listed"
    },
  };

  it('reads each Galileo satellite from the GSC table', () => {
    expect(healthOf(galileo[0], status)).toMatchObject({ category: 'ok', label: 'USABLE', info: { svid: 'E11' } });
    expect(healthOf(galileo[1], status).category).toBe('bad');
    expect(healthOf(galileo[3], status)).toMatchObject({ category: 'unknown', label: 'Not listed' });
  });

  it('is unknown while the status is unavailable', () => {
    expect(healthOf(galileo[0], null)).toMatchObject({ category: 'unknown', label: 'Unknown' });
  });

  it('treats LEO-PNT as demonstrators with no service status', () => {
    expect(healthOf(leo, status)).toMatchObject({ category: 'unknown', label: 'Demonstrator' });
  });

  it('counts Galileo satellites per category, leaving demonstrators out', () => {
    expect(countStatuses([...galileo, leo], status)).toEqual({ ok: 1, bad: 1, testing: 1, unknown: 1 });
  });

  it('hides a satellite whose layer is off, and non-usable ones on request', () => {
    const shown = (layers: object, showUnusable: boolean, i: number) => isShown(galileo[i], { layers, showUnusable, statusData: status });
    expect(shown({}, true, 0)).toBe(true); // layers default to shown
    expect(shown({ galileo: false }, true, 0)).toBe(false);
    expect(shown({ galileo: true }, false, 0)).toBe(true);
    expect(shown({ galileo: true }, false, 1)).toBe(false); // NOT USABLE
    expect(shown({ galileo: true }, true, 1)).toBe(true);
  });
});

describe('Earth-fixed positions', () => {
  const [sat] = parseTle(galileoTle, 'galileo');

  it('matches the ECI position rotated by GMST', () => {
    const pv = eciAt(sat, sat.epoch)!;
    const expected = eciToLonLatR([pv.position.x, pv.position.y, pv.position.z], gstime(sat.epoch));
    expect(lonLatRAt(sat, sat.epoch)).toEqual(expected);
    // Passing the GMST explicitly gives the same answer.
    expect(lonLatRAt(sat, sat.epoch, gstime(sat.epoch))).toEqual(expected);
  });

  it('samples evenly from the start time, inclusive', () => {
    const start = sat.epoch.getTime();
    const pts = sampleEarthFixed(sat, start, 60 * 60000, 6);
    expect(pts).toHaveLength(7);
    expect(pts[0]).toEqual(lonLatRAt(sat, sat.epoch));
    expect(pts[6]).toEqual(lonLatRAt(sat, new Date(start + 60 * 60000)));
  });

  it('does not close the loop after one orbit, because the Earth turns beneath it', () => {
    const pts = sampleEarthFixed(sat, sat.epoch.getTime(), sat.periodMin * 60000, 60);
    // ~14 h of Earth rotation shifts the track by roughly 210° of longitude
    const dLon = Math.abs(((pts[60][0] - pts[0][0] + 540) % 360) - 180);
    expect(dLon).toBeGreaterThan(90);
  });
});
