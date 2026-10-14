import { groundTrackRepeat, STATUS_COLORS } from '../../lib/satellites';
import type { Health, Satellite } from '../../lib/satellites';
import type { SatReadout } from '../../lib/skyView';
import { formatEpoch, formatLatLon, formatPeriod, formatRepeat } from '../../lib/format';
import './SatDetails.css';

interface Props {
  sat: Satellite;
  health: Health;
  // Live position; missing until the first readout tick, or if SGP4 fails for this satellite.
  readout?: SatReadout;
  mask: number;
}

// The expanded details of one satellite: service status (with the latest NAGU notice, if any),
// where it is now, and its orbital elements.
export default function SatDetails({ sat, health, readout, mask }: Props) {
  const repeat = groundTrackRepeat(sat.periodMin);
  const nagu = health.info?.nagu;
  return (
    <div className="gg-detail" style={{ borderColor: sat.color }}>
      <div className="gg-status-row">
        <span className="gg-badge" style={{ color: STATUS_COLORS[health.category], borderColor: STATUS_COLORS[health.category] }}>
          {health.label}
        </span>
        {health.note && <span className="gg-muted gg-small">{health.note}</span>}
      </div>
      {nagu && (
        <p className="gg-small gg-nagu">
          NAGU {nagu.url ? <a href={nagu.url} target="_blank" rel="noreferrer">{nagu.id}</a> : nagu.id}
          {nagu.type && <span className="gg-muted"> · {nagu.type}</span>}
          {nagu.subject && <><br />{nagu.subject}</>}
        </p>
      )}
      <dl>
        {health.info && <><dt>SV ID</dt><dd>{health.info.svid}</dd></>}
        {health.info?.clock && <><dt>Clock</dt><dd>{health.info.clock}</dd></>}
        {readout && (
          <>
            <dt>Sub-point</dt><dd>{formatLatLon(readout.lat, readout.lon)}</dd>
            <dt>Altitude</dt><dd>{Math.round(readout.alt).toLocaleString()} km</dd>
            <dt>Velocity</dt><dd>{readout.speed.toFixed(3)} km/s</dd>
          </>
        )}
        <dt>Period</dt><dd>{formatPeriod(sat.periodMin)}</dd>
        <dt>Track repeats</dt><dd>{repeat ? formatRepeat(repeat) : 'no short cycle'}</dd>
        <dt>Inclination</dt><dd>{sat.inclination.toFixed(2)}°</dd>
        <dt>RAAN</dt><dd>{sat.raan.toFixed(1)}°</dd>
        <dt>Eccentricity</dt><dd>{sat.eccentricity.toFixed(4)}</dd>
        <dt>NORAD ID</dt><dd>{sat.id}</dd>
        <dt>Element epoch</dt><dd>{formatEpoch(sat.epoch)}</dd>
      </dl>
      <p className="gg-muted gg-small">
        Shaded area: ground that sees it above {mask}° elevation. Dashed line: ground track for the next orbit.
      </p>
    </div>
  );
}
