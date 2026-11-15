/**
 * SUBJECT STAGE Phase 5.24: the designed editorial treatments. Pure drawing of decisions made on the server (server/src/stages/subjectStage/stageDesign.ts): every rect is a
 * composition fraction in the SAME coordinate system as the speaker / matte / foreground (the full output frame), so nothing here re-decides placement or safety.
 *
 *   EditorialSet        S1 "Set", behind the person: a ground derived from the footage's plate, a quiet grain, a chapter index + hairline, and the chapter headline (display face)
 *   ChapterTab          S1 on tight framing: the room stays (graded); a compact front tab below the face with the index and the headline
 *   SourceCard          S2: a paper quote card (serif quotation, accent glyph, optional attribution); spoken words ink in with an accent marker when the words are timed, static otherwise
 *   StageCutaway        the stage's own full-screen B-roll (image: a slow push; video: muted), hard cut or dip in / out
 *
 * Motion is deliberately small: one entrance (12-16 frames), an almost still hold, a short exit. Nothing moves the person.
 */
import React from 'react';
import {AbsoluteFill, Img, OffthreadVideo, interpolate, useVideoConfig} from 'remotion';

import type {SubjectStageCutaway, SubjectStageDesign, SubjectStageLook} from '../../blueprintSchema';
import {FONT_STACK, useKineticFonts} from '../../kinetic/fonts';
import {isStillMediaSrc, resolveMediaSrc} from '../../lib/mediaSrc';

type SetDesign = Extract<SubjectStageDesign, {kind: 'set'}>;
type CardDesign = Extract<SubjectStageDesign, {kind: 'source_card'}>;
type Box = {x: number; y: number; w: number; h: number};

/** The look used when a payload carries designs but no look (never produced by the server; a safe neutral). */
export const FALLBACK_LOOK: SubjectStageLook = {tone: 'light', ground: '#ECE9E3', groundEdge: '#D8D3CA', ink: '#17150F', inkSoft: '#5B564D', accent: '#D2462F', paper: '#F5F2EC', paperInk: '#16130E', fonts: {display: 'anton', serif: 'playfair', text: 'inter'}};

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const enterP = (frame: number, from: number, dur: number) => ease((frame - from) / dur);
const exitP = (frame: number, total: number, dur: number) => ease((total - frame) / dur);
const px = (b: Box, W: number, H: number) => ({left: b.x * W, top: b.y * H, width: b.w * W, height: b.h * H});

/** A still, very fine paper / film grain (SVG noise), multiplied at a low opacity. Static on purpose (no shimmer). */
const Grain: React.FC<{opacity: number; id: string}> = ({opacity, id}) => (
  <svg width="100%" height="100%" style={{position: 'absolute', inset: 0, opacity, mixBlendMode: 'multiply', pointerEvents: 'none'}}>
    <filter id={id}>
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={7} stitchTiles="stitch" />
      <feColorMatrix type="saturate" values="0" />
    </filter>
    <rect width="100%" height="100%" filter={`url(#${id})`} />
  </svg>
);

const Kicker: React.FC<{look: SubjectStageLook; index: string; height: number; size: number; frame: number; color: string}> = ({look, index, size, frame, color}) => {
  const draw = enterP(frame, 2, 14);
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: size * 0.7, opacity: enterP(frame, 0, 8)}}>
      <span style={{fontFamily: FONT_STACK[look.fonts.text], fontWeight: 700, fontSize: size, letterSpacing: '0.18em', color: look.accent}}>{index}</span>
      <span style={{display: 'block', height: Math.max(1, size * 0.09), width: size * 5 * draw, background: color, opacity: 0.6}} />
    </div>
  );
};

/** S1 "Set" (behind the person): the ground + the chapter headline. `frame` / `total` are span-local frames. */
export const EditorialSet: React.FC<{design: SetDesign; look?: SubjectStageLook; subject?: {box: Box} | undefined; frame: number; total: number}> = ({design, look: lookIn, subject, frame, total}) => {
  useKineticFonts();
  const look = lookIn ?? FALLBACK_LOOK;
  const {width: W, height: H} = useVideoConfig();
  const cx = subject ? (subject.box.x + subject.box.w / 2) * 100 : 50;
  const cy = subject ? (subject.box.y + subject.box.h * 0.35) * 100 : 45;
  // the ground opens from the person outward (she is drawn over it, so it reads as the room changing around her)
  const reveal = enterP(frame, 0, 14);
  const radius = 160 * reveal;
  const h = design.headline;
  const size = h.sizeFrac * H;
  const r = px(h.rect, W, H);
  const out = exitP(frame, total, 6);
  const drift = interpolate(frame, [0, Math.max(1, total)], [1, 1.018], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{clipPath: `circle(${radius}% at ${cx}% ${cy}%)`}}>
      <AbsoluteFill style={{background: `radial-gradient(ellipse 85% 70% at ${cx}% ${cy}%, ${look.ground} 0%, ${look.ground} 45%, ${look.groundEdge} 100%)`}} />
      <Grain opacity={look.tone === 'light' ? 0.07 : 0.12} id={`set-grain-${Math.round(h.rect.x * 1000)}`} />
      <div style={{position: 'absolute', left: r.left, top: r.top - TYPE_KICKER * H * 2.4, width: r.width, display: 'flex', justifyContent: h.align === 'center' ? 'center' : h.align === 'right' ? 'flex-end' : 'flex-start'}}>
        <Kicker look={look} index={design.kicker} height={H} size={TYPE_KICKER * H} frame={frame} color={look.inkSoft} />
      </div>
      <div style={{position: 'absolute', ...r, display: 'flex', flexDirection: 'column', alignItems: h.align === 'center' ? 'center' : h.align === 'right' ? 'flex-end' : 'flex-start', transform: `scale(${drift})`, transformOrigin: '50% 100%', opacity: out}}>
        {h.lines.map((line, i) => {
          const p = enterP(frame, 6 + i * 4, 12);
          return (
            <div key={i} style={{fontFamily: FONT_STACK[look.fonts.display], fontSize: size, lineHeight: 0.98, letterSpacing: `${0.005 + (1 - p) * 0.04}em`, color: look.ink, whiteSpace: 'nowrap', opacity: p, transform: `translateY(${(1 - p) * size * 0.25}px)`, textShadow: `0 ${size * 0.035}px ${size * 0.06}px ${look.groundEdge}`}}>
              {line}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const TYPE_KICKER = 0.016;

/** S1 on tight framing: a compact FRONT tab below the face. The room itself stays (graded by ShortVideo). */
export const ChapterTab: React.FC<{design: SetDesign; look?: SubjectStageLook; frame: number; total: number}> = ({design, look: lookIn, frame, total}) => {
  useKineticFonts();
  const look = lookIn ?? FALLBACK_LOOK;
  const {width: W, height: H} = useVideoConfig();
  const h = design.headline;
  const size = h.sizeFrac * H;
  const r = px(h.rect, W, H);
  const p = enterP(frame, 0, 12);
  const out = exitP(frame, total, 6);
  const pad = size * 0.32;
  return (
    <div style={{position: 'absolute', left: r.left - pad, top: r.top - pad - TYPE_KICKER * H * 1.9, opacity: Math.min(p, out), transform: `translateX(${(1 - p) * -0.06 * W}px)`}}>
      <div style={{display: 'inline-flex', flexDirection: 'column', gap: size * 0.12, padding: pad, paddingLeft: pad * 1.4, background: `${look.ground}E6`, borderLeft: `${Math.max(3, size * 0.08)}px solid ${look.accent}`, boxShadow: '0 4px 14px rgba(0,0,0,0.18)'}}>
        <span style={{fontFamily: FONT_STACK[look.fonts.text], fontWeight: 700, fontSize: TYPE_KICKER * H, letterSpacing: '0.2em', color: look.accent}}>{design.kicker}</span>
        {h.lines.map((line, i) => (
          <span key={i} style={{fontFamily: FONT_STACK[look.fonts.display], fontSize: size, lineHeight: 0.98, color: look.ink, whiteSpace: 'nowrap'}}>{line}</span>
        ))}
      </div>
    </div>
  );
};

/** S2 "Source card". `t` = output seconds (the word timings are output seconds); `frame` / `total` = span-local frames. */
export const SourceCard: React.FC<{design: CardDesign; look?: SubjectStageLook; t: number; frame: number; total: number}> = ({design, look: lookIn, t, frame, total}) => {
  useKineticFonts();
  const look = lookIn ?? FALLBACK_LOOK;
  const {width: W, height: H} = useVideoConfig();
  const card = px(design.card, W, H);
  const text = px(design.textRect, W, H);
  const size = design.sizeFrac * H;
  // entrance: a short rise from the side of the person while the shadow deepens (the card "lands"); exit: a slight lift and fade. No loop, no bounce.
  const p = enterP(frame, 0, 18);
  const out = exitP(frame, total, 10);
  const dir = design.side === 'left' ? -1 : design.side === 'right' ? 1 : 0;
  const tilt = design.tiltDeg + (1 - p) * 1.2 * (dir || 1);
  const dx = (1 - p) * 0.03 * W * -dir;
  const dy = (dir === 0 ? (1 - p) * 0.022 * H : 0) - (1 - out) * 0.008 * H;
  const push = interpolate(frame, [0, Math.max(1, total)], [1, 1.012], {extrapolateRight: 'clamp'});
  const depth = 0.35 + 0.65 * p;
  const words = design.words;
  let wi = 0;
  return (
    <div style={{position: 'absolute', ...card, opacity: Math.min(p, out), transform: `translate(${dx}px, ${dy}px) rotate(${tilt}deg) scale(${push})`, transformOrigin: '50% 50%'}}>
      <div style={{position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${look.paper} 0%, ${look.paper} 70%, rgba(0,0,0,0.025) 100%), ${look.paper}`, borderRadius: W * 0.005, boxShadow: `0 ${H * 0.016 * depth}px ${H * 0.034 * depth}px rgba(0,0,0,${0.26 * depth}), 0 ${H * 0.002}px ${H * 0.005}px rgba(0,0,0,0.16), inset 0 0 0 1px rgba(0,0,0,0.06)`, overflow: 'hidden'}}>
        <Grain opacity={0.05} id={`card-grain-${Math.round(design.card.x * 1000)}`} />
        <div style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: Math.max(4, W * 0.005), background: look.accent}} />
      </div>
      {/* hanging punctuation: the opening mark sits OUTSIDE the text measure, so the quote's first letter aligns with the other lines */}
      <div style={{position: 'absolute', left: text.left - card.left - size * 0.62, top: (text.top - card.top) - size * 1.18, fontFamily: FONT_STACK.playfairItalic, fontStyle: 'italic', fontWeight: 700, fontSize: size * 2.3, lineHeight: 1, color: look.accent}}>“</div>
      <div style={{position: 'absolute', left: text.left - card.left, top: text.top - card.top, width: text.width, fontFamily: FONT_STACK[look.fonts.serif], fontWeight: 400, fontSize: size, lineHeight: 1.24, letterSpacing: '-0.005em', color: look.paperInk}}>
        {design.lines.map((line, li) => (
          <div key={li} style={{whiteSpace: 'nowrap'}}>
            {line.split(' ').map((token, k) => {
              const w = words ? words[wi] : undefined;
              wi += 1;
              // timed: a word inks in when it is spoken, with an accent marker sweeping under it; static: every word in full ink
              const spoken = w ? interpolate(t, [w.start, Math.max(w.start + 0.04, w.end)], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) : 1;
              const inkOpacity = words ? 0.38 + 0.62 * spoken : 1;
              return (
                <span key={k} style={{position: 'relative', opacity: inkOpacity}}>
                  {words ? <span style={{position: 'absolute', left: 0, bottom: size * 0.04, height: size * 0.32, width: `${spoken * 100}%`, background: look.accent, opacity: 0.28}} /> : null}
                  <span style={{position: 'relative'}}>{token}</span>
                  {k < line.split(' ').length - 1 ? ' ' : ''}
                </span>
              );
            })}
          </div>
        ))}
        {design.attribution ? (
          <div style={{marginTop: size * 0.55, fontFamily: FONT_STACK[look.fonts.text], fontWeight: 600, fontSize: H * 0.017, letterSpacing: '0.16em', textTransform: 'uppercase', color: look.paperInk, opacity: 0.7}}>— {design.attribution}</div>
        ) : null}
      </div>
    </div>
  );
};

/** The stage's own full-screen cutaway. `t` = seconds since the cutaway started. */
export const StageCutaway: React.FC<{cutaway: SubjectStageCutaway; t: number; look?: SubjectStageLook}> = ({cutaway, t, look}) => {
  const dur = cutaway.end - cutaway.start;
  const src = resolveMediaSrc(cutaway.assetUrl);
  if (!src) return null;
  const dipIn = cutaway.enter === 'dip' ? interpolate(t, [0, 0.15], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) : 0;
  const dipOut = cutaway.exit === 'dip' ? interpolate(t, [dur - 0.15, dur], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) : 0;
  const scale = interpolate(t, [0, Math.max(0.1, dur)], [1.0, 1.06], {extrapolateRight: 'clamp'});
  const still = cutaway.mediaKind === 'image' || isStillMediaSrc(src);
  return (
    <AbsoluteFill style={{overflow: 'hidden', backgroundColor: '#000'}}>
      <AbsoluteFill style={{transform: `scale(${scale})`}}>
        {still ? <Img src={src} style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : <OffthreadVideo src={src} muted style={{width: '100%', height: '100%', objectFit: 'cover'}} />}
      </AbsoluteFill>
      {dipIn + dipOut > 0 ? <AbsoluteFill style={{backgroundColor: look?.ink ?? '#000', opacity: Math.max(dipIn, dipOut)}} /> : null}
    </AbsoluteFill>
  );
};
