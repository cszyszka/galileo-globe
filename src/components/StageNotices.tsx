import { useState } from 'react';
import { GROUP_COLORS, GROUP_NAMES } from '../lib/satellites';
import { TOUCH } from '../lib/touch';

// Messages shown over the globe while data loads, when it can't load, and when it is stale.

function formatAge(ms: number): string {
  const hours = Math.round(ms / 3600000);
  if (hours < 48) return `${hours} hours`;
  return `${Math.round(hours / 24)} days`;
}

export function LoadingNotice() {
  return (
    <div className="gg-center" role="status">
      <div className="gg-spinner" aria-hidden="true" />
      <p>Loading satellite data…</p>
    </div>
  );
}

export function ErrorNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="gg-center" role="alert">
      <p className="gg-center-title">Couldn’t load satellite data</p>
      <p className="gg-muted">Check your connection and try again. The data is refreshed automatically, so this is usually brief.</p>
      <button className="gg-primary" onClick={onRetry}>Try again</button>
    </div>
  );
}

export function StaleBanner({ stale }: { stale: { label: string; ageMs: number }[] }) {
  if (!stale.length) return null;
  const what = stale.map(s => `${s.label} is ${formatAge(s.ageMs)} old`).join(' · ');
  return (
    <div className="gg-banner" role="status">
      <strong>Data may be out of date.</strong> {what}. Positions can be slightly off; it normally refreshes every 6 hours.
    </div>
  );
}

// First-visit hint explaining the colours and markers. Dismissal is remembered when storage works.
const STORAGE_KEY = 'gg-legend-dismissed';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function Legend() {
  const [open, setOpen] = useState(() => !wasDismissed());

  const close = () => {
    setOpen(false);
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* storage unavailable */ }
  };

  return (
    <>
      <button
        className="gg-help-btn"
        aria-label={open ? 'Hide legend' : 'Show legend'}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        ?
      </button>
      {open && (
        <aside className="gg-legend" aria-label="How to read the globe" onKeyDown={e => { if (e.key === 'Escape') close(); }}>
          <div className="gg-legend-head">
            <strong>How to read the globe</strong>
            <button className="gg-legend-close" aria-label="Close legend" onClick={close}>×</button>
          </div>
          <h3>Orbits and markers</h3>
          <p className="gg-muted">Each ring is an orbit; the dots are satellites moving along it. Colour shows the orbit group.</p>
          <ul className="gg-legend-list">
            {GROUP_NAMES.map((name, i) => (
              <li key={name}><span className="gg-dot" style={{ background: GROUP_COLORS[i] }} /> {name}</li>
            ))}
          </ul>
          <ul className="gg-legend-list">
            <li><span className="gg-dot" style={{ background: 'var(--gg-muted)' }} /> Filled dot, solid ring: usable</li>
            <li><span className="gg-dot gg-hollow" style={{ borderColor: 'var(--gg-muted)' }} /> Hollow dot, dashed ring: reported not usable by the Galileo Service Centre</li>
          </ul>

          <h3>Moving around</h3>
          <p className="gg-muted">{TOUCH
            ? 'Drag to rotate, pinch to zoom. Tap a satellite for details, or tap the Earth to pick a location and see which satellites are overhead there.'
            : 'Drag to rotate, scroll or pinch to zoom. Click a satellite for details, or click the Earth to pick a location and see which satellites are overhead there.'}</p>

          <h3>A selected satellite</h3>
          <ul className="gg-legend-bullets">
            <li>The shaded area is the ground that sees it above the elevation mask.</li>
            <li>The dashed line on the Earth is its ground track for the next orbit; the dotted line runs from the satellite to the point beneath it.</li>
            <li>Its details show how often the ground track repeats (Galileo: every 10 days, 17 orbits).</li>
            <li>Settings › View › “3D orbit trace for selected” draws its path at orbit altitude as the Earth turns beneath it.</li>
          </ul>

          <h3>Appearance</h3>
          <p className="gg-muted">The sun and moon button switches between light and dark. Settings › Appearance can also follow your device.</p>
        </aside>
      )}
    </>
  );
}
