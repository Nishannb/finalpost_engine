/**
 * Typed facade for remotion-captions-themes.
 * tsconfig paths map the package name here so `tsc` never typechecks the
 * package's unstrict source. Remotion's webpack alias (remotion.config.ts)
 * still resolves the real package at bundle/render time.
 */

import type {FC} from 'react';

export type WordTiming = {
  text: string;
  start: number;
  end: number;
  emphasis?: boolean;
};

export type CaptionLine = {
  words: WordTiming[];
};

export type CaptionsData = {
  lines: CaptionLine[];
};

export type CaptionThemeProps = {
  data: CaptionsData;
  theme?: string;
  primaryColor?: string;
  secondaryColor?: string;
  fontSize?: number | string;
};

export declare const CaptionTheme: FC<CaptionThemeProps>;

export type ThemeName = string;
