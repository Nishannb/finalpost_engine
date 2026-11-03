/**
 * WP7G pure tests: cuts-profile aggression (glued yeahs, whole-video dedupe, higher removal cap), wider coach lead-ins, and the cuts debug dump. The stack mirrors the cuts-path Stage B
 * of `analyzeVideo` (the values used there: aggressiveBackchannel, maxRemovalFrac 0.5, wholeVideo). No audio, no video, no model.
 */
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import type {WordToken} from '../../types/blueprint.ts';
import {buildCutsDebugDump, writeCutsDebugDump} from '../../lib/cutsDebugDump.ts';
import {autoTrimSilence} from './autoTrim.ts';
import {buildCaptionWords} from './autoZoom.ts';
import {buildTimeline as speech} from './messyOneTake.fixtures.ts';
import {mergeTimeRanges, normalizeToken} from './scriptRetakeTrim.ts';
import {buildTimeline} from './timeline.ts';
import {transcriptRetakeExclusions, wordsOutsideRanges} from './transcriptRetakeTrim.ts';

const PAD = 0.08;

function stack(built: {words: WordToken[]; durationSec: number}, cuts: boolean) {
  const silence = autoTrimSilence(built.words, {thresholdSec: 0.4, paddingSec: PAD, sourceDurationSec: built.durationSec, removeFillers: true, aggressiveBackchannel: cuts});
  const retakes = transcriptRetakeExclusions(wordsOutsideRanges(built.words, []), {
    sourceDurationSec: built.durationSec,
    paddingSec: PAD,
    ...(cuts ? {maxRemovalFrac: 0.5, wholeVideo: true} : {}),
  });
  const exclusions = mergeTimeRanges([...silence.trimExclusions, ...retakes.trimExclusions]);
  const keep: Array<{sourceStart: number; sourceEnd: number; outputStart: number}> = [];
  let cursor = 0;
  let out = 0;
  for (const range of [...exclusions, {start: built.durationSec, end: built.durationSec}]) {
    if (range.start - cursor > 0.001) {
      keep.push({sourceStart: cursor, sourceEnd: range.start, outputStart: out});
      out += range.start - cursor;
    }
    cursor = Math.max(cursor, range.end);
  }
  const captions = buildCaptionWords(built.words, buildTimeline(keep), exclusions).map(w => normalizeToken(w.text)).filter(Boolean).join(' ');
  return {captions, retakes, exclusions, silence};
}
const count = (text: string, phrase: string) => text.split(phrase).length - 1;

const MAP = 'first we map the user journey on one simple page';
const CUT = 'then we cut every step that does not help the first win';
const TEST = 'after that we test it with five real customers this week';
const SHIP = 'finally we ship the smallest version and measure what changed';
const WHY = 'small teams move fast because nobody waits for approval';
const TAIL = 'and that is how a small team beats a big one every time';

describe('WP7G: glued backchannels on the cuts path', () => {
  const built = speech([{say: 'we shipped small changes and yeah that works every single day'}, {gap: 0.3}, {say: MAP}, {gap: 0.3}, {say: CUT}]);
  it('legacy rule keeps a glued mid-phrase yeah, the cuts rule cuts it', () => {
    expect(stack(built, false).captions).toContain('and yeah that works');
    const cuts = stack(built, true).captions;
    expect(cuts).not.toContain('yeah');
    expect(cuts).toContain('we shipped small changes and that works every single day');
  });
  it('never cuts yes / no / yet / year', () => {
    const real = speech([{say: 'yes we did it no we did not wait yet this year went well for the team'}, {gap: 0.3}, {say: MAP}, {gap: 0.3}, {say: CUT}]);
    expect(stack(real, true).captions).toContain('yes we did it no we did not wait yet this year went well');
  });
});

describe('WP7G: whole-video dedupe (the observed captionSample order)', () => {
  // A: an early fragment; much later B: the abandoned "revolutionized" opening; right after C: the full take with the other verb.
  const built = speech([
    {say: 'redefined collaboration in design for design'}, {gap: 1.0},
    {say: MAP}, {gap: 1.0}, {say: CUT}, {gap: 1.0}, {say: TEST}, {gap: 1.0}, {say: WHY}, {gap: 1.0}, {say: SHIP}, {gap: 1.0},
    {say: 'this is exactly how figma revolutionized'}, {gap: 0.9},
    {say: 'this is exactly how figma redefined collaboration in design for design today'}, {gap: 1.0}, {say: TAIL},
  ]);
  it('cuts path: one verb, one opening, one copy of the line, unique beats intact', () => {
    const {captions} = stack(built, true);
    expect(captions).not.toContain('revolutionized');
    expect(count(captions, 'redefined')).toBe(1);
    expect(count(captions, 'this is exactly how figma')).toBe(1);
    expect(captions).toContain('this is exactly how figma redefined collaboration in design for design today');
    for (const beat of [MAP, CUT, TEST, WHY, SHIP, TAIL]) expect(captions).toContain(beat);
  });
  it('the default (non-cuts) pass cannot reach the far fragment, so the whole-video pass is what fixes it', () => {
    expect(count(stack(built, false).captions, 'redefined collaboration in design for design')).toBe(2);
  });
  it('an intentional refrain far apart with a short line is left alone', () => {
    const refrain = speech([{say: 'ship it fast'}, {gap: 1}, {say: MAP}, {gap: 1}, {say: CUT}, {gap: 1}, {say: TEST}, {gap: 1}, {say: SHIP}, {gap: 1}, {say: 'ship it fast'}, {gap: 1}, {say: WHY}]);
    expect(count(stack(refrain, true).captions, 'ship it fast')).toBe(2);
  });
  it('a long messy take is cut harder with the cuts cap than with the 0.3 default', () => {
    const heavy = speech([
      {say: `${WHY} today`}, {gap: 0.9}, {say: `${WHY} today for all`}, {gap: 0.9}, {say: `${WHY} today for all of us`}, {gap: 0.9}, {say: MAP}, {gap: 0.9}, {say: CUT},
    ]);
    expect(stack(heavy, false).retakes.skipped).toBe('would_remove_too_much');
    const cuts = stack(heavy, true);
    expect(cuts.retakes.skipped).toBeUndefined();
    expect(count(cuts.captions, 'small teams move fast')).toBe(1);
  });
});

describe('WP7G: coach lead-ins beyond "say"', () => {
  const tail = [{gap: 0.9}, {say: MAP}, {gap: 0.8}, {say: CUT}, {gap: 0.8}, {say: TEST}] as const;
  it.each(['try again figma redefined collaboration in design', 'go figma redefined collaboration in design', 'like this figma redefined collaboration in design', 'one more time figma redefined collaboration in design'])(
    '"%s" then the creator performance keeps only the creator line',
    prompt => {
      const {captions} = stack(speech([{say: prompt}, {gap: 1.5}, {say: 'this is exactly how figma redefined collaboration in design for design'}, ...tail]), true);
      expect(count(captions, 'redefined collaboration in design')).toBe(1);
      expect(captions).toContain('this is exactly how figma redefined collaboration in design for design');
      expect(captions).not.toMatch(/\b(try|again|like this|one more)\b/);
    },
  );
  it('a creator sentence that starts with "this" or "like" is not treated as a coach lead-in', () => {
    const {captions} = stack(speech([{say: 'this is exactly how figma works'}, {gap: 1.0}, {say: MAP}, {gap: 1.0}, {say: CUT}, {gap: 1.0}, {say: TEST}]), true);
    expect(captions).toContain('this is exactly how figma works');
  });
});

describe('WP7G: cuts debug dump', () => {
  const input = {
    blueprintId: 'bp_test123', editProfile: 'cuts', sourceDurationSec: 10,
    words: [{text: 'Hello', start: 0.1, end: 0.4}, {text: 'yeah', start: 0.5, end: 0.8}],
    trimExclusions: [{start: 0.45, end: 0.85}], droppedTakes: 3, restarts: 1, echoes: 1,
    captionWords: [{text: 'Hello'}], warnings: ['transcript_retakes_dropped:3'],
  };
  it('builds the replay payload: words, exclusions, counts, caption texts in order', () => {
    const dump = buildCutsDebugDump(input);
    expect(dump.words).toEqual(input.words);
    expect(dump.trimExclusions).toEqual(input.trimExclusions);
    expect(dump.counts).toEqual({droppedTakes: 3, restarts: 1, echoes: 1});
    expect(dump.captionTexts).toEqual(['Hello']);
  });
  it('writes <dir>/<blueprintId>.json and never throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuts-debug-'));
    try {
      const file = writeCutsDebugDump(input, dir)!;
      expect(readdirSync(dir)).toEqual(['bp_test123.json']);
      expect(JSON.parse(readFileSync(file, 'utf8')).counts.droppedTakes).toBe(3);
      expect(writeCutsDebugDump(input, join(dir, 'bp_test123.json', 'nope'))).toBeNull();
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
  it('analyzeVideo triggers it on the cuts profile (or CUTS_DEBUG) and wires the cuts-only knobs', () => {
    const analyze = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'analyzeVideo.ts'), 'utf8');
    expect(analyze).toContain('if (speechCutsOn || env.CUTS_DEBUG) {');
    expect(analyze).toContain('writeCutsDebugDump({');
    expect(analyze).toContain('aggressiveBackchannel: speechCutsOn');
    expect(analyze).toContain('...(speechCutsOn ? {maxRemovalFrac: CUTS_RETAKE_MAX_REMOVAL, wholeVideo: true} : {})');
    expect(analyze).toContain('const CUTS_RETAKE_MAX_REMOVAL = 0.5;');
    expect(analyze).toContain('const maxRemoval = 0.55;');
  });
});
