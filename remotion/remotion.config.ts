/**
 * Remotion build/render defaults.
 *
 * JPEG frames at quality 88 are ~3x faster to encode than PNG with no visible
 * difference at 1080x1920, which is the single biggest lever on Lambda cost.
 */

import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
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

function resolveCaptionsThemesPackage(): string {
  const requireFromCwd = createRequire(path.join(process.cwd(), 'package.json'));
  try {
    return path.dirname(
      requireFromCwd.resolve('remotion-captions-themes/package.json'),
    );
  } catch {
    const candidates = [
      path.resolve(process.cwd(), 'node_modules/remotion-captions-themes'),
      path.resolve(process.cwd(), '../node_modules/remotion-captions-themes'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    throw new Error(
      'remotion-captions-themes not found — run npm install in ai-video-engine',
    );
  }
}

// tsconfig paths map this package to a typed stub for `tsc`; force webpack to
// the real install so Lambda/studio/render still get the theme components.
Config.overrideWebpackConfig(config => {
  config.resolve = config.resolve ?? {};
  config.resolve.alias = {
    ...(config.resolve.alias ?? {}),
    'remotion-captions-themes': resolveCaptionsThemesPackage(),
  };
  return config;
});
