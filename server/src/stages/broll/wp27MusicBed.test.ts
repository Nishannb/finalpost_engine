/**
 * WP27: music bed ducking math + wiring pins (offline; no audio file required).
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {musicBedVolumeAt} from '../../../../remotion/src/components/MusicBedTrack';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('WP27 music bed', () => {
  it('ducks under speech windows and restores between them', () => {
    const speech = [{start: 1, end: 2}];
    expect(musicBedVolumeAt({frame: 0, fps: 30, speechWindows: speech, ducking: true, musicGain: 0.18, duckedGain: 0.04})).toBe(0.18);
    expect(musicBedVolumeAt({frame: 45, fps: 30, speechWindows: speech, ducking: true, musicGain: 0.18, duckedGain: 0.04})).toBe(0.04);
    expect(musicBedVolumeAt({frame: 90, fps: 30, speechWindows: speech, ducking: true, musicGain: 0.18, duckedGain: 0.04})).toBe(0.18);
    expect(musicBedVolumeAt({frame: 45, fps: 30, speechWindows: speech, ducking: false, musicGain: 0.18, duckedGain: 0.04})).toBe(0.18);
  });
  it('ShortVideo mounts MusicBedTrack; analyze attaches POLISH_MUSIC_BED_URL when set', () => {
    expect(read('../../../../remotion/src/ShortVideo.tsx')).toContain('<MusicBedTrack');
    expect(read('../../pipeline/analyzeVideo.ts')).toContain('POLISH_MUSIC_BED_URL');
    expect(read('../../config/env.ts')).toContain('POLISH_MUSIC_BED_URL');
  });
});
