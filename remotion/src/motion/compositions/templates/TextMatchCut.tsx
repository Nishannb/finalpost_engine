import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';

import {
  MATCH_CUT_SPECS,
  applyKeywordCase,
  fillFromPool,
  planMatchCutScenes,
  pushInScale,
  sceneAt,
  type BlurClass,
  type MatchCutVariant,
  type MatchDecor,
  type MatchFont,
  type MatchRow,
} from '../../../lib/textMatchCut';
import type {SafeArea} from '../../layout';

export type TypeTextMatchCutProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The one spoken word (1-2 words, <= 12 chars) that persists in the highlight box across every scene. */
  keyword?: string;
  /** A second spoken keyword: the keyword swaps at the midpoint while the layout family repeats (T1 grammar). */
  swapKeyword?: string;
  /** The spoken sentence around the keyword. Every other glyph on screen is cycled from these words (cropped + blurred, not meant to be read). */
  phrase?: string;
  before?: string;
  after?: string;
  variant?: MatchCutVariant;
  durationInFrames?: number;
};

const FONT_STACK: Record<MatchFont, string> = {
  mono: "'Courier Prime','Cutive Mono','Courier New',Courier,monospace",
  serif: "'Source Serif 4','Playfair Display','Libre Caslon Text',Georgia,'Times New Roman',serif",
  sans: "'Plus Jakarta Sans','Archivo Black','Inter','Helvetica Neue',Arial,sans-serif",
  script: "'Pinyon Script','Great Vibes','Snell Roundhand','Apple Chancery',cursive",
};
const BLUR_PX = (cls: BlurClass, width: number) => [0, width * 0.0022, width * 0.0068, width * 0.0045][cls]!;
const GLYPH_W: Record<MatchFont, number> = {mono: 0.6, serif: 0.5, sans: 0.58, script: 0.4};
const words = (s: string | undefined) => (s ?? '').split(/\s+/).filter(Boolean);

const DEMO = 'the moment you notice it everything changes';

const Decor: React.FC<{d: MatchDecor; width: number; height: number; ay: number; F: number; ink: string}> = ({d, width, height, ay, F, ink}) => {
  if (d.kind === 'bar') return <div style={{position: 'absolute', left: 0, right: 0, top: d.y0 * height, height: (d.y1 - d.y0) * height, backgroundColor: d.color}} />;
  if (d.kind === 'rule') return <div style={{position: 'absolute', left: d.x0 * width, width: (d.x1 - d.x0) * width, top: ay * height + d.dy * F, height: Math.max(2, F * (d.thick ?? 2) * 0.05), backgroundColor: ink, opacity: 0.8}} />;
  const dot = Math.max(5, F * 0.16);
  return (
    <div
      style={{
        position: 'absolute',
        left: -width * 0.05,
        right: -width * 0.05,
        top: d.y0 * height,
        height: (d.y1 - d.y0) * height,
        backgroundImage: `radial-gradient(circle at center, #4a4a4a 0 ${dot * 0.32}px, transparent ${dot * 0.36}px), linear-gradient(115deg, #8d8d8d, #cfcfcf 55%, #6e6e6e)`,
        backgroundSize: `${dot}px ${dot}px, 100% 100%`,
        backgroundBlendMode: 'multiply',
        filter: `grayscale(1) blur(${d.blur * (width / 1080)}px)`,
        opacity: 0.5,
      }}
    />
  );
};

/**
 * TEXT MATCH CUT (kinetic_text, full-frame, hard cuts only; silent). One spoken keyword stays locked inside a sharp highlight box at a fixed anchor while the whole layout (typeface, scale, rotation, background) is replaced
 * on every cut. Surrounding type is the speaker's own words, cropped by the frame and blurred by distance. Three grammars: memo (T1, mono/serif/sans, static), editorial (T2, linear 1.00 -> 1.14 push-in), newsprint (T3, per-cut background tint).
 */
export const TypeTextMatchCut: React.FC<TypeTextMatchCutProps> = ({width, height, keyword, swapKeyword, phrase, before, after, variant, durationInFrames}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const fps = cfg.fps;
  const spec = MATCH_CUT_SPECS[variant ?? 'memo'];
  const kw = (keyword?.trim() || 'Intelligence').slice(0, 14);
  const swap = swapKeyword?.trim() ? swapKeyword.trim().slice(0, 14) : undefined;
  const pool = words(phrase).length > 0 ? words(phrase) : words(DEMO);
  const beforeWords = words(before).length > 0 ? words(before) : pool.slice(0, Math.max(1, Math.ceil(pool.length / 2)));
  const afterWords = words(after).length > 0 ? words(after) : pool.slice(Math.floor(pool.length / 2));
  const durSec = (durationInFrames && durationInFrames > 0 ? durationInFrames : cfg.durationInFrames) / fps;
  const scenes = React.useMemo(() => planMatchCutScenes({variant: spec.id, durSec, fps, keyword: kw, swap}), [spec.id, durSec, fps, kw, swap]);
  const {scene, progress} = sceneAt(scenes, spec.id, fps, frame);
  const layout = spec.layouts[scene.layoutId]!;
  const F = width * 0.06;
  const ax = scene.anchor.x * width;
  const ay = scene.anchor.y * height;
  const scale = pushInScale(spec.id, progress);
  const ink = spec.ink;
  const repeatTo = (ws: readonly string[], minChars: number) => {
    let s = ws.join(' ');
    while (s.length < minChars && ws.length > 0) s = `${s} ${ws.join(' ')}`;
    return s;
  };

  const renderRow = (row: MatchRow, i: number) => {
    const fam = FONT_STACK[row.font];
    const px = row.size * F;
    const blur = BLUR_PX(row.blur ?? 0, width);
    const common: React.CSSProperties = {fontFamily: fam, fontWeight: row.weight ?? (row.font === 'mono' ? 400 : row.font === 'script' ? 400 : 500), fontStyle: row.italic ? 'italic' : 'normal', letterSpacing: row.tracking ? `${row.tracking}em` : undefined, lineHeight: 1.05, whiteSpace: 'nowrap'};
    if (row.kind === 'kw') {
      const shown = applyKeywordCase(scene.keyword, row.kwCase);
      const fit = Math.min(px, (width * 0.8) / (Math.max(4, shown.length + 1) * GLYPH_W[row.font] * 1.1));
      const [padX, padY] = spec.keyword.padEm;
      const ctxPx = fit * 0.92;
      const minChars = Math.ceil(width / (ctxPx * GLYPH_W[row.font])) + 6;
      const side: React.CSSProperties = {...common, position: 'absolute', top: '50%', fontSize: ctxPx, color: ink, opacity: 0.72, filter: `blur(${BLUR_PX(1, width)}px)`, fontWeight: row.font === 'sans' ? 700 : common.fontWeight};
      return (
        <div key={i} style={{position: 'absolute', left: ax, top: ay + row.dy * F, transform: 'translate(-50%, -50%)'}}>
          <span style={{...side, right: '100%', marginRight: fit * 0.35, transform: 'translateY(-50%)'}}>{repeatTo(beforeWords, minChars)}</span>
          <span style={{...side, left: '100%', marginLeft: fit * 0.35, transform: 'translateY(-50%)'}}>{repeatTo(afterWords, minChars)}</span>
          <span style={{...common, display: 'block', fontSize: fit, backgroundColor: spec.keyword.bg, color: spec.keyword.fg, padding: `${padY}em ${padX}em`, borderRadius: 0, fontWeight: row.weight ?? (row.font === 'sans' ? 800 : row.font === 'mono' ? 700 : 600)}}>{shown}</span>
        </div>
      );
    }
    const x = (row.x ?? 0.5) * width;
    const wrap: React.CSSProperties = {position: 'absolute', left: x, top: ay + row.dy * F, transform: `translate(-50%, -50%) rotate(${row.rot ?? 0}deg)`, opacity: row.opacity ?? 1};
    const smear: React.CSSProperties = row.blur === 3 ? {textShadow: `${width * 0.022}px 0 0 ${ink}55, ${-width * 0.022}px 0 0 ${ink}55`} : {};
    if (row.kind === 'block') {
      const text = fillFromPool(pool, row.from ?? 0, {minChars: 170});
      return (
        <div key={i} style={{...wrap, width: (row.blockW ?? 0.4) * width, textAlign: 'justify'}}>
          <div style={{...common, whiteSpace: 'normal', fontSize: px, lineHeight: 1.22, color: ink, filter: `blur(${BLUR_PX(row.blur ?? 2, width)}px)`}}>{text}</div>
        </div>
      );
    }
    const minChars = Math.ceil(width / (px * GLYPH_W[row.font])) + 8;
    let text = fillFromPool(pool, row.from ?? 0, {words: row.words, minChars});
    if (row.caps) text = text.toUpperCase();
    return (
      <div key={i} style={wrap}>
        <div style={{...common, fontSize: px, color: ink, filter: blur > 0 ? `blur(${blur}px)` : undefined, ...smear}}>{text}</div>
      </div>
    );
  };

  const vignette = spec.background.vignette;
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: scene.bg}}>
      <div style={{position: 'absolute', inset: 0, transform: `scale(${scale})`, transformOrigin: `${ax}px ${ay}px`}}>
        {layout.decor?.map((d, i) => <Decor key={i} d={d} width={width} height={height} ay={scene.anchor.y} F={F} ink={ink} />)}
        {layout.rows.map(renderRow)}
      </div>
      {/* paper tone: soft vignette + faint fibre noise (multiply). Both layers are multiply at low strength, so the highlight colour is only grained, never washed out. */}
      <div style={{position: 'absolute', inset: 0, background: `radial-gradient(ellipse at center, rgba(255,255,255,0) 45%, rgba(0,0,0,${vignette}) 100%)`, pointerEvents: 'none', mixBlendMode: 'multiply'}} />
      <svg width={width} height={height} style={{position: 'absolute', inset: 0, opacity: 0.1, mixBlendMode: 'multiply', pointerEvents: 'none'}}>
        <filter id={`mc-noise-${spec.id}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={scene.index + 3} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#mc-noise-${spec.id})`} />
      </svg>
    </div>
  );
};
