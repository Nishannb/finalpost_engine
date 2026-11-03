import {describe, expect, it} from 'vitest';

import {transcriptFidelity} from './fallback.ts';
import {verifyRenderSpec} from './guardrails.ts';
import {SubjectBandDepth} from './depth.ts';
import {buildScene} from './scene.ts';
import {renderSpecSchema} from './schema.ts';
import {STORYBOARD_CELLS, buildPhraseA, buildStoryboard} from './storyboard.ts';

describe('storyboard (contact sheet)', () => {
  const sb = buildStoryboard();
  it('is 3 layouts x 3 styles + running / behindSignature / 3D, grounded and guardrail-clean', () => {
    expect(STORYBOARD_CELLS).toHaveLength(12);
    expect(renderSpecSchema.safeParse(sb.spec).success).toBe(true);
    expect(transcriptFidelity(sb.plan, sb.words)).toEqual([]);
    const scenes = Object.fromEntries(sb.shots.map((s, i) => [s.id, buildScene({shotId: s.id, subjectBox: sb.cells[i]!.box, luminance: 0.07})]));
    expect(verifyRenderSpec(sb.spec, {scenes, depth: new SubjectBandDepth(), shots: sb.shots})).toEqual([]);
  });
  it('is NOT a grid of words behind the oval: gutters / flanks in front, one behindSignature', () => {
    const behind = sb.spec.events.filter(e => e.layering === 'behind');
    expect(behind.length).toBeLessThanOrEqual(1);
    expect(sb.spec.events.filter(e => e.layering === 'front').length).toBeGreaterThanOrEqual(10);
    // one phrase = one block: the demo sheet never splits a phrase across the frame any more
    expect(sb.spec.events.some(e => e.zone === 'flank' || e.id.endsWith('.a'))).toBe(false);
  });
  it('phrase-a proof: 90 frames, roles as specified, no solver violations', () => {
    const p = buildPhraseA();
    expect(p.spec.durationInFrames).toBe(90);
    expect(p.report.violations).toEqual([]);
    expect(p.spec.events.flatMap(e => e.lines.map(l => `${l.text.toLowerCase()}:${l.role}`))).toEqual(['i:connector', 'feel:connector', 'like:connector', 'giving:hero', 'up:support', 'sometimes:support', 'man:connector']);
  });
});
