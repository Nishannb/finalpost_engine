import React from 'react';

import {
  TYPEWRITER_BAR_FULL_W,
  TYPEWRITER_BASE_SEC,
  TYPEWRITER_COLORS,
  TYPEWRITER_DEFAULT_LINES,
  TYPEWRITER_LINE_START_SEC,
  typewriterBarExpand,
  typewriterBlockY,
  typewriterCps,
  typewriterMark,
  typewriterChars,
} from '../../../lib/motionTemplateTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {useTemplateClock} from './useTemplateClock';

export type TypewriterPosterProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** Two or three lines (placeholders; bound from speech). A leading ◔ draws the dotted clock icon. */
  lines?: string[];
  /** Text + bar + mark colour (default #B1DDFF). */
  accent?: string;
  /** Ground colour (default #003BD6). */
  ground?: string;
  /** Optional still/SVG that replaces the default tone-on-tone 3D mark (https asset when personalized). */
  markSrc?: string;
  /** Footer copy (demo only; live polish hides with `hideFooter`). */
  footerLeft?: string;
  footerRight?: string;
  /** Hide the footer (live polish). */
  hideFooter?: boolean;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_FOOTER_LEFT = '✧ Brand';
const DEFAULT_FOOTER_RIGHT = 'Save your spot — Link in bio';
const CLOCK = '◔';
const STAR = '✧';

const Clock: React.FC<{size: number}> = ({size}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{display: 'inline-block', verticalAlign: '-0.1em'}} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <circle cx={12} cy={12} r={10} strokeDasharray="0.1 4.2" strokeWidth={3} />
    <path d="M12 6v6l4 2" />
  </svg>
);

const Star: React.FC<{size: number}> = ({size}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{display: 'inline-block', verticalAlign: '-0.12em'}} fill="currentColor">
    <path d="M12 1c.8 6.4 4.6 10.2 11 11-6.4.8-10.2 4.6-11 11-.8-6.4-4.6-10.2-11-11C7.4 11.2 11.2 7.4 12 1z" />
  </svg>
);

/** Characters of `text`, with the clock / star glyphs drawn as icons (the font has neither). */
const glyphs = (text: string, size: number, keyPrefix: string): React.ReactNode[] =>
  Array.from(text).map((ch, i) => (ch === CLOCK ? <Clock key={`${keyPrefix}${i}`} size={size * 0.85} /> : ch === STAR ? <Star key={`${keyPrefix}${i}`} size={size * 0.85} /> : <React.Fragment key={`${keyPrefix}${i}`}>{ch}</React.Fragment>));

/** CSS/SVG stand-in for the default extruded mark: X + four cylinders (no WebGL), tone-on-tone with the ground. */
const ToneMark: React.FC<{size: number; opacity: number; outline: number; rotateDeg: number; tone: string; rim: string}> = ({size, opacity, outline, rotateDeg, tone, rim}) => {
  const layers = 14;
  const depth = size * 0.16;
  const bar = {width: size * 0.2, height: size * 0.92, borderRadius: size * 0.04};
  const disc = size * 0.2;
  const fillAlpha = 1 - outline;
  const layer = (z: number, key: string, last: boolean) => (
    <div key={key} style={{position: 'absolute', inset: 0, transform: `translateZ(${z}px)`, transformStyle: 'preserve-3d'}}>
      {[45, -45].map(deg => (
        <div key={deg} style={{position: 'absolute', left: size / 2 - bar.width / 2, top: size / 2 - bar.height / 2, ...bar, transform: `rotate(${deg}deg)`, backgroundColor: tone, opacity: fillAlpha, border: last || outline > 0 ? `${Math.max(2, size * 0.006)}px solid ${rim}` : undefined, boxSizing: 'border-box'}} />
      ))}
      {[
        [0.5, 0.1],
        [0.5, 0.9],
        [0.1, 0.5],
        [0.9, 0.5],
      ].map(([cx, cy], i) => (
        <div key={`c${i}`} style={{position: 'absolute', left: cx! * size - disc / 2, top: cy! * size - disc / 2, width: disc, height: disc, borderRadius: '50%', backgroundColor: tone, opacity: fillAlpha, border: last || outline > 0 ? `${Math.max(2, size * 0.006)}px solid ${rim}` : undefined, boxSizing: 'border-box'}} />
      ))}
    </div>
  );
  return (
    <div style={{width: size, height: size, opacity, perspective: size * 3}}>
      <div style={{position: 'relative', width: size, height: size, transformStyle: 'preserve-3d', transform: `rotateX(-14deg) rotateY(${rotateDeg}deg)`}}>
        {Array.from({length: layers}, (_, i) => layer((i / (layers - 1) - 0.5) * depth, `l${i}`, i === 0 || i === layers - 1))}
      </div>
    </div>
  );
};

/**
 * CLIP_21 TYPEWRITER POSTER (WP50 Layer 2 / Part 4): placeholder lines type with a caret; the bar above line 1 tracks typed width then widens; the block rises; a replaceable mark
 * (default tone-on-tone 3D stand-in, or `markSrc`) fades in, rotates, then fill → outline. Silent.
 */
export const TypewriterPoster: React.FC<TypewriterPosterProps> = ({width, height, lines, accent, ground, markSrc, footerLeft, footerRight, hideFooter = false, durationInFrames}) => {
  const {t} = useTemplateClock(TYPEWRITER_BASE_SEC, durationInFrames);
  const ink = accent && HEX.test(accent) ? accent : TYPEWRITER_COLORS.ink;
  const bg = ground && HEX.test(ground) ? ground : TYPEWRITER_COLORS.ground;
  const copy = (lines && lines.length >= 2 ? lines.slice(0, 3) : [...TYPEWRITER_DEFAULT_LINES]) as string[];
  const blockW = width * TYPEWRITER_BAR_FULL_W;
  const expand = typewriterBarExpand(t);
  const mark = typewriterMark(t);
  const blink = Math.floor(t / 0.5) % 2 === 0;
  const lastIndex = copy.length - 1;

  const sizes = copy.map((line, i) => Math.min(width * (i === 0 ? 0.115 : 0.085), (blockW * 0.96) / Math.max(1, Array.from(line).length * 0.6)));
  const caret = (size: number) => (
    <span style={{display: 'inline-block', position: 'relative', width: 0, height: '1em'}}>
      <span style={{position: 'absolute', left: size * 0.04, top: size * 0.06, width: Math.max(3, size * 0.05), height: size * 0.9, backgroundColor: ink}} />
    </span>
  );

  const lineEls = copy.map((line, i) => {
    const total = Array.from(line).length;
    const start = TYPEWRITER_LINE_START_SEC[i]!;
    const count = typewriterChars(t, start, typewriterCps(i, total), total);
    if (t < start) return <div key={`line${i}`} style={{height: sizes[i]! * 1.25}} />;
    const chars = Array.from(line);
    const typed = chars.slice(0, count).join('');
    const rest = chars.slice(count).join('');
    const typing = count < total;
    const showCaret = typing || (i === lastIndex && t >= start && blink);
    const size = sizes[i]!;
    const grow = i === 0;
    const body = (
      <span style={{whiteSpace: 'pre'}}>
        {i === 0 ? (
          <span style={{position: 'relative', display: 'inline-block'}}>
            {glyphs(typed, size, 't')}
            {showCaret && caret(size)}
            <span style={{position: 'absolute', left: '50%', bottom: '100%', marginBottom: size * 0.16, height: Math.max(4, size * 0.07), width: `calc(${(1 - expand) * 100}% + ${expand * blockW}px)`, transform: 'translateX(-50%)', backgroundColor: ink}} />
          </span>
        ) : (
          <>
            {glyphs(typed, size, 't')}
            {showCaret && caret(size)}
            <span style={{color: 'transparent'}}>{glyphs(rest, size, 'r')}</span>
          </>
        )}
      </span>
    );
    return (
      <div key={`line${i}`} style={{height: size * 1.25, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: size, lineHeight: 1, fontWeight: 700, letterSpacing: -size * 0.01}}>
        {grow && count === 0 ? caret(size) : body}
      </div>
    );
  });

  const markSize = width * 0.62;
  const footerSize = width * 0.028;
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: bg, color: ink, fontFamily: fontFamily('space_grotesk')}}>
      <div style={{position: 'absolute', left: (width - blockW) / 2, width: blockW, top: typewriterBlockY(t) * height + sizes[0]! * 0.4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: sizes[1]! * 0.25}}>{lineEls}</div>
      {mark.fadeIn > 0 && (
        <div style={{position: 'absolute', left: (width - markSize) / 2, top: height * 0.5, display: 'flex', justifyContent: 'center'}}>
          {markSrc ? (
            <div style={{width: markSize, height: markSize, opacity: mark.fadeIn, transform: `rotateY(${mark.rotateDeg}deg)`, transformStyle: 'preserve-3d'}}>
              <img src={markSrc} alt="" style={{width: '100%', height: '100%', objectFit: 'contain', opacity: 1 - mark.outline * 0.35}} />
            </div>
          ) : (
            <ToneMark size={markSize} opacity={mark.fadeIn} outline={mark.outline} rotateDeg={mark.rotateDeg} tone={mixHex(bg, ink, 0.14)} rim={mixHex(bg, ink, 0.4)} />
          )}
        </div>
      )}
      {!hideFooter && (
        <div style={{position: 'absolute', left: width * 0.05, right: width * 0.05, bottom: height * 0.04, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: footerSize, fontWeight: 500}}>
          <span>{glyphs(footerLeft ?? DEFAULT_FOOTER_LEFT, footerSize, 'fl')}</span>
          <span>{glyphs(footerRight ?? DEFAULT_FOOTER_RIGHT, footerSize, 'fr')}</span>
        </div>
      )}
    </div>
  );
};

function mixHex(a: string, b: string, amount: number): string {
  const ch = (hex: string, k: number) => parseInt(hex.slice(1 + k * 2, 3 + k * 2), 16);
  const out = [0, 1, 2].map(k => Math.round(ch(a, k) + (ch(b, k) - ch(a, k)) * amount));
  return `#${out.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}
