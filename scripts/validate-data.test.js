import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tleChecksumOk, validateGalileoStatus, validateTle } from './validate-data.js';

// Four Galileo satellites with epochs on 1–2 October 2026.
const TLE = readFileSync(new URL('../src/lib/__fixtures__/galileo.tle', import.meta.url), 'utf8');
const NOW = new Date(Date.UTC(2026, 9, 3));
const lines = () => TLE.split('\n').filter(Boolean);

// Recomputes a TLE line's checksum, so a test can change a field and keep the line valid.
function withChecksum(line) {
  let sum = 0;
  for (const ch of line.slice(0, 68)) {
    if (ch >= '0' && ch <= '9') sum += Number(ch);
    else if (ch === '-') sum += 1;
  }
  return line.slice(0, 68) + (sum % 10);
}

const status = (satellites) => ({ source: 'https://www.gsc-europa.eu/', fetchedAt: NOW.toISOString(), satellites });
const usable = (svid) => ({ svid, clock: 'PHM', status: 'USABLE', nagu: null });

describe('tleChecksumOk', () => {
  it('accepts real lines and rejects a changed digit or a short line', () => {
    const [, l1, l2] = lines();
    expect(tleChecksumOk(l1)).toBe(true);
    expect(tleChecksumOk(l2)).toBe(true);
    expect(tleChecksumOk(l1.slice(0, 20) + '9' + l1.slice(21))).toBe(false);
    expect(tleChecksumOk(l1.slice(0, 60))).toBe(false);
  });
});

describe('validateTle', () => {
  it('counts the satellites in a good file', () => {
    expect(validateTle(TLE, { now: NOW })).toEqual({ count: 4, warnings: [] });
  });

  it('rejects text that is not name/line1/line2 triplets', () => {
    expect(() => validateTle(lines().slice(0, 5).join('\n'), { now: NOW })).toThrow(/triplets/);
  });

  it('rejects a malformed line', () => {
    const l = lines();
    l[1] = 'X' + l[1].slice(1);
    expect(() => validateTle(l.join('\n'), { now: NOW })).toThrow(/Malformed/);
  });

  it('rejects a bad checksum', () => {
    const l = lines();
    l[2] = l[2].slice(0, 10) + (l[2][10] === '1' ? '2' : '1') + l[2].slice(11);
    expect(() => validateTle(l.join('\n'), { now: NOW })).toThrow(/checksum/);
  });

  it('rejects lines 1 and 2 with different catalog numbers', () => {
    const l = lines();
    l[2] = withChecksum(l[2].slice(0, 2) + '99999' + l[2].slice(7));
    expect(() => validateTle(l.join('\n'), { now: NOW })).toThrow(/catalog numbers differ/);
  });

  it('rejects a duplicate satellite', () => {
    const l = lines();
    expect(() => validateTle([...l, ...l.slice(0, 3)].join('\n'), { now: NOW })).toThrow(/Duplicate/);
  });

  it('enforces the minimum count', () => {
    expect(() => validateTle(TLE, { min: 20, now: NOW })).toThrow(/expected at least 20/);
  });

  it('rejects a big drop from the previous count unless accepted', () => {
    expect(() => validateTle(TLE, { previous: 32, now: NOW })).toThrow(/--accept-drop/);
    expect(validateTle(TLE, { previous: 32, acceptDrop: true, now: NOW }).count).toBe(4);
    expect(validateTle(TLE, { previous: 5, now: NOW }).count).toBe(4);
  });

  it('warns when even the newest element set is old', () => {
    const later = new Date(Date.UTC(2026, 9, 20));
    expect(validateTle(TLE, { now: later }).warnings).toEqual(['Newest element set is from 2026-10-02']);
  });
});

describe('validateGalileoStatus', () => {
  it('counts the satellites in good data', () => {
    expect(validateGalileoStatus(status({ GSAT0101: usable('E11'), GSAT0102: usable('E12') })))
      .toEqual({ count: 2, warnings: [] });
  });

  it('rejects unexpected names, SV IDs and missing status', () => {
    expect(() => validateGalileoStatus(status({ 'GSAT 101': usable('E11') }))).toThrow(/satellite name/);
    expect(() => validateGalileoStatus(status({ GSAT0101: usable('11') }))).toThrow(/SV ID/);
    expect(() => validateGalileoStatus(status({ GSAT0101: { svid: 'E11' } }))).toThrow(/Missing status/);
  });

  it('treats a missing table as zero satellites', () => {
    expect(() => validateGalileoStatus({}, { min: 1 })).toThrow(/Only 0 satellites/);
  });

  it('rejects a big drop from the previous count', () => {
    expect(() => validateGalileoStatus(status({ GSAT0101: usable('E11') }), { previous: 28 })).toThrow(/down from 28/);
  });

  it('warns about status values it does not know', () => {
    const { warnings } = validateGalileoStatus(status({ GSAT0101: { ...usable('E11'), status: 'RETIRED' } }));
    expect(warnings).toEqual(['Unrecognised status values (GSAT0101: RETIRED)']);
  });
});
