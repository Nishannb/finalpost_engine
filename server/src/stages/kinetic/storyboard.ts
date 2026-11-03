/**
 * Storyboard / contact sheet (MOTION-PLAYBOOK). NOT "every preset behind the oval": 3 columns of LAYOUT on a stand-in figure x 3 rows of STYLE, plus one row of specials.
 *
 *   columns  beside (figure left, type right) | beside (figure right, type left) | flank (figure centre, type on both sides)
 *   rows     cinematicClean | editorialLuxury | retroNeon
 *   extras   running line at the chest | one behindSignature | extruded 3D in a SIDE gutter (never through the face)
 *
 * Every cell is its own 96-frame shot solved by the real solver (one solve per style, merged). Pure; the CLI writes the spec to remotion/src/kinetic/storyboard.spec.json.
 */
import {StaticCamera} from './camera.ts';
import {SubjectBandDepth} from './depth.ts';
import {solveLayout, type SolveReport} from './layout.ts';
import {buildScene, type Box} from './scene.ts';
import {brandConfigSchema, type BrandConfig, type KineticPlan, type KineticShot, type KineticWord, type RenderSpec, type StyleName, type TextEvent} from './schema.ts';

export const STORYBOARD_SLOT_FRAMES = 96;
export const STORYBOARD_SUBJECT: Box = {x: 0.28, y: 0.3, w: 0.44, h: 0.65};
export const SHEET_COLS = 3;

const FIG_LEFT: Box = {x: 0.04, y: 0.3, w: 0.4, h: 0.62};
const FIG_RIGHT: Box = {x: 0.56, y: 0.3, w: 0.4, h: 0.62};
const FIG_CENTRE_NARROW: Box = {x: 0.36, y: 0.3, w: 0.28, h: 0.62};

type Line = {text: string; role: TextEvent['lines'][number]['role']};
export type Cell = {
  id: string;
  label: string;
  style: StyleName;
  box: Box;
  words: string[];
  lines: Line[];
  preset: TextEvent['preset'];
  layering: TextEvent['layering'];
  regionHint: TextEvent['regionHint'];
  /** frame offset inside the slot where the still is taken */
  still: number;
};

const PHRASE = ['i', 'feel', 'like', 'giving', 'up'];
const PHRASE_LINES: Line[] = [{text: 'i feel like', role: 'connector'}, {text: 'giving', role: 'hero'}, {text: 'up', role: 'support'}];
const FLANK_WORDS = ['i', 'feel', 'like', 'done', 'now'];
const FLANK_LINES: Line[] = [{text: 'i feel like', role: 'connector'}, {text: 'done', role: 'hero'}, {text: 'now', role: 'support'}];

const STYLES: StyleName[] = ['cinematicClean', 'editorialLuxury', 'retroNeon'];
const COLS: Array<{key: string; label: string; box: Box; words: string[]; lines: Line[]; hint: TextEvent['regionHint']}> = [
  {key: 'beside-right', label: 'figure left, type right', box: FIG_LEFT, words: PHRASE, lines: PHRASE_LINES, hint: 'auto'},
  {key: 'beside-left', label: 'figure right, type left', box: FIG_RIGHT, words: PHRASE, lines: PHRASE_LINES, hint: 'auto'},
  {key: 'flank', label: 'figure centre, type flanks', box: FIG_CENTRE_NARROW, words: FLANK_WORDS, lines: FLANK_LINES, hint: 'auto'},
];

export const STORYBOARD_CELLS: Cell[] = [
  ...STYLES.flatMap(style => COLS.map((c): Cell => ({id: `${style}.${c.key}`, label: `${style} · ${c.label}`, style, box: c.box, words: c.words, lines: c.lines, preset: 'type.words', layering: 'auto', regionHint: c.hint, still: 80}))),
  {id: 'special.running', label: 'running line at the chest', style: 'cinematicClean', box: STORYBOARD_SUBJECT, words: PHRASE, lines: [{text: 'i feel like giving up', role: 'running'}], preset: 'type.words', layering: 'auto', regionHint: 'running', still: 57},
  {id: 'special.behindSignature', label: 'behindSignature (rare)', style: 'cinematicClean', box: STORYBOARD_SUBJECT, words: ['giving', 'up', 'sometimes', 'man'], lines: [{text: 'giving', role: 'hero'}], preset: 'type.words', layering: 'auto', regionHint: 'behindSignature', still: 70},
  {id: 'special.extruded3d', label: 'extruded 3D in the side gutter', style: 'cinematicClean', box: FIG_LEFT, words: ['stand', 'out', 'every', 'day'], lines: [{text: 'OUT', role: 'hero'}], preset: 'hero.extruded3d.rise', layering: 'front', regionHint: 'besideRight', still: 70},
];

export function buildStoryboard(opts: {width?: number; height?: number; fps?: number; seed?: number; brand?: BrandConfig; only?: string[]} = {}): {
  spec: RenderSpec; report: SolveReport; plan: KineticPlan; words: KineticWord[]; shots: KineticShot[]; cells: Array<Cell & {slot: number; stillFrame: number}>;
} {
  const width = opts.width ?? 720, height = opts.height ?? 1280, fps = opts.fps ?? 30;
  const brand = opts.brand ?? brandConfigSchema.parse({});
  const cells = STORYBOARD_CELLS.filter(c => !opts.only || opts.only.includes(c.id));
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
    const ev: TextEvent = {id: cell.id, shotId: shot.id, wordRange: [base, base + cell.words.length - 1], lines: cell.lines.map(l => ({text: l.text, role: l.role})), preset: cell.preset, layering: cell.layering, anchor: 'auto', regionHint: cell.regionHint};
    evByStyle.set(cell.style, [...(evByStyle.get(cell.style) ?? []), ev]);
    return {...cell, slot: start, stillFrame: start + cell.still};
  });
  const merged: RenderSpec[] = [];
  const report: SolveReport = {actions: [], dropped: [], violations: [], anchorDowngrades: []};
  for (const style of STYLES) {
    const events = evByStyle.get(style) ?? [];
    if (events.length === 0) continue;
    const r = solveLayout({plan: {version: '1', style, events}, words, shots, scenes, cameras, depth: new SubjectBandDepth(), brand, width, height, fps, seed: opts.seed ?? 1, planSource: 'storyboard'});
    merged.push(r.spec);
    report.actions.push(...r.report.actions); report.dropped.push(...r.report.dropped); report.violations.push(...r.report.violations); report.anchorDowngrades.push(...r.report.anchorDowngrades);
  }
  const first = merged[0]!;
  const spec: RenderSpec = {...first, captions: [], durationInFrames: Math.max(1, placed.length * STORYBOARD_SLOT_FRAMES), events: merged.flatMap(m => m.events).sort((a, b) => a.inFrame - b.inFrame || a.id.localeCompare(b.id)), shots: first.shots};
  const plan: KineticPlan = {version: '1', style: 'cinematicClean', events: [...evByStyle.values()].flat()};
  return {spec, report, plan, words, shots, cells: placed};
}

/** The props of the KineticStoryboard composition (what storyboard.spec.json holds). */
export function storyboardProps(sb: ReturnType<typeof buildStoryboard> = buildStoryboard()) {
  return {
    spec: sb.spec,
    subjectBox: STORYBOARD_SUBJECT,
    subjectBoxes: sb.cells.map(c => ({startFrame: c.slot, endFrame: c.slot + STORYBOARD_SLOT_FRAMES, box: c.box, label: c.label})),
  };
}

/**
 * 90-frame motion proof (30 fps): "I feel like GIVING up / sometimes man". Roles: i feel like = connector, giving = hero, up = support, sometimes = support, man = connector.
 * TIMINGS ARE FAKE (hand-set speech starts, not a transcript). Block 1 plays E1 / E2 + E4 line stack, then the hold, then X3; block 2 plays E1, the hold and X1 on the cut.
 */
export function buildPhraseA(opts: {width?: number; height?: number} = {}): {spec: RenderSpec; report: SolveReport; words: KineticWord[]; shots: KineticShot[]; frames: {hold: number; slam: number}} {
  const width = opts.width ?? 1080, height = opts.height ?? 1920, fps = 30;
  const timing: Array<[string, number]> = [['i', 6], ['feel', 12], ['like', 18], ['giving', 26], ['up', 34], ['sometimes', 62], ['man', 72]];
  const words: KineticWord[] = timing.map(([text, start], idx) => ({idx, text, startFrame: start, endFrame: start + 10, emphasisScore: 0.8}));
  const shots: KineticShot[] = [{id: 'shot-0', startFrame: 0, endFrame: 90}];
  const scenes = {'shot-0': buildScene({shotId: 'shot-0', subjectBox: FIG_LEFT, luminance: 0.07, width, height})};
  const events: TextEvent[] = [
    {id: 'a', shotId: 'shot-0', wordRange: [0, 4], lines: [{text: 'i feel like', role: 'connector'}, {text: 'giving', role: 'hero'}, {text: 'up', role: 'support'}], preset: 'type.words', layering: 'auto', anchor: 'screen', regionHint: 'auto'},
    {id: 'b', shotId: 'shot-0', wordRange: [5, 6], lines: [{text: 'sometimes', role: 'support'}, {text: 'man', role: 'connector'}], preset: 'type.words', layering: 'auto', anchor: 'screen', regionHint: 'auto', exit: 'X1'},
  ];
  const {spec, report} = solveLayout({plan: {version: '1', style: 'cinematicClean', events}, words, shots, scenes, cameras: {'shot-0': new StaticCamera().track(shots[0]!)}, depth: new SubjectBandDepth(), brand: brandConfigSchema.parse({}), width, height, fps, seed: 1, planSource: 'phrase-a (fake timings)'});
  return {spec, report, words, shots, frames: {hold: 52, slam: 25}};
}
