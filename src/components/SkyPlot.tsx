import type { MouseEvent } from 'react';

// Polar azimuth/elevation plot as seen by the observer: zenith in the centre, horizon on the
// outer ring, north up and east to the right (as if looking up at the sky with a map overhead).
const SIZE = 220;
const C = SIZE / 2;
const R = C - 18;
const DEG = Math.PI / 180;
// Tap radius around each dot (viewBox units). Dots can sit close together, so a tap picks the
// nearest one within this radius rather than whichever target happens to be drawn on top.
const HIT_R = 14;

const radiusFor = (el: number) => ((90 - el) / 90) * R;

function toXY(az: number, el: number): [number, number] {
  const r = radiusFor(el);
  return [C + r * Math.sin(az * DEG), C - r * Math.cos(az * DEG)];
}

export interface SkyItem {
  id: string;
  name: string;
  label: string;
  az: number;
  el: number;
  color: string;
  hollow: boolean;
  // Below the elevation mask: plotted for reference but not counted, so drawn faded
  masked: boolean;
}

interface SkyPlotProps {
  items: SkyItem[];
  mask: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function SkyPlot({ items, mask, selectedId, onSelect }: SkyPlotProps) {
  const pick = (e: MouseEvent<SVGSVGElement>) => {
    const m = e.currentTarget.getScreenCTM()?.inverse();
    if (!m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    let best: { id: string; d: number } | null = null;
    for (const it of items) {
      const [x, y] = toXY(it.az, it.el);
      const d = Math.hypot(x - p.x, y - p.y);
      if (d <= HIT_R && (!best || d < best.d)) best = { id: it.id, d };
    }
    if (best) onSelect(best.id);
  };

  return (
    <svg className="gg-skyplot" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Sky plot of visible satellites" onClick={pick}>
      <circle cx={C} cy={C} r={R} className="gg-sky-bg" />
      {[30, 60].map(el => <circle key={el} cx={C} cy={C} r={radiusFor(el)} className="gg-sky-ring" />)}
      {mask > 0 && <circle cx={C} cy={C} r={radiusFor(mask)} className="gg-sky-mask" />}
      <line x1={C - R} y1={C} x2={C + R} y2={C} className="gg-sky-ring" />
      <line x1={C} y1={C - R} x2={C} y2={C + R} className="gg-sky-ring" />
      {([['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const).map(([t, az]) => {
        const [x, y] = [C + (R + 10) * Math.sin(az * DEG), C - (R + 10) * Math.cos(az * DEG)];
        return <text key={t} x={x} y={y} className="gg-sky-cardinal">{t}</text>;
      })}
      <text x={C + 3} y={C - radiusFor(30) + 10} className="gg-sky-tick">30°</text>
      <text x={C + 3} y={C - radiusFor(60) + 10} className="gg-sky-tick">60°</text>
      {items.map(it => {
        const [x, y] = toXY(it.az, it.el);
        const selected = it.id === selectedId;
        return (
          <g key={it.id} transform={`translate(${x},${y})`} className="gg-sky-sat" opacity={it.masked ? 0.4 : 1}>
            <title>{`${it.name} — el ${it.el.toFixed(0)}°, az ${it.az.toFixed(0)}°`}</title>
            <circle r={HIT_R} fill="transparent" />
            {selected && <circle r={8} fill="none" style={{ stroke: it.color }} strokeWidth={1.2} />}
            <circle
              r={4}
              style={{ fill: it.hollow ? 'var(--gg-panel)' : it.color, stroke: it.hollow ? it.color : 'var(--gg-panel)' }}
              strokeWidth={it.hollow ? 1.8 : 1}
            />
            <text x={6} y={-5} style={{ fill: it.color }} className="gg-sky-label">{it.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
