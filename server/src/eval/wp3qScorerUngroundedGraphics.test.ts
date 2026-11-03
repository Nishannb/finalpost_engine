/**
 * WP3Q pure tests: row 6 (motion graphics and emphasis text) of the offline scorer, from the blueprint and a transcript string the caller passes. The matcher is the one the writer
 * uses (stages/broll/groundedText.ts); there is no second copy. Import graph: rubricScorer.ts (-> lib/renderIntegrity.ts -> lib/errors.ts -> lib/billingGuard.ts; groundedText.ts, no imports),
 * stages/broll/legibility.ts (for the parity check). No logger, `.env`, SDK, FFmpeg, Chromium, network or model call.
 */
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {isGroundedInTranscript as writerMatcher} from '../stages/broll/legibility.ts';
import {isGroundedInTranscript, ungroundedWords} from '../stages/broll/groundedText.ts';
import {scoreRubric} from './rubricScorer.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');
const read = (...parts: string[]) => readFileSync(resolve(...parts), 'utf8');

type Json = Record<string, unknown>;
const TRANSCRIPT = "Honestly, the biggest mistake is trying to control every emotion. Software won't fix that. Spend 5M less on ads, and save 20% of it.";
const graphic = (text: string, over: Json = {}) => ({start: 1, end: 3, text, role: 'primary', shape: 'pill', anchor: 'top_left', ...over});
const emphasis = (text: string) => ({start: 5, end: 7, text, weight: 'primary', treatment: 'scale', accentColor: '#FFFFFF'});
const bp = (over: Json = {}): Json => ({width: 1080, height: 1920, outputDurationSec: 30, hookTitle: 'x', motionGraphics: [], semanticEmphasis: [], visualOverlays: [], brollClips: [], ...over});
const row6 = (blueprint: Json, transcript?: string) => scoreRubric({blueprint, ...(transcript === undefined ? {} : {transcript})}).rows.find(item => item.row === 6)!;
const check = (r: ReturnType<typeof row6>, id: string) => r.checks.find(item => item.id === id)!;

describe('no transcript: not checked', () => {
  it('absent, empty or blank gives not_checked, whatever the graphics say; the blueprint\'s own transcript is not used', () => {
    for (const transcript of [undefined, '', '   \n']) {
      const r = row6(bp({motionGraphics: [graphic('Invented claim')], transcript: 'invented claim'}), transcript);
      expect(r, String(transcript)).toMatchObject({status: 'not_checked', complete: false});
      expect(r.checks.map(c => c.id)).toEqual(['graphic_text_in_transcript']);
    }
    expect(scoreRubric({blueprint: bp()}).inputs.transcript).toBe(false);
    expect(scoreRubric({blueprint: bp(), transcript: ' '}).inputs.transcript).toBe(false);
    expect(scoreRubric({blueprint: bp(), transcript: TRANSCRIPT}).inputs.transcript).toBe(true);
  });
  it('the stored Phase 34 legacy example without a transcript is not_checked for row 6', () => {
    const legacy = JSON.parse(read(HERE, 'fixtures', 'wp3a-phase34-blueprint.trimmed.json')) as Json;
    expect(row6(legacy).status).toBe('not_checked');
  });
});

describe('with a transcript', () => {
  it('empty motion-graphic and emphasis lists pass (nothing is claimed); the row is still incomplete', () => {
    const r = row6(bp(), TRANSCRIPT);
    expect(check(r, 'motion_graphic_text_in_transcript').status).toBe('pass');
    expect(check(r, 'emphasis_text_in_transcript').status).toBe('pass');
    expect(r).toMatchObject({status: 'pass', complete: false});
    expect(row6(bp({motionGraphics: undefined, semanticEmphasis: undefined}), TRANSCRIPT).status).toBe('pass');
  });

  it('text whose every word was said passes: case, punctuation, a plural s, currency and percent signs are ignored', () => {
    const r = row6(bp({motionGraphics: [graphic('CONTROL EVERY EMOTIONS'), graphic('biggest mistake!'), graphic('$5M')], semanticEmphasis: [emphasis('20%'), emphasis('Save it'), emphasis('Software')]}), TRANSCRIPT);
    expect(r.status).toBe('pass');
    expect(r.checks.filter(c => c.status === 'fail')).toEqual([]);
  });

  it('a graphic with a word that was not said fails the row and names the text, its path and the missing words', () => {
    const r = row6(bp({motionGraphics: [graphic('biggest mistake'), graphic('Recommended Software')]}), TRANSCRIPT);
    expect(r.status).toBe('fail');
    const c = check(r, 'motion_graphic_text_in_transcript');
    expect(c.status).toBe('fail');
    expect(c.evidence).toEqual([{path: 'motionGraphics[1].text', value: 'Recommended Software'}, {path: 'motionGraphics[1].wordsNotInTranscript', value: ['recommended']}]);
    expect(check(r, 'emphasis_text_in_transcript').status).toBe('pass');
  });

  it('the same for an emphasis; both lists are checked independently and both can fail', () => {
    const r = row6(bp({motionGraphics: [graphic('Guaranteed results')], semanticEmphasis: [emphasis('Master your feelings'), emphasis('control')]}), TRANSCRIPT);
    expect(check(r, 'emphasis_text_in_transcript').evidence).toEqual([{path: 'semanticEmphasis[0].text', value: 'Master your feelings'}, {path: 'semanticEmphasis[0].wordsNotInTranscript', value: ['master', 'your', 'feelings']}]);
    expect(r.checks.filter(c => c.status === 'fail').map(c => c.id).sort()).toEqual(['emphasis_text_in_transcript', 'motion_graphic_text_in_transcript']);
  });

  it('a spoken number written as words, or a paraphrase, does not match (the writer\'s stated limit)', () => {
    expect(row6(bp({motionGraphics: [graphic('FIVE MILLION')]}), TRANSCRIPT).status).toBe('fail');
    expect(row6(bp({semanticEmphasis: [emphasis('Stay calm')]}), TRANSCRIPT).status).toBe('fail');
  });

  it('an item with no text states nothing and does not fail', () => {
    expect(row6(bp({motionGraphics: [{start: 1, end: 2}, graphic('')]}), TRANSCRIPT).status).toBe('pass');
  });

  it('the hook title is not part of this row (overlay text is: see wp3rScorerVisibleText.test.ts, WP3R)', () => {
    const r = row6(bp({hookTitle: 'Recommended Software'}), TRANSCRIPT);
    expect(r.status).toBe('pass');
  });
});

describe('what the scorer will not decide', () => {
  const ids = ['pixel_quality', 'layout_repetition', 'paraphrase_fairness'];
  it('pixel quality, layout repetition and the fairness of a paraphrase are not_checked, with the basis stated, and never a pass', () => {
    for (const blueprint of [bp(), bp({motionGraphics: [graphic('biggest mistake')]}), bp({motionGraphics: [graphic('Invented')]})]) {
      const r = row6(blueprint, TRANSCRIPT);
      for (const id of ids) {
        expect(check(r, id).status, id).toBe('not_checked');
        expect(check(r, id).evidence).toEqual([{path: 'basis', value: 'blueprint and transcript only'}]);
      }
      expect(r.complete).toBe(false);
      expect(r.checks.filter(c => ids.includes(c.id) && c.status === 'pass')).toEqual([]);
    }
    expect(check(row6(bp(), TRANSCRIPT), 'paraphrase_fairness').detail).toContain('human judgement');
  });
});

describe('one matcher, and the scorer only reports', () => {
  it('the scorer\'s verdict equals the writer\'s matcher on a grid of texts', () => {
    const texts = ['control every emotions', 'CONTROL', 'biggest mistake', '$5M', '20%', 'Software', 'softwares', 'five million', 'Recommended Software', 'the', '', 'ads, and save', "Software's"];
    for (const text of texts) {
      const verdict = check(row6(bp({motionGraphics: [graphic(text)]}), TRANSCRIPT), 'motion_graphic_text_in_transcript').status;
      expect(verdict, text).toBe(writerMatcher(text, TRANSCRIPT) ? 'pass' : 'fail');
      expect(writerMatcher(text, TRANSCRIPT)).toBe(isGroundedInTranscript(text, TRANSCRIPT));
      expect(isGroundedInTranscript(text, TRANSCRIPT)).toBe(ungroundedWords(text, TRANSCRIPT).length === 0);
    }
  });
  it('the legacy matcher export is the shared one, and the tokenising regex exists in exactly one source file', () => {
    expect(writerMatcher).toBe(isGroundedInTranscript);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) name !== 'node_modules' && walk(path);
        else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) files.push(relative(SRC, path));
      }
    };
    walk(SRC);
    expect(files.filter(f => read(SRC, f).includes('[^\\p{L}\\p{N}$%€£]+'))).toEqual(['stages/broll/groundedText.ts']);
  });
  it('the scorer contains no matching code of its own', () => {
    const scorer = read(HERE, 'rubricScorer.ts');
    const code = scorer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain("import {ungroundedWords} from '../stages/broll/groundedText.ts';");
    const row = code.slice(code.indexOf('function scoreGraphics'), code.indexOf('function scoreIntegrity'));
    expect(row).not.toMatch(/toLowerCase|normalize\(|\.split\(|new Set\(|replace\(/);
    expect(row).toContain('ungroundedWords(entry.text, transcript)');
  });
  it('the writer imports the shared matcher instead of defining one, and still drops ungrounded text the same way', () => {
    const legibility = read(SRC, 'stages', 'broll', 'legibility.ts');
    expect(legibility).toContain("import {isGroundedInTranscript} from './groundedText.ts';");
    expect(legibility).not.toContain('const tokens =');
  });
  it('a blueprint is never modified: deep-frozen input scores, and the graphics come out unchanged', () => {
    const deepFreeze = <T,>(value: T): T => {
      if (typeof value === 'object' && value !== null) {
        Object.values(value as object).forEach(deepFreeze);
        Object.freeze(value);
      }
      return value;
    };
    const blueprint = deepFreeze(bp({motionGraphics: [graphic('Recommended Software')], semanticEmphasis: [emphasis('Master your feelings')]}));
    const before = JSON.stringify(blueprint);
    expect(() => scoreRubric({blueprint, transcript: TRANSCRIPT})).not.toThrow();
    expect(JSON.stringify(blueprint)).toBe(before);
  });
  it('hostile shapes do not throw', () => {
    for (const blueprint of [{}, null, {motionGraphics: 'x', semanticEmphasis: [null, 3, {text: 5}]}, {motionGraphics: [{text: {a: 1}}]}]) {
      expect(() => scoreRubric({blueprint, transcript: TRANSCRIPT})).not.toThrow();
    }
  });
});

describe('scope (source text)', () => {
  it('the report lists row 6 as scored; the CLI reads the transcript from a file only; the defaults and the renderer are untouched', () => {
    const r = scoreRubric({blueprint: bp(), transcript: TRANSCRIPT});
    expect(r.rows.map(item => item.row)).toEqual([1, 2, 3, 4, 5, 6, 9]);
    expect(r.notScored).toEqual([7, 8, 10]);
    const cli = read(SRC, 'scripts', 'scoreRubric.ts');
    expect(cli).toContain("'--transcript-file'");
    expect(cli).toContain("readFileSync(options.get('--transcript-file')!, 'utf8')");
    const env = read(SRC, 'config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
    for (const path of [['..', '..', 'remotion', 'src', 'components', 'MotionGraphicTrack.tsx'], ['..', '..', 'remotion', 'src', 'components', 'SemanticEmphasisTrack.tsx']]) expect(read(SRC, ...path)).not.toMatch(/groundedText|rubricScorer/);
  });
  it('only the writer and the scorer import the matcher module, and the legibility module is still imported by analyzeVideo alone among runtime files', () => {
    const importers: string[] = [];
    const legibilityImporters: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) name !== 'node_modules' && walk(path);
        else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
          const text = read(path);
          if (/groundedText\.ts'/.test(text)) importers.push(relative(SRC, path));
          if (/broll\/legibility\.ts'|\.\/legibility\.ts'/.test(text)) legibilityImporters.push(relative(SRC, path));
        }
      }
    };
    walk(SRC);
    expect(importers.sort()).toEqual(['eval/rubricScorer.ts', 'stages/broll/bakedGraphicText.ts', 'stages/broll/legibility.ts']); // WP3T added the baked-text check
    expect(legibilityImporters).toEqual(['pipeline/analyzeVideo.ts']);
  });
});
