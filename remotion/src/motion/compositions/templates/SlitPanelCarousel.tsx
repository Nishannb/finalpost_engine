import React from 'react';

import {
  SLIT_ACCORDION_FACTOR,
  SLIT_ACID,
  SLIT_ASPECT,
  SLIT_CAROUSEL_BASE_SEC,
  SLIT_CAROUSEL_TIMELINE,
  SLIT_VISIBLE_SLOTS,
  easeOutCubic,
  findOp,
  fitContain,
  slitAccordion,
  slitAdvance,
  slitFocusItem,
  staggered,
} from '../../../lib/motionTemplateTiming';
import type {SafeArea} from '../../layout';
import {PhotoFill} from './shared';
import {useTemplateClock} from './useTemplateClock';

export type SlitPanel = {src?: string; tone?: string};

export type SlitPanelCarouselProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** 2-6 panels. A panel with no `src` is a flat tone (the accent panel is acid yellow #EAF826). */
  panels?: SlitPanel[];
  /** Which panel expands (index into `panels`). Default: the one that lands in the centre slot after the first advance. */
  focusIndex?: number;
  /** The one accent panel's tone (default acid yellow #EAF826). */
  accent?: string;
  /** Image shift across the strip, as a fraction of the panel width (default 0: none). The image SCALE never changes. */
  parallax?: number;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const GRAYS = ['#2B2B2B', '#3A3A3A', '#222222', '#454545', '#303030', '#3F3F3F'];
const DEFAULT_PANELS: SlitPanel[] = [{}, {}, {}, {}, {}];

/**
 * CLIP_02 SLIT PANEL CAROUSEL (WP45 Layer 2): a letterboxed 4:3 strip of tall slit panels on black. Each panel's height window grows open (window_reveal), then slot_carousel_advance (the strip moves one slot, panels
 * staggered 25 ms so the gutters swell elastically), hold, panel_accordion_expand (one panel widens 3.25x, neighbours are pushed out and cropped; the image keeps a constant scale and the panel is a window onto it),
 * hold, contract, the strip advances back one slot (loop-friendly end). Acid-yellow accent on one panel. No fade, no blur, no glow.
 */
export const SlitPanelCarousel: React.FC<SlitPanelCarouselProps> = ({width, height, panels, focusIndex, accent = SLIT_ACID, parallax = 0, durationInFrames}) => {
  const {t} = useTemplateClock(SLIT_CAROUSEL_BASE_SEC, durationInFrames);
  const list = (panels && panels.length >= 2 ? panels : DEFAULT_PANELS).slice(0, 6);
  const n = list.length;
  const slots = SLIT_VISIBLE_SLOTS;
  const focusContent = focusIndex === undefined ? 3 % n : ((focusIndex % n) + n) % n;
  const focusItem = slitFocusItem(n, focusContent, slots);
  const strip = fitContain(SLIT_ASPECT, width, height);
  const gutter = Math.max(4, Math.round(strip.w * 0.012));
  const pw = (strip.w - gutter * (slots - 1)) / slots;
  const pitch = pw + gutter;
  const expandedW = pw * SLIT_ACCORDION_FACTOR;
  const open = slitAccordion(t);
  const extra = (expandedW - pw) * open;
  const reveal = findOp(SLIT_CAROUSEL_TIMELINE, 'window_reveal')!;
  // the focus panel's slot after the first advance: neighbours left / right of it are pushed apart
  const restSlot = (item: number) => item - 1;

  const items: React.ReactNode[] = [];
  for (let item = 0; item <= slots; item++) {
    const content = list[item % n]!;
    const slot = item - slitAdvance(t, item, slots);
    const isFocus = item === focusItem;
    // accordion: the focus widens in place around its own centre, every other panel is pushed out (and cropped by the strip edge)
    const before = restSlot(item) < restSlot(focusItem);
    const shift = isFocus ? -extra / 2 : before ? -extra / 2 : extra / 2;
    const w = isFocus ? pw + extra : pw;
    const x = strip.x + slot * pitch + shift;
    const win = easeOutCubic(staggered(t, reveal.from, Math.max(0, slot) * 0.04, 0.34));
    const tone = content.tone ?? (item % n === focusContent ? accent : GRAYS[(item % n) % GRAYS.length]!);
    const centre = x + w / 2 - (strip.x + strip.w / 2);
    // clip the panel to the strip (cropped, never squeezed) and to its own window
    const left = Math.max(x, strip.x);
    const right = Math.min(x + w, strip.x + strip.w);
    if (right <= left || win <= 0) continue;
    const inset = ((1 - win) / 2) * 100;
    items.push(
      <div key={item} style={{position: 'absolute', left, top: strip.y, width: right - left, height: strip.h, overflow: 'hidden', clipPath: `inset(${inset}% 0 ${inset}% 0)`}}>
        {/* the image layer keeps ONE size (the expanded width) and is centred on the panel: the accordion only changes how much of it the window shows */}
        <div style={{position: 'absolute', top: 0, height: '100%', width: expandedW, left: x + w / 2 - expandedW / 2 - left + centre * parallax}}>
          {content.src ? (
            <PhotoFill src={content.src} ground={tone} figure={tone} sun={tone} grayscale />
          ) : (
            <div style={{position: 'absolute', inset: 0, backgroundColor: tone}}>
              <div style={{position: 'absolute', left: '36%', top: '34%', width: '28%', aspectRatio: '1 / 1', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.16)'}} />
            </div>
          )}
        </div>
      </div>,
    );
  }

  return <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: '#000000'}}>{items}</div>;
};
