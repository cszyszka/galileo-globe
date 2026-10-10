import type { LoadMeta } from '../../hooks/useSatelliteData';
import { formatUtc } from '../../lib/format';

// Where the orbit data comes from, shown under the satellite list once it has loaded.
export default function DataCredits({ meta }: { meta: LoadMeta }) {
  if (meta.status !== 'ready') return null;
  const fetchedAt = meta.sources.galileo?.fetchedAt;
  return (
    <p className="gg-muted gg-small">
      Orbital elements from <a href="https://celestrak.org" target="_blank" rel="noopener noreferrer">CelesTrak</a> (the “galileo” group and objects named LPNTSAT — ESA’s Celeste
      LEO-PNT demonstrators), propagated with SGP4 in your browser.
      {fetchedAt && ` Updated ${formatUtc(new Date(fetchedAt))}.`}
      {' '}Inclusion here doesn’t mean a satellite is currently healthy or in service.
    </p>
  );
}
