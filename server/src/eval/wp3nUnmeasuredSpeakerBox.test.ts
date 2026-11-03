/**
 * WP3N pure tests: with an unmeasured face (mvp) the motion stage is given no speaker box, the motion Director prompt says the position is unknown and carries no coordinates, and a
 * behind-subject text request is not placed from a missing or default box. The decisions are pure: speakerForMotion / motionSpeakerLine (stages/layout/unmeasuredSlots.ts) and
 * decideTextTreatment (stages/textTreatment/textTreatment.ts, which imports only zod). motionDirector.ts, the stage index and analyzeVideo.ts import the logger / SDK path and are read as
 * text. Import graph: unmeasuredSlots.ts (-> lib/provenance.ts -> types/blueprint.ts constants; a type-only import of occupancy.ts) and textTreatment.ts (zod). No logger, `.env`, SDK, FFmpeg,
 * Chromium or network; no Claude or Gemini call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {motionSpeakerLine, speakerForMotion} from '../stages/layout/unmeasuredSlots.ts';
import {decideTextTreatment, type TextTreatment} from '../stages/textTreatment/textTreatment.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');

const DEFAULT_BOX = {x: 0.18, y: 0.16, w: 0.64, h: 0.62};
const occupancy = (source: 'vision' | 'fallback', unmeasuredSlots?: true) => ({speaker: DEFAULT_BOX, source, ...(unmeasuredSlots ? {unmeasuredSlots} : {})});

describe('what the motion stage is given', () => {
  it('a measured face (and any unmarked occupancy, which includes the whole legacy profile) passes the real box, the same object', () => {
    for (const o of [occupancy('vision'), occupancy('vision', true), occupancy('fallback')]) {
      const given = speakerForMotion(o) as {speakerBox: unknown};
      expect(given.speakerBox).toBe(o.speaker);
      expect(Object.keys(given)).toEqual(['speakerBox']);
    }
  });
  it('an unmeasured face passes no box and says the speaker is unknown', () => {
    const given = speakerForMotion(occupancy('fallback', true));
    expect(given).toEqual({speakerUnknown: true});
    expect('speakerBox' in given).toBe(false);
  });
});

describe('the motion Director prompt line', () => {
  it('with a box it is the original text, character for character', () => {
    expect(motionSpeakerLine({speakerBox: DEFAULT_BOX})).toBe('Speaker box (frame fractions): x=0.18 y=0.16 w=0.64 h=0.62.');
    expect(motionSpeakerLine({speakerBox: {x: 0.3333, y: 0.05, w: 0.4, h: 0.9}})).toBe('Speaker box (frame fractions): x=0.33 y=0.05 w=0.40 h=0.90.');
  });
  it('unknown gives an explicit statement and no coordinates, not a single digit', () => {
    const line = motionSpeakerLine({speakerUnknown: true});
    expect(line).toBe('The speaker position is UNKNOWN (detection failed). No speaker box is given; do not assume where the speaker is.');
    expect(line).not.toMatch(/\d/);
    expect(line).not.toMatch(/frame fractions|x=|y=|w=|h=/);
  });
  it('unknown wins even if a box is also passed (it cannot leak the default box)', () => {
    const line = motionSpeakerLine({speakerBox: DEFAULT_BOX, speakerUnknown: true});
    expect(line).not.toContain('0.18');
    expect(line).not.toContain('0.64');
    expect(line).toContain('UNKNOWN');
  });
  it('no box and not unknown gives the empty line, as before', () => {
    expect(motionSpeakerLine({})).toBe('');
  });
  it('end to end: the unmeasured branch of what the stage receives yields a prompt line without the default box coordinates', () => {
    const line = motionSpeakerLine(speakerForMotion(occupancy('fallback', true)));
    expect(line).not.toMatch(/0\.18|0\.16|0\.64|0\.62/);
    expect(motionSpeakerLine(speakerForMotion(occupancy('vision')))).toContain('x=0.18');
  });
});

describe('the behind-subject text decision', () => {
  const behind: TextTreatment = {kind: 'behind_subject', text: 'FOCUS', centerY: 0.3, widthFrac: 0.9};
  const base = {matteUsable: true, start: 1, end: 3, reason: 'why', behindColors: {color: '#FFFFFF'}};

  it('with an unknown speaker the request is not placed: it is delivered as a layered panel, downgraded, and says why', () => {
    const d = decideTextTreatment(behind, {...base, speakerUnknown: true});
    expect(d.route).toBe('toolkit');
    if (d.route === 'toolkit') {
      expect(d.downgradedFrom).toBe('behind_subject');
      expect(d.treatment.kind).toBe('layered');
      expect(d.note).toContain('speaker_unmeasured');
    }
  });
  it('even with a default box also passed, an unknown speaker is never placed from it', () => {
    const d = decideTextTreatment(behind, {...base, speakerBox: DEFAULT_BOX, speakerUnknown: true});
    expect(d.route).toBe('toolkit');
  });
  it('a measured speaker is unchanged: placed when the text is visible, downgraded for the old reason when it is hidden', () => {
    const placed = decideTextTreatment(behind, {...base, speakerBox: {x: 0.3, y: 0.6, w: 0.4, h: 0.3}});
    expect(placed.route).toBe('behind_subject_track');
    const hidden = decideTextTreatment(behind, {...base, speakerBox: {x: 0.0, y: 0.0, w: 1, h: 1}});
    expect(hidden.route).toBe('toolkit');
    if (hidden.route === 'toolkit') expect(hidden.note).toContain('text_mostly_hidden_');
  });
  it('legacy callers that pass no box and no flag keep the old meaning of "no box" (no constraint)', () => {
    expect(decideTextTreatment(behind, base).route).toBe('behind_subject_track');
    expect(decideTextTreatment(behind, {...base, speakerUnknown: false}).route).toBe('behind_subject_track');
  });
  it('the earlier reasons still come first: no matte, then no safe colour, then the unknown speaker', () => {
    const noteOf = (context: Parameters<typeof decideTextTreatment>[1]) => {
      const d = decideTextTreatment(behind, context);
      return d.route === 'toolkit' ? d.note : '';
    };
    expect(noteOf({...base, matteUsable: false, speakerUnknown: true})).toContain('no_foreground_matte');
    expect(noteOf({...base, behindColors: null, speakerUnknown: true})).toContain('no_safe_text_colour');
    expect(noteOf({...base, speakerUnknown: true})).toContain('speaker_unmeasured');
  });
  it('other treatments are not affected by an unknown speaker', () => {
    const layered: TextTreatment = {kind: 'layered', text: 'HI', reveal: 'wipe-right'};
    const d = decideTextTreatment(layered, {...base, speakerUnknown: true});
    expect(d.route).toBe('toolkit');
    if (d.route === 'toolkit') expect(d.downgradedFrom).toBeUndefined();
  });
  it('no behind-subject entry (and so no centerY or width) is created for an unknown speaker', () => {
    const d = decideTextTreatment(behind, {...base, speakerUnknown: true});
    expect('entry' in d).toBe(false);
  });
});

describe('wiring (source text; analyzeVideo, the stage and the Director import the logger or the SDK path)', () => {
  const av = read('pipeline', 'analyzeVideo.ts');
  const stage = read('stages', 'motionDirector', 'index.ts');
  const director = read('stages', 'motionDirector', 'motionDirector.ts');
  it('analyzeVideo hands the motion stage the speaker through the helper, not the occupancy box', () => {
    const call = av.indexOf('motion = await runMotionGraphicsStage({');
    const callBody = av.slice(call, av.indexOf('ledger,\n      });', call));
    expect(callBody).toContain('...speakerForMotion(occupancy),');
    expect(callBody).not.toContain('speakerBox: occupancy.speaker');
  });
  it('the stage forwards the flag to the Director and to the text-treatment decision, and nothing else reads the box', () => {
    expect(stage).toContain('...(input.speakerUnknown ? {speakerUnknown: true} : {}),');
    expect(stage.match(/speakerUnknown: true/g)).toHaveLength(2);
    expect(stage.match(/input\.speakerBox/g)).toHaveLength(3); // the Director call, the text-treatment call and (WP8J) the library seed's safe-band check
  });
  it('the Director prompt gets its speaker line from the helper, and the old inline box line is gone', () => {
    expect(director).toContain('motionSpeakerLine(input),');
    expect(director).not.toContain('Speaker box (frame fractions)');
    expect(director).not.toMatch(/input\.speakerBox\.(x|y|w|h)/);
  });
  it('the text-treatment code skips behind-subject when the speaker is unknown, after the matte and colour checks', () => {
    const t = read('stages', 'textTreatment', 'textTreatment.ts');
    expect(t).toContain("if (context.speakerUnknown) {\n    return downgrade('speaker_unmeasured');");
    expect(t.indexOf("downgrade('speaker_unmeasured')")).toBeGreaterThan(t.indexOf("downgrade('no_safe_text_colour')"));
    expect(t.indexOf("downgrade('speaker_unmeasured')")).toBeLessThan(t.indexOf('visibleFractionBehindSubject({centerY'));
  });
  it('the shared validator is not changed; the opening resolver was handled afterwards (WP3O), so no call site passes the occupancy box any more', () => {
    expect(read('lib', 'editConflicts.ts')).not.toMatch(/speakerUnknown|speakerForMotion|motionSpeakerLine/);
    expect(av.match(/speakerBox: occupancy\.speaker,/g)).toBeNull(); // WP3N left two (the opening calls); WP3O moved them to the helper
    expect(av.match(/\.\.\.speakerForMotion\(occupancy\),/g)).toHaveLength(3);
  });
  it('the defaults are unchanged', () => {
    const env = read('config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
