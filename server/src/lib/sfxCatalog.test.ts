import {spawnSync} from 'node:child_process';
import {mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';

import {
  applyCatalogToHits,
  catalogVolume,
  cueForHit,
  loadSfxCatalog,
  parseCatalog,
  pickEntry,
  sfxLibraryDir,
  sfxVoiceOffsetLu,
  validateSfxLibrary,
  type SfxEntry,
} from './sfxCatalog.ts';
import {schedulePolishSfxHits} from './polishSfx.ts';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const tmp: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sfx-catalog-'));
  tmp.push(dir);
  return dir;
};
afterAll(() => tmp.forEach(dir => rmSync(dir, {recursive: true, force: true})));

/** Synthetic mono 16-bit wav: `silenceSec` of zeros, then a 440 Hz tone. Written only into a test temp dir. */
function writeTone(file: string, input: {toneSec: number; silenceSec?: number; peak?: number}) {
  const rate = 48000;
  const silent = Math.round((input.silenceSec ?? 0) * rate);
  const tone = Math.round(input.toneSec * rate);
  const pcm = Buffer.alloc((silent + tone) * 2);
  for (let i = 0; i < tone; i += 1) pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * (input.peak ?? 0.89) * 32767), (silent + i) * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  writeFileSync(file, Buffer.concat([header, pcm]));
}

describe('the real library folder', () => {
  it('ships empty: a README and sfxinfo.json == [] and no audio files', () => {
    const dir = sfxLibraryDir({});
    expect(dir.endsWith(path.join('remotion', 'public', 'sfx-library'))).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(['README.md', 'sfxinfo.json']);
    expect(JSON.parse(readFileSync(path.join(dir, 'sfxinfo.json'), 'utf8'))).toEqual([]);
    expect(loadSfxCatalog(dir)).toEqual({entries: [], issues: []});
  });
});

describe('parseCatalog', () => {
  it('reads a full entry and defaults gainDb to 0', () => {
    const {entries, issues} = parseCatalog([{fileName: 'whoosh_soft_01.wav', duration: 0.42, tobeused: ['cut', 'transition'], notes: 'airy'}]);
    expect(issues).toEqual([]);
    expect(entries).toEqual([{fileName: 'whoosh_soft_01.wav', duration: 0.42, tobeused: ['cut', 'transition'], gainDb: 0, notes: 'airy'}]);
  });

  it('normalizes a comma-separated tobeused string to an array', () => {
    const {entries} = parseCatalog([{fileName: 'a.wav', duration: 1, tobeused: ' Cut, transition ,cut', gainDb: -3}]);
    expect(entries[0]).toMatchObject({tobeused: ['cut', 'transition'], gainDb: -3});
  });

  it('warns on an unknown cue, keeps the valid ones and never throws', () => {
    const {entries, issues} = parseCatalog([{fileName: 'a.wav', duration: 1, tobeused: ['cut', 'boom']}]);
    expect(entries[0]!.tobeused).toEqual(['cut']);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({level: 'warn', code: 'unknown_cue', fileName: 'a.wav'});
    expect(issues[0]!.message).toContain('boom');
  });

  it('drops entries that cannot work, with a warning each, and survives junk', () => {
    const {entries, issues} = parseCatalog([
      null,
      {duration: 1, tobeused: ['cut']},
      {fileName: '../x.wav', duration: 1, tobeused: ['cut']},
      {fileName: 'a.ogg', duration: 1, tobeused: ['cut']},
      {fileName: 'b.wav', tobeused: ['cut']},
      {fileName: 'c.wav', duration: 1},
      {fileName: 'd.wav', duration: 1, tobeused: ['nope']},
      {fileName: 'e.wav', duration: 1, tobeused: ['cut']},
      {fileName: 'e.wav', duration: 2, tobeused: ['hook']},
    ]);
    expect(entries.map(entry => entry.fileName)).toEqual(['e.wav']);
    expect(entries[0]!.duration).toBe(1);
    expect(issues.map(issue => issue.code)).toEqual([
      'entry_invalid', 'entry_no_filename', 'entry_bad_filename', 'entry_bad_extension', 'entry_no_duration', 'entry_no_cues', 'unknown_cue', 'entry_no_valid_cues', 'entry_duplicate',
    ]);
    expect(parseCatalog({not: 'an array'}).issues[0]!.code).toBe('catalog_not_array');
    expect(parseCatalog([]).entries).toEqual([]);
  });

  it('reports invalid JSON on disk instead of throwing', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'sfxinfo.json'), '{oops');
    expect(loadSfxCatalog(dir).issues[0]!.code).toBe('catalog_unreadable');
    expect(loadSfxCatalog(path.join(dir, 'missing'))).toEqual({entries: [], issues: []});
  });
});

describe('flag', () => {
  it('SFX_VOICE_OFFSET_LU defaults to -10 and ignores nonsense or positive values', () => {
    expect(sfxVoiceOffsetLu({})).toBe(-10);
    expect(sfxVoiceOffsetLu({SFX_VOICE_OFFSET_LU: '-14'})).toBe(-14);
    expect(sfxVoiceOffsetLu({SFX_VOICE_OFFSET_LU: '3'})).toBe(-10);
    expect(sfxVoiceOffsetLu({SFX_VOICE_OFFSET_LU: 'loud'})).toBe(-10);
  });
});

describe('an empty catalog changes nothing', () => {
  const scheduled = schedulePolishSfxHits({
    graphics: [
      {start: 1, end: 3, placementMode: 'full_screen'},
      {start: 5, end: 6, placementMode: 'split_screen'},
    ],
    transitions: [{at: 8, keyword: 'whip pan'}, {at: 10, keyword: 'hard cut'}],
    framedWindows: [{start: 12}],
  });

  it('keeps today\'s hits exactly (snapshot of the scheduler)', () => {
    expect(scheduled.hits).toMatchInlineSnapshot(`
      [
        {
          "at": 1,
          "kind": "hit",
          "reason": "graphic_full_screen",
          "volume": 0.14,
        },
        {
          "at": 5,
          "kind": "pop",
          "reason": "graphic_split_screen",
          "volume": 0.1,
        },
        {
          "at": 8,
          "kind": "whoosh",
          "reason": "transition_whip pan",
          "volume": 0.12,
        },
        {
          "at": 10,
          "kind": "hit",
          "reason": "transition_hard cut",
          "volume": 0.12,
        },
        {
          "at": 12,
          "kind": "pop",
          "reason": "framed_window",
          "volume": 0.08,
        },
      ]
    `);
  });

  it('applyCatalogToHits with no entries returns the same hits, deep-equal', () => {
    const result = applyCatalogToHits(scheduled.hits, {entries: [], videoId: 'v1', voLufs: -20, wordOnsetsSec: [1.05, 8.05]});
    expect(result.hits).toEqual(scheduled.hits);
    expect(result.stats).toMatchObject({input: 5, fromCatalog: 0, fallback: 5, maskedByWord: 0, maxPeakVsVoiceLu: null});
  });

  it('entries that match no scheduled cue also leave every hit untouched', () => {
    const entries: SfxEntry[] = [{fileName: 'ui.wav', duration: 0.2, tobeused: ['ui', 'ambience'], gainDb: 0}];
    expect(applyCatalogToHits(scheduled.hits, {entries, videoId: 'v1', voLufs: -20}).hits).toEqual(scheduled.hits);
  });
});

describe('the pick', () => {
  const dir = tempDir();
  writeTone(path.join(dir, 'whoosh_a.wav'), {toneSec: 0.4});
  writeTone(path.join(dir, 'hit_b.wav'), {toneSec: 0.3});
  writeFileSync(
    path.join(dir, 'sfxinfo.json'),
    JSON.stringify([
      {fileName: 'whoosh_a.wav', duration: 0.4, tobeused: ['transition'], gainDb: -2},
      {fileName: 'hit_b.wav', duration: 0.3, tobeused: 'cut,emphasis'},
    ]),
  );
  const {entries, issues} = loadSfxCatalog(dir);

  it('loads the two-entry fixture without issues', () => {
    expect(issues).toEqual([]);
    expect(entries.map(entry => entry.fileName)).toEqual(['whoosh_a.wav', 'hit_b.wav']);
  });

  it('the right cue picks the right file', () => {
    expect(pickEntry(entries, 'transition', 'vid', 4)!.fileName).toBe('whoosh_a.wav');
    expect(pickEntry(entries, 'cut', 'vid', 4)!.fileName).toBe('hit_b.wav');
    expect(pickEntry(entries, 'emphasis', 'vid', 9.5)!.fileName).toBe('hit_b.wav');
    expect(pickEntry(entries, 'hook', 'vid', 0.2)).toBeNull();
  });

  it('is stable across runs and independent of catalog order', () => {
    const many: SfxEntry[] = ['a', 'b', 'c', 'd'].map(name => ({fileName: `${name}.wav`, duration: 0.3, tobeused: ['cut'], gainDb: 0}));
    const picks = (list: SfxEntry[]) => [1, 2.5, 7.25, 11].map(at => pickEntry(list, 'cut', 'video-123', at)!.fileName);
    expect(picks(many)).toEqual(picks(many));
    expect(picks([...many].reverse())).toEqual(picks(many));
    // A different video can pick differently; the same video never does.
    const other = [1, 2.5, 7.25, 11, 13, 17].map(at => pickEntry(many, 'cut', 'video-999', at)!.fileName);
    const mine = [1, 2.5, 7.25, 11, 13, 17].map(at => pickEntry(many, 'cut', 'video-123', at)!.fileName);
    expect(new Set([...other, ...mine]).size).toBeGreaterThan(1);
  });

  it('replaces a scheduled hit with the catalog file, relative to the voice', () => {
    const hits = [
      {at: 8, kind: 'whoosh' as const, volume: 0.12, reason: 'transition_whip pan'},
      {at: 10, kind: 'hit' as const, volume: 0.12, reason: 'transition_hard cut'},
      {at: 12, kind: 'pop' as const, volume: 0.08, reason: 'framed_window'},
    ];
    const result = applyCatalogToHits(hits, {entries, videoId: 'vid', voLufs: -20, offsetLu: -10});
    expect(result.hits[0]).toMatchObject({src: 'staticFile:sfx-library/whoosh_a.wav', durationSec: 0.4, kind: 'whoosh'});
    expect(result.hits[1]).toMatchObject({src: 'staticFile:sfx-library/hit_b.wav', durationSec: 0.3});
    expect(result.hits[2]).toEqual(hits[2]); // zoom_in: no entry, built-in pop kept
    // -20 LUFS voice, -10 LU, gainDb -2 → -32 dBFS peak → 0.0251
    expect(result.hits[0]!.volume).toBeCloseTo(10 ** (-32 / 20), 4);
    expect(result.hits[1]!.volume).toBeCloseTo(10 ** (-30 / 20), 4);
    expect(result.stats).toMatchObject({fromCatalog: 2, fallback: 1, maxPeakVsVoiceLu: -10});
  });
});

describe('voice-first level and word mask', () => {
  it('never sets a peak closer to the voice than -6 LU, whatever gainDb says', () => {
    expect(catalogVolume(-20, -10, 0)).toMatchObject({peakDbfs: -30, clamped: false});
    expect(catalogVolume(-20, -10, 9)).toMatchObject({peakDbfs: -26, clamped: true});
    expect(catalogVolume(0, 0, 0).volume).toBeLessThanOrEqual(1);
  });

  it('drops a catalog hit within 120 ms after a word onset and keeps one outside', () => {
    const entries: SfxEntry[] = [{fileName: 'c.wav', duration: 0.3, tobeused: ['cut'], gainDb: 0}];
    const hit = (at: number) => ({at, kind: 'hit' as const, reason: 'transition_hard cut'});
    const run = (at: number) => applyCatalogToHits([hit(at)], {entries, videoId: 'v', voLufs: -20, wordOnsetsSec: [5]});
    expect(run(5.05).hits).toEqual([]);
    expect(run(5.05).stats.maskedByWord).toBe(1);
    expect(run(5.12).hits).toEqual([]);
    expect(run(5.2).hits).toHaveLength(1);
    expect(run(4.95).hits).toHaveLength(1); // before the onset is fine
  });

  it('maps scheduled hits to cues', () => {
    expect(cueForHit({kind: 'hit', reason: 'transition_hard cut'})).toBe('cut');
    expect(cueForHit({kind: 'whoosh', reason: 'transition_whip pan'})).toBe('transition');
    expect(cueForHit({kind: 'hit', reason: 'transition_smash zoom'})).toBe('zoom_in');
    expect(cueForHit({kind: 'pop', reason: 'framed_window'})).toBe('zoom_in');
    expect(cueForHit({kind: 'hit', reason: 'graphic_full_screen'})).toBe('transition');
    expect(cueForHit({kind: 'whoosh', reason: 'recipe_x_whoosh'})).toBe('kinetic_plate');
  });
});

describe('sfx:check validation', () => {
  it('flags unknown cues and missing files with a fake probe', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'sfxinfo.json'), JSON.stringify([{fileName: 'gone.wav', duration: 1, tobeused: ['cut', 'zap']}]));
    const report = await validateSfxLibrary(dir, async () => ({durationSec: 1, leadingSilenceSec: 0, peakDbfs: -1}));
    expect(report.issues.map(issue => issue.code).sort()).toEqual(['file_missing', 'unknown_cue']);
    expect(report.issues.find(issue => issue.code === 'file_missing')!.level).toBe('error');
  });

  it('flags a wrong duration, leading silence and a file with no entry; suggests, never edits', async () => {
    const dir = tempDir();
    writeTone(path.join(dir, 'good.wav'), {toneSec: 0.5});
    writeTone(path.join(dir, 'long.wav'), {toneSec: 0.8}); // catalog says 0.5
    writeTone(path.join(dir, 'late.wav'), {toneSec: 0.3, silenceSec: 0.12}); // 120 ms of leading silence, 0.42 s total
    writeTone(path.join(dir, 'quiet.wav'), {toneSec: 0.3, peak: 0.1}); // peak about -20 dBFS
    writeTone(path.join(dir, 'orphan.wav'), {toneSec: 0.2});
    const catalogText = JSON.stringify([
      {fileName: 'good.wav', duration: 0.5, tobeused: ['cut']},
      {fileName: 'long.wav', duration: 0.5, tobeused: ['cut']},
      {fileName: 'late.wav', duration: 0.42, tobeused: ['transition']},
      {fileName: 'quiet.wav', duration: 0.3, tobeused: ['emphasis']},
    ]);
    writeFileSync(path.join(dir, 'sfxinfo.json'), catalogText);
    const before = readdirSync(dir).map(name => [name, readFileSync(path.join(dir, name)).length]);
    if (!hasFfmpeg) return;

    const report = await validateSfxLibrary(dir);
    const by = (code: string) => report.issues.filter(issue => issue.code === code).map(issue => issue.fileName);
    expect(by('duration_mismatch')).toEqual(['long.wav']);
    expect(by('leading_silence')).toEqual(['late.wav']);
    expect(by('peak_out_of_range')).toEqual(['quiet.wav']);
    expect(by('uncatalogued_file')).toEqual(['orphan.wav']);
    expect(by('file_missing')).toEqual([]);
    expect(report.issues.find(issue => issue.code === 'duration_mismatch')!.suggestion).toContain('"duration": 0.8');
    expect(report.probed).toBe(4);
    // read-only
    expect(readFileSync(path.join(dir, 'sfxinfo.json'), 'utf8')).toBe(catalogText);
    expect(readdirSync(dir).map(name => [name, readFileSync(path.join(dir, name)).length])).toEqual(before);
  }, 30000);

  it('reports a clean library with no issues', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'sfxinfo.json'), '[]');
    expect(await validateSfxLibrary(dir)).toMatchObject({entries: [], issues: [], probed: 0});
  });
});
