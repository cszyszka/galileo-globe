import type { Observer } from '../../lib/geometry';
import type { SkyView } from '../../lib/skyView';
import type { StatusState } from '../../hooks/useSatelliteData';
import { compassPoint, formatLatLon } from '../../lib/format';
import SkyPlot from '../SkyPlot';
import { FixSummary, StatusDot } from './StatusSummary';
import './VisibleFromSection.css';

const ELEVATION_MASKS = [0, 5, 10, 15];

interface Props {
  observer: Observer | null;
  sky: SkyView;
  mask: number;
  onMask: (mask: number) => void;
  status: StatusState;
  // Whether the Galileo layer is shown; the fix summary is about Galileo only.
  galileoShown: boolean;
  selectedId: string | null;
  onPick: (id: string) => void;
  onUseMyLocation: () => void;
  onClear: () => void;
  geoError: string | null;
}

// "Visible from" a place picked on the globe: which satellites are above its horizon, whether
// enough usable Galileo satellites are in view for a position fix, and a sky plot of them.
export default function VisibleFromSection({
  observer, sky, mask, onMask, status, galileoShown, selectedId, onPick, onUseMyLocation, onClear, geoError,
}: Props) {
  const { aboveHorizon, inView, usableGalileo } = sky;
  return (
    <section>
      <h2>
        Visible from
        <span className="gg-observer-coords">{observer ? formatLatLon(observer.lat, observer.lon) : '…'}</span>
      </h2>
      {!observer ? (
        <p className="gg-muted gg-small gg-observer-hint">
          Click anywhere on the Earth to see which satellites are above the horizon there.
        </p>
      ) : (
        <>
          <div className="gg-mask">
            <span className="gg-muted">Elevation mask</span>
            <div className="gg-buttons">
              {ELEVATION_MASKS.map(m => (
                <button key={m} className={m === mask ? 'active' : ''} aria-pressed={m === mask} onClick={() => onMask(m)}>{m}°</button>
              ))}
            </div>
          </div>
          <p className="gg-visible-summary">
            <strong>{inView.length}</strong> in view
            {galileoShown && !status.data && (
              <span className="gg-muted">
                {status.state === 'loading' ? ' · checking Galileo service status…' : ' · Galileo service status unavailable'}
              </span>
            )}
            {galileoShown && status.data && <FixSummary usable={usableGalileo} />}
          </p>
          <SkyPlot
            mask={mask}
            selectedId={selectedId}
            onSelect={onPick}
            items={aboveHorizon.map(({ s, look, health }) => ({
              id: s.id,
              name: s.short,
              // The SV ID (E01…) is what receivers show, so prefer it as the short label.
              label: health.info?.svid ?? s.alias ?? s.short,
              az: look.az,
              el: look.el,
              color: s.color,
              hollow: health.category === 'bad',
              masked: look.el < mask,
            }))}
          />
          {inView.length > 0 ? (
            <ul className="gg-list gg-visible-list">
              <li className="gg-visible-head gg-muted">
                <span />
                <span>Satellite</span>
                <span>Elev</span>
                <span>Azim</span>
                <span>Range</span>
              </li>
              {inView.map(({ s, look, health }) => (
                <li key={s.id}>
                  <button className={s.id === selectedId ? 'active' : ''} aria-pressed={s.id === selectedId} onClick={() => onPick(s.id)}>
                    <StatusDot color={s.color} hollow={health.category === 'bad'} title={health.note ?? health.label} />
                    <span className="gg-name">{s.short}</span>
                    <span className="gg-pos">
                      {look.el.toFixed(1)}°
                      <span className={look.rising ? 'gg-rising' : 'gg-setting'} title={look.rising ? 'Rising' : 'Setting'}>
                        {look.rising ? '↑' : '↓'}
                      </span>
                    </span>
                    <span className="gg-pos">{look.az.toFixed(0)}° {compassPoint(look.az)}</span>
                    <span className="gg-pos">{Math.round(look.range).toLocaleString()} km</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="gg-muted gg-small">No satellites above {mask}° right now.</p>
          )}
        </>
      )}
      <div className="gg-buttons gg-observer-actions">
        <button onClick={onUseMyLocation}>Use my location</button>
        {observer && <button onClick={onClear}>Clear</button>}
      </div>
      {geoError && <p className="gg-error gg-small" role="alert">{geoError}</p>}
    </section>
  );
}
