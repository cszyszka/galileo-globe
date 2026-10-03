// Downloads everything the app needs at runtime into public/data/, so the published site
// serves it as static files and visitors never hit CelesTrak or the GSC directly.
//
//   npm run data:refresh            # skips sources fetched in the last hour
//   npm run data:refresh -- --force # fetch everything now
//   ... -- --accept-drop             # accept a big drop in satellite count (see validate-data.js)
//
// Output (public/data/):
//   tle-galileo.txt, tle-leopnt.txt   orbital elements from CelesTrak
//   galileo-status.json               per-satellite service status from the GSC
//   meta.json                         when each file was fetched, and any errors
//
// Each source is independent: if a download fails or doesn't pass validation, its previous file
// is left in place, the error is recorded in meta.json, and the script exits non-zero so a
// scheduled job reports it.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { TLE_SOURCES } from '../src/lib/sources.js';
import { fetchGalileoStatus, GSC_URL } from './galileo-status.js';
import { validateTle, validateGalileoStatus } from './validate-data.js';

const OUT_DIR = new URL('../public/data/', import.meta.url);
const META_FILE = 'meta.json';
// CelesTrak asks clients not to download data more often than it changes (a few times a day).
const MIN_INTERVAL_MS = 60 * 60 * 1000;
const USER_AGENT = 'globe-visualization data refresh (Galileo / LEO-PNT viewer)';

const force = process.argv.includes('--force');
const acceptDrop = process.argv.includes('--accept-drop');

// Fewer satellites than this means the source is broken (Galileo has ~30 in orbit).
// LEO-PNT may legitimately be empty, e.g. if CelesTrak renames the objects.
const MIN_COUNT = { galileo: 20, leopnt: 0 };

async function readMeta() {
  try {
    return JSON.parse(await readFile(new URL(META_FILE, OUT_DIR), 'utf8'));
  } catch {
    return { sources: {} };
  }
}

// Write via a temp file so a crash never leaves a half-written file behind.
async function writeAtomic(name, contents) {
  const target = new URL(name, OUT_DIR);
  const tmp = new URL(`.${name}.tmp`, OUT_DIR);
  await writeFile(tmp, contents);
  await rename(tmp, target);
}

async function fetchTle(url) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`CelesTrak responded ${res.status}`);
  const text = await res.text();
  // CelesTrak answers an empty query with a plain-text message rather than an error.
  if (/No GP data found/i.test(text)) return '';
  if (!/^1 \d{5}/m.test(text)) throw new Error('Response contains no TLEs');
  return text.trim() + '\n';
}

const JOBS = [
  ...Object.entries(TLE_SOURCES).map(([key, src]) => ({
    key: `tle-${key}`,
    file: src.file,
    url: src.url,
    run: async opts => {
      const text = await fetchTle(src.url);
      const { count, warnings } = validateTle(text, { ...opts, min: MIN_COUNT[key] });
      return { contents: text, count, warnings };
    },
  })),
  {
    key: 'galileo-status',
    file: 'galileo-status.json',
    url: GSC_URL,
    run: async opts => {
      const data = await fetchGalileoStatus();
      const { count, warnings } = validateGalileoStatus(data, { ...opts, min: MIN_COUNT.galileo });
      return { contents: JSON.stringify(data, null, 2) + '\n', count, warnings };
    },
  },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const meta = await readMeta();
  const now = new Date();
  let failures = 0;

  for (const job of JOBS) {
    const prev = meta.sources[job.key];
    const age = prev?.fetchedAt ? now - Date.parse(prev.fetchedAt) : Infinity;
    if (!force && !prev?.error && age < MIN_INTERVAL_MS) {
      console.log(`skip  ${job.file.padEnd(20)} fetched ${Math.round(age / 60000)} min ago`);
      continue;
    }
    try {
      const { contents, count, warnings } = await job.run({ previous: prev?.count ?? 0, acceptDrop });
      await writeAtomic(job.file, contents);
      meta.sources[job.key] = { file: job.file, url: job.url, fetchedAt: new Date().toISOString(), count };
      if (warnings.length) meta.sources[job.key].warnings = warnings;
      console.log(`ok    ${job.file.padEnd(20)} ${count} satellites`);
      for (const w of warnings) console.warn(`      warning: ${w}`);
    } catch (err) {
      failures++;
      // Keep the last good file and its timestamp; just record what went wrong.
      meta.sources[job.key] = {
        ...prev,
        file: job.file,
        url: job.url,
        error: err.message,
        failedAt: new Date().toISOString(),
      };
      console.error(`FAIL  ${job.file.padEnd(20)} ${err.message}${prev?.fetchedAt ? ' (keeping previous file)' : ''}`);
    }
  }

  meta.generatedAt = now.toISOString();
  await writeAtomic(META_FILE, JSON.stringify(meta, null, 2) + '\n');
  if (failures) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
