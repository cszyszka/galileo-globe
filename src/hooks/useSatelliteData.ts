import { useCallback, useEffect, useRef, useState } from 'react';
import { SOURCES, loadDataMeta, loadGalileoStatus, loadOmm, parseOmm, sortSats } from '../lib/satellites';
import type { Constellation, GalileoStatus, Satellite } from '../lib/satellites';

// How often an open page re-reads the data files (they're refreshed on the server every ~6 h).
const DATA_RELOAD_MS = 30 * 60000;
// Show a warning when data is older than this (the scheduled refresh has stopped working).
const STALE_DATA_MS = 12 * 3600000;

export interface SourceState {
  ok: boolean;
  fetchedAt?: string | null;
  refreshError?: string | null;
  message?: string;
}

export interface LoadMeta { status: 'loading' | 'ready' | 'error'; sources: Record<string, SourceState> }
export interface StatusState { state: 'loading' | 'ready' | 'error'; data: GalileoStatus | null; message?: string }

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// Loads the orbit data (one OMM JSON file per source) and the Galileo service status, then re-checks
// periodically. `sats` only changes identity when the orbit data actually changed, because a new
// array rebuilds the whole globe scene.
export function useSatelliteData() {
  const [sats, setSats] = useState<Satellite[]>([]);
  const [meta, setMeta] = useState<LoadMeta>({ status: 'loading', sources: {} });
  const [status, setStatus] = useState<StatusState>({ state: 'loading', data: null });
  const reloadRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    let lastOmmKey: string | null = null;
    let lastCount = 0;
    const keys = Object.keys(SOURCES);

    const load = async () => {
      const [dataMeta, statusResult, ...ommResults] = await Promise.allSettled([
        loadDataMeta(),
        loadGalileoStatus(),
        ...keys.map(loadOmm),
      ]);
      if (cancelled) return;
      const refresh = dataMeta.status === 'fulfilled' ? dataMeta.value.sources ?? {} : {};

      // Sources load independently, so one failing doesn't hide the other.
      const sources: Record<string, SourceState> = {};
      const texts: string[] = [];
      ommResults.forEach((r, i) => {
        const info = refresh[`omm-${keys[i]}`] ?? ({} as Partial<(typeof refresh)[string]>);
        if (r.status === 'fulfilled') {
          texts.push(r.value);
          sources[keys[i]] = { ok: true, fetchedAt: info.fetchedAt ?? null, refreshError: info.error ?? null };
        } else {
          texts.push('');
          sources[keys[i]] = { ok: false, message: errorMessage(r.reason) };
        }
      });
      // The raw text is the change detector: identical files mean nothing to re-parse.
      const ommKey = texts.join('\n');
      if (ommKey !== lastOmmKey) {
        lastOmmKey = ommKey;
        const all = keys.flatMap((k, i) => (texts[i] ? parseOmm(texts[i], k as Constellation) : []));
        lastCount = all.length;
        setSats(sortSats(all));
      }
      setMeta({ status: lastCount ? 'ready' : 'error', sources });

      if (statusResult.status === 'fulfilled') {
        setStatus({ state: 'ready', data: statusResult.value });
      } else {
        // A failed re-check keeps the status we already have rather than blanking it.
        const message = errorMessage(statusResult.reason);
        setStatus(prev => (prev.data ? prev : { state: 'error', data: null, message }));
      }
    };

    reloadRef.current = load;
    load();
    const id = setInterval(load, DATA_RELOAD_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const retry = useCallback(() => {
    setMeta(prev => ({ ...prev, status: 'loading' }));
    setStatus(prev => (prev.data ? prev : { state: 'loading', data: null }));
    reloadRef.current?.();
  }, []);

  return { sats, meta, status, retry };
}

// Data files older than STALE_DATA_MS at wall-clock time `now`, for the "may be out of date" banner.
export function staleSources(meta: LoadMeta, status: StatusState, now: number): { label: string; ageMs: number }[] {
  return [
    ...Object.entries(meta.sources).flatMap(([key, src]) => (src.ok && src.fetchedAt ? [{ label: `${SOURCES[key].label} orbit data`, at: src.fetchedAt }] : [])),
    ...(status.data ? [{ label: 'Galileo service status', at: status.data.fetchedAt }] : []),
  ]
    .map(x => ({ label: x.label, ageMs: now - Date.parse(x.at) }))
    .filter(x => x.ageMs > STALE_DATA_MS);
}
