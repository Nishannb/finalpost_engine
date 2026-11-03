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

export type WikiCalloutProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The article passage (spoken words). The library registry passes `passage`. */
  passage?: string;
  /** Alias of `passage` (kept for older callers). */
  body?: string;
  /** Optional article heading (spoken words). Without it only the page chrome is drawn above the passage. */
  title?: string;
  /** 1-3 spoken words or phrases the highlighter marks inside the passage (solid marker bar, drawn left to right). */
  highlight?: string[];
  /** WP12B: speech-synced highlighter. Spans of `{word, fromSec, toSec}` (seconds from the start of this graphic; every word is a whole word of the passage): the marker walks the passage as each word is spoken. Absent / empty: the static `highlight` words. */
  highlightSchedule?: HighlightSpan[];
  /** WP14A: the entrance recipe of the sheet (motion only; the paper chrome is the host's). */
  recipeId?: MotionRecipeId;
  /** Opaque full-bleed background behind the page. Default true; set false to float the page over the footage. */
  background?: boolean;
};

/**
 * A captured encyclopedia / article page (WP10B), deliberately unlike the social TweetCard: a full-width paper page with a tab strip, a heading with a double rule, a column of grey "contents" bars
 * on the left and the passage on the right with a DOMINANT highlighter on the marked words. Text-free chrome (bars, dots); only spoken words are text. Colours come from the plate palette.
 */
export const WikiCallout: React.FC<WikiCalloutProps> = ({width, height, safeArea, passage, body, title, highlight, highlightSchedule, recipeId = 'split_mask_reveal', background = true}) => {
  const fps = usePlateFps();
  const walk = scheduleFrames(highlightSchedule, fps);
  const text = passage ?? body ?? '';
  const palette = usePlatePalette();
  const outer = contentBox(width, height, safeArea, Math.min(width, height) * 0.05);
  const page = {x: outer.x, y: outer.y + outer.height * 0.12, width: outer.width, height: outer.height * 0.76};
  const radius = Math.min(page.width, page.height) * 0.025;
  const pad = Math.min(page.width, page.height) * 0.05;
  const inner = {x: page.x + pad, y: page.y + pad, width: page.width - pad * 2, height: page.height - pad * 2};
  const [tabs, afterTabs] = sliceTop(inner, 0.025, inner.height * 0.02);
  const [head, content] = title ? sliceTop(afterTabs, 0.2, inner.height * 0.01) : [null, afterTabs];
  const [rule, main] = sliceTop(content, Math.max(6, content.height * 0.012), content.height * 0.03);
  const textBox = main;
  const marked = walk.words.length > 0 ? walk.words.slice(0, 8) : (highlight ?? []).slice(0, 3);
  return (
    <>
      {background ? <PlateGround /> : null}
      <Box {...page}>
        <MotionRecipe recipeId={recipeId}>
          <div style={{width: page.width, height: page.height, background: palette.paper, borderRadius: radius, border: `2px solid ${withAlpha(palette.paperInk, 0.16)}`, boxShadow: `0 ${radius}px ${radius * 2.4}px rgba(0,0,0,0.36)`}} />
        </MotionRecipe>
      </Box>
      <Box {...tabs}>
        <Reveal delay={3}>
          <div style={{display: 'flex', alignItems: 'flex-end', gap: tabs.height * 0.3, height: tabs.height}}>
            {[0.22, 0.16, 0.16].map((frac, i) => (
              <div key={i} style={{width: tabs.width * frac, height: i === 0 ? tabs.height : tabs.height * 0.78, borderRadius: `${tabs.height * 0.25}px ${tabs.height * 0.25}px 0 0`, background: i === 0 ? palette.marker : withAlpha(palette.paperInk, 0.12)}} />
            ))}
          </div>
        </Reveal>
      </Box>
      {head && title ? (
        <Box {...head}>
          <Reveal delay={6}>
            <FitText text={title} width={head.width} height={head.height} maxLines={2} align="left" verticalAlign="center" weight={900} color={palette.paperInk} />
          </Reveal>
        </Box>
      ) : null}
      <Box {...rule}>
        <Reveal delay={8}>
          <Shape kind="rect" width={rule.width} height={rule.height} fill={withAlpha(palette.paperInk, 0.45)} />
        </Reveal>
      </Box>
      <Box {...textBox}>
        <KineticText text={text} width={textBox.width} height={textBox.height} maxLines={10} align="left" verticalAlign="top" weight={800} font="body" color={palette.paperInk} delay={12} each={2} highlight={marked} highlightStartFrames={walk.words.length > 0 ? walk.starts : undefined} highlightEndFrames={walk.words.length > 0 ? walk.ends : undefined} highlightStyle="marker" highlightColor={palette.marker} highlightInk={palette.markerInk} highlightOpacity={1} emphasisScale={1.05} />
      </Box>
    </>
  );
};
