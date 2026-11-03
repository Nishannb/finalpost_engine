import React from 'react';

import {
  CHAT_BASE_SEC,
  CHAT_COLORS,
  CHAT_DEMO_MESSAGES,
  CHAT_MAX_CYCLES,
  CHAT_MAX_WIDTH,
  CHAT_SIDE_INSET,
  chatBubbleFrame,
  mix,
  type ChatMessage,
} from '../../../lib/motionTemplateTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {hexOr, readableInk} from './colorUtil';
import {useTemplateClock} from './useTemplateClock';

export type ChatConversationBubblesProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** The conversation (demo copy only when omitted). messages[0] is already on screen at t=0; the rest play one per cycle slot (max 4). `indicatorOnly` shows just the typing dots. */
  messages?: ChatMessage[];
  /** Right-hand bubble colour (default #1A73F5; live = edit-palette accent). */
  accent?: string;
  /** Page colour (default #FDFDFD). */
  ground?: string;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const FONT_H = 0.022;
const LINE_H = 1.32;
const PAD_X = 0.85;
const PAD_Y = 0.55;
const AVG_GLYPH = 0.56;
const DOT = 0.42;

/** Greedy word wrap using an average glyph width: the bubble's FINAL blank size is known before the first word rises (no reflow). */
function wrapLines(words: string[], maxChars: number): string[][] {
  const lines: string[][] = [];
  let current: string[] = [];
  let len = 0;
  for (const word of words) {
    const next = len + (current.length ? 1 : 0) + word.length;
    if (current.length && next > maxChars) {
      lines.push(current);
      current = [word];
      len = word.length;
    } else {
      current.push(word);
      len = next;
    }
  }
  if (current.length) lines.push(current);
  return lines;
}

/**
 * CLIP_22 CHAT CONVERSATION BUBBLES (WP51 Layer 2 / Batch B1): 9:16, 10.25 s loop. Grey left bubbles, accent-blue right bubbles on a near-white page. Each message: typing_indicator (1.2 s, 3-dot pulse) -> empty pill -> expand to the FINAL
 * blank size (250 ms expo-out) -> word_rise_reveal (125 ms/word, 5 px rise, 160 ms fade). The last slot of the demo is indicator-only (the loop tail). Silent. No cursor, no blur, no bounce.
 */
export const ChatConversationBubbles: React.FC<ChatConversationBubblesProps> = ({width, height, messages, accent, ground, durationInFrames}) => {
  const {t} = useTemplateClock(CHAT_BASE_SEC, durationInFrames);
  const list = (messages && messages.length >= 1 ? messages : [...CHAT_DEMO_MESSAGES]).slice(0, CHAT_MAX_CYCLES + 1);
  const blue = hexOr(accent) ?? CHAT_COLORS.blue;
  const page = hexOr(ground) ?? CHAT_COLORS.ground;
  const blueInk = readableInk(blue, CHAT_COLORS.blueInk, '#0B0B0B');
  const font = height * FONT_H;
  const inset = width * CHAT_SIDE_INSET;
  const lineH = font * LINE_H;
  const padX = font * PAD_X;
  const padY = font * PAD_Y;
  const gap = height * 0.022;

  let top = height * 0.07;
  const rows = list.map((message, i) => {
    const maxW = width * CHAT_MAX_WIDTH[message.side];
    const words = message.text.split(/\s+/).filter(Boolean);
    const maxChars = Math.max(6, Math.floor((maxW - 2 * padX) / (font * AVG_GLYPH)));
    const lines = message.indicatorOnly || words.length === 0 ? [] : wrapLines(words, maxChars);
    const widest = Math.max(0, ...lines.map(line => line.join(' ').length));
    const pillH = lineH + 2 * padY;
    const finalW = lines.length ? Math.min(maxW, widest * font * AVG_GLYPH + 2 * padX) : font * 3.4;
    const finalH = lines.length ? lines.length * lineH + 2 * padY : pillH;
    const row = {message, words, lines, finalW, finalH, pillH, y: top, slot: i - 1};
    top += finalH + gap;
    return row;
  });

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: page, fontFamily: fontFamily('inter'), fontWeight: 600}}>
      {rows.map((row, i) => {
        const pre = i === 0;
        const frame = pre ? null : chatBubbleFrame(t, row.slot, row.words.length, row.message.indicatorOnly);
        if (frame && frame.phase === 'hidden') return null;
        const right = row.message.side === 'right';
        const bg = right ? blue : CHAT_COLORS.grey;
        const ink = right ? blueInk : CHAT_COLORS.greyInk;
        const indicator = frame !== null && (frame.phase === 'indicator' || frame.phase === 'pill');
        const w = indicator ? font * 3.4 : frame && frame.phase === 'expand' ? mix(font * 3.4, row.finalW, frame.expand) : row.finalW;
        const h = indicator ? row.pillH : frame && frame.phase === 'expand' ? mix(row.pillH, row.finalH, frame.expand) : row.finalH;
        const side = right ? {right: inset} : {left: inset};
        const wordEls: React.ReactNode[] = [];
        let k = 0;
        row.lines.forEach((line, li) => {
          line.forEach((word, wi) => {
            const state = frame && frame.words[k] ? frame.words[k]! : {fade: pre || (frame && frame.phase === 'done') ? 1 : 0, rise: 0};
            wordEls.push(
              <span key={`${li}-${wi}`} style={{display: 'inline-block', opacity: state.fade, transform: `translateY(${state.rise}px)`, marginRight: wi < line.length - 1 ? '0.28em' : 0}}>
                {word}
              </span>,
            );
            k += 1;
          });
          if (li < row.lines.length - 1) wordEls.push(<br key={`br${li}`} />);
        });
        return (
          <div key={i} style={{position: 'absolute', top: row.y, ...side, width: w, height: h, borderRadius: Math.min(h / 2, font * 1.15), backgroundColor: bg, overflow: 'hidden'}}>
            {indicator ? (
              <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: font * 0.34}}>
                {frame!.phase === 'indicator' &&
                  frame!.dots.map((o, d) => <div key={d} style={{width: font * DOT, height: font * DOT, borderRadius: '50%', backgroundColor: right ? blueInk : '#7A7A7A', opacity: o}} />)}
              </div>
            ) : (
              <div style={{position: 'absolute', left: padX, top: padY, width: row.finalW - 2 * padX, fontSize: font, lineHeight: `${lineH}px`, color: ink, whiteSpace: 'nowrap'}}>{wordEls}</div>
            )}
          </div>
        );
      })}
    </div>
  );
};
