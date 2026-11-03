import {describe, expect, it} from 'vitest';

import {LOOP_THRESHOLD_SEC, usesLoopBody, type LoopBedSpec} from './loopBed.ts';

describe('usesLoopBody', () => {
  const bed: LoopBedSpec = {
    musicSource: 'generated',
    musicLoopUrl: 'https://example.test/bed_loop.wav',
    musicFullDurationSec: 60,
  };

  it('uses the 58 s threshold', () => {
    expect(LOOP_THRESHOLD_SEC).toBe(58);
  });

  it('does not need the loop element at or under 58 s', () => {
    expect(usesLoopBody(30, bed)).toBe(false);
    expect(usesLoopBody(58, bed)).toBe(false);
  });

  it('needs the loop element above 58 s', () => {
    expect(usesLoopBody(58.1, bed)).toBe(true);
    expect(usesLoopBody(90, bed)).toBe(true);
  });

  it('never splits without a loop url or for licensed beds', () => {
    expect(usesLoopBody(90, {...bed, musicLoopUrl: undefined})).toBe(false);
    expect(usesLoopBody(90, {...bed, musicSource: 'licensed'})).toBe(false);
  });
});
