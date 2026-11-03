import React from 'react';

import {PlateGround, usePlateFps, usePlatePalette} from '../components/Plate';
import {Box, Reveal} from '../components/Reveal';
import {Shape} from '../components/Shapes';
import {FitText, KineticText} from '../components/Text';
import {scheduleFrames, type HighlightSpan} from '../highlightSchedule';
import {contentBox, sliceTop, type SafeArea} from '../layout';
import {MotionRecipe} from '../recipes/MotionRecipe';
import type {MotionRecipeId} from '../recipes/motionRecipes';
import {withAlpha} from '../theme';

export type TweetCardProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The post text (spoken words). */
  body: string;
  /** Display name and handle: optional, spoken words only. Without both, no header row is drawn. */
  name?: string;
  handle?: string;
  /** 1-3 spoken words or phrases the highlighter marks inside the body (a solid marker bar, drawn left to right). */
  highlight?: string[];
  /** WP12B: speech-synced highlighter (see WikiCallout). Absent / empty: the static `highlight` words. */
  highlightSchedule?: HighlightSpan[];
  /** WP14A: the entrance recipe of the sheet (motion only; the paper chrome is the host's). */
  recipeId?: MotionRecipeId;
  /** Opaque full-bleed background behind the card. Default true; set false to float the card over the footage. */
  background?: boolean;
};

/**
 * A captured post / article surface (WP10A): a paper card with a hairline border and minimal capture chrome (three dots), an optional letter-disc header, and the body landing word by
 * word with a DOMINANT highlighter on the marked words (full-strength marker bar, ink flipped for contrast). No images, no network. Colours come from the plate palette.
 */
export const TweetCard: React.FC<TweetCardProps> = ({width, height, safeArea, body, name, handle, highlight, highlightSchedule, recipeId = 'nested_scale_in', background = true}) => {
  const fps = usePlateFps();
  const walk = scheduleFrames(highlightSchedule, fps);
  const palette = usePlatePalette();
  const outer = contentBox(width, height, safeArea, Math.min(width, height) * 0.06);
  const pad = Math.min(outer.width, outer.height) * 0.05;
  const card = {x: outer.x, y: outer.y + outer.height * 0.16, width: outer.width, height: outer.height * 0.68};
  const radius = Math.min(card.width, card.height) * 0.05;
  const inner = {x: card.x + pad, y: card.y + pad, width: card.width - pad * 2, height: card.height - pad * 2};
  const [chrome, afterChrome] = sliceTop(inner, 0.07);
  const hasHeader = Boolean(name || handle);
  const [head, bodyBox] = hasHeader ? sliceTop(afterChrome, 0.22) : [null, afterChrome];
  const dot = Math.min(chrome.height * 0.55, chrome.width * 0.04);
  const disc = head ? Math.min(head.height, head.width * 0.2) : 0;
  const initial = (name ?? handle ?? '').replace(/^@/, '').trim().charAt(0).toUpperCase();
  const marked = walk.words.length > 0 ? walk.words.slice(0, 8) : (highlight ?? []).slice(0, 3);
  return (
    <>
      {background ? <PlateGround /> : null}
      <Box {...card}>
        <MotionRecipe recipeId={recipeId}>
          <div style={{width: card.width, height: card.height, background: palette.paper, borderRadius: radius, border: `2px solid ${withAlpha(palette.paperInk, 0.18)}`, boxShadow: `0 ${radius}px ${radius * 2}px rgba(0,0,0,0.38)`, transform: 'rotate(-1.2deg)'}} />
        </MotionRecipe>
      </Box>
      <Box {...chrome}>
        <Reveal delay={3}>
          <div style={{display: 'flex', alignItems: 'center', gap: dot * 0.8, height: chrome.height}}>
            {[0, 1, 2].map(i => (
              <Shape key={i} kind="circle" width={dot} height={dot} fill={withAlpha(palette.paperInk, 0.28)} />
            ))}
          </div>
        </Reveal>
      </Box>
      {head ? (
        <>
          <Box x={head.x} y={head.y} width={disc} height={disc}>
            <Reveal delay={4} effect="pop">
              <Shape kind="circle" width={disc} height={disc} fill={palette.marker} />
            </Reveal>
          </Box>
          {initial ? (
            <Box x={head.x} y={head.y} width={disc} height={disc}>
              <FitText text={initial} width={disc} height={disc * 0.7} maxLines={1} weight={900} color={palette.markerInk} />
            </Box>
          ) : null}
          <Box x={head.x + disc * 1.25} y={head.y} width={head.width - disc * 1.25} height={head.height}>
            <Reveal delay={6}>
              {name ? <FitText text={name} width={head.width - disc * 1.25} height={head.height * (handle ? 0.5 : 0.7)} maxLines={1} align="left" weight={800} color={palette.paperInk} /> : null}
              {handle ? <FitText text={handle} width={head.width - disc * 1.25} height={head.height * 0.4} maxLines={1} align="left" font="body" weight={500} color={palette.paperMuted} /> : null}
            </Reveal>
          </Box>
        </>
      ) : null}
      <Box {...bodyBox}>
        <KineticText text={body} width={bodyBox.width} height={bodyBox.height} maxLines={8} align="left" verticalAlign="top" weight={700} font="body" color={palette.paperInk} delay={10} each={2} highlight={marked} highlightStartFrames={walk.words.length > 0 ? walk.starts : undefined} highlightEndFrames={walk.words.length > 0 ? walk.ends : undefined} highlightStyle="marker" highlightColor={palette.marker} highlightInk={palette.markerInk} highlightOpacity={1} emphasisScale={1.06} />
      </Box>
    </>
  );
};
