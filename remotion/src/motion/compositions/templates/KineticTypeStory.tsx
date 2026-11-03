import React from 'react';
import {Img} from 'remotion';

import {staggerStep} from '../../../lib/craftTiming';
import {fontFamily} from '../../fonts';
import {
  HERO_LETTER_SPACING_EM,
  HERO_LINE_HEIGHT_EM,
  HERO_SCALE_OVERSHOOT,
  heroClampCenterY,
  heroContainedFontPx,
  heroSweepLeftX,
  planHeroSweep,
  planWordPopSlot,
  shortsSafeRect,
} from '../../heroSweep';
import type {SafeArea} from '../../layout';
import {
  DEFAULT_SUBJECT_BOX,
  DIRECTIONS,
  ENTER_EASE_OUT,
  KineticStage,
  MOVE_IN_OUT,
  PLAYFUL_OVERSHOOT,
  SubjectForeground,
  clamp01,
  eased,
  capPx,
  enterExit,
  fitRun,
  kineticPalette,
  offsetFor,
  seedOf,
  typeRegion,
  typeShadow,
  type KineticPalette,
  type SubjectBox,
} from './kineticType';
import {useTemplateClock} from './useTemplateClock';

/**
 * KINETIC_TYPE_STORYTELLING (WP55, toolkit kinetic_text): ten overlay templates that reproduce the typography-led editing grammar (oversized type, hierarchy, word-level stagger, depth). Every comp is
 * deterministic (no randomness, no wall clock), silent, owns no frame (captions keep playing) and keeps read-able type inside the safe area (above the caption band). All copy arrives as props that the binder grounded in the
 * transcript / brand data; the demo strings below only render when a prop is omitted (proof shells), never in a live edit.
 */
type Common = {width: number; height: number; safeArea?: SafeArea; durationInFrames?: number; accent?: string; accent2?: string; ink?: string};
type Tone = 'accent' | 'accent2' | 'ink';
const toneColor = (pal: KineticPalette, tone: Tone | undefined, fallback: Tone = 'ink'): string => pal[tone ?? fallback];
const BASE_SEC = 2.6;

const heavy = {fontWeight: 900, lineHeight: 0.92, letterSpacing: '-0.025em'} as const;

// ------------------------------------------------------------------------------------------------ 1. environmental hero
export type TypeEnvironmentalHeroProps = Common & {
  /** 1-2 spoken words, drawn ALL CAPS. */
  text?: string;
  /** Small spoken lead-in above the hero word. */
  lead?: string;
  tone?: Tone;
  /** 'matte' = presenter cutout drawn above the type (real occlusion). 'none' = no matte: type stays in the headroom above the subject (never overlaps the head). */
  occlusion?: 'matte' | 'none';
  /** Person-only alpha video (the subject matte asset). Omit in production: the host composition draws the foreground (SubjectForegroundTrack). */
  subjectSrc?: string;
  /** Seconds into the subject video at which this beat starts. */
  subjectStartSec?: number;
  /** Subject bounding box, fractions of the frame (x, y, w, h). */
  subjectBox?: SubjectBox;
  /**
   * How the occluded word stays READABLE. 'sweep' (default when occluded) = MARQUEE: the word keeps its big size and scrolls horizontally behind the person, so every glyph spends a contiguous stretch of the beat
   * fully clear of the head (left or right gutter); overlap during the transit is intended (see heroSweep.ts). Only when there is no usable gutter at all does the comp fall back to the headroom layout (no occlusion).
   * 'none' = the legacy static centred word behind the subject (kept only for the bug comparison render; the binder never sets it).
   */
  reveal?: 'sweep' | 'none';
};

export const TypeEnvironmentalHero: React.FC<TypeEnvironmentalHeroProps> = ({width, height, text, lead, tone, occlusion, reveal, subjectSrc, subjectStartSec, subjectBox, accent, accent2, ink, durationInFrames}) => {
  const {sec, durSec, fps} = useTemplateClock(BASE_SEC, durationInFrames);
  const pal = kineticPalette({accent, accent2, ink});
  const box = subjectBox ?? DEFAULT_SUBJECT_BOX;
  const region = typeRegion(width, height);
  const safe = shortsSafeRect(width, height);
  const words = (text?.trim() || 'BIGGER').toUpperCase().split(/\s+/).slice(0, 2);
  const leadText = lead?.trim() || undefined;
  // 'matte' = the presenter is drawn in FRONT of the type: either by this comp (subjectSrc, standalone / proof) or by the host composition's cut-aware keyed foreground (production: no subjectSrc)
  const wantsMatte = occlusion === 'matte';
  const headTop = box.y * height;
  const leadEm = leadText ? HERO_LEAD_EM : 0;
  // marquee: the word is fit INSIDE the Shorts safe rect and shifts within it behind the person (heroSweep.ts). No usable gutter at all -> headroom layout, no occlusion.
  const sweep = wantsMatte && reveal !== 'none' ? planHeroSweep({box, lines: words, width, height, maxFontPx: capPx(width, height, 0.27), beatSec: durSec, leadEm}) : undefined;
  const marquee = sweep?.feasible ? sweep : undefined;
  const occluded = wantsMatte && (reveal === 'none' || Boolean(marquee));
  // matte: the type sits at head / chest height, the presenter walks in front of it. none: the whole block must fit in the headroom above the subject.
  const headroom = Math.max(0, headTop - region.top - height * 0.015);
  // the marquee never scales; the other layouts enter at 1.14x, so they are fit (width AND height) at that scale: no glyph ink leaves the safe rect at any frame
  const maxScale = marquee ? 1 : HERO_SCALE_OVERSHOOT;
  const maxPx = occluded ? capPx(width, height, 0.27) : Math.min(capPx(width, height, 0.2), headroom / (words.length * HERO_LINE_HEIGHT_EM + leadEm));
  const font = marquee ? marquee.fontPx : heroContainedFontPx(words, width, height, maxPx, {leadEm, scale: maxScale});
  const heroH = font * HERO_LINE_HEIGHT_EM * words.length;
  const leadH = font * leadEm;
  const blockH = heroH + leadH;
  const settleDrift = height * 0.012;
  const wantY = occluded ? Math.min(region.bottom - blockH / 2, headTop + box.h * height * 0.08) : region.top + (headroom - blockH) / 2 + blockH / 2;
  const centerY = heroClampCenterY(wantY, blockH + 2 * settleDrift, height, width, maxScale);
  // the marquee needs the word fully visible while it is shown, so its fade-in / out are short (the legacy slow 0.55 s enter would eat most of the first stretch)
  const {enter, exit} = marquee ? enterExit(sec, durSec, 0, 0.12, 0.16) : enterExit(sec, durSec, 0.05, 0.55);
  const settle = eased(MOVE_IN_OUT, sec, 0.2, Math.max(0.8, durSec - 0.4));
  const scale = (HERO_SCALE_OVERSHOOT - (HERO_SCALE_OVERSHOOT - 1) * enter) * (1 - 0.03 * exit);
  const color = toneColor(pal, tone, 'accent');
  // hero face: Bebas Neue, tight tracking, vertical ink ramp (lighter top -> the accent) and a soft contact shadow (drop-shadow so it follows the clipped gradient glyphs)
  const heroStyle = {
    fontFamily: fontFamily('bebas'),
    fontSize: font,
    fontWeight: 400,
    lineHeight: HERO_LINE_HEIGHT_EM,
    letterSpacing: `${HERO_LETTER_SPACING_EM}em`,
    whiteSpace: 'nowrap',
    backgroundImage: `linear-gradient(180deg, color-mix(in srgb, ${color} 62%, #ffffff) 0%, ${color} 58%, color-mix(in srgb, ${color} 80%, #000000) 100%)`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    filter: `drop-shadow(0 ${font * 0.018}px ${font * 0.03}px ${pal.shadow}) drop-shadow(0 ${font * 0.05}px ${font * 0.07}px rgba(0,0,0,0.35))`,
  } as const;
  // lead: small geometric sans ABOVE the hero, fit to the safe width
  const leadChars = leadText ? Array.from(leadText).length : 1;
  const leadPx = Math.min(font * 0.2, (safe.w * 0.98) / (Math.max(4, leadChars) * 0.62));
  const leadStyle = {fontFamily: fontFamily('space_grotesk'), fontSize: leadPx, fontWeight: 700, lineHeight: 1.1, color: pal.ink, letterSpacing: '0.02em', whiteSpace: 'nowrap', height: leadH, display: 'flex', alignItems: 'flex-start', textShadow: typeShadow(pal, 0.06)} as const;
  if (marquee) {
    // block left edge (px) at this frame; lines are left-aligned inside the block, glyph k of a line starts at the cumulative measured advance (kerning off so the render matches the planner's layout);
    // the block is clipped to the view window (= the safe window), which the contained block never touches
    const left = heroSweepLeftX(marquee, durSec > 0 ? sec / durSec : 0);
    const clipPad = font * 0.2;
    return (
      <KineticStage>
        <div style={{position: 'absolute', left: marquee.view.from, width: marquee.view.to - marquee.view.from, top: centerY - blockH / 2 - clipPad - settle * settleDrift, height: blockH + 2 * clipPad, overflow: 'hidden', opacity: clamp01(enter * 1.4) * (1 - exit)}}>
          <div
            style={{
              position: 'absolute',
              left: left - marquee.view.from,
              top: clipPad,
              width: marquee.blockWidthPx,
              height: blockH,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              justifyContent: 'center',
              fontKerning: 'none',
            }}
          >
            {leadText ? <div style={leadStyle}>{leadText}</div> : null}
            {words.map((word, i) => (
              <div key={i} style={heroStyle}>
                {word}
              </div>
            ))}
          </div>
        </div>
        <SubjectForeground src={subjectSrc} startSec={subjectStartSec} width={width} height={height} fps={fps} />
      </KineticStage>
    );
  }
  return (
    <KineticStage>
      <div
        style={{
          position: 'absolute',
          left: safe.left,
          width: safe.w,
          top: centerY - blockH / 2 - settle * settleDrift,
          height: blockH,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: clamp01(enter * 1.4) * (1 - exit),
          transform: `scale(${scale})`,
          transformOrigin: '50% 50%',
          fontKerning: 'none',
        }}
      >
        {leadText ? <div style={leadStyle}>{leadText}</div> : null}
        {words.map((word, i) => (
          <div key={i} style={heroStyle}>
            {word}
          </div>
        ))}
      </div>
      {occluded ? <SubjectForeground src={subjectSrc} startSec={subjectStartSec} width={width} height={height} fps={fps} /> : null}
    </KineticStage>
  );
};

/** Lead block height (em of the hero font): the lead line plus its gap above the hero. */
const HERO_LEAD_EM = 0.32;

// ------------------------------------------------------------------------------------------------ 2. impact number
export type TypeImpactNumberProps = Common & {
  /** One value, or a short sequence (<= 3), as spoken: "10", "$2M", "386K". */
  values?: string[];
  /** Count up to this number (single value only). */
  countTo?: number;
  prefix?: string;
  suffix?: string;
  label?: string;
  labelPosition?: 'below' | 'side';
};

const formatCount = (n: number): string => n.toLocaleString('en-US');

export const TypeImpactNumber: React.FC<TypeImpactNumberProps> = ({width, height, values, countTo, prefix, suffix, label, labelPosition, accent, accent2, ink, durationInFrames}) => {
  const {sec, durSec} = useTemplateClock(BASE_SEC, durationInFrames);
  const pal = kineticPalette({accent, accent2, ink});
  const region = typeRegion(width, height);
  const list = (values && values.length > 0 ? values : ['10']).slice(0, 3);
  const side = labelPosition === 'side';
  const longest = Math.max(...list.map(v => Array.from(`${prefix ?? ''}${v}${suffix ?? ''}`).length), typeof countTo === 'number' ? Array.from(`${prefix ?? ''}${formatCount(countTo)}${suffix ?? ''}`).length : 0);
  const font = fitRun(longest, width * (side ? 0.62 : 0.86), capPx(width, height, 0.27), 0.6);
  const slot = Math.max(0.9, (durSec - 0.5) / list.length);
  const centerY = region.top + region.h * 0.3;
  return (
    <KineticStage>
      {list.map((value, k) => {
        const start = 0.08 + k * slot;
        const end = k === list.length - 1 ? durSec : start + slot;
        const local = sec - start;
        const pop = eased(PLAYFUL_OVERSHOOT, sec, start, 0.46); // 0 -> 1 with a controlled overshoot
        const out = eased(MOVE_IN_OUT, sec, end - 0.28, 0.28);
        const tail = k === list.length - 1 ? eased(MOVE_IN_OUT, sec, durSec - 0.26, 0.26) : out;
        if (local < 0 || tail >= 1) return null;
        const counted = typeof countTo === 'number' && list.length === 1 ? formatCount(Math.round(countTo * eased(MOVE_IN_OUT, sec, start, Math.min(1.1, durSec * 0.5)))) : value;
        const shown = `${prefix ?? ''}${counted}${suffix ?? ''}`;
        return (
          <div
            key={k}
            style={{
              position: 'absolute',
              left: 0,
              width,
              top: centerY - font * 0.55,
              display: 'flex',
              flexDirection: side ? 'row' : 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: font * (side ? 0.12 : 0.06),
              opacity: clamp01(pop * 2) * (1 - tail),
              transform: `translateY(${-tail * height * 0.03}px) scale(${0.55 + 0.45 * pop})`,
              transformOrigin: '50% 55%',
            }}
          >
            <div style={{fontSize: font, ...heavy, color: pal.accent, textShadow: typeShadow(pal, 0.04), fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap'}}>{shown}</div>
            {label ? (
              <div style={{fontSize: font * (side ? 0.2 : 0.17), fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.04em', color: pal.ink, textShadow: typeShadow(pal, 0.08), opacity: eased(ENTER_EASE_OUT, sec, start + 0.18, 0.3), transform: `translateY(${(1 - eased(ENTER_EASE_OUT, sec, start + 0.18, 0.3)) * font * 0.08}px)`}}>{label}</div>
            ) : null}
          </div>
        );
      })}
    </KineticStage>
  );
};

// ------------------------------------------------------------------------------------------------ 3. staggered phrase
export type TypeStaggeredPhraseProps = Common & {
  /** One short spoken phrase (2-8 words). */
  text?: string;
  /** Seconds into the beat at which each word is spoken (rhythm of the speech); even stagger when omitted. */
  wordStarts?: number[];
  /** Index of the word that takes the accent. */
  emphasisIndex?: number;
  subjectBox?: SubjectBox;
};

export const TypeStaggeredPhrase: React.FC<TypeStaggeredPhraseProps> = ({width, height, text, wordStarts, emphasisIndex, subjectBox, accent, accent2, ink, durationInFrames}) => {
  const {sec, durSec} = useTemplateClock(BASE_SEC, durationInFrames);
  const pal = kineticPalette({accent, accent2, ink});
  const region = typeRegion(width, height);
  const phrase = (text?.trim() || 'Every word lands on its own beat').split(/\s+/).slice(0, 8);
  const total = phrase.join(' ').length;
  const longest = Math.max(...phrase.map(w => Array.from(w).length));
  const boxW = region.w * 0.96;
  const font = fitRun(Math.max(longest, Math.ceil(total / 2.6)), boxW, capPx(width, height, 0.082), 0.58);
  const step = staggerStep(phrase.length);
  const seed = seedOf(phrase.join(' '), DIRECTIONS.length);
  const emph = typeof emphasisIndex === 'number' && emphasisIndex >= 0 && emphasisIndex < phrase.length ? emphasisIndex : phrase.length - 1;
  const box = subjectBox ?? DEFAULT_SUBJECT_BOX;
  const room = Math.max(font * 3.4, box.y * height - region.top);
  return (
    <KineticStage>
      <div style={{position: 'absolute', left: region.left, width: region.w, top: region.top, height: Math.min(room, region.h * 0.5), display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignContent: 'center', columnGap: font * 0.26, rowGap: font * 0.06}}>
        {phrase.map((word, i) => {
          const at = wordStarts && typeof wordStarts[i] === 'number' ? Math.max(0, wordStarts[i]! - 0.05) : 0.1 + i * Math.max(0.09, step * 2.4);
          const {enter, exit} = enterExit(sec, durSec, at, 0.38, 0.26 + (phrase.length - 1 - i) * 0.0);
          const dir = DIRECTIONS[(seed + i * 3) % DIRECTIONS.length]!; // not every word travels the same way
          const off = offsetFor(dir, font * 0.7, enter);
          const out = offsetFor(dir === 'up' ? 'down' : dir === 'down' ? 'up' : dir === 'left' ? 'right' : 'left', font * 0.25, 1 - exit);
          return (
            <span key={i} style={{display: 'inline-block', fontSize: font, fontWeight: i === emph ? 900 : 800, lineHeight: 1, color: i === emph ? pal.accent : pal.ink, textShadow: typeShadow(pal, 0.05), opacity: clamp01(enter * 1.6) * (1 - exit), transform: `translate(${off.x + out.x}px, ${off.y + out.y}px)`}}>
              {word}
            </span>
          );
        })}
      </div>
    </KineticStage>
  );
};

// ------------------------------------------------------------------------------------------------ 4. split colour headline
export type SplitGroup = {text: string; size?: 'sm' | 'lg'; tone?: Tone};
export type TypeSplitColorHeadlineProps = Common & {groups?: SplitGroup[]; groupStarts?: number[]};

export const TypeSplitColorHeadline: React.FC<TypeSplitColorHeadlineProps> = ({width, height, groups, groupStarts, accent, accent2, ink, durationInFrames}) => {
  const {sec, durSec} = useTemplateClock(BASE_SEC, durationInFrames);
  const pal = kineticPalette({accent, accent2, ink});
  const region = typeRegion(width, height);
  const rows = (groups && groups.length > 0 ? groups : [{text: 'Small lead-in', size: 'sm' as const, tone: 'accent' as const}, {text: 'KEYWORD', size: 'lg' as const, tone: 'accent2' as const}]).slice(0, 3);
  const lgLongest = Math.max(...rows.filter(r => r.size === 'lg').map(r => Array.from(r.text).length), 6);
  const lgFont = fitRun(lgLongest, region.w * 0.96, capPx(width, height, 0.15), 0.62);
  const sizeOf = (r: SplitGroup) => (r.size === 'sm' ? lgFont * 0.36 : lgFont);
  const seed = seedOf(rows.map(r => r.text).join('|'), 2);
  const entrances = ['rise', 'slide', 'pop'] as const;
  return (
    <KineticStage>
      <div style={{position: 'absolute', left: region.left, width: region.w, top: region.top + region.h * 0.06, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: lgFont * 0.04}}>
        {rows.map((row, i) => {
          const at = groupStarts && typeof groupStarts[i] === 'number' ? Math.max(0, groupStarts[i]!) : 0.08 + i * 0.26;
          const {enter, exit} = enterExit(sec, durSec, at, 0.44, 0.26);
          const kind = entrances[(i + seed) % entrances.length]!; // each group enters its own way
          const font = sizeOf(row);
          const rise = kind === 'rise' ? (1 - enter) * 105 : 0;
          const slideX = kind === 'slide' ? (1 - enter) * (i % 2 === 0 ? -1 : 1) * width * 0.18 : 0;
          const popScale = kind === 'pop' ? 0.7 + 0.3 * eased(PLAYFUL_OVERSHOOT, sec, at, 0.4) : 1;
          return (
            <div key={i} style={{overflow: 'hidden', paddingBottom: font * 0.1, marginBottom: -font * 0.1, opacity: 1 - exit}}>
              <div style={{fontSize: font, ...heavy, whiteSpace: 'nowrap', color: toneColor(pal, row.tone, row.size === 'sm' ? 'accent' : 'accent2'), textShadow: typeShadow(pal, 0.04), transform: `translate(${slideX}px, ${rise}%) scale(${popScale})`, opacity: clamp01(enter * 2.2)}}>{row.text}</div>
            </div>
          );
        })}
      </div>
    </KineticStage>
  );
};

// ------------------------------------------------------------------------------------------------ 5. kinetic word pop
export type TypeKineticWordPopProps = Common & {
  word?: string;
  /** Which side of the presenter the word pops on; 'top' = headroom (used when there is no free side space). */
  anchor?: 'left' | 'right' | 'top';
  subjectBox?: SubjectBox;
  /** @deprecated IGNORED. Small type is never drawn behind the presenter (a word tucked under a shoulder is unreadable); only big environmental heroes (clip_45) use the matte. Kept so stale blueprints still type-check. */
  occlusion?: 'matte' | 'none';
  /** @deprecated IGNORED (see `occlusion`). */
  subjectSrc?: string;
  /** @deprecated IGNORED (see `occlusion`). */
  subjectStartSec?: number;
};

export const TypeKineticWordPop: React.FC<TypeKineticWordPopProps> = ({width, height, word, anchor, subjectBox, accent, accent2, ink, durationInFrames}) => {
  const {sec, durSec} = useTemplateClock(1.2, durationInFrames);
  const pal = kineticPalette({accent, accent2, ink});
  const region = typeRegion(width, height);
  const box = subjectBox ?? DEFAULT_SUBJECT_BOX;
  const text = (word?.trim() || 'Attention').slice(0, 18);
  // The word's rect must have ZERO overlap with the person: the gutters beside the HEAD BAND (+ pad) at head height, else the true headroom ABOVE the head, else nothing is drawn (never through the face). See planWordPopSlot.
  const slot = planWordPopSlot({box, word: text, anchor, width, height, region, sideCapPx: capPx(width, height, 0.06), topCapPx: capPx(width, height, 0.085)});
  if (!slot) return null;
  const font = slot.fontPx;
  const freeW = slot.room;
  const cx = slot.cx;
  const cy = slot.cy;
  const pop = eased(PLAYFUL_OVERSHOOT, sec, 0.02, 0.26);
  const out = eased(MOVE_IN_OUT, sec, Math.max(0.3, durSec - 0.2), 0.2);
  if (out >= 1) return null;
  return (
    <KineticStage>
      <div style={{position: 'absolute', left: cx - freeW / 2, width: freeW, top: cy - font * 0.6, textAlign: 'center', fontSize: font, ...heavy, whiteSpace: 'nowrap', color: pal.ink, textShadow: typeShadow(pal, 0.07), opacity: clamp01(pop * 3) * (1 - out), transform: `scale(${0.45 + 0.55 * pop}) translateY(${-out * font * 0.2}px)`}}>
        <span style={{backgroundImage: `linear-gradient(${pal.accent}, ${pal.accent})`, backgroundRepeat: 'no-repeat', backgroundSize: `${eased(ENTER_EASE_OUT, sec, 0.12, 0.3) * 100}% 0.14em`, backgroundPosition: '0 96%', paddingBottom: font * 0.08}}>{text}</span>
      </div>
    </KineticStage>
  );
};

// ------------------------------------------------------------------------------------------------ 6. stacked statement
export type StackLine = {text: string; role?: 'lead' | 'key' | 'support'};
export type TypeStackedStatementProps = Common & {lines?: StackLine[]; lineStarts?: number[]};

export const TypeStackedStatement: React.FC<TypeStackedStatementProps> = ({width, height, lines, lineStarts, accent, accent2, ink, durationInFrames}) => {
  const {sec, durSec} = useTemplateClock(BASE_SEC + 0.6, durationInFrames);
  const pal = kineticPalette({accent, accent2, ink});
  const region = typeRegion(width, height);
  const rows = (lines && lines.length > 0 ? lines : [{text: 'The lead-in', role: 'lead' as const}, {text: 'KEY IDEA', role: 'key' as const}, {text: 'and the follow-through', role: 'support' as const}]).slice(0, 4);
  const keyChars = Math.max(...rows.filter(r => r.role === 'key').map(r => Array.from(r.text).length), 6);
  const keyFont = fitRun(keyChars, region.w * 0.96, capPx(width, height, 0.13), 0.62);
  const scaleOf = (r: StackLine) => (r.role === 'key' ? 1 : r.role === 'lead' ? 0.4 : 0.34);
  return (
    <KineticStage>
      <div style={{position: 'absolute', left: region.left, width: region.w, top: region.top + region.h * 0.05, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: keyFont * 0.05}}>
        {rows.map((row, i) => {
          const at = lineStarts && typeof lineStarts[i] === 'number' ? Math.max(0, lineStarts[i]!) : 0.08 + i * 0.3;
          const {enter, exit} = enterExit(sec, durSec, at, row.role === 'key' ? 0.55 : 0.4, 0.28);
          const font = keyFont * scaleOf(row);
          const isKey = row.role === 'key';
          return (
            <div key={i} style={{overflow: 'hidden', paddingBottom: font * 0.12, marginBottom: -font * 0.12, opacity: 1 - exit}}>
              <div style={{fontSize: font, ...heavy, fontWeight: isKey ? 900 : 700, whiteSpace: 'nowrap', color: isKey ? pal.accent : pal.ink, textShadow: typeShadow(pal, 0.045), transform: `translateY(${(1 - enter) * 105}%) scale(${isKey ? 1.1 - 0.1 * enter : 1})`, opacity: clamp01(enter * 2)}}>{row.text}</div>
            </div>
          );
        })}
      </div>
    </KineticStage>
  );
};

// ------------------------------------------------------------------------------------------------ 7. floating social proof
export type SocialIcon = 'heart' | 'comment' | 'share' | 'bookmark';
export type TypeFloatingSocialProofProps = Common & {
  icons?: SocialIcon[];
  /** Creator-provided stills shown in phone frames (never generated, never a faked post). */
  imageSrcs?: string[];
  /** A figure the creator PROVIDED or said aloud (e.g. "386K"); shown verbatim. Never invented. */
  figure?: string;
  figureLabel?: string;
};

const ICON_PATHS: Record<SocialIcon, string> = {
  heart: 'M12 21s-7.5-4.6-9.6-9.2C.7 8.2 2.6 4.5 6.2 4.5c2.1 0 3.6 1.1 4.6 2.6l1.2 1.7 1.2-1.7c1-1.5 2.5-2.6 4.6-2.6 3.6 0 5.5 3.7 3.8 7.3C19.5 16.4 12 21 12 21z',
  comment: 'M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H11l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  share: 'M3 11.5 21 3l-5.5 18-4-7.5L3 11.5zm8.5 2.5L21 3',
  bookmark: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z',
};
// depth layers: [x, y, size (frac of W), depth], placed on the left / right edges and top so the presenter column stays clear
const SOCIAL_SLOTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.14, 0.46, 0.17, 1.15],
  [0.86, 0.38, 0.14, 1.0],
  [0.8, 0.56, 0.2, 1.2],
  [0.2, 0.3, 0.1, 0.7],
  [0.9, 0.24, 0.09, 0.65],
  [0.1, 0.58, 0.08, 0.6],
];

export const TypeFloatingSocialProof: React.FC<TypeFloatingSocialProofProps> = ({width, height, icons, imageSrcs, figure, figureLabel, accent, accent2, ink, durationInFrames}) => {
  const {sec, durSec} = useTemplateClock(BASE_SEC + 1, durationInFrames);
  const pal = kineticPalette({accent, accent2, ink});
  const region = typeRegion(width, height);
  const list: SocialIcon[] = icons && icons.length > 0 ? icons : ['heart'];
  const cards = (imageSrcs ?? []).filter(src => /^(https:\/\/|data:image\/|staticFile:|\/)/.test(src)).slice(0, 2);
  const out = eased(MOVE_IN_OUT, sec, durSec - 0.3, 0.3);
  const unit = Math.min(width, height * 0.56);
  return (
    <KineticStage>
      <div style={{position: 'absolute', inset: 0, opacity: 1 - out}}>
        {cards.map((src, i) => {
          const cw = unit * 0.24;
          const ch = cw * 1.62;
          const enter = eased(ENTER_EASE_OUT, sec, 0.08 + i * 0.14, 0.55);
          const bob = Math.sin(sec * 1.3 + i * 1.7) * height * 0.006;
          const x = i === 0 ? width * 0.25 - cw / 2 : width * 0.75 - cw / 2;
          const y = region.top + height * 0.02 + bob - (1 - enter) * height * 0.08;
          return (
            <div key={`c${i}`} style={{position: 'absolute', left: x, top: y, width: cw, height: ch, borderRadius: cw * 0.13, background: '#101114', padding: cw * 0.035, boxShadow: '0 18px 40px rgba(0,0,0,0.35)', opacity: clamp01(enter * 2), transform: `scale(${0.8 + 0.2 * enter})`}}>
              <Img src={src} style={{width: '100%', height: '100%', objectFit: 'cover', borderRadius: cw * 0.1}} />
            </div>
          );
        })}
        {SOCIAL_SLOTS.slice(0, Math.min(SOCIAL_SLOTS.length, Math.max(3, list.length * 2))).map(([fx, fy, fs, depth], k) => {
          const icon = list[k % list.length]!;
          const size = unit * fs;
          const enter = eased(PLAYFUL_OVERSHOOT, sec, 0.3 + k * 0.11, 0.5);
          const bob = Math.sin(sec * (0.9 + depth * 0.5) + k * 2.1) * height * 0.007 * depth;
          const sway = Math.cos(sec * 0.7 + k * 1.3) * width * 0.004 * depth;
          const far = depth < 0.9;
          return (
            <svg key={`i${k}`} viewBox="0 0 24 24" width={size} height={size} style={{position: 'absolute', left: width * fx - size / 2 + sway, top: height * fy - size / 2 + bob, opacity: clamp01(enter * 2) * (far ? 0.72 : 1), transform: `scale(${0.3 + 0.7 * enter})`, filter: `${far ? 'blur(1.4px) ' : ''}drop-shadow(0 6px 10px rgba(0,0,0,0.3))`}}>
              <rect x="-4" y="-4" width="32" height="32" fill="none" />
              <circle cx="12" cy="12" r="13.5" fill="#FF2D55" opacity={icon === 'heart' ? 1 : 0} />
              <path d={ICON_PATHS[icon]} fill={icon === 'heart' ? '#FFFFFF' : 'none'} stroke={icon === 'heart' ? 'none' : pal.ink} strokeWidth={1.8} strokeLinejoin="round" transform={icon === 'heart' ? 'translate(4 4.2) scale(0.66)' : undefined} />
            </svg>
          );
        })}
        {figure ? (
          <div style={{position: 'absolute', left: 0, width, top: region.top + height * 0.02 + unit * 0.24 * 1.62 + height * 0.012, textAlign: 'center', opacity: eased(ENTER_EASE_OUT, sec, 0.5, 0.35), transform: `translateY(${(1 - eased(ENTER_EASE_OUT, sec, 0.5, 0.35)) * 24}px)`}}>
            <div style={{fontSize: fitRun(Array.from(figure).length, width * 0.5, capPx(width, height, 0.062), 0.6), ...heavy, color: pal.ink, textShadow: typeShadow(pal, 0.05), fontVariantNumeric: 'tabular-nums'}}>{figure}</div>
            {figureLabel ? <div style={{fontSize: height * 0.02, fontWeight: 800, color: pal.ink, textTransform: 'uppercase', letterSpacing: '0.06em', textShadow: typeShadow(pal, 0.1)}}>{figureLabel}</div> : null}
          </div>
        ) : null}
      </div>
    </KineticStage>
  );
};

// ------------------------------------------------------------------------------------------------ 8. logo reveal (overlay)
export type TypeLogoRevealProps = Common & {logoSrc?: string; title?: string; subtitle?: string};

export const TypeLogoReveal: React.FC<TypeLogoRevealProps> = ({width, height, logoSrc, title, subtitle, accent, accent2, ink, durationInFrames}) => {
  const {sec, durSec} = useTemplateClock(BASE_SEC, durationInFrames);
  const pal = kineticPalette({accent, accent2, ink});
  const region = typeRegion(width, height);
  const chip = Math.min(width, height * 0.56) * 0.26;
  const {enter, exit} = enterExit(sec, durSec, 0.05, 0.6);
  const text = enterExit(sec, durSec, 0.35, 0.45);
  const titleFont = title ? fitRun(Array.from(title).length, region.w * 0.9, capPx(width, height, 0.07), 0.6) : 0;
  const drift = eased(MOVE_IN_OUT, sec, 0.2, Math.max(0.8, durSec - 0.4)) * height * 0.008;
  return (
    <KineticStage>
      <div style={{position: 'absolute', left: 0, width, top: region.top + region.h * 0.14 - drift, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: chip * 0.12, opacity: 1 - exit}}>
        {logoSrc ? (
          <div style={{width: chip, height: chip, borderRadius: chip * 0.22, background: '#FFFFFF', boxShadow: '0 16px 36px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: clamp01(enter * 2), transform: `scale(${0.86 + 0.14 * enter})`}}>
            <Img src={logoSrc} style={{width: '72%', height: '72%', objectFit: 'contain'}} />
          </div>
        ) : null}
        {title ? (
          <div style={{overflow: 'hidden', paddingBottom: titleFont * 0.12, marginBottom: -titleFont * 0.12}}>
            <div style={{fontSize: titleFont, ...heavy, color: pal.ink, textShadow: typeShadow(pal, 0.05), whiteSpace: 'nowrap', transform: `translateY(${(1 - text.enter) * 105}%)`}}>{title}</div>
          </div>
        ) : null}
        {subtitle ? <div style={{fontSize: titleFont * 0.38, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: pal.accent, textShadow: typeShadow(pal, 0.08), opacity: eased(ENTER_EASE_OUT, sec, 0.6, 0.3)}}>{subtitle}</div> : null}
        <div style={{height: Math.max(4, titleFont * 0.08), width: `${eased(ENTER_EASE_OUT, sec, 0.5, 0.5) * 38}%`, background: pal.accent, borderRadius: 4}} />
      </div>
    </KineticStage>
  );
};

// ------------------------------------------------------------------------------------------------ 9. kinetic CTA
export type CtaPart = {text: string; size?: 'sm' | 'md' | 'lg'; tone?: Tone};
export type TypeKineticCtaProps = Common & {parts?: CtaPart[]; partStarts?: number[]};

export const TypeKineticCta: React.FC<TypeKineticCtaProps> = ({width, height, parts, partStarts, accent, accent2, ink, durationInFrames}) => {
  const {sec, durSec} = useTemplateClock(BASE_SEC + 0.4, durationInFrames);
  const pal = kineticPalette({accent, accent2, ink});
  const region = typeRegion(width, height);
  const rows = (parts && parts.length > 0 ? parts : [{text: 'Just', size: 'sm' as const}, {text: 'DM ME', size: 'lg' as const, tone: 'accent' as const}]).slice(0, 3);
  const lgChars = Math.max(...rows.filter(r => r.size === 'lg').map(r => Array.from(r.text).length), 5);
  const lg = fitRun(lgChars, region.w * 0.96, capPx(width, height, 0.17), 0.62);
  const sizeOf = (r: CtaPart) => (r.size === 'lg' ? lg : r.size === 'md' ? lg * 0.42 : lg * 0.3);
  return (
    <KineticStage>
      <div style={{position: 'absolute', left: region.left, width: region.w, top: region.top + region.h * 0.2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: lg * 0.05}}>
        {rows.map((row, i) => {
          const at = partStarts && typeof partStarts[i] === 'number' ? Math.max(0, partStarts[i]!) : 0.08 + i * 0.28;
          const big = row.size === 'lg';
          const {enter, exit} = enterExit(sec, durSec, at, big ? 0.5 : 0.38, 0.26);
          const pop = big ? eased(PLAYFUL_OVERSHOOT, sec, at, 0.46) : enter;
          const font = sizeOf(row);
          return (
            <div key={i} style={{overflow: 'hidden', paddingBottom: font * 0.12, marginBottom: -font * 0.12, opacity: 1 - exit}}>
              <div style={{fontSize: font, ...heavy, fontWeight: big ? 900 : 800, whiteSpace: 'nowrap', color: toneColor(pal, row.tone, big ? 'accent' : 'ink'), textShadow: typeShadow(pal, 0.04), opacity: clamp01(enter * 2), transform: big ? `translateY(${(1 - clamp01(pop)) * 60}%) scale(${0.82 + 0.18 * pop})` : `translateY(${(1 - enter) * 105}%)`}}>{row.text}</div>
            </div>
          );
        })}
      </div>
    </KineticStage>
  );
};

// ------------------------------------------------------------------------------------------------ 10. illustrated emphasis
export type EmphasisAccent = 'underline' | 'circle' | 'arrow' | 'burst' | 'bracket';
export type TypeIllustratedEmphasisProps = Common & {word?: string; lead?: string; mark?: EmphasisAccent; subjectBox?: SubjectBox};

export const TypeIllustratedEmphasis: React.FC<TypeIllustratedEmphasisProps> = ({width, height, word, lead, mark, subjectBox, accent, accent2, ink, durationInFrames}) => {
  const {sec, durSec} = useTemplateClock(BASE_SEC, durationInFrames);
  const pal = kineticPalette({accent, accent2, ink});
  const region = typeRegion(width, height);
  const box = subjectBox ?? DEFAULT_SUBJECT_BOX;
  const text = (word?.trim() || 'Attention').slice(0, 16);
  const chars = Array.from(text).length;
  const font = fitRun(chars, region.w * 0.8, capPx(width, height, 0.1), 0.6);
  const textW = chars * font * 0.58;
  const textH = font * 0.95;
  const cy = Math.min(region.top + region.h * 0.22, Math.max(region.top + textH, box.y * height - textH * 1.2));
  const cx = width / 2;
  const kind: EmphasisAccent = mark ?? 'underline';
  const {enter, exit} = enterExit(sec, durSec, 0.05, 0.42);
  const draw = eased(MOVE_IN_OUT, sec, 0.4, 0.45); // the accent draws on AFTER the word lands
  const pathLen = 1000;
  const stroke = Math.max(5, font * 0.075);
  const sw = {stroke: pal.accent, strokeWidth: stroke, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeDasharray: pathLen, strokeDashoffset: pathLen * (1 - draw)};
  const x0 = cx - textW / 2;
  const y0 = cy - textH / 2;
  let drawing: React.ReactNode = null;
  if (kind === 'underline') {
    drawing = <path d={`M ${x0 - font * 0.05} ${y0 + textH * 1.04} C ${x0 + textW * 0.3} ${y0 + textH * 0.98}, ${x0 + textW * 0.7} ${y0 + textH * 1.12}, ${x0 + textW * 1.04} ${y0 + textH * 1.02}`} pathLength={pathLen} {...sw} />;
  } else if (kind === 'circle') {
    drawing = <path d={`M ${x0 + textW * 0.98} ${y0 + textH * 0.2} C ${x0 + textW * 0.8} ${y0 - textH * 0.18}, ${x0 + textW * 0.1} ${y0 - textH * 0.12}, ${x0 - textW * 0.04} ${y0 + textH * 0.52} C ${x0 + textW * 0.02} ${y0 + textH * 1.16}, ${x0 + textW * 0.88} ${y0 + textH * 1.2}, ${x0 + textW * 1.04} ${y0 + textH * 0.58} C ${x0 + textW * 1.06} ${y0 + textH * 0.36}, ${x0 + textW * 1.0} ${y0 + textH * 0.22}, ${x0 + textW * 0.94} ${y0 + textH * 0.1}`} pathLength={pathLen} {...sw} />;
  } else if (kind === 'arrow') {
    const ax = x0 - font * 0.9;
    const ay = y0 - font * 0.55;
    const tx = x0 - font * 0.12;
    const ty = y0 + textH * 0.42;
    drawing = (
      <g>
        <path d={`M ${ax} ${ay} C ${ax - font * 0.2} ${ty - font * 0.2}, ${tx - font * 0.5} ${ty + font * 0.2}, ${tx} ${ty}`} pathLength={pathLen} {...sw} />
        <path d={`M ${tx - font * 0.28} ${ty - font * 0.24} L ${tx} ${ty} L ${tx - font * 0.3} ${ty + font * 0.2}`} pathLength={pathLen} {...sw} strokeDashoffset={pathLen * (1 - clamp01((draw - 0.7) / 0.3))} />
      </g>
    );
  } else if (kind === 'burst') {
    const bx = x0 + textW + font * 0.18;
    const by = y0 + font * 0.02;
    drawing = (
      <g>
        {[-60, -20, 20].map((deg, i) => {
          const r = (deg * Math.PI) / 180;
          const x1 = bx + Math.cos(r) * font * 0.14;
          const y1 = by + Math.sin(r) * font * 0.14;
          const x2 = bx + Math.cos(r) * font * 0.5;
          const y2 = by + Math.sin(r) * font * 0.5;
          return <path key={i} d={`M ${x1} ${y1} L ${x2} ${y2}`} pathLength={pathLen} {...sw} strokeDashoffset={pathLen * (1 - eased(ENTER_EASE_OUT, sec, 0.4 + i * 0.07, 0.3))} />;
        })}
      </g>
    );
  } else {
    const len = font * 0.34;
    drawing = (
      <g>
        <path d={`M ${x0 - font * 0.1 + len} ${y0 - font * 0.04} L ${x0 - font * 0.1} ${y0 - font * 0.04} L ${x0 - font * 0.1} ${y0 - font * 0.04 + len}`} pathLength={pathLen} {...sw} />
        <path d={`M ${x0 + textW + font * 0.1 - len} ${y0 + textH * 1.02} L ${x0 + textW + font * 0.1} ${y0 + textH * 1.02} L ${x0 + textW + font * 0.1} ${y0 + textH * 1.02 - len}`} pathLength={pathLen} {...sw} />
      </g>
    );
  }
  return (
    <KineticStage>
      <div style={{position: 'absolute', inset: 0, opacity: 1 - exit}}>
        {lead ? <div style={{position: 'absolute', left: 0, width, top: cy - textH / 2 - font * 0.42, textAlign: 'center', fontSize: font * 0.3, fontWeight: 800, color: pal.ink, textShadow: typeShadow(pal, 0.08), opacity: clamp01(enter * 2)}}>{lead}</div> : null}
        <div style={{position: 'absolute', left: 0, width, top: cy - textH / 2, textAlign: 'center', fontSize: font, ...heavy, whiteSpace: 'nowrap', color: pal.ink, textShadow: typeShadow(pal, 0.045), opacity: clamp01(enter * 2), transform: `translateY(${(1 - enter) * font * 0.3}px) scale(${0.92 + 0.08 * enter})`}}>{text}</div>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{position: 'absolute', inset: 0}}>
          {drawing}
        </svg>
      </div>
    </KineticStage>
  );
};
