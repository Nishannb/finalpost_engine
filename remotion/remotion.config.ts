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
// One Chrome tab + a capped OffthreadVideo cache keeps peak disk use down
// when the Mac volume is nearly full (UHD B-roll used to OOM the compositor).
Config.setDelayRenderTimeoutInMilliseconds(120_000);
Config.setConcurrency(1);
Config.setOffthreadVideoCacheSizeInBytes(256 * 1024 * 1024);
