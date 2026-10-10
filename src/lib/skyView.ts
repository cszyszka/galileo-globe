import { eciToGeodetic, eciToEcf, ecfToLookAngles } from 'satellite.js';
import { eciAt, gstime, healthOf, isShown } from './satellites';
import type { Health, Satellite, Visibility } from './satellites';
import { DEG } from './geometry';
import type { Observer } from './geometry';

// What the panel shows for each satellite: where it is, and how it looks from the chosen place.
// Unlike the globe drawing, this uses satellite.js's geodetic conversions and look angles, so the
// numbers match what a receiver would report.

// Look angles from the observer: elevation and azimuth (deg), range (km), and whether it is climbing.
export interface Look { el: number; az: number; range: number; rising: boolean }
export interface SatReadout { lat: number; lon: number; alt: number; speed: number; look?: Look }

// A position fix needs at least four satellites (three for position, one for the receiver clock).
export const MIN_SATS_FOR_FIX = 4;

// Rising/setting is decided by comparing the elevation with the one a minute later.
const RISING_LOOKAHEAD_MS = 60000;

export function computeReadouts(sats: Satellite[], date: Date, observer: Observer | null): Record<string, SatReadout> {
  const gmst = gstime(date);
  const site = observer && { latitude: observer.lat * DEG, longitude: observer.lon * DEG, height: 0 };
  const later = new Date(date.getTime() + RISING_LOOKAHEAD_MS);
  const gmstLater = gstime(later);
  const bySat: Record<string, SatReadout> = {};
  for (const s of sats) {
    const pv = eciAt(s, date);
    if (!pv) continue;
    const geo = eciToGeodetic(pv.position, gmst);
    const readout: SatReadout = {
      lat: geo.latitude / DEG,
      lon: geo.longitude / DEG,
      alt: geo.height,
      speed: Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z),
    };
    if (site) {
      const look = ecfToLookAngles(site, eciToEcf(pv.position, gmst));
      const pvLater = eciAt(s, later);
      const elLater = pvLater ? ecfToLookAngles(site, eciToEcf(pvLater.position, gmstLater)).elevation : look.elevation;
      readout.look = {
        el: look.elevation / DEG,
        az: ((look.azimuth / DEG) + 360) % 360,
        range: look.rangeSat,
        rising: elLater > look.elevation,
      };
    }
    bySat[s.id] = readout;
  }
  return bySat;
}

export interface SkyEntry { s: Satellite; look: Look; health: Health }

export interface SkyView {
  // Shown satellites above the horizon, highest first.
  aboveHorizon: SkyEntry[];
  // The subset above the elevation mask. Those below it are still plotted (faded) but don't count.
  inView: SkyEntry[];
  // Galileo satellites in view that the GNSS Service Centre reports usable.
  usableGalileo: number;
}

export function computeSkyView(sats: Satellite[], bySat: Record<string, SatReadout>, visibility: Visibility, mask: number): SkyView {
  const aboveHorizon = sats
    .flatMap(s => {
      const look = bySat[s.id]?.look;
      return look && look.el >= 0 && isShown(s, visibility) ? [{ s, look, health: healthOf(s, visibility.statusData) }] : [];
    })
    .sort((a, b) => b.look.el - a.look.el);
  const inView = aboveHorizon.filter(x => x.look.el >= mask);
  const usableGalileo = inView.filter(x => x.s.constellation === 'galileo' && x.health.category === 'ok').length;
  return { aboveHorizon, inView, usableGalileo };
}
