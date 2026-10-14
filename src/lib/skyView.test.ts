import { describe, expect, it } from 'vitest';
import galileoOmm from './__fixtures__/galileo.omm.json?raw';
import { lonLatRAt, parseOmm } from './satellites';
import type { GalileoStatus, Visibility } from './satellites';
import { computeReadouts, computeSkyView } from './skyView';
import type { SatReadout } from './skyView';

const sats = parseOmm(galileoOmm, 'galileo');
const [sat] = sats;

describe('computeReadouts', () => {
  it('reports position and speed, and no look angles without an observer', () => {
    const r = computeReadouts(sats, sat.epoch, null)[sat.id];
    expect(r.alt).toBeGreaterThan(22000);
    expect(r.alt).toBeLessThan(24000); // ~23,200 km Galileo altitude
    expect(r.speed).toBeCloseTo(3.67, 1);
    expect(r.look).toBeUndefined();
  });

  it('sees a satellite near the zenith from right beneath it', () => {
    const [lon, lat] = lonLatRAt(sat, sat.epoch)!;
    const look = computeReadouts([sat], sat.epoch, { lon, lat })[sat.id].look!;
    // Geocentric vs geodetic latitude keeps it from being exactly 90°.
    expect(look.el).toBeGreaterThan(85);
    expect(look.range).toBeGreaterThan(22000);
    expect(look.range).toBeLessThan(24000);
  });

  it('puts a satellite below the horizon from the antipode', () => {
    const [lon, lat] = lonLatRAt(sat, sat.epoch)!;
    const look = computeReadouts([sat], sat.epoch, { lon: lon + 180, lat: -lat })[sat.id].look!;
    expect(look.el).toBeLessThan(0);
  });
});

describe('computeSkyView', () => {
  const look = (el: number) => ({ lat: 0, lon: 0, alt: 0, speed: 0, look: { el, az: 0, range: 0, rising: true } });
  const status: GalileoStatus = {
    source: '',
    fetchedAt: '',
    satellites: {
      [sats[0].short]: { svid: 'E11', status: 'USABLE', nagu: null },
      [sats[1].short]: { svid: 'E19', status: 'NOT USABLE', nagu: null },
      [sats[2].short]: { svid: 'E30', status: 'USABLE', nagu: null },
    },
  };
  const bySat: Record<string, SatReadout> = {
    [sats[0].id]: look(5), // above the horizon, below a 10° mask
    [sats[1].id]: look(60),
    [sats[2].id]: look(30),
    [sats[3].id]: look(-10), // below the horizon
  };
  const visibility = (over: Partial<Visibility> = {}): Visibility => ({ layers: {}, showUnusable: true, statusData: status, ...over });

  it('lists satellites above the horizon, highest first', () => {
    const { aboveHorizon } = computeSkyView(sats, bySat, visibility(), 10);
    expect(aboveHorizon.map(x => x.s.id)).toEqual([sats[1].id, sats[2].id, sats[0].id]);
  });

  it('counts only those above the mask as in view, and only usable Galileo towards a fix', () => {
    const { inView, usableGalileo } = computeSkyView(sats, bySat, visibility(), 10);
    expect(inView.map(x => x.s.id)).toEqual([sats[1].id, sats[2].id]);
    expect(usableGalileo).toBe(1); // sats[1] is not usable
  });

  it('follows the visibility settings', () => {
    expect(computeSkyView(sats, bySat, visibility({ showUnusable: false }), 0).aboveHorizon).toHaveLength(2);
    expect(computeSkyView(sats, bySat, visibility({ layers: { galileo: false, galileoElliptical: false } }), 0).aboveHorizon).toHaveLength(0);
  });
});
