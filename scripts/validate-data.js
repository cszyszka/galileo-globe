// Sanity checks for freshly downloaded data, run by scripts/refresh-data.js before anything is
// written. A check that fails throws, and the previous (last good) file is kept. Softer
// problems are returned as warnings and recorded in meta.json.

import { twoline2satrec } from 'satellite.js';

// Reject a download that suddenly has far fewer satellites than the last good one — that's far
// more likely a broken source than satellites disappearing. Override with --accept-drop.
const MAX_DROP_RATIO = 0.75;
// Warn when even the newest element set is this old: the source has probably stopped updating.
const STALE_EPOCH_DAYS = 7;

// TLE line checksum: sum of digits, minus signs count as 1, modulo 10.
export function tleChecksumOk(line) {
  if (line.length < 69) return false;
  let sum = 0;
  for (const ch of line.slice(0, 68)) {
    if (ch >= '0' && ch <= '9') sum += Number(ch);
    else if (ch === '-') sum += 1;
  }
  return sum % 10 === Number(line[68]);
}

function epochOf(satrec) {
  const year = satrec.epochyr < 57 ? 2000 + satrec.epochyr : 1900 + satrec.epochyr;
  return new Date(Date.UTC(year, 0, 1) + (satrec.epochdays - 1) * 86400000);
}

function checkCount(count, { min = 0, previous, acceptDrop }) {
  if (count < min) throw new Error(`Only ${count} satellites (expected at least ${min})`);
  if (!acceptDrop && previous > 0 && count < Math.ceil(previous * MAX_DROP_RATIO)) {
    throw new Error(`Only ${count} satellites, down from ${previous} — rerun with --accept-drop if this is real`);
  }
}

// Validates CelesTrak 3-line TLE text. Returns { count, warnings }.
export function validateTle(text, { min = 0, previous = 0, acceptDrop = false, now = new Date() } = {}) {
  const lines = text.split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean);
  if (lines.length % 3 !== 0) throw new Error(`Expected name/line1/line2 triplets, got ${lines.length} lines`);

  const warnings = [];
  const ids = new Set();
  let newest = null;
  for (let i = 0; i < lines.length; i += 3) {
    const [name, l1, l2] = lines.slice(i, i + 3);
    if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) throw new Error(`Malformed TLE for "${name.trim()}"`);
    if (!tleChecksumOk(l1) || !tleChecksumOk(l2)) throw new Error(`Bad checksum in TLE for "${name.trim()}"`);
    if (l1.slice(2, 7) !== l2.slice(2, 7)) throw new Error(`Line 1/2 catalog numbers differ for "${name.trim()}"`);
    const satrec = twoline2satrec(l1, l2);
    if (satrec.error) throw new Error(`SGP4 rejects TLE for "${name.trim()}" (error ${satrec.error})`);
    if (ids.has(satrec.satnum)) throw new Error(`Duplicate satellite ${satrec.satnum}`);
    ids.add(satrec.satnum);
    const epoch = epochOf(satrec);
    if (!newest || epoch > newest) newest = epoch;
  }

  const count = ids.size;
  checkCount(count, { min, previous, acceptDrop });
  if (newest && (now - newest) / 86400000 > STALE_EPOCH_DAYS) {
    warnings.push(`Newest element set is from ${newest.toISOString().slice(0, 10)}`);
  }
  return { count, warnings };
}

// Validates the parsed GSC status object. Returns { count, warnings }.
export function validateGalileoStatus(data, { min = 0, previous = 0, acceptDrop = false } = {}) {
  const entries = Object.entries(data?.satellites ?? {});
  for (const [name, sat] of entries) {
    if (!/^GSAT\d{4}$/.test(name)) throw new Error(`Unexpected satellite name "${name}"`);
    if (!/^E\d{2}$/.test(sat.svid ?? '')) throw new Error(`Unexpected SV ID "${sat.svid}" for ${name}`);
    if (!sat.status) throw new Error(`Missing status for ${name}`);
  }
  checkCount(entries.length, { min, previous, acceptDrop });

  const warnings = [];
  const known = ['USABLE', 'NOT USABLE', 'NOT AVAILABLE', 'TESTING', 'UNDER COMMISSIONING'];
  const odd = entries.filter(([, s]) => !known.includes(s.status)).map(([n, s]) => `${n}: ${s.status}`);
  if (odd.length) warnings.push(`Unrecognised status values (${odd.join(', ')})`);
  return { count: entries.length, warnings };
}
