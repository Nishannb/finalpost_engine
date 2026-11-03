/**
 * Contact sheet 3 (perspective). Sheet 1 is layout, sheet 2 is depth and looks. This one is how type SITS:
 * a wall in one-point perspective, isometric block letters, a trapezoid reshape, a slant, and an extruded word turned so the side face shows.
 * Every cell is its own 96-frame shot solved by the real solver. The same poses are what a production plan cycles onto front heroes.
 */
import {StaticCamera} from './camera.ts';
import {SubjectBandDepth} from './depth.ts';
import {solveLayout, type SolveReport} from './layout.ts';
import {buildScene, type Box} from './scene.ts';
import {brandConfigSchema, type KineticPlan, type KineticShot, type KineticWord, type RenderSpec, type StyleName, type TextEvent} from './schema.ts';
import {STORYBOARD_SLOT_FRAMES} from './storyboard.ts';

export const SHEET3_COLS = 3;
export const SHEET3_SUBJECT: Box = {x: 0.28, y: 0.32, w: 0.4, h: 0.58};
const FIG_RIGHT: Box = {x: 0.58, y: 0.28, w: 0.38, h: 0.64};
const FIG_LEFT: Box = {x: 0.04, y: 0.28, w: 0.38, h: 0.64};

type L = TextEvent['lines'][number];
export type Sheet3Cell = {
  id: string;
  label: string;
  style: StyleName;
  box: Box;
  words: string[];
  events: Array<Pick<TextEvent, 'id' | 'lines' | 'preset' | 'layering' | 'regionHint'> & Partial<Pick<TextEvent, 'wordRange' | 'pose' | 'accent' | 'enter' | 'exit'>>>;
  still: number | null;
};

const ln = (text: string, role: L['role']): L => ({text, role});

export const SHEET3_CELLS: Sheet3Cell[] = [
  {id: 'p1.recede.wall', label: 'RECEDE · wall of type above the speaker', style: 'cinematicClean', box: {x: 0.32, y: 0.7, w: 0.36, h: 0.26}, words: ['theyre', 'posting'],
    events: [{id: 'p1', lines: [ln('theyre', 'hero'), ln('posting', 'support')], preset: 'type.words', layering: 'front', regionHint: 'upper', pose: 'recede', enter: 'IN-1', exit: 'OUT-4'}], still: null},
  {id: 'p2.isometric.block', label: 'ISOMETRIC · block letters, side face showing', style: 'retroNeon', box: SHEET3_SUBJECT, words: ['shadow'],
    events: [{id: 'p2', lines: [ln('shadow', 'hero')], preset: 'type.words', layering: 'front', regionHint: 'upper', pose: 'isometric', accent: 'cyan'}], still: 28},
  {id: 'p3.trapezoid', label: 'TRAPEZOID · baseline wider than the top', style: 'cinematicClean', box: SHEET3_SUBJECT, words: ['reshape'],
    events: [{id: 'p3', lines: [ln('reshape', 'hero')], preset: 'type.words', layering: 'front', regionHint: 'upper', pose: 'trapezoid'}], still: 28},
  {id: 'p4.slant', label: 'SLANT · skewed hero', style: 'retroNeon', box: SHEET3_SUBJECT, words: ['kinetic'],
    events: [{id: 'p4', lines: [ln('kinetic', 'hero')], preset: 'type.words', layering: 'front', regionHint: 'running', pose: 'slant', accent: 'magenta'}], still: 28},
  {id: 'p5.extruded.yaw', label: 'EXTRUDED · accent colour, side face turned out', style: 'retroNeon', box: FIG_LEFT, words: ['flip'],
    events: [{id: 'p5', lines: [ln('flip', 'hero')], preset: 'hero.extruded3d.rise', layering: 'front', regionHint: 'besideRight', accent: 'orange'}], still: 20},
  {id: 'p6.recede.word', label: 'RECEDE · one word running to a vanishing point', style: 'retroNeon', box: FIG_RIGHT, words: ['graphics'],
    events: [{id: 'p6', lines: [ln('graphics', 'hero')], preset: 'type.words', layering: 'front', regionHint: 'besideLeft', pose: 'recede', accent: 'orange'}], still: 28},
  {id: 'p7.isometric.stack', label: 'ISOMETRIC · stacked word', style: 'retroNeon', box: SHEET3_SUBJECT, words: ['perspective'],
    events: [{id: 'p7', lines: [ln('perspective', 'hero')], preset: 'type.words', layering: 'front', regionHint: 'upper', pose: 'isometric', accent: 'gold'}], still: 28},
  {id: 'p8.trapezoid.stack', label: 'TRAPEZOID · two-line reshape', style: 'cinematicClean', box: SHEET3_SUBJECT, words: ['text', 'perspective'],
    events: [{id: 'p8', lines: [ln('text', 'support'), ln('perspective', 'hero')], preset: 'type.words', layering: 'front', regionHint: 'upper', pose: 'trapezoid'}], still: null},
  {id: 'p9.slant.beside', label: 'SLANT · beside the speaker', style: 'retroNeon', box: FIG_LEFT, words: ['posting'],
    events: [{id: 'p9', lines: [ln('posting', 'hero')], preset: 'type.words', layering: 'front', regionHint: 'besideRight', pose: 'slant', accent: 'crimson'}], still: 28},
];

export function buildSheet3(opts: {width?: number; height?: number; fps?: number; seed?: number; only?: string[]} = {}): {
  spec: RenderSpec; report: SolveReport; plan: KineticPlan; words: KineticWord[]; shots: KineticShot[]; cells: Array<Sheet3Cell & {slot: number; stillFrame: number}>;
} {
  const width = opts.width ?? 720, height = opts.height ?? 1280, fps = opts.fps ?? 30;
  const cells = SHEET3_CELLS.filter(c => !opts.only || opts.only.includes(c.id));
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
    scenes[shot.id] = buildScene({shotId: shot.id, subjectBox: cell.box, luminance: 0.12, plateColor: '#2A3344', width, height});
    cameras[shot.id] = new StaticCamera().track(shot);
    for (const e of cell.events) {
      const range = e.wordRange ?? [0, cell.words.length - 1];
      const te: TextEvent = {
        id: e.id, shotId: shot.id, wordRange: [base + range[0], base + range[1]], lines: e.lines, preset: e.preset, layering: e.layering, anchor: 'auto', regionHint: e.regionHint,
        ...(e.pose ? {pose: e.pose} : {}),
        ...(e.accent ? {accent: e.accent} : {}),
        ...(e.enter ? {enter: e.enter} : {}),
        ...(e.exit ? {exit: e.exit} : {}),
      };
      evByStyle.set(cell.style, [...(evByStyle.get(cell.style) ?? []), te]);
    }
    const still = cell.still ?? 8 + (cell.words.length - 1) * 14 + 18;
    return {...cell, slot: start, stillFrame: start + still};
  });
  const merged: RenderSpec[] = [];
  const report: SolveReport = {actions: [], dropped: [], violations: [], anchorDowngrades: []};
  for (const [style, events] of evByStyle) {
    const r = solveLayout({plan: {version: '1', style, fontPair: 'street', events}, words, shots, scenes, cameras, depth: new SubjectBandDepth(), brand: brandConfigSchema.parse({}), width, height, fps, seed: opts.seed ?? 1, planSource: 'sheet-3'});
    merged.push(r.spec);
    report.actions.push(...r.report.actions); report.dropped.push(...r.report.dropped); report.violations.push(...r.report.violations); report.anchorDowngrades.push(...r.report.anchorDowngrades);
  }
  const first = merged[0]!;
  const spec: RenderSpec = {...first, captions: [], durationInFrames: Math.max(1, placed.length * STORYBOARD_SLOT_FRAMES), events: merged.flatMap(m => m.events).sort((a, b) => a.inFrame - b.inFrame || a.id.localeCompare(b.id)), shots: first.shots};
  const plan: KineticPlan = {version: '1', style: 'retroNeon', fontPair: 'street', events: [...evByStyle.values()].flat()};
  return {spec, report, plan, words, shots, cells: placed};
}

export function sheet3Props(sb: ReturnType<typeof buildSheet3> = buildSheet3()) {
  return {
    spec: sb.spec,
    subjectBox: SHEET3_SUBJECT,
    subjectBoxes: sb.cells.map(c => ({startFrame: c.slot, endFrame: c.slot + STORYBOARD_SLOT_FRAMES, box: c.box, label: c.label})),
  };
}
