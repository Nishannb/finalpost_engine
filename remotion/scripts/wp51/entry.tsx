/**
 * WP51 Layer-2 proof (NOT part of the production bundle). Cycles the five NEW motion-template comps (ChatConversationBubbles, SalePromoCountdown, ColorWordWheel, TrackingCollapseHeadline, SpatialBlurTiltReveal) back to back, each at its natural length
 * (10.25 / 2.87 / 4.38 / 1.21 / 1.61 s), each fed the props the REAL server library registry resolved from `{motionTemplateId}` (`wp51-plan.json`, written by wp51-preview.mjs). Demo copy / colours are proof-shell only (live polish binds video copy + editPalette).
 * All five are opaque full-bleed templates (they own the frame, captions muted); the 1:1 / 4:5 / 16:10 boards are letterboxed in the portrait canvas. Silent. 1080x1920 @30. No captions. Capture chrome (dashed outlines, handles, cursor) is NOT drawn.
 */
import React from 'react';
import {AbsoluteFill, Composition, Sequence, continueRender, delayRender, registerRoot} from 'remotion';

import {loadMotionFonts} from '../../src/motion/fonts';
import {ChatConversationBubbles} from '../../src/motion/compositions/templates/ChatConversationBubbles';
import {ColorWordWheel} from '../../src/motion/compositions/templates/ColorWordWheel';
import {SalePromoCountdown} from '../../src/motion/compositions/templates/SalePromoCountdown';
import {SpatialBlurTiltReveal} from '../../src/motion/compositions/templates/SpatialBlurTiltReveal';
import {TrackingCollapseHeadline} from '../../src/motion/compositions/templates/TrackingCollapseHeadline';
import {Themed, H, SAFE, W} from '../wp23/shared';
import plan from '../../out/phase36-readiness/wp51-plan.json';

// Inter comes from the toolkit's bundled fonts (no network).
const fontsHandle = delayRender('wp51 motion fonts');
loadMotionFonts().then(
  () => continueRender(fontsHandle),
  () => continueRender(fontsHandle),
);

const FPS = 30;
const f = (sec: number) => Math.round(sec * FPS);

type Demo = {templateId: string; compositionId: string; props: Record<string, unknown>; durationSec: number};
const demos = plan.demos as unknown as Demo[];

const render = (demo: Demo): React.ReactNode => {
  const common = {width: W, height: H, safeArea: SAFE};
  const props = demo.props as object;
  switch (demo.compositionId) {
    case 'ChatConversationBubbles':
      return <ChatConversationBubbles {...common} {...props} />;
    case 'SalePromoCountdown':
      return <SalePromoCountdown {...common} {...props} />;
    case 'ColorWordWheel':
      return <ColorWordWheel {...common} {...props} />;
    case 'TrackingCollapseHeadline':
      return <TrackingCollapseHeadline {...common} {...props} />;
    default:
      return <SpatialBlurTiltReveal {...common} {...props} />;
  }
};

const Proof: React.FC = () => {
  let at = 0;
  return (
    <AbsoluteFill style={{backgroundColor: '#000'}}>
      {demos.map(demo => {
        const from = at;
        at += f(demo.durationSec);
        return (
          <Sequence key={demo.templateId} from={from} durationInFrames={f(demo.durationSec)}>
            <Themed>{render(demo)}</Themed>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const total = demos.reduce((sum, demo) => sum + f(demo.durationSec), 0);
const Root: React.FC = () => <Composition id="WP51MotionTemplates" component={Proof} width={W} height={H} fps={FPS} durationInFrames={total} />;
registerRoot(Root);
