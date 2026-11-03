/**
 * The 18 kinetic presets as Remotion components. Each receives a solved RenderEvent (fonts, fills, shadow, per-line boxes already decided by the server solver) and only decides HOW it animates
 * inside its block: per-letter, swap, light streak, sequence, chromatic split, extrude. Position / scale / opacity / blur of the whole block come from the keyframes (KineticTrack), not from here.
 * To add a preset: add the name to spec.ts (kept byte-identical with server/src/stages/kinetic/schema.ts), a registry entry on the server, and a component + map entry here.
 */
import React from 'react';

import {Extruded3DText, cssExtrude} from './Extruded3D';
import {StackLines, clamp01, gradientCss, lineStyle, swapState, type PresetProps} from './primitives';
import {TypeMatchCutPreset} from './MatchCutPreset';
import {TypeWords} from './TypeWords';
import type {PresetName, RenderLine} from './spec';

/** 1. small geometric sans + giant serif-italic hero (behind the subject). */
export const StackSerifHeroBehind: React.FC<PresetProps> = p => <StackLines {...p} stagger={2} />;

/** 2. four-line mixed stack, lines enter one after another. */
export const StackMixedBetween: React.FC<PresetProps> = p => <StackLines {...p} stagger={3} />;

/** 3. plane rotated in Y/X (rotation lives in the keyframes), last word swaps, far edge fades out. */
export const Plane3dRecedingSwap: React.FC<PresetProps> = ({event, local}) => (
  <div style={{position: 'absolute', inset: 0, WebkitMaskImage: 'linear-gradient(90deg, #000 55%, rgba(0,0,0,0.55) 100%)', maskImage: 'linear-gradient(90deg, #000 55%, rgba(0,0,0,0.55) 100%)'}}>
    <StackLines event={event} local={local} stagger={2} />
  </div>
);

/** 4. giant thin serif word in front. */
export const HeroThinSerifFront: React.FC<PresetProps> = p => <StackLines {...p} />;

/** 5. plain bold centred, soft shadow (the fallback). */
export const FallbackBoldCenterFront: React.FC<PresetProps> = p => <StackLines {...p} />;

/** 6. huge gradient word. */
export const HeroGradientWordBehind: React.FC<PresetProps> = p => <StackLines {...p} />;

/** 7. two clusters (the solver splits them into two blocks), hero italic. */
export const StackTwoClusterBehind: React.FC<PresetProps> = p => <StackLines {...p} stagger={2} />;

/** 8. per-letter reveal. */
export const HeroPerLetterBehind: React.FC<PresetProps> = ({event, local}) => (
  <>
    {event.lines.map((line, i) => {
      const letters = Array.from(line.uppercase ? line.text.toUpperCase() : line.text);
      const color = line.fill.colors[Math.floor(line.fill.colors.length / 2)] ?? '#fff';
      const solid: RenderLine['fill'] = {kind: 'solid', colors: [color], angleDeg: 90};
      return (
        <div key={i} style={{...lineStyle(line, event, solid), textTransform: 'none'}}>
          {letters.map((ch, k) => {
            const t = clamp01((local - (line.revealFrames[k] ?? k * 2)) / 6);
            return (
              <span key={k} style={{display: 'inline-block', whiteSpace: 'pre', opacity: t, transform: `translateY(${(1 - t) * 0.3 * line.fontPx}px) scale(${0.9 + 0.1 * t})`, filter: `blur(${(1 - t) * 10}px)`}}>
                {ch}
              </span>
            );
          })}
        </div>
      );
    })}
  </>
);

/** 9. gold gradient + glow (CSS only), a slow shine sweeps across. */
export const HeroGoldGlowBehind: React.FC<PresetProps> = ({event, local}) => (
  <StackLines
    event={event}
    local={local}
    render={(line, i) => {
      const shine = ((local * 2) % 160) - 30; // % across the word
      const style = lineStyle(line, event);
      return (
        <div key={i} style={{...style, backgroundImage: `linear-gradient(105deg, transparent ${shine - 12}%, rgba(255,255,255,0.85) ${shine}%, transparent ${shine + 12}%), ${gradientCss(line.fill)}`}}>
          {line.text}
        </div>
      );
    }}
  />
);

/** 10. horizontal light-streak word swap. */
export const HeroSwapStreak: React.FC<PresetProps> = ({event, local}) => (
  <StackLines
    event={event}
    local={local}
    render={(line, i) => {
      const s = swapState(line, local);
      const style = lineStyle(line, event);
      const p = clamp01(s.sinceSwap / 7);
      const streaking = line.swapWords.length > 0 && p < 1;
      return (
        <div key={i} style={{...style, overflow: 'visible'}}>
          {s.text}
          {streaking ? (
            <div style={{position: 'absolute', top: '-8%', bottom: '-8%', left: `${p * 110 - 10}%`, width: '14%', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.95), transparent)', filter: 'blur(5px)', WebkitTextFillColor: 'initial', mixBlendMode: 'screen'}} />
          ) : null}
        </div>
      );
    }}
  />
);

/** 11. thin lower-centre caption, always in front. */
export const CaptionSerifLower: React.FC<PresetProps> = p => <StackLines {...p} />;

/** 12. glossy 3D word rising (three). */
export const HeroExtruded3dRise: React.FC<PresetProps> = p => <Extruded3DText {...p} mode="rise" />;

/** 13. glossy 3D word on a back plane that follows the camera provider (the block keyframes carry the camera). */
export const HeroExtruded3dWorldAnchored: React.FC<PresetProps> = p => <Extruded3DText {...p} mode="world" />;

/** 14. one word at a time, hard replace, a unique gradient each. */
export const HeroGradientWordSequence: React.FC<PresetProps> = ({event, local}) => (
  <StackLines
    event={event}
    local={local}
    render={(line, i) => {
      const toks = line.text.split(/\s+/);
      let idx = 0;
      line.revealFrames.forEach((f, k) => {
        if (local >= f) idx = k;
      });
      const fill = line.wordFills[idx] ?? line.fill;
      return (
        <div key={i} style={lineStyle(line, event, fill)}>
          {toks[Math.min(idx, toks.length - 1)]}
        </div>
      );
    }}
  />
);

/** 15. stacked words, one accent colour, CSS extrude + drop shadow. */
export const HeroExtrudedStackFront: React.FC<PresetProps> = ({event, local}) => <StackLines event={event} local={local} stagger={2} extrude={cssExtrude('rgba(20,20,20,0.85)', Math.max(3, Math.round((event.lines[0]?.fontPx ?? 60) * 0.05)))} />;

/** 16. condensed hero behind the head + smaller support. */
export const StackCondensedHeroBehind: React.FC<PresetProps> = p => <StackLines {...p} stagger={2} />;

/** 17. one chromatic hero between two plain lines: RGB-split copies behind a gradient face. */
export const HeroChromaticMid: React.FC<PresetProps> = ({event, local}) => (
  <StackLines
    event={event}
    local={local}
    stagger={2}
    render={(line, i) => {
      const hero = line.role === 'hero';
      const jitter = 3 * Math.max(0, 1 - local / 14) + 1.5;
      const cyan: RenderLine['fill'] = {kind: 'solid', colors: ['#00E5FF'], angleDeg: 90};
      const red: RenderLine['fill'] = {kind: 'solid', colors: ['#FF2A6D'], angleDeg: 90};
      const t = clamp01((local - i * 2) / 8);
      const common = {opacity: t, transform: `translateY(${(1 - t) * 12}px)`};
      return (
        <div key={i} style={{position: 'absolute', inset: 0, ...common}}>
          {hero ? (
            <>
              <div style={{...lineStyle(line, event, cyan), transform: `translateX(${-jitter}px)`, mixBlendMode: 'screen', opacity: 0.7}}>{line.text}</div>
              <div style={{...lineStyle(line, event, red), transform: `translateX(${jitter}px)`, mixBlendMode: 'screen', opacity: 0.7}}>{line.text}</div>
            </>
          ) : null}
          <div style={lineStyle(line, event)}>{line.text}</div>
        </div>
      );
    }}
  />
);

/** 18. two heroes (the solver splits them into two blocks and solves layering independently). */
export const StackTwoHeroDepth: React.FC<PresetProps> = p => <StackLines {...p} stagger={0} />;

export const PRESET_COMPONENTS: Record<PresetName, React.FC<PresetProps>> = {
  'stack.serifHero.behind': StackSerifHeroBehind,
  'stack.mixed.between': StackMixedBetween,
  'plane3d.receding.swap': Plane3dRecedingSwap,
  'hero.thinSerif.front': HeroThinSerifFront,
  'fallback.boldCenter.front': FallbackBoldCenterFront,
  'hero.gradientWord.behind': HeroGradientWordBehind,
  'stack.twoCluster.behind': StackTwoClusterBehind,
  'hero.perLetter.behind': HeroPerLetterBehind,
  'hero.goldGlow.behind': HeroGoldGlowBehind,
  'hero.swapStreak': HeroSwapStreak,
  'caption.serif.lower': CaptionSerifLower,
  'hero.extruded3d.rise': HeroExtruded3dRise,
  'hero.extruded3d.worldAnchored': HeroExtruded3dWorldAnchored,
  'hero.gradientWord.sequence': HeroGradientWordSequence,
  'hero.extrudedStack.front': HeroExtrudedStackFront,
  'stack.condensedHero.behind': StackCondensedHeroBehind,
  'hero.chromatic.mid': HeroChromaticMid,
  'stack.twoHero.depth': StackTwoHeroDepth,
  'type.words': TypeWords,
  'type.matchCut': TypeMatchCutPreset,
};
