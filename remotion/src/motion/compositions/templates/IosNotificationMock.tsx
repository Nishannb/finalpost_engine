import React from 'react';

import {IOS_BANNER, IOS_CURSOR_AT, IOS_NOTIFICATION_BASE_SEC, iosCursorState} from '../../../lib/motionTemplateTiming';
import {fontFamily} from '../../fonts';
import type {SafeArea} from '../../layout';
import {useTemplateClock} from './useTemplateClock';

export type IosNotificationMockProps = {
  width: number;
  height: number;
  safeArea?: SafeArea;
  /** Sender line (default "Jitter Team"). */
  title?: string;
  /** Right-hand time stamp (default "now"). */
  time?: string;
  /** Message body (default "Remix and make it shine! 🌞"). */
  body?: string;
  /** Draw the light canvas (#EEEDF0) behind the banner. Default false: an overlay has no ground of its own. */
  canvas?: boolean;
  /** Override the beat length (frames); defaults to the Sequence's duration. */
  durationInFrames?: number;
};

const GREEN = '#34C759';

const MessagesIcon: React.FC<{size: number}> = ({size}) => (
  <svg width={size} height={size} viewBox="0 0 60 60">
    <rect width={60} height={60} rx={14} fill={GREEN} />
    <path d="M30 14 C19 14 11 20.5 11 29 C11 34 13.8 38.3 18.2 41 C17.8 43.6 16.6 45.8 14.8 47.6 C18.6 47.4 21.8 46 24 44 C25.9 44.5 27.9 44.8 30 44.8 C41 44.8 49 38 49 29 C49 20.5 41 14 30 14 Z" fill="#FFFFFF" />
  </svg>
);

const Arrow: React.FC<{size: number}> = ({size}) => (
  <svg width={size} height={size * 1.2} viewBox="0 0 30 36">
    <path d="M2 2 L2 28 L9 21 L14 33 L19 31 L14 19 L24 19 Z" fill="#111111" stroke="#FFFFFF" strokeWidth={2} strokeLinejoin="round" />
  </svg>
);

const OpenHand: React.FC<{size: number}> = ({size}) => (
  <svg width={size} height={size} viewBox="0 0 40 40">
    <path
      d="M11 21 L11 11 C11 9 14 9 14 11 L14 18 L14 7 C14 5 17 5 17 7 L17 17 L17 6 C17 4 20 4 20 6 L20 17 L20 9 C20 7 23 7 23 9 L23 24 C25 21 27 22 27 24 C27 28 24 33 21 35 L15 35 C12 33 9 27 11 21 Z"
      fill="#FFFFFF"
      stroke="#111111"
      strokeWidth={2}
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * CLIP_07 iOS NOTIFICATION MOCK (WP46 Layer 2, an OVERLAY: it does not own the frame, so captions stay on): a static rounded notification banner (Messages-style green icon, title, time, body). The banner never moves; only the
 * cursor changes: arrow at (0.52, 0.70) -> open hand at 0.83 s -> hidden at 1.67 s. No pop-in (the reference has none). 2.02 s, silent, no fade / blur / glow / shadow. Text comes from props (the defaults are placeholders).
 */
export const IosNotificationMock: React.FC<IosNotificationMockProps> = ({width, height, title = 'Jitter Team', time = 'now', body = 'Remix and make it shine! \u{1F31E}', canvas = false, durationInFrames}) => {
  const {t} = useTemplateClock(IOS_NOTIFICATION_BASE_SEC, durationInFrames);
  const portrait = height > width;
  const bannerW = Math.round(width * (portrait ? 0.9 : IOS_BANNER.w));
  // 16:9: the grammar's 0.55 x 0.16 of the canvas; a portrait frame gets a 4.2:1 banner across 90 % of its width so the text stays readable
  const bannerH = portrait ? Math.round(bannerW / 4.2) : Math.round(height * IOS_BANNER.h);
  const bannerX = Math.round((width - bannerW) / 2);
  const bannerY = Math.round(height * IOS_BANNER.top);
  const radius = Math.round(bannerH * (IOS_BANNER.radius / (1080 * IOS_BANNER.h)));
  const icon = Math.round(bannerH * 0.5);
  const pad = Math.round(bannerH * 0.2);
  const titleSize = Math.round(bannerH * 0.2);
  const bodySize = Math.round(bannerH * 0.19);
  const cursor = iosCursorState(t);
  const cursorSize = Math.round(Math.min(width, height) * 0.085);

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: canvas ? '#EEEDF0' : 'transparent'}}>
      <div style={{position: 'absolute', left: bannerX, top: bannerY, width: bannerW, height: bannerH, borderRadius: Math.max(radius, Math.round(bannerH * 0.14)), backgroundColor: IOS_BANNER.fill, display: 'flex', alignItems: 'center', padding: `0 ${pad}px`, boxSizing: 'border-box', gap: pad}}>
        <MessagesIcon size={icon} />
        <div style={{flex: 1, minWidth: 0, fontFamily: fontFamily('inter')}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'}}>
            <span style={{fontWeight: 700, fontSize: titleSize, color: '#111111'}}>{title}</span>
            <span style={{fontWeight: 500, fontSize: Math.round(titleSize * 0.8), color: '#6B6B70'}}>{time}</span>
          </div>
          <div style={{fontWeight: 500, fontSize: bodySize, color: '#222222', marginTop: Math.round(bannerH * 0.05), lineHeight: 1.25}}>{body}</div>
        </div>
      </div>
      {cursor !== 'hidden' ? (
        <div style={{position: 'absolute', left: Math.round(width * IOS_CURSOR_AT[0]), top: Math.round(height * IOS_CURSOR_AT[1]), transform: cursor === 'hand' ? 'translate(-50%, -50%)' : 'translate(-10%, -5%)'}}>
          {cursor === 'hand' ? <OpenHand size={Math.round(cursorSize * 1.2)} /> : <Arrow size={cursorSize} />}
        </div>
      ) : null}
    </div>
  );
};
