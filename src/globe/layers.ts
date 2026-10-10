import * as d3 from 'd3';
import type { Satellite } from '../lib/satellites';

// Builds the globe's SVG once per satellite set. Elements are appended in paint order (later ones
// draw on top); the scene only updates their attributes each frame.

type Sel<E extends d3.BaseType, D = unknown> = d3.Selection<E, D, null, undefined>;
type DataSel<E extends d3.BaseType> = d3.Selection<E, Satellite, SVGGElement, unknown>;

// Tap/click radius (px) around a satellite marker.
export const SAT_HIT_R = 12;

export interface Layers {
  svg: Sel<SVGSVGElement>;
  atmoGradient: Sel<SVGRadialGradientElement>;
  atmoInner: Sel<SVGStopElement>;
  behindClip: Sel<SVGPathElement>;
  atmosphere: Sel<SVGCircleElement>;
  ocean: Sel<SVGCircleElement>;
  graticule: Sel<SVGPathElement>;
  landGroup: Sel<SVGGElement>;
  night: Sel<SVGPathElement>;
  footprint: Sel<SVGPathElement>;
  track: Sel<SVGPathElement>;
  traceRing: Sel<SVGPathElement>;
  nadirLine: Sel<SVGPathElement>;
  observerMarker: Sel<SVGGElement>;
  orbitPaths: DataSel<SVGPathElement>;
  sightLines: DataSel<SVGPathElement>;
  satNodes: DataSel<SVGGElement>;
  labels: DataSel<SVGTextElement>;
}

export function createLayers(svgEl: SVGSVGElement, sats: Satellite[]): Layers {
  const svg = d3.select(svgEl);
  svg.selectAll('*').remove();

  const defs = svg.append('defs');
  // Atmosphere: fades from the surface to ATMOSPHERE_KM altitude (stops are set per frame).
  const atmoGradient = defs.append('radialGradient').attr('id', 'gg-atmo').attr('gradientUnits', 'userSpaceOnUse');
  const atmoInner = atmoGradient.append('stop').style('stop-color', 'var(--gg-atmo-in)').attr('stop-opacity', 0.55);
  atmoGradient.append('stop').attr('offset', 1).style('stop-color', 'var(--gg-atmo-out)').attr('stop-opacity', 0);

  // Labels of satellites behind the Earth are clipped by the Earth's disc (updated every frame)
  const behindClip = defs.append('clipPath').attr('id', 'gg-behind-clip').append('path').attr('clip-rule', 'evenodd');

  const atmosphere = svg.append('circle').attr('fill', 'url(#gg-atmo)');
  const ocean = svg.append('circle').style('fill', 'var(--gg-ocean)');

  // Everything drawn on the Earth's surface goes through the orthographic projection, which clips
  // the far side by itself.
  const earth = svg.append('g');
  const graticule = earth.append('path').attr('fill', 'none').style('stroke', 'var(--gg-grat)').attr('stroke-width', 0.4);
  const landGroup = earth.append('g');
  const night = earth.append('path').style('fill', 'var(--gg-night)');
  const footprint = earth.append('path').attr('fill-opacity', 0.12).attr('stroke-opacity', 0.6).attr('stroke-width', 1);
  const track = earth.append('path').attr('fill', 'none').attr('stroke-width', 1.2).attr('stroke-dasharray', '3 3');

  // Everything off the surface is drawn in view space and cut at the Earth's limb by visiblePath.
  const orbitGroup = svg.append('g').attr('fill', 'none');
  // Earth-fixed 3D trace of the selected satellite: its path at orbit altitude as the Earth turns beneath it
  const traceRing = svg.append('path').attr('fill', 'none').attr('stroke-width', 1.3).attr('stroke-opacity', 0.9).attr('stroke-linejoin', 'round');
  const nadirLine = svg.append('path').attr('fill', 'none').attr('stroke-width', 0.8).attr('stroke-dasharray', '2 3');
  const sightGroup = svg.append('g').attr('fill', 'none').attr('stroke-width', 1).attr('stroke-linecap', 'round');
  const observerMarker = svg.append('g').attr('class', 'gg-observer').attr('display', 'none');
  observerMarker.append('circle').attr('r', 9).attr('fill', 'none').style('stroke', 'var(--gg-marker)').attr('stroke-opacity', 0.5);
  observerMarker.append('circle').attr('r', 3.5).style('fill', 'var(--gg-marker)').style('stroke', 'var(--gg-bg)').attr('stroke-width', 1.5);
  const satGroup = svg.append('g');
  const labelGroup = svg.append('g').attr('font-size', 11).attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace');

  const orbitPaths = orbitGroup.selectAll<SVGPathElement, Satellite>('path').data(sats, d => d.id).enter().append('path')
    .style('stroke', d => d.color).attr('stroke-linecap', 'round');
  const sightLines = sightGroup.selectAll<SVGPathElement, Satellite>('path').data(sats, d => d.id).enter().append('path')
    .style('stroke', d => d.color);

  // Each satellite marker: an invisible hit area, a ring shown when selected or hovered, and the dot.
  const satNodes = satGroup.selectAll<SVGGElement, Satellite>('g').data(sats, d => d.id).enter().append('g')
    .attr('class', 'gg-sat');
  satNodes.append('circle').attr('class', 'hit').attr('r', SAT_HIT_R).attr('fill', 'transparent');
  satNodes.append('circle').attr('class', 'ring').attr('r', 10).attr('fill', 'none').style('stroke', d => d.color).attr('stroke-width', 1.2);
  satNodes.append('circle').attr('class', 'dot').attr('r', 4.5).style('fill', d => d.color).style('stroke', 'var(--gg-bg)').attr('stroke-width', 1.5);

  const labels = labelGroup.selectAll<SVGTextElement, Satellite>('text').data(sats, d => d.id).enter().append('text')
    .style('fill', d => d.color).attr('paint-order', 'stroke').style('stroke', 'var(--gg-bg)').attr('stroke-width', 3)
    .text(d => d.short);

  return {
    svg, atmoGradient, atmoInner, behindClip, atmosphere, ocean, graticule, landGroup, night, footprint, track,
    traceRing, nadirLine, observerMarker, orbitPaths, sightLines, satNodes, labels,
  };
}
