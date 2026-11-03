/**
 * WP41: Skill B (Explainer) captions + lime highlight proof (NOT part of the production bundle). The plan comes from the REAL pure planners (server explainerPacing + explainerClaims + polishExplainerCaptions,
 * via wp41-preview.mjs -> wp41-plan.json): hard-cut layouts A / B / C / D, a claim beat (layout B: a FAKE article on top, the speaker below) wherever a number / amount is spoken over a plain talking head,
 * and the production caption component (`ChunkSwapCaptions`, mode chunk_swap) reading the same direction (`yTrack`, `cutTimes`) the server writes.
 *   explainer_b hook   newspaper still (top) over the speaker stand-in
 *   explainer_b beat   FAKE article plate + LimeHighlightWipe on the claim phrase ("$1.4 trillion"): the rest of the page dims to 0.28, a lime #BFFF00 bar wipes L -> R
 *   explainer_c        white + dot-grid diagram; logo chips pop in on the spoken name (>= 0.5 s apart), connectors drawn on
 *   explainer_d        dark cutaway still;  explainer_a  the speaker stand-in (no footage in the repo)
 * Proof-only: a corner tag naming the layout, the FOLLOW pill stand-in. `captions=false` (input prop) renders the same frame without captions so the script can measure the caption bbox by diff.
 * Hard cuts only, muted, 1080x1920 @ 30. No SFX.
 */
import React from 'react';
import {AbsoluteFill, Composition, Img, Sequence, continueRender, delayRender, getInputProps, interpolate, registerRoot, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {loadFont as loadInter} from '@remotion/google-fonts/Inter';
import {loadFont as loadPlayfair} from '@remotion/google-fonts/PlayfairDisplay';
import {loadFont as loadPoppins} from '@remotion/google-fonts/Poppins';

import {ChunkSwapCaptions} from '../../src/components/ChunkSwapCaptions';
import {ExplainerLayoutFrame} from '../../src/components/ExplainerLayouts';
import {LimeHighlightWipe} from '../../src/components/LimeHighlightWipe';
import {EXPLAINER_CHIP_STAGGER_SEC, EXPLAINER_LIME, explainerRegions, type ExplainerLayoutId} from '../../src/lib/explainerLayouts';
import type {HighlightRect} from '../../src/lib/limeHighlight';
import {Footage, H, LOGOS, W} from '../wp23/shared';
import plan from '../../out/phase36-readiness/wp41-plan.json';

const {fontFamily: poppins} = loadPoppins('normal', {weights: ['800'], subsets: ['latin']});
const {fontFamily: serif} = loadPlayfair('normal', {weights: ['700', '900'], subsets: ['latin']});
const {fontFamily: sans} = loadInter('normal', {weights: ['400', '600'], subsets: ['latin']});
const FPS = 30;
const frameOf = (sec: number) => Math.round(sec * FPS);

type Span = {start: number; end: number; layout: ExplainerLayoutId};
type Beat = {start: number; end: number; highlight: {phrase: string; start: number; end: number}};
const track = plan.claims.layoutTrack as Span[];
const beats = plan.claims.beats as Beat[];
const roles = plan.pacing.segments as Array<{start: number; end: number; layout: ExplainerLayoutId; role: string}>;
const files = plan.files as {broll: string; cutaway: string};
const nameClaims = (plan.claims.claims as Array<{kind: string; text: string; start: number}>).filter(claim => claim.kind === 'name');

const Speaker: React.FC<{crop?: boolean}> = ({crop = false}) =>
  crop ? (
    <div style={{position: 'absolute', left: 0, top: -470, width: W, height: H}}>
      <Footage moving />
    </div>
  ) : (
    <Footage moving />
  );

const CoverImg: React.FC<{file: string; push?: number}> = ({file, push = 0.04}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const scale = 1 + push * Math.min(1, frame / Math.max(1, durationInFrames));
  return <Img src={staticFile(`wp36-fixtures/${file}`)} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})`}} />;
};

// ---- the fake article plate (top half of layout B): a paper page; the key phrase is measured from the DOM (Range rects) so the lime bar sits exactly behind it ----
const TOP = explainerRegions('explainer_b', W, H).top!;
const BODY_PX = 46;
const ARTICLE_BODY = ['In its annual letter the payments company said it processed ', 'KEY', ' in total volume last year, up 38 percent from the year before, as more AI startups built on its platform.'];
const GRAY_BODY = 'Analysts said the growth was led by subscription billing and by software teams that now send every customer charge through a single programmable API instead of stitching together banks.';

const ArticleBody: React.FC<{phrase: string; keyRef?: React.Ref<HTMLSpanElement>}> = ({phrase, keyRef}) => (
  <AbsoluteFill style={{backgroundColor: '#F6F3EA', color: '#16140F'}}>
    <div style={{position: 'absolute', left: 0, right: 0, top: 36, textAlign: 'center', fontFamily: serif, fontWeight: 900, fontSize: 66, letterSpacing: 2}}>THE DAILY LEDGER</div>
    <div style={{position: 'absolute', left: 60, right: 60, top: 120, borderTop: '4px solid #16140F', borderBottom: '1.5px solid #16140F', height: 12}} />
    <div style={{position: 'absolute', left: 60, right: 60, top: 160, fontFamily: sans, fontWeight: 600, fontSize: 26, letterSpacing: 3, color: '#6B655A'}}>BUSINESS · PAYMENTS</div>
    <div style={{position: 'absolute', left: 60, right: 60, top: 206, fontFamily: serif, fontWeight: 900, fontSize: 76, lineHeight: 1.04}}>Payments giant posts record year</div>
    <div style={{position: 'absolute', left: 60, right: 60, top: 372, fontFamily: sans, fontWeight: 400, fontSize: BODY_PX, lineHeight: 1.4, textAlign: 'left'}}>
      {ARTICLE_BODY[0]}
      <span ref={keyRef} data-key-phrase="true">{phrase}</span>
      {ARTICLE_BODY[2]}
    </div>
    <div style={{position: 'absolute', left: 60, right: 60, top: 688, fontFamily: sans, fontWeight: 400, fontSize: BODY_PX, lineHeight: 1.4}}>{GRAY_BODY}</div>
  </AbsoluteFill>
);

/** Measure the phrase span's line boxes (fractions of the plate) once fonts are loaded; the render waits for it (delayRender). */
function usePhraseRects(phrase: string): {rects: HighlightRect[]; probe: React.ReactNode} {
  const [rects, setRects] = React.useState<HighlightRect[] | null>(null);
  const [handle] = React.useState(() => delayRender('measure article phrase'));
  const ref = React.useRef<HTMLSpanElement>(null);
  const holder = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    let cancelled = false;
    Promise.all([document.fonts.ready, document.fonts.load(`900 66px ${serif}`), document.fonts.load(`400 ${BODY_PX}px ${sans}`)]).then(() => {
      if (cancelled || !ref.current || !holder.current) return;
      const base = holder.current.getBoundingClientRect();
      const lines = [...ref.current.getClientRects()];
      setRects(lines.map(rect => ({x: (rect.left - base.left) / TOP.w, y: (rect.top - base.top) / TOP.h, w: rect.width / TOP.w, h: rect.height / TOP.h})));
      continueRender(handle);
    });
    return () => {
      cancelled = true;
    };
  }, [handle]);
  // the measurement copy is invisible and sits under everything (never painted into the frame)
  const probe = (
    <div ref={holder} style={{position: 'absolute', left: 0, top: 0, width: TOP.w, height: TOP.h, visibility: 'hidden', pointerEvents: 'none'}}>
      <ArticleBody phrase={phrase} keyRef={ref} />
    </div>
  );
  return {rects: rects ?? [], probe};
}

const ArticlePlate: React.FC<{beat: Beat; startFrameOffset: number}> = ({beat, startFrameOffset}) => {
  const {rects, probe} = usePhraseRects(beat.highlight.phrase);
  return (
    <AbsoluteFill>
      {probe}
      <LimeHighlightWipe width={TOP.w} height={TOP.h} rects={rects} startFrame={startFrameOffset}>
        <ArticleBody phrase={beat.highlight.phrase} />
      </LimeHighlightWipe>
    </AbsoluteFill>
  );
};

// ---- layout C: logo chips pop on the spoken name (>= 0.5 s apart), connectors drawn on ----
const NAMES = ['Stripe', 'Notion', 'Linear'];
const CHIP_X = [150, 420, 690];
const HUB = {x: 540, y: 880};
const Diagram: React.FC<{segStart: number}> = ({segStart}) => {
  const frame = useCurrentFrame();
  const draw = (from: number, len = 14) => interpolate(frame, [from, from + len], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const pop = (from: number) => spring({frame: frame - from, fps: FPS, config: {damping: 12, stiffness: 180}});
  // each chip pops when its name is spoken (the claim -> visual rule), never less than the grammar's 0.5 s after the previous chip
  const popAt: number[] = [];
  NAMES.forEach((name, index) => {
    const spoken = nameClaims.find(claim => claim.text.toLowerCase() === name.toLowerCase() && claim.start >= segStart - 0.2 && claim.start < segStart + 6);
    const wanted = spoken ? frameOf(spoken.start - segStart) - 2 : 6 + index * frameOf(EXPLAINER_CHIP_STAGGER_SEC);
    popAt.push(Math.max(index === 0 ? 0 : popAt[index - 1]! + frameOf(EXPLAINER_CHIP_STAGGER_SEC), wanted));
  });
  const hubFrom = popAt[2]! + 14;
  const winFrom = hubFrom + 12;
  return (
    <AbsoluteFill>
      <div style={{position: 'absolute', top: 120, width: '100%', textAlign: 'center', fontFamily: poppins, fontWeight: 800, fontSize: 64, color: '#111', opacity: draw(0, 10)}}>
        <span style={{background: EXPLAINER_LIME, padding: '6px 26px', borderRadius: 18}}>who ships agents</span>
      </div>
      <svg width={W} height={H} style={{position: 'absolute', left: 0, top: 0}}>
        {CHIP_X.map((x, index) => {
          const x1 = x + 120;
          const y1 = 586;
          const length = Math.hypot(HUB.x - x1, HUB.y - 120 - y1);
          return <line key={index} x1={x1} y1={y1} x2={HUB.x} y2={HUB.y - 120} stroke="#111" strokeWidth={6} strokeLinecap="round" strokeDasharray={length} strokeDashoffset={length * (1 - draw(popAt[index]! + 10))} />;
        })}
      </svg>
      {CHIP_X.map((x, index) => (
        <div key={index} style={{position: 'absolute', left: x, top: 240, width: 240, transform: `scale(${pop(popAt[index]!)})`, transformOrigin: '50% 50%', textAlign: 'center', fontFamily: poppins, fontWeight: 800, fontSize: 38, color: '#111'}}>
          <Img src={LOGOS[index % LOGOS.length]!} style={{width: 220, height: 220, borderRadius: 44, boxShadow: '0 10px 30px rgba(0,0,0,0.18)'}} />
          <div style={{marginTop: 12}}>{NAMES[index]}</div>
        </div>
      ))}
      <div style={{position: 'absolute', left: HUB.x - 120, top: HUB.y - 120, width: 240, height: 240, borderRadius: 120, background: EXPLAINER_LIME, border: '6px solid #111', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: poppins, fontWeight: 800, fontSize: 52, color: '#111', transform: `scale(${pop(hubFrom)})`}}>agent</div>
      <div style={{position: 'absolute', left: 150, top: 1090, width: 780, height: 210, borderRadius: 28, background: '#fff', border: '6px solid #111', boxShadow: '0 16px 40px rgba(0,0,0,0.2)', overflow: 'hidden', opacity: draw(winFrom, 8), transform: `translateY(${(1 - draw(winFrom, 10)) * 30}px)`}}>
        <div style={{height: 56, background: '#E5E7EB', display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 22}}>
          {['#F87171', '#FBBF24', '#34D399'].map(color => <div key={color} style={{width: 18, height: 18, borderRadius: 9, background: color}} />)}
        </div>
        {[0.78, 0.55, 0.68].map((w, index) => (
          <div key={index} style={{margin: '20px 30px 0', height: 26, width: `${w * 100 * draw(winFrom + 10 + index * 8, 14)}%`, borderRadius: 13, background: index === 1 ? EXPLAINER_LIME : '#D1D5DB'}} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

const FollowPill: React.FC = () => {
  const frame = useCurrentFrame();
  const scale = spring({frame: frame - 12, fps: FPS, config: {damping: 12, stiffness: 160}});
  return (
    <div style={{position: 'absolute', left: 0, width: '100%', top: 1640, display: 'flex', justifyContent: 'center', transform: `scale(${scale})`}}>
      <div style={{background: EXPLAINER_LIME, color: '#111', fontFamily: poppins, fontWeight: 800, fontSize: 56, padding: '16px 60px', borderRadius: 60}}>FOLLOW</div>
    </div>
  );
};

const Tag: React.FC<{text: string}> = ({text}) => (
  <div style={{position: 'absolute', left: 28, top: 1822, padding: '6px 18px', borderRadius: 12, background: 'rgba(0,0,0,0.72)', color: '#fff', fontFamily: poppins, fontWeight: 800, fontSize: 34, zIndex: 40}}>{text}</div>
);

const Shot: React.FC<{span: Span}> = ({span}) => {
  const beat = span.layout === 'explainer_b' ? beats.find(item => Math.abs(item.start - span.start) < 0.01) : undefined;
  const role = roles.find(segment => segment.start <= span.start + 0.01 && segment.end > span.start + 0.01)?.role ?? '';
  const tag = beat ? 'LAYOUT B · claim beat' : `LAYOUT ${span.layout.slice(-1).toUpperCase()} · ${role}`;
  return (
    <AbsoluteFill>
      <ExplainerLayoutFrame
        layout={span.layout}
        width={W}
        height={H}
        broll={beat ? <ArticlePlate beat={beat} startFrameOffset={frameOf(beat.highlight.start - beat.start)} /> : <CoverImg file={files.broll} />}
        speaker={<Speaker crop />}>
        {span.layout === 'explainer_c' ? <Diagram segStart={span.start} /> : span.layout === 'explainer_d' ? <CoverImg file={files.cutaway} push={0.03} /> : <Speaker />}
      </ExplainerLayoutFrame>
      {role === 'cta' ? <FollowPill /> : null}
      <Tag text={tag} />
    </AbsoluteFill>
  );
};

const Explainer: React.FC = () => {
  const showCaptions = (getInputProps() as {captions?: boolean}).captions !== false;
  return (
    <AbsoluteFill style={{backgroundColor: '#000'}}>
      {track.map((span, index) => (
        <Sequence key={index} from={frameOf(span.start)} durationInFrames={Math.max(1, frameOf(span.end) - frameOf(span.start))}>
          <Shot span={span} />
        </Sequence>
      ))}
      {showCaptions ? <ChunkSwapCaptions words={plan.words as never} language="en" direction={plan.direction as never} /> : null}
    </AbsoluteFill>
  );
};

const Root: React.FC = () => <Composition id="WP41Explainer" component={Explainer} width={W} height={H} fps={FPS} durationInFrames={frameOf(plan.durationSec)} defaultProps={{captions: true}} />;
registerRoot(Root);
