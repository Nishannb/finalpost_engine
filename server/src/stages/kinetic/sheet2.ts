/**
 * Contact sheet 2 (depth + looks). `storyboard.ts` stays the LAYOUT sheet (beside / flank / one behind / one 3D). This one shows the chemistry that sheet lacks, 9 cells on a centred (or side) stand-in figure:
 *
 *   BEHIND (the silhouette really hides the words)          FRONT (type in front of the speaker, each its own look)
 *   B1 stackOverCutout, cinematicClean                       F1 bold centre stack over the chest, hero ~3x connectors
 *   B2 stackOverCutout, editorialLuxury (serif italic)       F2 editorial serif italic tucked into a sans line, upper chest
 *   B3 extruded 3D chrome hero behind the head + small       F3 retro neon: one accent script hero, glow on the hero only
 *      front word above the cutout                           F4 extruded 3D warm-amber word in a side gutter
 *   B4 wide condensed caps across the shoulders              F5 running line, one small word at a time at chest height
 *
 * Every cell is its own 96-frame shot solved by the real solver (one solve per style, merged), like storyboard.ts. Pure; cli.ts renders it.
 */
import {StaticCamera} from './camera.ts';
import {SubjectBandDepth} from './depth.ts';
import {solveLayout, type SolveReport} from './layout.ts';
import {buildScene, type Box} from './scene.ts';
import {brandConfigSchema, type BrandConfig, type KineticPlan, type KineticShot, type KineticWord, type RenderSpec, type StyleName, type TextEvent} from './schema.ts';
import {STORYBOARD_SLOT_FRAMES} from './storyboard.ts';

export const SHEET2_COLS = 3;
export const SHEET2_SUBJECT: Box = {x: 0.28, y: 0.34, w: 0.44, h: 0.6};
const FIG_LEFT: Box = {x: 0.04, y: 0.3, w: 0.4, h: 0.62};

/** warm accent for the front 3D word: re-colours the chrome material through the brand gradient table */
export const SHEET2_BRAND: BrandConfig = brandConfigSchema.parse({palette: {ink: '#111111', paper: '#FFFFFF', accent: '#FFD400', accent2: '#FF5A36', gradients: {amber: ['#FF9A3C', '#B34700']}}});

type L = TextEvent['lines'][number];
export type Sheet2Cell = {
  id: string;
  label: string;
  group: 'behind' | 'front';
  style: StyleName;
  box: Box;
  words: string[];
  /** events of the cell; wordRange is relative to `words` */
  events: Array<Pick<TextEvent, 'id' | 'lines' | 'preset' | 'layering' | 'regionHint'> & Partial<Pick<TextEvent, 'wordRange' | 'styleOverrides'>>>;
  /** frame offset inside the slot where the still is taken (null = just after the last word) */
  still: number | null;
};

const ln = (text: string, role: L['role']): L => ({text, role});

export const SHEET2_CELLS: Sheet2Cell[] = [
  {id: 'b1.stack.clean', label: 'BEHIND · stackOverCutout · cinematicClean', group: 'behind', style: 'cinematicClean', box: SHEET2_SUBJECT, words: ['i', 'was', 'done'],
    events: [{id: 'b1', lines: [ln('i was', 'connector'), ln('done', 'hero')], preset: 'type.words', layering: 'auto', regionHint: 'stackOverCutout'}], still: null},
  {id: 'b2.stack.editorial', label: 'BEHIND · stackOverCutout · editorialLuxury', group: 'behind', style: 'editorialLuxury', box: SHEET2_SUBJECT, words: ['i', 'still', 'believe'],
    events: [{id: 'b2', lines: [ln('i still', 'connector'), ln('believe', 'hero')], preset: 'type.words', layering: 'auto', regionHint: 'stackOverCutout'}], still: null},
  {id: 'b3.extruded3d.behind', label: 'BEHIND · chrome 3D behind the head + small word above', group: 'behind', style: 'cinematicClean', box: SHEET2_SUBJECT, words: ['just', 'stand', 'out'],
    events: [
      {id: 'b3.front', wordRange: [0, 1], lines: [ln('just', 'support')], preset: 'type.words', layering: 'front', regionHint: 'upper'},
      {id: 'b3.3d', wordRange: [1, 1], lines: [ln('stand', 'hero')], preset: 'hero.extruded3d.rise', layering: 'behind', regionHint: 'auto'},
    ], still: 38},
  {id: 'b4.wide.shoulders', label: 'BEHIND · wide condensed caps across the shoulders', group: 'behind', style: 'cinematicClean', box: SHEET2_SUBJECT, words: ['believe', 'it'],
    events: [{id: 'b4', lines: [ln('believe', 'hero')], preset: 'stack.condensedHero.behind', layering: 'behind', regionHint: 'behindSignature'}], still: 38},
  {id: 'f1.chest.stack', label: 'FRONT · bold centre stack over the chest', group: 'front', style: 'cinematicClean', box: SHEET2_SUBJECT, words: ['i', 'will', 'stand'],
    events: [{id: 'f1', lines: [ln('i will', 'connector'), ln('stand', 'hero')], preset: 'type.words', layering: 'auto', regionHint: 'running'}], still: null},
  {id: 'f2.editorial.tuck', label: 'FRONT · serif italic tucked into a sans line', group: 'front', style: 'editorialLuxury', box: SHEET2_SUBJECT, words: ['not', 'tired', 'yet'],
    events: [{id: 'f2', lines: [ln('not', 'connector'), ln('tired', 'hero'), ln('yet', 'support')], preset: 'type.words', layering: 'auto', regionHint: 'running'}], still: null},
  {id: 'f3.retro.neon', label: 'FRONT · retro neon script hero', group: 'front', style: 'retroNeon', box: SHEET2_SUBJECT, words: ['just', 'believe'],
    events: [{id: 'f3', lines: [ln('just', 'connector'), ln('believe', 'hero')], preset: 'type.words', layering: 'auto', regionHint: 'upper'}], still: null},
  {id: 'f4.extruded3d.gutter', label: 'FRONT · warm amber 3D in the side gutter', group: 'front', style: 'cinematicClean', box: FIG_LEFT, words: ['not', 'done', 'yet'],
    events: [{id: 'f4', wordRange: [1, 1], lines: [ln('done', 'hero')], preset: 'hero.extruded3d.rise', layering: 'front', regionHint: 'besideRight', styleOverrides: {gradient: 'amber'}}], still: 38},
  {id: 'f5.running', label: 'FRONT · running line, one word at a time', group: 'front', style: 'cinematicClean', box: SHEET2_SUBJECT, words: ['stand', 'out', 'every', 'day'],
    events: [{id: 'f5', lines: [ln('stand out every day', 'running')], preset: 'type.words', layering: 'auto', regionHint: 'running'}], still: 50},
];

export function buildSheet2(opts: {width?: number; height?: number; fps?: number; seed?: number; only?: string[]; cells?: Sheet2Cell[]} = {}): {
  spec: RenderSpec; report: SolveReport; plan: KineticPlan; words: KineticWord[]; shots: KineticShot[]; cells: Array<Sheet2Cell & {slot: number; stillFrame: number}>;
} {
  const width = opts.width ?? 720, height = opts.height ?? 1280, fps = opts.fps ?? 30;
  const cells = (opts.cells ?? SHEET2_CELLS).filter(c => !opts.only || opts.only.includes(c.id));
  const words: KineticWord[] = [];
  const shots: KineticShot[] = [];
  const scenes: Record<string, ReturnType<typeof buildScene>> = {};
  const cameras: Record<string, ReturnType<StaticCamera['track']>> = {};
  const evByStyle = new Map<StyleName, TextEvent[]>();
  const placed = cells.map((cell, i) => {
    const start = i * STORYBOARD_SLOT_FRAMES;
    const base = words.length;
    cell.words.forEach((text, k) => words.push({idx: base + k, text, startFrame: start + 8 + k * 14, endFrame: start + 8 + k * 14 + 12, emphasisScore: 0.8}));
    const shot: KineticShot = {id: `shot-${i}`, startFrame: start, endFrame: start + STORYBOARD_SLOT_FRAMES};
    shots.push(shot);
    scenes[shot.id] = buildScene({shotId: shot.id, subjectBox: cell.box, luminance: 0.07, width, height});
    cameras[shot.id] = new StaticCamera().track(shot);
    for (const e of cell.events) {
      const range = e.wordRange ?? [0, cell.words.length - 1];
      const te: TextEvent = {id: e.id, shotId: shot.id, wordRange: [base + range[0], base + range[1]], lines: e.lines, preset: e.preset, layering: e.layering, anchor: 'auto', regionHint: e.regionHint, ...(e.styleOverrides ? {styleOverrides: e.styleOverrides} : {})};
      evByStyle.set(cell.style, [...(evByStyle.get(cell.style) ?? []), te]);
    }
    const still = cell.still ?? 8 + (cell.words.length - 1) * 14 + 12 + 6;
    return {...cell, slot: start, stillFrame: start + still};
  });
  const merged: RenderSpec[] = [];
  const report: SolveReport = {actions: [], dropped: [], violations: [], anchorDowngrades: []};
  for (const [style, events] of evByStyle) {
    const r = solveLayout({plan: {version: '1', style, events}, words, shots, scenes, cameras, depth: new SubjectBandDepth(), brand: SHEET2_BRAND, width, height, fps, seed: opts.seed ?? 1, planSource: 'sheet-2'});
    merged.push(r.spec);
    report.actions.push(...r.report.actions); report.dropped.push(...r.report.dropped); report.violations.push(...r.report.violations); report.anchorDowngrades.push(...r.report.anchorDowngrades);
  }
  const first = merged[0]!;
  const spec: RenderSpec = {...first, captions: [], durationInFrames: Math.max(1, placed.length * STORYBOARD_SLOT_FRAMES), events: merged.flatMap(m => m.events).sort((a, b) => a.inFrame - b.inFrame || a.id.localeCompare(b.id)), shots: first.shots};
  const plan: KineticPlan = {version: '1', style: 'cinematicClean', events: [...evByStyle.values()].flat()};
  return {spec, report, plan, words, shots, cells: placed};
}

export function sheet2Props(sb: ReturnType<typeof buildSheet2> = buildSheet2()) {
  return {
    spec: sb.spec,
    subjectBox: SHEET2_SUBJECT,
    subjectBoxes: sb.cells.map(c => ({startFrame: c.slot, endFrame: c.slot + STORYBOARD_SLOT_FRAMES, box: c.box, label: c.label})),
  };
}
