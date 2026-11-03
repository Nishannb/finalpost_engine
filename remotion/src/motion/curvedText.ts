/**
 * Curved-text layout: pure geometry, no React.
 *
 * Given a box and a curve request it returns the SVG path the text runs on, the font size at which the text fits that path, and a conservative
 * bounding box (rotation included) so the caller can prove the text stays inside the canvas margins. The text is measured with the same
 * `measureLine` the rest of the toolkit uses (injectable for tests). Nothing here claims more than it does: `legible` is false when the text had to
 * shrink below `minFontSize`, and `clipped` is true when it cannot be made to fit the box at all.
 *
 * Shapes: 'arc' (a circular segment: curvature -1..1, + = arch, - = bowl), 'circle' (a ring, text outside for clockwise, inside for counter-clockwise)
 * and 'path' (a smooth curve through 2-16 points the caller supplies; no raw SVG path strings are accepted).
 */

import {measureLine} from './text';
import type {FontId} from './fonts';

export type CurveShape = 'arc' | 'circle' | 'path';
export type CurveAlign = 'start' | 'center' | 'end';
export type Point = {x: number; y: number};
export type LineMeasurer = (text: string, fontSize: number) => number;

export type CurvedTextOptions = {
  text: string;
  /** Box (px) the whole curved block must stay inside. */
  width: number;
  height: number;
  shape?: CurveShape;
  /** arc: -1..1. 0 is a straight line, 1 a half circle; positive arches up (∩), negative bowls down (∪). Default 0.35. */
  curvature?: number;
  /** circle: ring radius of the text baseline in px. Default: the largest ring that fits. */
  radius?: number;
  /** circle: where the text sits, in degrees clockwise from 12 o'clock. Default 0 (top). */
  angleDeg?: number;
  /** circle: 'clockwise' puts glyphs outside the ring (reads left to right over the top); 'counterclockwise' puts them inside (reads along the bottom). */
  direction?: 'clockwise' | 'counterclockwise';
  /** path: the points the curve passes through, in box px. */
  points?: Point[];
  align?: CurveAlign;
  font?: FontId;
  weight?: number;
  /** Largest font size to try (px). Default 96. */
  fontSize?: number;
  /** Below this the text is flagged not legible. Default 28. */
  minFontSize?: number;
  /** Letter spacing in em. */
  letterSpacing?: number;
  uppercase?: boolean;
  /** Whole-block rotation in degrees about the box centre. */
  rotationDeg?: number;
  /** Keep-out margin from the box edge, px. Default 24. */
  margin?: number;
  /** Test seam: replaces the font measurer. */
  measure?: LineMeasurer;
};

export type CurvedTextLayout = {
  pathD: string;
  pathLength: number;
  text: string;
  fontSize: number;
  letterSpacingPx: number;
  textLength: number;
  /** textPath startOffset as a fraction of the path length, plus the matching text-anchor. */
  startOffset: number;
  textAnchor: 'start' | 'middle' | 'end';
  rotationDeg: number;
  /** Conservative bounds of the rendered text after rotation, in box px. */
  bbox: {x: number; y: number; width: number; height: number};
  /** The same bounds before rotation (what a clip applied inside the rotated group should use). */
  unrotatedBbox: {x: number; y: number; width: number; height: number};
  shape: CurveShape;
  /** The text had to shrink to fit. */
  shrunk: boolean;
  /** Font size is at least `minFontSize`. */
  legible: boolean;
  /** Set by the CurvedText component when it replaced an illegible or clipped curve with a straight line. */
  usedFallback?: boolean;
  /** The bounds still leave the box at the smallest size tried: do not use this layout. */
  clipped: boolean;
};

const ASCENT = 0.82;
/** A bend (on the glyphs' side) whose radius is below this multiple of the font size squeezes the letters into each other (cap height ~0.72 em). */
const CROWDING = 2;
const DESCENT = 0.26;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const f = (n: number) => Math.round(n * 100) / 100;

export function measurerFor(options: Pick<CurvedTextOptions, 'font' | 'weight' | 'letterSpacing' | 'measure'>): LineMeasurer {
  if (options.measure) {
    return options.measure;
  }
  return (text, fontSize) => measureLine(text, fontSize, options.font ?? 'inter', options.weight ?? 700, options.letterSpacing ?? 0);
}

type Geometry = {
  pathD: string;
  pathLength: number;
  bounds: {minX: number; minY: number; maxX: number; maxY: number};
  glyphsOutside: boolean;
  /** Tightest bend of the path (px radius) on the side the glyphs stand on; Infinity when nothing bends them. Glyphs crumple when it is below ~their height. */
  crowdingRadius: number;
};

/** Circular segment through (x0,y) and (x1,y); sagitta = curvature * half-chord. */
function arcGeometry(chord: number, curvature: number, cx: number, cy: number, fontSize: number): Geometry {
  const half = chord / 2;
  const sag = Math.abs(curvature) * half;
  if (sag < 0.5) {
    return {pathD: `M ${f(cx - half)} ${f(cy)} L ${f(cx + half)} ${f(cy)}`, pathLength: chord, bounds: {minX: cx - half, maxX: cx + half, minY: cy, maxY: cy}, glyphsOutside: true, crowdingRadius: Infinity};
  }
  const radius = (half * half + sag * sag) / (2 * sag);
  const theta = 2 * Math.asin(clamp(half / radius, 0, 1));
  const arch = curvature > 0;
  // Large-arc only needed past a half circle, which curvature <= 1 never reaches.
  const pathD = `M ${f(cx - half)} ${f(cy)} A ${f(radius)} ${f(radius)} 0 0 ${arch ? 1 : 0} ${f(cx + half)} ${f(cy)}`;
  const minY = arch ? cy - sag : cy;
  const maxY = arch ? cy : cy + sag;
  return {pathD, pathLength: radius * theta, bounds: {minX: cx - half, maxX: cx + half, minY, maxY}, glyphsOutside: arch, crowdingRadius: arch ? Infinity : radius};
}

function circleGeometry(radius: number, cx: number, cy: number, startDeg: number, clockwise: boolean): Geometry {
  const at = (deg: number): Point => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return {x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad)};
  };
  const a = at(startDeg);
  const b = at(startDeg + 180);
  const sweep = clockwise ? 1 : 0;
  const pathD = `M ${f(a.x)} ${f(a.y)} A ${f(radius)} ${f(radius)} 0 1 ${sweep} ${f(b.x)} ${f(b.y)} A ${f(radius)} ${f(radius)} 0 1 ${sweep} ${f(a.x)} ${f(a.y)}`;
  return {pathD, pathLength: 2 * Math.PI * radius, bounds: {minX: cx - radius, maxX: cx + radius, minY: cy - radius, maxY: cy + radius}, glyphsOutside: clockwise, crowdingRadius: clockwise ? Infinity : radius};
}

/** Catmull-Rom through the points, as cubic Béziers, with the length measured by sampling. */
function pathGeometry(points: Point[]): Geometry {
  const pts = points.slice(0, 16);
  const segments: Array<[Point, Point, Point, Point]> = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    segments.push([p1, {x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6}, {x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6}, p2]);
  }
  let d = `M ${f(pts[0]!.x)} ${f(pts[0]!.y)}`;
  let length = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const samples: Point[] = [pts[0]!];
  for (const [a, c1, c2, b] of segments) {
    d += ` C ${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(b.x)} ${f(b.y)}`;
    let prev = a;
    for (let s = 1; s <= 24; s++) {
      const t = s / 24;
      const u = 1 - t;
      const x = u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x;
      const y = u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y;
      length += Math.hypot(x - prev.x, y - prev.y);
      samples.push({x, y});
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      prev = {x, y};
    }
  }
  // Smallest circumradius over sample triples spaced about a glyph apart: a bend tighter than the glyphs are tall folds the letters into each other.
  let crowdingRadius = Infinity;
  const stride = 2;
  for (let i = stride; i < samples.length - stride; i++) {
    const p = samples[i - stride]!;
    const q = samples[i]!;
    const r = samples[i + stride]!;
    const a = Math.hypot(q.x - p.x, q.y - p.y);
    const b = Math.hypot(r.x - q.x, r.y - q.y);
    const c = Math.hypot(r.x - p.x, r.y - p.y);
    const area2 = Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    if (area2 > 1e-6) {
      crowdingRadius = Math.min(crowdingRadius, (a * b * c) / (2 * area2));
    }
  }
  return {pathD: d, pathLength: length, bounds: {minX, minY, maxX, maxY}, glyphsOutside: true, crowdingRadius};
}

function rotatedBounds(b: {x: number; y: number; width: number; height: number}, deg: number, cx: number, cy: number) {
  if (!deg) {
    return b;
  }
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]] as const) {
    xs.push(cx + (x - cx) * cos - (y - cy) * sin);
    ys.push(cy + (x - cx) * sin + (y - cy) * cos);
  }
  return {x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys)};
}

export function layoutCurvedText(options: CurvedTextOptions): CurvedTextLayout {
  const {width, height, shape = 'arc', align = 'center', margin = 24, rotationDeg = 0, minFontSize = 28} = options;
  const text = options.uppercase ? options.text.toUpperCase() : options.text.trim();
  const measure = measurerFor(options);
  const maxFont = options.fontSize ?? 96;
  const cx = width / 2;
  const cy = height / 2;
  const innerW = Math.max(1, width - 2 * margin);
  const innerH = Math.max(1, height - 2 * margin);
  const spacingEm = options.letterSpacing ?? 0;

  let best: CurvedTextLayout | null = null;
  // Each step shrinks the type and, with it, the curve's footprint; stop at the first layout that fits the box and the path.
  for (let fontSize = maxFont, step = 0; step < 60; step++, fontSize = f(fontSize * 0.95)) {
        const textLength = measure(text, fontSize);
    let geometry: Geometry;
    if (shape === 'circle') {
      const clockwise = options.direction !== 'counterclockwise';
      const ring = options.radius ?? Math.min(innerW, innerH) / 2 - (clockwise ? fontSize * ASCENT : fontSize * DESCENT);
      const radius = Math.max(8, ring);
      const angle = options.angleDeg ?? 0;
      geometry = circleGeometry(radius, cx, cy, align === 'center' ? angle + 180 : angle, clockwise);
    } else if (shape === 'path') {
      const points = (options.points ?? []).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
      geometry = pathGeometry(points.length >= 2 ? points : [{x: margin, y: cy}, {x: width - margin, y: cy}]);
    } else {
      const curvature = clamp(options.curvature ?? 0.35, -1, 1);
      const chord = Math.min(innerW, Math.max(textLength / 0.92, 1));
      // Vertically centre the arc plus its glyphs in the box.
      const sag = Math.abs(curvature) * (chord / 2);
      const arch = curvature > 0;
      const top = (arch ? sag : 0) + fontSize * ASCENT;
      const bottom = (arch ? 0 : sag) + fontSize * DESCENT;
      const chordY = cy - (top + bottom) / 2 + top;
      geometry = arcGeometry(chord, curvature, cx, chordY, fontSize);
    }
    // Circle: only the outer side matters. Arc: glyphs always stand above the path (ascent above, descent below). Path: either side, so the larger pad.
    const pad = fontSize * (shape === 'circle' ? (geometry.glyphsOutside ? ASCENT : DESCENT) : ASCENT);
    const padIn = fontSize * (shape === 'path' ? ASCENT : DESCENT);
    const b = geometry.bounds;
    // A ring's glyphs extend outward on every side by the outer pad only; an arc or path has glyphs on one side of the curve.
    const raw =
      shape === 'circle'
        ? {x: b.minX - pad, y: b.minY - pad, width: b.maxX - b.minX + 2 * pad, height: b.maxY - b.minY + 2 * pad}
        : {
            x: b.minX - fontSize * 0.1,
            y: b.minY - pad,
            width: b.maxX - b.minX + fontSize * 0.2,
            height: b.maxY - b.minY + pad + padIn,
          };
    const bbox = rotatedBounds(raw, rotationDeg, cx, cy);
    const fitsBox = bbox.x >= margin - 0.5 && bbox.y >= margin - 0.5 && bbox.x + bbox.width <= width - margin + 0.5 && bbox.y + bbox.height <= height - margin + 0.5;
    const fitsPath = textLength <= geometry.pathLength * 0.98;
    const startOffset = align === 'start' ? 0 : align === 'end' ? 1 : 0.5;
    const candidate: CurvedTextLayout = {
      pathD: geometry.pathD,
      pathLength: geometry.pathLength,
      text,
      fontSize,
      letterSpacingPx: spacingEm * fontSize,
      textLength,
      startOffset,
      textAnchor: align === 'start' ? 'start' : align === 'end' ? 'end' : 'middle',
      rotationDeg,
      bbox: {x: f(bbox.x), y: f(bbox.y), width: f(bbox.width), height: f(bbox.height)},
      unrotatedBbox: {x: f(raw.x), y: f(raw.y), width: f(raw.width), height: f(raw.height)},
      shape,
      shrunk: fontSize < maxFont,
      legible: fontSize >= minFontSize && geometry.crowdingRadius >= fontSize * CROWDING,
      clipped: !fitsBox || !fitsPath,
    };
    best = candidate;
    if (fitsBox && fitsPath && geometry.crowdingRadius >= fontSize * CROWDING) {
      break;
    }
    if (fontSize <= 8) {
      break;
    }
  }
  return best!;
}
