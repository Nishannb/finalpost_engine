/**
 * Remotion build/render defaults.
 *
 * JPEG frames at quality 88 are ~3x faster to encode than PNG with no visible
 * difference at 1080x1920, which is the single biggest lever on Lambda cost.
 */

import {Config} from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(88);
Config.setCodec('h264');
Config.setOverwriteOutput(true);
// Local burns prefetch stock into public/; this is the backstop if one file
// still has to buffer. Two Chrome tabs keeps peak disk use down on a full disk.
Config.setDelayRenderTimeoutInMilliseconds(120_000);
Config.setConcurrency(2);
