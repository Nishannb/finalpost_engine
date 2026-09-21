/**
 * Motion-graphic templates for Inset Scale Reveal (variant B).
 *
 * Add a new template by:
 * 1. Adding an id here and in server/src/lib/insetReveal.ts INSET_GRAPHIC_TEMPLATES
 * 2. Registering a renderer in INSET_GRAPHIC_RENDERERS
 * Do not touch the compositor (InsetRevealTrack) or Director compiler.
 */

import React from 'react';
import {interpolate} from 'remotion';

export type InsetGraphicRenderParams = {
  text: string;
  data?: Record<string, string | number>;
  localTime: number;
  progress: number;
  width: number;
  height: number;
  accent: string;
  ink: string;
};

export type InsetGraphicRenderer = (params: InsetGraphicRenderParams) => React.ReactNode;

function StatCallout({text, data, progress, width, height, accent, ink}: InsetGraphicRenderParams) {
  const label = String(data?.label ?? '').trim();
  const scale = interpolate(progress, [0, 1], [0.86, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const opacity = progress;
  const fontSize = Math.round(Math.min(width, height) * 0.09);
  return (
    <div
      style={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: fontSize * 0.18,
        justifyContent: 'center',
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: 'center top',
        width: '100%',
      }}>
      <div
        style={{
          color: ink,
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize,
          fontWeight: 800,
          letterSpacing: -1.5,
          lineHeight: 1,
          textAlign: 'center',
          textShadow: `0 8px 28px ${accent}66`,
        }}>
        {text || '—'}
      </div>
      {label ? (
        <div
          style={{
            backgroundColor: accent,
            borderRadius: 999,
            color: '#0B1220',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: Math.round(fontSize * 0.28),
            fontWeight: 700,
            letterSpacing: 1.2,
            padding: `${Math.round(fontSize * 0.12)}px ${Math.round(fontSize * 0.32)}px`,
            textTransform: 'uppercase',
          }}>
          {label}
        </div>
      ) : null}
    </div>
  );
}

function KeywordTitle({text, progress, width, height, accent, ink}: InsetGraphicRenderParams) {
  const y = interpolate(progress, [0, 1], [18, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const fontSize = Math.round(Math.min(width, height) * 0.055);
  return (
    <div
      style={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: fontSize * 0.35,
        opacity: progress,
        transform: `translateY(${y}px)`,
        width: '100%',
      }}>
      <div
        style={{
          backgroundColor: accent,
          borderRadius: 999,
          height: 6,
          width: Math.min(width * 0.22, 160),
        }}
      />
      <div
        style={{
          color: ink,
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize,
          fontWeight: 800,
          letterSpacing: 0.4,
          lineHeight: 1.15,
          maxWidth: '92%',
          textAlign: 'center',
          textTransform: 'uppercase',
        }}>
        {text || 'KEY POINT'}
      </div>
    </div>
  );
}

export const INSET_GRAPHIC_RENDERERS: Record<string, InsetGraphicRenderer> = {
  stat_callout: params => <StatCallout {...params} />,
  keyword_title: params => <KeywordTitle {...params} />,
};

export function renderInsetGraphic(
  templateId: string,
  params: InsetGraphicRenderParams,
): React.ReactNode {
  const renderer =
    INSET_GRAPHIC_RENDERERS[templateId] ?? INSET_GRAPHIC_RENDERERS.keyword_title;
  if (!renderer) {
    return null;
  }
  return renderer(params);
}
