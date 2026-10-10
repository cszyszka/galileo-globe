import { useMemo, useState } from 'react';
import * as d3 from 'd3';
import { GROUP_COLORS, GROUP_NAMES, STATUS_COLORS, healthOf, isShown } from '../../lib/satellites';
import type { Satellite, Visibility } from '../../lib/satellites';
import type { SatReadout } from '../../lib/skyView';
import { formatLatLon } from '../../lib/format';
import SatDetails from './SatDetails';
import { StatusDot } from './StatusSummary';
import './SatelliteGroups.css';

// Only the three Galileo planes have a meaningful common RAAN to show in their heading.
const PLANES_WITH_RAAN = 3;

interface Props {
  sats: Satellite[];
  visibility: Visibility;
  selectedId: string | null;
  bySat: Record<string, SatReadout>;
  mask: number;
  onSelect: (id: string) => void;
  onDeselect: () => void;
}

// Every shown satellite, one section per orbit group. A row opens to show that satellite's details.
export default function SatelliteGroups({ sats, visibility, selectedId, bySat, mask, onSelect, onDeselect }: Props) {
  const groups = useMemo(() => {
    const g: Satellite[][] = GROUP_NAMES.map(() => []);
    for (const s of sats) g[s.plane].push(s);
    return g;
  }, [sats]);

  // Keep the previously selected row's details mounted while it slides shut; the row clears this
  // when its transition ends. (Adjusting state during render is React's pattern for "on change".)
  const [prevSelectedId, setPrevSelectedId] = useState(selectedId);
  const [closingId, setClosingId] = useState<string | null>(null);
  if (prevSelectedId !== selectedId) {
    setPrevSelectedId(selectedId);
    setClosingId(prevSelectedId);
  }

  return groups.map((list, plane) => list.length > 0 && visibility.layers[list[0].layer] && (
    <section key={plane}>
      <h2>
        <span className="gg-dot" style={{ background: GROUP_COLORS[plane] }} />
        {GROUP_NAMES[plane]}
        <span className="gg-muted"> · {list.length} sats{plane < PLANES_WITH_RAAN ? ` · RAAN ≈ ${Math.round(d3.mean(list, s => s.raan) ?? 0)}°` : ''}</span>
      </h2>
      <ul className="gg-list">
        {list.map(s => {
          if (!isShown(s, visibility)) return null;
          const health = healthOf(s, visibility.statusData);
          const r = bySat[s.id];
          const open = s.id === selectedId;
          return (
            <li key={s.id} data-sat-id={s.id}>
              <button className={open ? 'active' : ''} aria-expanded={open} onClick={() => (open ? onDeselect() : onSelect(s.id))}>
                {/* Coloured by service status here; the visible list colours by orbit group instead. */}
                <StatusDot color={STATUS_COLORS[health.category]} hollow={health.category === 'bad'} title={health.note ?? health.label} />
                <span className="gg-name">{s.short}</span>
                <span className="gg-muted">{s.alias}</span>
                <span className="gg-pos">{r ? formatLatLon(r.lat, r.lon) : '—'}</span>
              </button>
              <div
                className={`gg-expand${open ? ' open' : ''}`}
                onTransitionEnd={e => {
                  // Ignore transitions bubbling up from the details inside.
                  if (e.target === e.currentTarget && !open && s.id === closingId) setClosingId(null);
                }}
              >
                <div className="gg-expand-inner">
                  {(open || s.id === closingId) && <SatDetails sat={s} health={health} readout={r} mask={mask} />}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  ));
}
