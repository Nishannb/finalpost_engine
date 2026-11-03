/**
 * SUBJECT STAGE native placeholders (Phase 2): plain, brand-free plates the stage can draw when no uploaded asset exists. A neutral gradient plate (S1), an opaque quote card (S2) and a tall result page of
 * stacked rows (S3 scroll). Copy only ever arrives as props (the planner will draw it from the transcript); nothing here carries a brand, a language, an icon or a colour from any reference.
 */
import React from 'react';

import {fontFamily} from '../../motion/fonts';
import {STAGE_TOKENS} from './stageMotion';

/**
 * S1: warm-neutral plate WITH CONTENT. A plate is never blank (the behind layer must not be visually empty for more than 0.5 s): the headline (and an optional subline) of the spoken unit sit in the top band
 * above the presenter's head (head top ~28 % of the frame), same spirit as the quote card. With no text at all it still draws a neutral ground (the planner / validator treat that as EMPTY and never emit it).
 */
export const PlateGround: React.FC<{width: number; height: number; text?: string; lines?: string[]; accent?: string}> = ({width, height, text, lines, accent}) => {
  const headline = (text ?? '').replace(/\s+/g, ' ').trim();
  const sub = (lines ?? []).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)[0];
  const boxW = width * 0.84;
  const boxH = height * 0.17; // the top band above the head
  const chars = Math.max(8, Array.from(headline).length);
  const font = headline ? Math.max(24, Math.min(width * 0.085, Math.sqrt((boxW * boxH) / (chars * 0.58 * 1.2)))) : 0;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height,
        background: `radial-gradient(ellipse at 30% 20%, #FBF6EE 0%, #EFE6D8 55%, #D9CDBB 100%)`,
        boxShadow: 'inset 0 0 160px rgba(60, 40, 20, 0.18)',
        fontFamily: fontFamily('inter'),
        color: STAGE_TOKENS.ink,
      }}
    >
      {headline ? (
        <div style={{position: 'absolute', left: width * 0.08, top: height * 0.065, width: boxW, display: 'flex', gap: width * 0.025}}>
          <div style={{flex: '0 0 auto', width: Math.max(6, width * 0.012), borderRadius: width, backgroundColor: accent ?? STAGE_TOKENS.signalHot}} />
          <div>
            <div style={{fontSize: font, fontWeight: 900, lineHeight: 1.12, letterSpacing: '-0.01em'}}>{headline}</div>
            {sub ? <div style={{marginTop: font * 0.28, fontSize: font * 0.52, fontWeight: 600, lineHeight: 1.25, color: 'rgba(26,26,26,0.68)'}}>{sub}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

/** S2: opaque paper card with an accent bar and the quoted text (text fits the box by character count). */
export const QuoteCard: React.FC<{width: number; height: number; text?: string; accent?: string}> = ({width, height, text, accent}) => {
  const body = (text?.trim() || 'Quoted text appears here.').slice(0, 280);
  const chars = Array.from(body).length;
  const font = Math.max(18, Math.min(width * 0.075, Math.sqrt((width * 0.8 * height * 0.55) / (Math.max(12, chars) * 0.62 * 1.35))));
  return (
    <div style={{position: 'absolute', left: 0, top: 0, width, height, backgroundColor: STAGE_TOKENS.paper, color: STAGE_TOKENS.ink, fontFamily: fontFamily('inter')}}>
      <div style={{position: 'absolute', left: 0, top: 0, width, height: Math.max(10, height * 0.07), backgroundColor: accent ?? STAGE_TOKENS.signalHot}} />
      <div style={{position: 'absolute', left: width * 0.1, right: width * 0.1, top: height * 0.17, fontSize: font, fontWeight: 700, lineHeight: 1.3, overflow: 'hidden', maxHeight: height * 0.7}}>{body}</div>
    </div>
  );
};

const ROW_H_FRAC = 0.36; // of the page width: one result row
/** Height (px) of a result page with `rows` rows at page width `width` (so the scroll can stop at the content end). */
export const resultPageHeightPx = (rows: number, width: number): number => Math.max(1, rows) * width * ROW_H_FRAC + width * 0.1;

/** S3: a tall page of stacked result rows (a source bar, a title line, two grey text lines). */
export const ResultPage: React.FC<{width: number; lines?: string[]; accent?: string}> = ({width, lines, accent}) => {
  const rows = (lines && lines.length > 0 ? lines : ['First result', 'Second result', 'Third result', 'Fourth result']).slice(0, 24);
  const rowH = width * ROW_H_FRAC;
  const h = resultPageHeightPx(rows.length, width);
  return (
    <div style={{position: 'absolute', left: 0, top: 0, width, height: h, backgroundColor: STAGE_TOKENS.paper, color: STAGE_TOKENS.ink, fontFamily: fontFamily('inter')}}>
      {rows.map((line, i) => (
        <div key={i} style={{position: 'absolute', left: width * 0.06, right: width * 0.06, top: width * 0.05 + i * rowH, height: rowH, borderBottom: `${Math.max(1, width * 0.002)}px solid rgba(0,0,0,0.12)`}}>
          <div style={{width: width * 0.22, height: rowH * 0.1, borderRadius: rowH, backgroundColor: 'rgba(0,0,0,0.16)', marginTop: rowH * 0.1}} />
          <div style={{fontSize: width * 0.052, fontWeight: 800, color: accent ?? STAGE_TOKENS.signal, marginTop: rowH * 0.08, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{line}</div>
          <div style={{width: width * 0.84, height: rowH * 0.075, borderRadius: rowH, backgroundColor: 'rgba(0,0,0,0.12)', marginTop: rowH * 0.1}} />
          <div style={{width: width * 0.62, height: rowH * 0.075, borderRadius: rowH, backgroundColor: 'rgba(0,0,0,0.1)', marginTop: rowH * 0.07}} />
        </div>
      ))}
    </div>
  );
};
