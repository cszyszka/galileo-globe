import { describe, expect, it } from 'vitest';
import * as d3 from 'd3';
import { EARTH_RADIUS_KM } from './satellites';
import type { Vec3 } from './satellites';
import { elevationDeg, limbCrossing, occluded, segment, toView, visiblePath } from './geometry';
import type { Screen } from './geometry';

// Identity "projection": view-space x/y straight to screen x/y, so paths are easy to read.
const screen: Screen = ([x, y]) => [x, y];
const noRotation = d3.geoRotation([0, 0, 0]);

describe('toView', () => {
  it('puts lon 0, lat 0 straight towards the viewer', () => {
    const [x, y, z] = toView(noRotation, 0, 0, 1);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(1);
  });

  it('puts east to the right and north up, scaled by radius', () => {
    const east = toView(noRotation, 90, 0, 2);
    expect(east[0]).toBeCloseTo(2);
    const north = toView(noRotation, 0, 90, 1);
    expect(north[1]).toBeCloseTo(1);
  });

  it('applies the globe rotation', () => {
    // Rotating by -90° of longitude brings lon 90 to the centre of the view.
    const [x, , z] = toView(d3.geoRotation([-90, 0, 0]), 90, 0, 1);
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(1);
  });
});

describe('occluded', () => {
  it('hides only points behind the Earth and inside its disc', () => {
    expect(occluded([0, 0, -3])).toBe(true);
    expect(occluded([0, 0, 3])).toBe(false); // in front
    expect(occluded([2, 0, -3])).toBe(false); // behind, but outside the disc
  });
});

describe('segment', () => {
  it('includes both ends', () => {
    const pts = segment([0, 0, 0], [4, 0, 0], 4);
    expect(pts).toEqual([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]]);
  });
});

describe('limbCrossing', () => {
  it('finds where a line behind the Earth comes out from behind the disc', () => {
    const p = limbCrossing([0, 0, -2], [2, 0, -2]);
    expect(p[0]).toBeCloseTo(1, 2);
  });
});

describe('visiblePath', () => {
  it('draws a fully visible line as one stroke', () => {
    expect(visiblePath([[0, 0, 1], [1, 0, 1]], screen)).toBe('M0.0,0.0L1.0,0.0');
  });

  it('is empty when every point is hidden', () => {
    expect(visiblePath([[0, 0, -2], [0.5, 0, -2]], screen)).toBe('');
  });

  it('lifts the pen behind the Earth and resumes exactly at the limb', () => {
    // From the left of the disc, behind it, out to the right.
    const pts: Vec3[] = [[-2, 0, -1], [0, 0, -1], [2, 0, -1]];
    const d = visiblePath(pts, screen);
    expect(d).toBe('M-2.0,0.0L-1.0,0.0M1.0,0.0L2.0,0.0');
  });
});

describe('elevationDeg', () => {
  const observer = { lon: 0, lat: 0 };
  const geo = EARTH_RADIUS_KM + 35786;

  it('is 90° for a satellite straight overhead', () => {
    expect(elevationDeg(observer, [0, 0, geo])).toBeCloseTo(90);
  });

  it('is negative for a satellite on the far side of the Earth', () => {
    expect(elevationDeg(observer, [180, 0, geo])).toBeLessThan(0);
  });

  it('decreases as the satellite moves away from the zenith', () => {
    expect(elevationDeg(observer, [20, 0, geo])).toBeGreaterThan(elevationDeg(observer, [40, 0, geo]));
  });
});
