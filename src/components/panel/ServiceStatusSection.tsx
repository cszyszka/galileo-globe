import type { StatusCounts as Counts } from '../../lib/satellites';
import type { StatusState } from '../../hooks/useSatelliteData';
import { formatUtc } from '../../lib/format';
import { StatusCounts } from './StatusSummary';

// Summary of the official Galileo service status, with its source and age.
export default function ServiceStatusSection({ status, counts }: { status: StatusState; counts: Counts }) {
  return (
    <section>
      <h2>Galileo service status</h2>
      {status.state === 'loading' && <p className="gg-muted">Loading…</p>}
      {status.state === 'error' && <p className="gg-error">Couldn’t load status: {status.message}</p>}
      {status.data && (
        <>
          <div className="gg-status-summary">
            <StatusCounts counts={counts} />
          </div>
          <p className="gg-muted gg-small">
            Source: <a href={status.data.source} target="_blank" rel="noreferrer">European GNSS Service Centre</a>
            , updated {formatUtc(new Date(status.data.fetchedAt))}. Hollow markers and dashed orbits are not usable.
          </p>
        </>
      )}
    </section>
  );
}
