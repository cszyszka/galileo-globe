import { EARTH_RADIUS_KM } from './satellites';
import type { LonLatR, Vec3 } from './satellites';

// View-space geometry for drawing the globe.
//
// "View space" is a cartesian frame measured in Earth radii, after the globe's rotation is
// applied: x to the right, y up, z towards the viewer. The Earth is the unit sphere at the origin,
// so a point is hidden when it is behind the Earth (z < 0) and inside its disc (x² + y² < 1).

export const DEG = Math.PI / 180;

// A place on the ground, in degrees.
export interface Observer { lon: number; lat: number }

// d3.geoRotation(...) — maps lon/lat to the rotated lon/lat the viewer sees.
export type Rotate = (p: [number, number]) => [number, number];
// Projects a view-space point onto the screen (px).
export type Screen = (p: Vec3) => [number, number];

// Rotated unit-sphere cartesian for a lon/lat, scaled by radius (in Earth radii).
export function toView(rotate: Rotate, lon: number, lat: number, r: number): Vec3 {
  const [l, p] = rotate([lon, lat]);
  const cp = Math.cos(p * DEG);
  return [r * cp * Math.sin(l * DEG), r * Math.sin(p * DEG), r * cp * Math.cos(l * DEG)];
}

// True when a view-space point is hidden behind the Earth's disc.
export const occluded = ([x, y, z]: Vec3): boolean => z < 0 && x * x + y * y < 1;

export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// `steps + 1` evenly spaced points from a to b, inclusive. Straight lines in view space (lines of
// sight, the nadir line) are drawn through these so visiblePath can cut them at the Earth's limb.
export const segment = (a: Vec3, b: Vec3, steps = 16): Vec3[] =>
  Array.from({ length: steps + 1 }, (_, i) => lerp3(a, b, i / steps));

// Point on segment a→b where visibility flips (a and b have different visibility). Bisection is
// plenty here: 8 halvings put the cut well under a pixel from the true limb crossing.
export function limbCrossing(a: Vec3, b: Vec3): Vec3 {
  let lo = 0, hi = 1;
  const aHidden = occluded(a);
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    if (occluded(lerp3(a, b, mid)) === aHidden) lo = mid;
    else hi = mid;
  }
  return lerp3(a, b, (lo + hi) / 2);
}

// SVG path through view-space points, skipping the parts hidden behind the Earth disk. Where the
// line passes behind the Earth it is cut exactly at the limb, so it doesn't stop short of the edge.
export function visiblePath(pts: Vec3[], screen: Screen): string {
  let d = '';
  let penDown = false;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const hidden = occluded(p);
    if (i > 0 && hidden !== occluded(pts[i - 1])) {
      const [x, y] = screen(limbCrossing(pts[i - 1], p));
      d += (penDown ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
      penDown = !hidden;
    }
    if (!hidden) {
      const [x, y] = screen(p);
      d += (penDown ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
      penDown = true;
    }
  }
  return d;
}

// Earth-centred, Earth-fixed cartesian for a lon/lat (deg) at radius r (in Earth radii).
export const ecef = (lon: number, lat: number, r = 1): Vec3 => {
  const cl = Math.cos(lat * DEG);
  return [r * cl * Math.cos(lon * DEG), r * cl * Math.sin(lon * DEG), r * Math.sin(lat * DEG)];
};

// Elevation (deg) of a satellite at [lon, lat, radiusKm] above an observer's horizon
// (spherical Earth — close enough for drawing; the panel uses satellite.js look angles).
export function elevationDeg(observer: Observer, [lon, lat, r]: LonLatR): number {
  const o = ecef(observer.lon, observer.lat);
  const sv = ecef(lon, lat, r / EARTH_RADIUS_KM);
  const d: Vec3 = [sv[0] - o[0], sv[1] - o[1], sv[2] - o[2]];
  // The observer's position on the unit sphere is also its local "up", so the sine of the
  // elevation is the up-component of the unit line of sight.
  return Math.asin((d[0] * o[0] + d[1] * o[1] + d[2] * o[2]) / Math.hypot(...d)) / DEG;
}
