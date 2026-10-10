import type { Vec3 } from '../lib/satellites';

// The globe's camera: a d3 rotation [λ, φ, γ] that eases towards a target, plus a zoom factor.
// It is mutated in place by the pointer handlers and the animation loop, outside React, so moving
// the globe never re-renders the page.

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 5;
export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

// Auto-rotation, in degrees of longitude per frame.
const AUTO_ROTATE_STEP = 0.02;
// Share of the remaining distance to the target covered each frame.
const EASE = 0.08;
// Keep the poles just short of facing the viewer, where dragging would flip the globe over.
const MAX_TILT = 85;
// Degrees of rotation per pixel dragged, at zoom 1.
const DRAG_DEG_PER_PX = 0.5;

export interface ViewState {
  rot: Vec3;
  tgt: Vec3;
  zoom: number;
  // A drag or pinch is in progress.
  dragging: boolean;
  // The gesture that just ended was a drag, so the click that follows it isn't a tap.
  wasDrag: boolean;
  // Where the current pointer went down, and where it was last seen.
  down: [number, number] | null;
  lastXY: [number, number] | null;
}

export function createView(): ViewState {
  return { rot: [-10, -25, 0], tgt: [-10, -25, 0], zoom: 1, dragging: false, wasDrag: false, down: null, lastXY: null };
}

// Point the camera at a lon/lat (it eases there over the next frames).
export function lookAt(v: ViewState, lon: number, lat: number): void {
  v.tgt[0] = -lon;
  v.tgt[1] = -lat;
}

// Turn the target by a pointer movement in px. Slower when zoomed in, so the surface tracks the finger.
export function dragBy(v: ViewState, dx: number, dy: number): void {
  const k = DRAG_DEG_PER_PX / v.zoom;
  v.tgt[0] += dx * k;
  v.tgt[1] = Math.max(-MAX_TILT, Math.min(MAX_TILT, v.tgt[1] - dy * k));
}

// Advance the camera one frame: follow a point (lon/lat) if given, otherwise spin if auto-rotating,
// then ease the rotation towards the target. Neither applies while the person is dragging.
export function stepCamera(v: ViewState, follow: [number, number] | null, autoRotate: boolean): void {
  if (follow && !v.dragging) {
    lookAt(v, follow[0], follow[1]);
  } else if (autoRotate && !v.dragging) {
    v.tgt[0] += AUTO_ROTATE_STEP;
  }
  // Take the short way round: bring the target within ±180° of the current rotation.
  v.tgt[0] = v.rot[0] + ((((v.tgt[0] - v.rot[0]) % 360) + 540) % 360) - 180;
  v.rot[0] += (v.tgt[0] - v.rot[0]) * EASE;
  v.rot[1] += (v.tgt[1] - v.rot[1]) * EASE;
}

// True while the camera is still visibly easing towards its target.
export function isEasing(v: ViewState): boolean {
  return Math.abs(v.tgt[0] - v.rot[0]) > 0.01 || Math.abs(v.tgt[1] - v.rot[1]) > 0.01;
}
