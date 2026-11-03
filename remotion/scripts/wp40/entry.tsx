/**
 * WP40: Skill B (Explainer) layout proof (NOT part of the production bundle). The plan comes from the REAL pure planner (server/src/stages/broll/explainerPacing.ts, via wp40-preview.mjs -> wp40-plan.json);
 * each segment is drawn with the production-side layout frames (src/components/ExplainerLayouts.tsx):
 *   explainer_b  newspaper still (top) over the speaker stand-in (bottom), seam at 50 %
 *   explainer_a  full talking-head stand-in (the speaker is a fixture: no footage in the repo)
 *   explainer_c  WHITE + light-gray DOT GRID: logo chips (pop-in 0.5 s apart), connectors drawn on, a lime hub, a mock window
 *   explainer_d  dark, higher-contrast full-frame cutaway (a cached stock still stands in for the archival clip)
 *   explainer_a  (cta) talking head + lime FOLLOW pill stand-in
 * A tiny corner tag names the layout (proof only) and a STUB caption chunk sits at the grammar y (B 50 %, A/C/D 75 %); real chunk-swap captions are WP41. Hard cuts only, muted, 1080x1920 @ 30.
 */
import React from 'react';
import {AbsoluteFill, Composition, Img, Sequence, interpolate, registerRoot, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {loadFont} from '@remotion/google-fonts/Poppins';

import {ExplainerLayoutFrame} from '../../src/components/ExplainerLayouts';
import {EXPLAINER_CAPTION_Y_PCT, EXPLAINER_CHIP_STAGGER_SEC, EXPLAINER_LIME, type ExplainerLayoutId} from '../../src/lib/explainerLayouts';
import {Footage, H, LOGOS, W} from '../wp23/shared';
import plan from '../../out/phase36-readiness/wp40-plan.json';

const {fontFamily} = loadFont('normal', {weights: ['800'], subsets: ['latin']});
const FPS = 30;
const frameOf = (sec: number) => Math.round(sec * FPS);

type Segment = {start: number; end: number; layout: ExplainerLayoutId; role: string};
const segments = plan.pacing.segments as Segment[];
const captions = plan.captions as Array<{text: string}>;
const files = plan.files as {broll: string; cutaway: string};

/** `crop`: the speaker framed head + shoulders inside the 960 px tall Layout B slot (the stand-in is drawn on a full 1920 px canvas, shifted up). */
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

const NAMES = ['Stripe', 'Notion', 'Linear'];
const CHIP_X = [150, 420, 690];
const HUB = {x: 540, y: 880};
const Diagram: React.FC = () => {
  const frame = useCurrentFrame();
  const draw = (from: number, len = 14) => interpolate(frame, [from, from + len], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const pop = (from: number) => spring({frame: frame - from, fps: FPS, config: {damping: 12, stiffness: 180}});
  const chipFrom = (index: number) => 6 + Math.round(index * EXPLAINER_CHIP_STAGGER_SEC * FPS);
  const hubFrom = chipFrom(2) + 14;
  const winFrom = hubFrom + 12;
  return (
    <AbsoluteFill>
      <div style={{position: 'absolute', top: 120, width: '100%', textAlign: 'center', fontFamily, fontWeight: 800, fontSize: 64, color: '#111', opacity: draw(0, 10)}}>
        <span style={{background: EXPLAINER_LIME, padding: '6px 26px', borderRadius: 18}}>who ships agents</span>
      </div>
      <svg width={W} height={H} style={{position: 'absolute', left: 0, top: 0}}>
        {CHIP_X.map((x, index) => {
          const x1 = x + 120;
          const y1 = 586;
          const length = Math.hypot(HUB.x - x1, HUB.y - 120 - y1);
          return <line key={index} x1={x1} y1={y1} x2={HUB.x} y2={HUB.y - 120} stroke="#111" strokeWidth={6} strokeLinecap="round" strokeDasharray={length} strokeDashoffset={length * (1 - draw(chipFrom(index) + 10))} />;
        })}
        <line x1={HUB.x} y1={HUB.y + 120} x2={HUB.x} y2={1090} stroke="#111" strokeWidth={6} strokeLinecap="round" strokeDasharray={80} strokeDashoffset={80 * (1 - draw(hubFrom + 6))} />
      </svg>
      {CHIP_X.map((x, index) => (
        <div key={index} style={{position: 'absolute', left: x, top: 240, width: 240, transform: `scale(${pop(chipFrom(index))})`, transformOrigin: '50% 50%', textAlign: 'center', fontFamily, fontWeight: 800, fontSize: 38, color: '#111'}}>
          <Img src={LOGOS[index % LOGOS.length]!} style={{width: 220, height: 220, borderRadius: 44, boxShadow: '0 10px 30px rgba(0,0,0,0.18)'}} />
          <div style={{marginTop: 12}}>{NAMES[index]}</div>
        </div>
      ))}
      <div style={{position: 'absolute', left: HUB.x - 120, top: HUB.y - 120, width: 240, height: 240, borderRadius: 120, background: EXPLAINER_LIME, border: '6px solid #111', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily, fontWeight: 800, fontSize: 52, color: '#111', transform: `scale(${pop(hubFrom)})`}}>agent</div>
      <div style={{position: 'absolute', left: 150, top: 1090, width: 780, height: 250, borderRadius: 28, background: '#fff', border: '6px solid #111', boxShadow: '0 16px 40px rgba(0,0,0,0.2)', overflow: 'hidden', opacity: draw(winFrom, 8), transform: `translateY(${(1 - draw(winFrom, 10)) * 30}px)`}}>
        <div style={{height: 56, background: '#E5E7EB', display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 22}}>
          {['#F87171', '#FBBF24', '#34D399'].map(color => <div key={color} style={{width: 18, height: 18, borderRadius: 9, background: color}} />)}
        </div>
        {[0.78, 0.55, 0.68].map((w, index) => (
          <div key={index} style={{margin: '26px 30px 0', height: 30, width: `${w * 100 * draw(winFrom + 10 + index * 8, 14)}%`, borderRadius: 15, background: index === 1 ? EXPLAINER_LIME : '#D1D5DB'}} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

const FollowPill: React.FC = () => {
  const frame = useCurrentFrame();
  const scale = spring({frame: frame - 12, fps: FPS, config: {damping: 12, stiffness: 160}});
  return (
    <div style={{position: 'absolute', left: 0, width: '100%', top: 1560, display: 'flex', justifyContent: 'center', transform: `scale(${scale})`}}>
      <div style={{background: EXPLAINER_LIME, color: '#111', fontFamily, fontWeight: 800, fontSize: 56, padding: '16px 60px', borderRadius: 60}}>FOLLOW</div>
    </div>
  );
};

/** WP40 STUB caption: one static 1-3 word chunk at the grammar y (WP41 replaces it with chunk-swap). */
const StubCaption: React.FC<{layout: ExplainerLayoutId; text: string}> = ({layout, text}) => (
  <div style={{position: 'absolute', left: 60, right: 60, top: `${EXPLAINER_CAPTION_Y_PCT[layout]}%`, transform: 'translateY(-50%)', textAlign: 'center', fontFamily, fontWeight: 800, fontSize: 92, color: '#fff', WebkitTextStroke: '10px #000', paintOrder: 'stroke fill', textShadow: '0 6px 18px rgba(0,0,0,0.45)'}}>{text}</div>
);

const Tag: React.FC<{layout: ExplainerLayoutId; role: string}> = ({layout, role}) => (
  <div style={{position: 'absolute', left: 28, top: 28, padding: '6px 18px', borderRadius: 12, background: 'rgba(0,0,0,0.72)', color: '#fff', fontFamily, fontWeight: 800, fontSize: 34}}>
    LAYOUT {layout.slice(-1).toUpperCase()} · {role}
  </div>
);

const Shot: React.FC<{segment: Segment; caption: string}> = ({segment, caption}) => {
  const {layout, role} = segment;
  return (
    <AbsoluteFill>
      <ExplainerLayoutFrame layout={layout} width={W} height={H} broll={<CoverImg file={files.broll} />} speaker={<Speaker crop />}>
        {layout === 'explainer_c' ? <Diagram /> : layout === 'explainer_d' ? <CoverImg file={files.cutaway} push={0.03} /> : <Speaker />}
      </ExplainerLayoutFrame>
      {role === 'cta' ? <FollowPill /> : null}
      <StubCaption layout={layout} text={caption} />
      <Tag layout={layout} role={role} />
    </AbsoluteFill>
  );
};

const Explainer: React.FC = () => (
  <AbsoluteFill style={{backgroundColor: '#000'}}>
    {segments.map((segment, index) => (
      <Sequence key={index} from={frameOf(segment.start)} durationInFrames={Math.max(1, frameOf(segment.end) - frameOf(segment.start))}>
        <Shot segment={segment} caption={captions[index]?.text ?? ''} />
      </Sequence>
    ))}
  </AbsoluteFill>
);

const Root: React.FC = () => <Composition id="WP40Explainer" component={Explainer} width={W} height={H} fps={FPS} durationInFrames={frameOf(plan.durationSec)} />;
registerRoot(Root);
