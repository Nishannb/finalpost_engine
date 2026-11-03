/**
 * WP6B source-text tests: the intra-utterance restart rule lives in the same pure module, is reached through the existing call (no new call site, no wider gate), and stays model-free.
 * analyzeVideo.ts imports the logger, so it is only read. No render, no network.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const analyze = stripComments(read('pipeline', 'analyzeVideo.ts'));
const raw = read('stages', 'filters', 'transcriptRetakeTrim.ts');
const module_ = stripComments(raw);

describe('wiring is as WP6A left it', () => {
  it('analyzeVideo still has one call and the same gate (mvp full-edits, or teleprompter-clean), and does not call the new helper directly', () => {
    expect(analyze.match(/transcriptRetakeExclusions\(/g)).toHaveLength(1);
    expect(analyze).toContain("if ((input.editProfile === 'mvp' && !captionsOnly) || teleprompterClean || speechCutsOn) {");
    expect(analyze).not.toContain('intraUtteranceRestarts');
    expect(analyze).toContain('transcriptRetakeDropped = transcriptRetakes.droppedTakes;');
    expect(analyze).toContain('warnings.push(`transcript_retakes_dropped:${transcriptRetakes.droppedTakes}`);');
  });
  it('the gate was not widened to legacy or lean captions-only: the captions-only skip and the legacy default are unchanged', () => {
    // WP7A: the captions-only skip still applies to every profile except the explicit `cuts` opt-in
    expect(analyze).toContain('(captionsOnly && !teleprompterClean && !speechCutsOn) ||');
    expect(read('config', 'env.ts')).toMatch(/PRODUCT_EDIT_PROFILE: str\('cuts'\)/);
  });
});

describe('the new rule', () => {
  it('is exported from the pure module and documented in its header (rule, keep rule, what is not detected)', () => {
    expect(module_).toContain('export function intraUtteranceRestarts(');
    expect(raw).toContain('WP6B, RESTARTS INSIDE ONE UTTERANCE');
    expect(raw).toContain('KEEP RULE (same spirit as for takes)');
    expect(raw).toContain('WP6C, IN-PLACE WORD SWAP'); // WP6C superseded the WP6B "not detected" note
  });
  it('is bounded by explicit constants: three repeated tokens, two content words, span 18, 60% per utterance, eight tokens minimum', () => {
    for (const line of ['const MIN_RESTART_PREFIX = 3;', 'const MIN_RESTART_CONTENT = 2;', 'const MAX_RESTART_SPAN = 18;', 'const FALSE_START_EXTRA = 3;', 'const MIN_UTTERANCE_TOKENS_FOR_RESTART = 8;', 'const MAX_INTRA_REMOVAL_FRAC = 0.6;']) expect(module_).toContain(line);
  });
  it('shares the global guards: one removal-fraction check covers takes and restarts, and the restart count is folded into droppedTakes', () => {
    expect(module_).toContain('if (dropped.length === 0 && restarts === 0) return none();');
    expect(module_.match(/removed \/ duration > maxRemoval/g)).toHaveLength(1);
    expect(module_).toContain('droppedTakes: dropped.length + restarts, clusters, restarts');
  });
  it('skips utterances already dropped as whole takes, and needs the timed split to line up with the take split', () => {
    expect(module_).toContain('if (timed.length === all.length) {');
    expect(module_).toContain('if (droppedOrders.has(order)) return;');
  });
  it('stays pure: the same four imports (plus the token normaliser from the script module), no scriptText, no model, no network, no logger', () => {
    expect([...module_.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]).sort()).toEqual(['../../types/blueprint.ts', './autoTrim.ts', './scriptRetakeTrim.ts', './timeline.ts']);
    expect(module_).not.toMatch(/fetch\(|gemini|anthropic|claude|groq|logger|node:fs|process\.env|readFile|spawn|scriptText/i);
  });
  it('the defaults are unchanged', () => {
    const env = read('config', 'env.ts');
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
    expect(env).toContain('SILENCE_THRESHOLD_SEC: num(0.4),');
  });
});
