import { LAYERS } from '../../lib/satellites';
import type { LayerKey } from '../../lib/satellites';
import type { ThemePref } from '../../lib/theme';

const THEME_OPTIONS: { pref: ThemePref; label: string }[] = [
  { pref: 'system', label: 'Match device' },
  { pref: 'light', label: 'Light' },
  { pref: 'dark', label: 'Dark' },
];

// A checkbox setting: its current value and what to do when it changes.
export interface Toggle { value: boolean; onChange: (on: boolean) => void }

interface Props {
  layers: Record<LayerKey, boolean>;
  layerCounts: Map<LayerKey, number>;
  onLayerChange: (key: LayerKey, on: boolean) => void;
  // Null while the service status isn't loaded: there is nothing to filter on then.
  showUnusable: Toggle | null;
  themePref: ThemePref;
  onThemePref: (pref: ThemePref) => void;
  showTime: Toggle;
  trace3d: Toggle;
  autoRotate: Toggle;
  showLabels: Toggle;
  // Disabled when nothing is selected.
  follow: Toggle & { disabled: boolean };
}

function Checkbox({ toggle, label, disabled }: { toggle: Toggle; label: string; disabled?: boolean }) {
  return (
    <label>
      <input type="checkbox" checked={toggle.value} disabled={disabled} onChange={e => toggle.onChange(e.target.checked)} /> {label}
    </label>
  );
}

export default function SettingsTab(props: Props) {
  const { layers, layerCounts, onLayerChange, showUnusable, themePref, onThemePref } = props;
  return (
    <>
      <section>
        <h2>Constellations</h2>
        {LAYERS.map(({ key, label, note }) => (
          <label key={key}>
            <input type="checkbox" checked={layers[key]} onChange={e => onLayerChange(key, e.target.checked)} />
            {label}
            {note && <span className="gg-muted">({note})</span>}
            <span className="gg-muted gg-layer-count">{layerCounts.get(key) ?? 0} sats</span>
          </label>
        ))}
      </section>

      {showUnusable && (
        <section>
          <h2>Galileo service status</h2>
          <Checkbox toggle={showUnusable} label="Show non-usable satellites" />
        </section>
      )}

      <section>
        <h2>Appearance</h2>
        {THEME_OPTIONS.map(({ pref, label }) => (
          <label key={pref}>
            <input type="radio" name="gg-theme" checked={themePref === pref} onChange={() => onThemePref(pref)} />
            {label}
          </label>
        ))}
      </section>

      <section>
        <h2>View</h2>
        <Checkbox toggle={props.showTime} label="Show time controls" />
        <Checkbox toggle={props.trace3d} label="3D orbit trace for selected" />
        <Checkbox toggle={props.autoRotate} label="Auto-rotate" />
        <Checkbox toggle={props.showLabels} label="Show all labels" />
        <Checkbox toggle={props.follow} label="Follow selected" disabled={props.follow.disabled} />
      </section>

      <p className="gg-muted gg-small gg-footer">
        © 2026 Cezary Szyszka · <a href="/about/">About &amp; credits</a>
      </p>
    </>
  );
}
