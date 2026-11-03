/**
 * WP42: the pieces ShortVideo draws INSIDE the Skill B layout frames (media plate, article plate body, text fallback plate). Pure presentation: no planning, no env.
 *   ExplainerMedia        the planned still / clip of a layout span (B: fills the top half, C: a card on the dot grid, D: full-bleed under the dark grade); a text-only plan draws ExplainerTextPlate
 *   ExplainerArticleBody  the claim beat's plate: a paper excerpt of the spoken line, the key phrase measured from the DOM (`useArticlePhraseRects`) so the lime bar sits exactly behind it
 *   ExplainerTextPlate    the honest fallback when no picture could be found: the phrase on a plate (never a blank frame)
 * ShortVideo mounts the lime wipe itself (`LimeHighlightWipe`) around the article body.
 */
import React from 'react';
import {AbsoluteFill, Img, OffthreadVideo, continueRender, delayRender, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

import type {VisualOverlay} from '../blueprintSchema';
import {EXPLAINER_LIME} from '../lib/explainerLayouts';
import {EXPLAINER_FALLBACK_RECT, plateFontPx, splitPlateContext, type ExplainerMountLayout} from '../lib/explainerMount';
import type {HighlightRect} from '../lib/limeHighlight';
import {resolveMediaSrc} from '../lib/mediaSrc';
import {secToFrame} from '../lib/timeline';

const SERIF = "Georgia, 'Times New Roman', 'Liberation Serif', serif";
const SANS = "'Helvetica Neue', Arial, 'Liberation Sans', sans-serif";

/** The fallback plate: the phrase (uppercase, heavy) on the layout's own ground. C: accent pill on paper; B / D: white on near-black. */
export const ExplainerTextPlate: React.FC<{text: string; layout: ExplainerMountLayout; accentColor?: string; inkOnAccent?: string}> = ({
  text,
  layout,
  accentColor = EXPLAINER_LIME,
  inkOnAccent = '#111111',
}) => {
  const light = layout === 'explainer_c';
  return (
    <AbsoluteFill data-explainer-text-plate="true" style={{background: light ? 'transparent' : 'linear-gradient(180deg, #14171C 0%, #07080A 100%)', alignItems: 'center', justifyContent: 'center', padding: 70}}>
      {text ? (
        <div style={{fontFamily: SANS, fontWeight: 900, fontSize: 84, lineHeight: 1.05, textAlign: 'center', textTransform: 'uppercase', color: light ? inkOnAccent : '#FFFFFF', ...(light ? {background: accentColor, padding: '14px 36px', borderRadius: 22} : {})}}>{text}</div>
      ) : null}
    </AbsoluteFill>
  );
};

const MediaFill: React.FC<{overlay: VisualOverlay; startFrame: number; durationFrames: number}> = ({overlay, startFrame, durationFrames}) => {
  const frame = useCurrentFrame();
  const progress = Math.min(1, Math.max(0, (frame - startFrame) / Math.max(1, durationFrames)));
  const src = resolveMediaSrc(overlay.assetUrl);
  if (overlay.mediaKind === 'video') return <OffthreadVideo src={src} muted style={{width: '100%', height: '100%', objectFit: 'cover'}} />;
  const scale = interpolate(progress, [0, 1], [1, 1.05]);
  return <Img src={src} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})`}} />;
};

/** The media of one layout span (`overlay` may be absent: the layout then shows its honest empty state). */
export const ExplainerMedia: React.FC<{
  overlay?: VisualOverlay;
  layout: 'explainer_b' | 'explainer_c' | 'explainer_d';
  width: number;
  height: number;
  accentColor?: string;
  inkOnAccent?: string;
}> = ({overlay, layout, width, height, accentColor = EXPLAINER_LIME, inkOnAccent = '#111111'}) => {
  const {fps} = useVideoConfig();
  const label = (overlay?.overlayText || overlay?.keyword || '').trim();
  const hasMedia = Boolean(overlay && overlay.mediaKind !== 'text' && overlay.assetUrl);
  const startFrame = overlay ? secToFrame(overlay.start, fps) : 0;
  const durationFrames = overlay ? Math.max(1, secToFrame(overlay.end, fps) - startFrame) : 1;
  if (!overlay || !hasMedia) return <ExplainerTextPlate text={label} layout={layout} accentColor={accentColor} inkOnAccent={inkOnAccent} />;
  if (layout === 'explainer_c') {
    // a card on the diagram ground; accent label pill above it (preferred lime, or editPalette.accent)
    const cardW = Math.round(width * 0.84);
    const cardH = Math.round(height * 0.5);
    return (
      <AbsoluteFill data-explainer-media="explainer_c">
        <div style={{position: 'absolute', left: (width - cardW) / 2, top: Math.round(height * 0.17), width: cardW, height: cardH, borderRadius: 34, overflow: 'hidden', border: '6px solid #111', boxShadow: '0 18px 44px rgba(0,0,0,0.22)', backgroundColor: '#E5E7EB'}}>
          <MediaFill overlay={overlay} startFrame={startFrame} durationFrames={durationFrames} />
        </div>
        {label ? (
          <div style={{position: 'absolute', left: 0, width: '100%', top: Math.round(height * 0.075), textAlign: 'center', fontFamily: SANS, fontWeight: 900, fontSize: 60, color: inkOnAccent, textTransform: 'uppercase'}}>
            <span style={{background: accentColor, padding: '6px 26px', borderRadius: 18}}>{label}</span>
          </div>
        ) : null}
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill data-explainer-media={layout}>
      <MediaFill overlay={overlay} startFrame={startFrame} durationFrames={durationFrames} />
    </AbsoluteFill>
  );
};

/** The article plate's paper body: a spoken-line excerpt with the key phrase in its own span (`keyRef`, measured by `useArticlePhraseRects`). */
export const ExplainerArticleBody: React.FC<{context?: string; phrase: string; width: number; keyRef?: React.Ref<HTMLSpanElement>}> = ({context, phrase, width, keyRef}) => {
  const parts = splitPlateContext(context, phrase);
  const px = plateFontPx((context ?? '').length, width);
  const pad = Math.round(width * 0.075);
  return (
    <AbsoluteFill data-explainer-article="true" style={{backgroundColor: '#F6F3EA', color: '#16140F'}}>
      <div style={{position: 'absolute', left: pad, right: pad, top: Math.round(width * 0.06), fontFamily: SERIF, fontWeight: 700, fontSize: Math.round(width * 0.028), letterSpacing: Math.round(width * 0.005), color: '#6B655A', textTransform: 'uppercase'}}>On the record</div>
      <div style={{position: 'absolute', left: pad, right: pad, top: Math.round(width * 0.11), borderTop: '4px solid #16140F', height: 8, borderBottom: '1.5px solid #16140F'}} />
      <div style={{position: 'absolute', left: pad, right: pad, top: Math.round(width * 0.2), fontFamily: SERIF, fontWeight: 400, fontSize: px, lineHeight: 1.38, textAlign: 'left'}}>
        {parts.before}
        <span ref={keyRef} data-key-phrase="true" style={{fontWeight: 700}}>
          {parts.phrase}
        </span>
        {parts.after}
      </div>
    </AbsoluteFill>
  );
};

/**
 * Measure the key phrase's line boxes (fractions of the plate) once fonts are ready; the render waits for it (delayRender). A failed / empty measurement returns the fallback band and says so (`measured: false`);
 * it never throws and never leaves the render waiting. `probe` is an invisible copy of the body the span lives in (never painted).
 */
export function useArticlePhraseRects(args: {context?: string; phrase: string; width: number; height: number}): {rects: HighlightRect[]; measured: boolean; settled: boolean; probe: React.ReactNode} {
  const {context, phrase, width, height} = args;
  const [state, setState] = React.useState<{rects: HighlightRect[]; measured: boolean} | null>(null);
  const [handle] = React.useState(() => delayRender('explainer: measure the article phrase'));
  const released = React.useRef(false);
  const ref = React.useRef<HTMLSpanElement>(null);
  const holder = React.useRef<HTMLDivElement>(null);
  const release = React.useCallback(() => {
    if (released.current) return;
    released.current = true;
    continueRender(handle);
  }, [handle]);
  React.useEffect(() => {
    let cancelled = false;
    const settle = (next: {rects: HighlightRect[]; measured: boolean}) => {
      if (!cancelled) setState(next);
      release();
    };
    Promise.resolve(typeof document !== 'undefined' && document.fonts ? document.fonts.ready : undefined)
      .then(() => {
        const node = ref.current;
        const box = holder.current;
        if (!node || !box) return settle({rects: [], measured: false});
        const base = box.getBoundingClientRect();
        const lines = Array.from(node.getClientRects()).filter(rect => rect.width > 1 && rect.height > 1);
        if (lines.length === 0 || base.width <= 0 || base.height <= 0) return settle({rects: [], measured: false});
        settle({rects: lines.map(rect => ({x: (rect.left - base.left) / base.width, y: (rect.top - base.top) / base.height, w: rect.width / base.width, h: rect.height / base.height})), measured: true});
      })
      .catch(() => settle({rects: [], measured: false}));
    return () => {
      cancelled = true;
      release();
    };
  }, [release, context, phrase]);
  const probe = (
    <div ref={holder} style={{position: 'absolute', left: 0, top: 0, width, height, visibility: 'hidden', pointerEvents: 'none'}}>
      <ExplainerArticleBody context={context} phrase={phrase} width={width} keyRef={ref} />
    </div>
  );
  if (!state) return {rects: [], measured: false, settled: false, probe};
  return {rects: state.measured ? state.rects : [EXPLAINER_FALLBACK_RECT], measured: state.measured, settled: true, probe};
}
