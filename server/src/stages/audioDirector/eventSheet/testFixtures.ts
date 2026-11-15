/** Synthetic blueprints shared by the Event Sheet tests. Test-only (imported by *.test.ts files). */

export type Bp = Record<string, unknown>;

export function base(extra: Bp = {}): Bp {
  return {
    schemaVersion: 1,
    blueprintId: 'bp_test',
    createdAt: '2026-11-12T00:00:00.000Z',
    videoUrl: 'https://example.invalid/source.mp4',
    languageCode: 'en',
    fps: 30,
    width: 1080,
    height: 1920,
    sourceDurationSec: 12,
    outputDurationSec: 10,
    captionWords: [
      {text: 'Three', start: 0.2, end: 0.5, sentenceIndex: 0},
      {text: 'things', start: 0.6, end: 1.0, sentenceIndex: 0},
      {text: 'changed', start: 5.1, end: 5.5, sentenceIndex: 1},
    ],
    keepSegments: [
      {sourceStart: 0, sourceEnd: 4, outputStart: 0},
      {sourceStart: 5, sourceEnd: 11, outputStart: 4},
    ],
    zoomTriggers: [{start: 2, end: 3, scale: 1.2, sentenceIndex: 0}],
    brollClips: [{start: 6, end: 8, keyword: 'city', assetUrl: 'https://cdn.invalid/a.mp4', provider: 'pexels', providerId: 1, width: 1, height: 1, credit: 'Alice', creditUrl: 'y'}],
    transitions: [{at: 6, duration: 0.4, keyword: 'whip blur', assetUrl: '', blend: 'screen', provider: 'generated', providerId: 0, width: 1, height: 1, credit: '', creditUrl: ''}],
    hookTitle: '',
    ...extra,
  };
}

export const kineticSpec = (extra: Bp = {}): Bp => ({
  version: '1',
  seed: 1,
  fps: 30,
  width: 1080,
  height: 1920,
  durationInFrames: 300,
  safeRect: {left: 0, right: 0, top: 0, bottom: 0},
  noMatte: true,
  shots: [{id: 'shot-0', startFrame: 0, endFrame: 300, noMatte: true}],
  events: [
    {id: 'hero-0', fps: 30, inFrame: 6, outFrame: 30, preset: 'type.words', presetResolved: 'type.words', layering: 'front', style: 'cinematicClean', exit: 'X1', wordRange: [0, 1], lines: [{text: 'THREE'}, {text: 'THINGS'}], flash: {startFrame: 6, color: '#fff', opacities: [0.8, 0.4]}},
    {id: 'hero-1', fps: 30, inFrame: 153, outFrame: 170, preset: 'type.words', presetResolved: 'type.words', layering: 'front', style: 'cinematicClean', exit: 'X1', wordRange: [2, 2], lines: [{text: 'CHANGED'}], flash: null},
  ],
  captions: [{wordIdx: 2, text: 'changed', inFrame: 170, outFrame: 180}],
  planSource: 'test',
  ...extra,
});

export const kineticEvent = (id: string | undefined, inFrame: number, extra: Bp = {}): Bp => ({
  ...(id === undefined ? {} : {id}),
  fps: 30,
  inFrame,
  outFrame: inFrame + 10,
  lines: [{text: 'X'}],
  flash: null,
  ...extra,
});

export const stage = (extra: Bp = {}): Bp => ({
  version: 1,
  styleId: 'subject_stage',
  matteUrl: 'staticFile:subject-matte.webm',
  bg: {blurPx: 0, dimPct: 0},
  spans: [{start: 1, end: 3, stage: 'S1', asset: {url: 'https://a.invalid/1.jpg', kind: 'image'}, motion: {kind: 'none'}, enter: 'hard_cut'}],
  accents: [{start: 1.5, end: 2.5, kind: 'pop_in', slot: 0, lines: ['A'], lineStarts: [0]}],
  cutaways: [{start: 5, end: 6, assetUrl: 'https://a.invalid/c.mp4', mediaKind: 'video', enter: 'hard_cut', exit: 'hard_cut'}],
  ...extra,
});
