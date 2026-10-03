// Polar azimuth/elevation plot as seen by the observer: zenith in the centre, horizon on the
// outer ring, north up and east to the right (as if looking up at the sky with a map overhead).
const SIZE = 220;
const C = SIZE / 2;
const R = C - 18;
const DEG = Math.PI / 180;

const radiusFor = el => ((90 - el) / 90) * R;

function toXY(az, el) {
  const r = radiusFor(el);
  return [C + r * Math.sin(az * DEG), C - r * Math.cos(az * DEG)];
}

export default function SkyPlot({ items, mask, selectedId, onSelect }) {
  return (
    <svg className="gg-skyplot" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Sky plot of visible satellites">
      <circle cx={C} cy={C} r={R} className="gg-sky-bg" />
      {[30, 60].map(el => <circle key={el} cx={C} cy={C} r={radiusFor(el)} className="gg-sky-ring" />)}
      {mask > 0 && <circle cx={C} cy={C} r={radiusFor(mask)} className="gg-sky-mask" />}
      <line x1={C - R} y1={C} x2={C + R} y2={C} className="gg-sky-ring" />
      <line x1={C} y1={C - R} x2={C} y2={C + R} className="gg-sky-ring" />
      {[['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([t, az]) => {
        const [x, y] = [C + (R + 10) * Math.sin(az * DEG), C - (R + 10) * Math.cos(az * DEG)];
        return <text key={t} x={x} y={y} className="gg-sky-cardinal">{t}</text>;
      })}
      <text x={C + 3} y={C - radiusFor(30) + 10} className="gg-sky-tick">30°</text>
      <text x={C + 3} y={C - radiusFor(60) + 10} className="gg-sky-tick">60°</text>
      {items.map(it => {
        const [x, y] = toXY(it.az, it.el);
        const selected = it.id === selectedId;
        return (
          <g key={it.id} transform={`translate(${x},${y})`} className="gg-sky-sat" onClick={() => onSelect(it.id)}>
            <title>{`${it.name} — el ${it.el.toFixed(0)}°, az ${it.az.toFixed(0)}°`}</title>
            {selected && <circle r={8} fill="none" stroke={it.color} strokeWidth={1.2} />}
            <circle
              r={4}
              fill={it.hollow ? 'var(--gg-bg, #071425)' : it.color}
              stroke={it.hollow ? it.color : '#071425'}
              strokeWidth={it.hollow ? 1.8 : 1}
            />
            <text x={6} y={-5} fill={it.color} className="gg-sky-label">{it.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
