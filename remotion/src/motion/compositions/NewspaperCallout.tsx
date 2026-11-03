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

export type NewspaperCalloutProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The printed passage (spoken words). */
  passage: string;
  /** Optional headline (spoken words). No newspaper name is ever invented: without a title the masthead is rules and an ornament only. */
  title?: string;
  /** 1-3 spoken words or phrases the highlighter marks (solid marker bar). */
  highlight?: string[];
  /** Speech-synced highlighter (see WikiCallout): `{word, fromSec, toSec}` from the start of this graphic. Absent / empty: the static `highlight`. */
  highlightSchedule?: HighlightSpan[];
  /** WP14A: the entrance recipe of the sheet (motion only; the paper chrome is the host's). */
  recipeId?: MotionRecipeId;
  /** Opaque full-bleed ground. Default true; false floats the sheet over the footage. */
  background?: boolean;
};

/** A passage of this many words or more is set in two columns with a rule between; shorter ones in one. */
export const NEWSPAPER_TWO_COLUMN_WORDS = 14;

/** Splits a passage into two columns at the middle word (pure, so it is testable). */
export function newspaperColumns(passage: string): string[] {
  const words = passage.split(/\s+/).filter(Boolean);
  if (words.length < NEWSPAPER_TWO_COLUMN_WORDS) return [words.join(' ')];
  const cut = Math.ceil(words.length / 2);
  return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
}

/**
 * A newspaper clipping (WP13D), distinct from WikiCallout (no browser tabs) and TweetCard (no social chrome, no tilt): a flat off-white sheet with a thick-and-thin MASTHEAD rule pair, an optional uppercase
 * display headline between double rules, and the passage set in one or two COLUMNS with a hairline column rule, with a solid highlighter on the marked words. Shapes only for the chrome; the only text is spoken
 * words. Colours and faces come from the plate palette / short-form look.
 */
export const NewspaperCallout: React.FC<NewspaperCalloutProps> = ({width, height, safeArea, passage, title, highlight, highlightSchedule, recipeId = 'nested_scale_in', background = true}) => {
  const fps = usePlateFps();
  const palette = usePlatePalette();
  const walk = scheduleFrames(highlightSchedule, fps);
  const outer = contentBox(width, height, safeArea, Math.min(width, height) * 0.05);
  const sheet = {x: outer.x, y: outer.y + outer.height * 0.12, width: outer.width, height: outer.height * 0.74};
  const pad = Math.min(sheet.width, sheet.height) * 0.055;
  const inner = {x: sheet.x + pad, y: sheet.y + pad, width: sheet.width - pad * 2, height: sheet.height - pad * 2};
  const thick = Math.max(8, inner.height * 0.014);
  const thin = Math.max(3, inner.height * 0.005);
  const [mastTop, afterTop] = sliceTop(inner, thick, thin * 2);
  const [mastThin, afterThin] = sliceTop(afterTop, thin, inner.height * 0.015);
  const [head, afterHead] = title ? sliceTop(afterThin, 0.17, inner.height * 0.01) : [null, afterThin];
  const [rule, body] = sliceTop(afterHead, thin * 1.5, inner.height * 0.025);
  const columns = newspaperColumns(passage);
  const gutter = body.width * 0.05;
  const colWidth = (body.width - gutter * (columns.length - 1)) / columns.length;
  const marked = walk.words.length > 0 ? walk.words.slice(0, 8) : (highlight ?? []).slice(0, 3);
  const each = 2;
  let before = 0;
  return (
    <>
      {background ? <PlateGround /> : null}
      <Box {...sheet}>
        <MotionRecipe recipeId={recipeId}>
          <div style={{width: sheet.width, height: sheet.height, background: palette.paper, boxShadow: '0 22px 60px rgba(0,0,0,0.38)'}} />
        </MotionRecipe>
      </Box>
      <Box {...mastTop}>
        <Reveal delay={2}>
          <Shape kind="rect" width={mastTop.width} height={mastTop.height} fill={palette.paperInk} />
        </Reveal>
      </Box>
      <Box {...mastThin}>
        <Reveal delay={4}>
          <Shape kind="rect" width={mastThin.width} height={mastThin.height} fill={palette.paperInk} />
        </Reveal>
      </Box>
      {head && title ? (
        <Box {...head}>
          <Reveal delay={6}>
            <FitText text={title} width={head.width} height={head.height} maxLines={2} align="center" verticalAlign="center" uppercase weight={900} letterSpacing={-0.01} color={palette.paperInk} />
          </Reveal>
        </Box>
      ) : null}
      <Box {...rule}>
        <Reveal delay={8}>
          <Shape kind="rect" width={rule.width} height={rule.height} fill={withAlpha(palette.paperInk, 0.55)} />
        </Reveal>
      </Box>
      {columns.map((text, index) => {
        const x = body.x + index * (colWidth + gutter);
        const delay = 10 + before * each;
        before += text.split(/\s+/).length;
        return (
          <React.Fragment key={index}>
            <Box x={x} y={body.y} width={colWidth} height={body.height}>
              <KineticText
                text={text}
                width={colWidth}
                height={body.height}
                maxLines={14}
                align="left"
                verticalAlign="top"
                weight={800}
                font="body"
                color={palette.paperInk}
                delay={delay}
                each={each}
                highlight={marked}
                highlightStartFrames={walk.words.length > 0 ? walk.starts : undefined}
                highlightEndFrames={walk.words.length > 0 ? walk.ends : undefined}
                highlightStyle="marker"
                highlightColor={palette.marker}
                highlightInk={palette.markerInk}
                highlightOpacity={1}
                emphasisScale={1.04}
              />
            </Box>
            {index < columns.length - 1 ? (
              <Box x={x + colWidth + gutter / 2 - thin / 2} y={body.y} width={thin} height={body.height}>
                <Reveal delay={12}>
                  <Shape kind="rect" width={thin} height={body.height} fill={withAlpha(palette.paperInk, 0.35)} />
                </Reveal>
              </Box>
            ) : null}
          </React.Fragment>
        );
      })}
    </>
  );
};
