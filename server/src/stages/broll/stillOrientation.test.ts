/**
 * 2026-11-27: a landscape logo filled the whole Kinetic frame. probeMedia throws on a still (no duration), so every photo kept the 1080x1920 default and was
 * classed as a VERTICAL asset (full-frame cutaway). probeImageSize reads a still's real size; a landscape asset is then a split screen.
 */
import {execFileSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {env} from '../../config/env.ts';
import {extractStillJpeg, probeImageSize, probeMedia} from '../../media/ffmpeg.ts';
import {isVerticalAsset, planLabeledAssetPlacements} from './labeledAssetPlacement.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'still-orient-'));
/** a still saved WITHOUT an extension, as the describe step saves uploads */
function still(name: string, w: number, h: number): string {
  const out = path.join(dir, name);
  execFileSync(env.FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=red:s=${w}x${h}`, '-frames:v', '1', '-f', 'image2', '-c:v', 'png', out]);
  return out;
}

describe('creator still orientation', () => {
  it('probeMedia cannot size a still (the old path); probeImageSize can, and the extracted frame keeps the aspect', async () => {
    const logo = still('logo_src_still', 1600, 900);
    await expect(probeMedia(logo)).rejects.toThrow();
    expect(await probeImageSize(logo)).toEqual({width: 1600, height: 900});
    const frame = path.join(dir, 'logo_a.jpg');
    await extractStillJpeg(logo, frame, 0);
    const size = await probeImageSize(frame);
    expect(size && size.width > size.height).toBe(true);
  });

  it('a landscape logo is a split screen in Kinetic; a 9:16 photo is the full frame', () => {
    expect(isVerticalAsset({width: 1600, height: 900})).toBe(false);
    expect(isVerticalAsset({width: 1080, height: 1920})).toBe(true);
    const brief = {version: 1 as const, outputDurationSec: 20, slots: [
      {id: 's1', label: 'YouTube logo', kind: 'logo' as const, reason: '', startSec: 3, endSec: 5, accept: ['image' as const], spokenHint: '', status: 'uploaded' as const, userAssetId: 'ub_1'},
      {id: 's2', label: 'Studio photo', kind: 'broll_clip' as const, reason: '', startSec: 10, endSec: 12, accept: ['image' as const], spokenHint: '', status: 'uploaded' as const, userAssetId: 'ub_2'},
    ]};
    const assets = new Map([
      ['ub_1', {url: 'https://x/logo.png', mediaKind: 'image' as const, width: 1600, height: 900}],
      ['ub_2', {url: 'https://x/studio.jpg', mediaKind: 'image' as const, width: 1080, height: 1920}],
    ]);
    const placed = planLabeledAssetPlacements({brief, assets, outputDurationSec: 20, fullFrameBrollStills: true});
    const byUrl = new Map(placed.overlays.map(o => [o.assetUrl, o]));
    expect(byUrl.get('https://x/logo.png')).toMatchObject({layout: 'split', fitWidth: true, speakerSide: 'bottom'});
    expect(byUrl.get('https://x/studio.jpg')).toMatchObject({layout: 'cutaway'});
  });
});
