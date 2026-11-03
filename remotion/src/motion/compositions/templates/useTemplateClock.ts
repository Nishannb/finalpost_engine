import {useCurrentFrame, useVideoConfig} from 'remotion';

import {templateScale} from '../../../lib/motionTemplateTiming';

export type TemplateClock = {
  /** Real seconds into the beat. */
  sec: number;
  /** The beat length in seconds. */
  durSec: number;
  /** Timeline (base) seconds: real seconds divided by the compression scale (a short beat plays the whole template, faster). */
  t: number;
  fps: number;
};

/** The clock every WP45 template reads: the beat's own frame + length (a Sequence scopes useVideoConfig().durationInFrames to the graphic), optionally overridden by a `durationInFrames` prop. */
export function useTemplateClock(baseSec: number, durationInFrames?: number): TemplateClock {
  const frame = useCurrentFrame();
  const config = useVideoConfig();
  const fps = config.fps;
  const durSec = (durationInFrames && durationInFrames > 0 ? durationInFrames : config.durationInFrames) / fps;
  const sec = frame / fps;
  return {sec, durSec, t: sec / templateScale(durSec, baseSec), fps};
}
