/**
 * WP3A: offline, read-only rubric scorer (rows 1, 2, 3, 4, 5, 6 and 9 of PHASE36J section 3). Pure: it takes already-parsed JSON and returns a report. It reads nothing from disk,
 * calls no ffprobe/FFmpeg/Chromium and no provider, and its only runtime imports are `lib/renderIntegrity.ts` (row 9's decision, shared with the production render check; that
 * imports only the error taxonomy). Objective checks only: every check is pass / fail / not_checked with the field path and value that decided it. There is no score.
 *
 * "not_checked" means the input needed to decide was not supplied or not recorded. It is never a pass, and a row with a not_checked check says so (`complete: false`).
 */
import {judgeRenderOutput} from '../lib/renderIntegrity.ts';
import type {OutputFacts} from '../pipeline/experimentVerdict.ts';
import {ungroundedWords} from '../stages/broll/groundedText.ts';

export type Status = 'pass' | 'fail' | 'not_checked';
export type Evidence = {path: string; value: unknown};
export type Check = {id: string; status: Status; detail: string; evidence: Evidence[]};
export type RowReport = {row: number; name: string; status: Status; complete: boolean; checks: Check[]};
export type RubricReport = {
  scorer: 'wp3a-offline-rubric';
  version: 1;
  inputs: {blueprint: true; ledger: boolean; inspection: boolean; suppliedIds: boolean; callerMinGapSec: boolean; transcript: boolean};
  rows: RowReport[];
  notScored: number[];
  summary: {pass: number; fail: number; not_checked: number};
};

export type ScoreInput = {
  blueprint: unknown;
  ledger?: unknown;
  /** The JSON `inspectOutput` writes for a finished render (OutputFacts). Never produced here. */
  inspection?: unknown;
  /** Ids of the creator assets given to the edit (`ub_1`, ...). Absent = row 4 is not checked. */
  suppliedIds?: readonly string[];
  /** Optional creator-supplied URLs of those assets; when given, each placed URL must also be one of them. */
  suppliedUrls?: readonly string[];
  /** Used only when the blueprint and ledger record no planner gap. Reported as source "caller". */
  callerMinGapSec?: number;
  /** The spoken transcript (row 6). Absent, or blank: row 6 is not_checked. The blueprint's own `transcript` field is deliberately not used. */
  transcript?: string;
  /** Whether the source video had audio (row 9). Used ONLY when the blueprint carries no `sourceHasAudio` (which wins). Unknown = the audio check is not_checked. */
  expectAudio?: boolean;
};

/** Mirrors SAFE_FRAME in lib/editConflicts.ts (that module imports the logger, so it cannot be imported here; a test compares the two sources). */
export const SAFE_FRAME = {x: 0.03, y: 0.04, w: 0.94, h: 0.93} as const;
export const REQUIRED_WIDTH = 1080;
export const REQUIRED_HEIGHT = 1920;
const EPS = 1e-6;

// ---- small accessors over unknown JSON -------------------------------------------------------------------------------------------------------------------------
type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : []);
const get = (root: unknown, path: string): unknown => path.split('.').reduce<unknown>((node, key) => (isObject(node) ? node[key] : undefined), root);
const short = (value: unknown): unknown => (typeof value === 'string' && value.length > 120 ? `${value.slice(0, 117)}...` : value);
const ev = (path: string, value: unknown): Evidence => ({path, value: short(value)});
const check = (id: string, status: Status, detail: string, evidence: Evidence[] = []): Check => ({id, status, detail, evidence});

function rowOf(row: number, name: string, checks: Check[]): RowReport {
  const failed = checks.some(item => item.status === 'fail');
  const passed = checks.some(item => item.status === 'pass');
  const unchecked = checks.some(item => item.status === 'not_checked');
  return {row, name, status: failed ? 'fail' : passed ? 'pass' : 'not_checked', complete: !unchecked, checks};
}

type Box = {x: number; y: number; w: number; h: number};
const insideFrame = (box: Box, frame: Box = {x: 0, y: 0, w: 1, h: 1}) =>
  box.x >= frame.x - EPS && box.y >= frame.y - EPS && box.x + box.w <= frame.x + frame.w + EPS && box.y + box.h <= frame.y + frame.h + EPS;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;

type HookFit = {sizeFrac: number; widthFrac: number; topFrac: number; heightFrac: number; clearBand?: boolean};
function hookFitOf(blueprint: unknown): HookFit | undefined {
  const raw = get(blueprint, 'legibility.hook');
  if (!isObject(raw)) return undefined;
  const widthFrac = num(raw.widthFrac);
  const topFrac = num(raw.topFrac);
  const heightFrac = num(raw.heightFrac);
  if (widthFrac === undefined || topFrac === undefined || heightFrac === undefined) return undefined;
  return {sizeFrac: num(raw.sizeFrac) ?? 0, widthFrac, topFrac, heightFrac, clearBand: typeof raw.clearBand === 'boolean' ? raw.clearBand : undefined};
}
const hookBox = (fit: HookFit): Box => ({x: (1 - fit.widthFrac) / 2, y: fit.topFrac, w: fit.widthFrac, h: fit.heightFrac});

/** Mirrors `captionBandFor` in remotion/src/generated/placement.ts (the conservative 13%-of-height band); a test compares the two sources. */
export function captionBand(position: unknown, bottomFrac: number): {top: number; bottom: number} {
  const band = 0.13;
  if (position === 'top') return {top: 0.12, bottom: 0.12 + band};
  if (position === 'center') return {top: (1 - band) / 2, bottom: (1 + band) / 2};
  const bottom = 1 - bottomFrac;
  return {top: bottom - band, bottom};
}

// ---- row 1: hook -----------------------------------------------------------------------------------------------------------------------------------------------
// WP3B writes `evidence.hookTitlePolicy` (mvp profile); the other paths are older/alternative spellings and keep legacy blueprints scoring as before.
const HOOK_POLICY_PATHS = ['evidence.hookTitlePolicy', 'hookTitlePolicy', 'hookPolicy', 'stats.hookTitlePolicy'] as const;

function optionalHookPolicy(blueprint: unknown): Evidence | undefined {
  for (const path of HOOK_POLICY_PATHS) {
    if (get(blueprint, path) === 'optional') return ev(path, 'optional');
  }
  const warnings = get(blueprint, 'stats.warnings');
  if (Array.isArray(warnings) && warnings.includes('hook_title_policy:optional')) return ev('stats.warnings', 'hook_title_policy:optional');
  return undefined;
}

/** WP4T: the warning `applyLegibility` records when it clears an ungrounded hook title (WP4R). */
const CLEARED_HOOK_WARNING = 'legibility:ungrounded_hook_cleared';

function scoreHook(input: ScoreInput): RowReport {
  const bp = input.blueprint;
  const checks: Check[] = [];
  const title = get(bp, 'hookTitle');
  const hasTitle = typeof title === 'string' && title.trim().length > 0;
  const policy = optionalHookPolicy(bp);
  const warnings = get(bp, 'stats.warnings');
  const openingRejected = Array.isArray(warnings) ? warnings.filter((item): item is string => typeof item === 'string' && item.startsWith('opening_rejected:')) : [];
  const info = ev('stats.warnings[opening_rejected:*] (info, not scored)', openingRejected.length > 0 ? openingRejected : null);
  if (hasTitle) checks.push(check('hook_title_present', 'pass', 'the blueprint has a non-empty hook title', [ev('hookTitle', title), info]));
  else if (policy) checks.push(check('hook_title_present', 'pass', 'the title is empty and the blueprint records the optional-hook policy', [ev('hookTitle', title ?? null), policy, info]));
  else if (Array.isArray(warnings) && warnings.includes(CLEARED_HOOK_WARNING)) checks.push(check('hook_title_present', 'pass', 'the title is empty because the writer cleared an ungrounded hook (the placeholder or words the speaker did not say); that is intentional', [ev('hookTitle', title ?? null), ev('stats.warnings', CLEARED_HOOK_WARNING), info]));
  else if (isObject(get(bp, 'openingTreatment')) && typeof get(bp, 'openingTreatment.text') === 'string') checks.push(check('hook_title_present', 'pass', 'the title is empty because an art-directed opening treatment replaces the standard hook (the renderer draws the opening, not the title)', [ev('hookTitle', title ?? null), ev('openingTreatment.text', get(bp, 'openingTreatment.text')), info]));
  else checks.push(check('hook_title_present', 'fail', 'the hook title is empty and the blueprint records no optional-hook policy', [ev('hookTitle', title ?? null), ev(HOOK_POLICY_PATHS.join(' | '), null), info]));

  const fit = hookFitOf(bp);
  if (!fit) {
    checks.push(check('hook_box_in_frame', 'not_checked', 'the blueprint carries no legibility.hook (a legacy blueprint): the drawn box is unknown', [ev('legibility.hook', null)]));
    checks.push(check('hook_clear_band', 'not_checked', 'no legibility.hook, so no clear-band verdict exists', [ev('legibility.hook', null)]));
  } else {
    const box = hookBox(fit);
    const inside = insideFrame(box);
    checks.push(check('hook_box_in_frame', inside ? 'pass' : 'fail', inside ? 'the fitted hook box lies inside the frame' : 'the fitted hook box leaves the frame', [ev('legibility.hook.widthFrac', fit.widthFrac), ev('legibility.hook.topFrac', fit.topFrac), ev('legibility.hook.heightFrac', fit.heightFrac)]));
    if (fit.clearBand === undefined) checks.push(check('hook_clear_band', 'not_checked', 'legibility.hook.clearBand is not recorded', [ev('legibility.hook.clearBand', null)]));
    else checks.push(check('hook_clear_band', fit.clearBand === false ? 'fail' : 'pass', fit.clearBand === false ? 'no band above the speaker could hold the hook' : 'the hook sits in a clear band', [ev('legibility.hook.clearBand', fit.clearBand)]));
  }

  const ledgerEdits = list(get(input.ledger, 'edits'));
  if (input.ledger === undefined) checks.push(check('ledger_hook_title_survived', 'not_checked', 'no ledger was supplied'));
  else {
    const entry = ledgerEdits.find(item => item.type === 'hook_title');
    if (!entry) checks.push(check('ledger_hook_title_survived', 'not_checked', 'the ledger has no hook_title entry', [ev('edits[type=hook_title]', null)]));
    else checks.push(check('ledger_hook_title_survived', entry.final === null ? 'fail' : 'pass', entry.final === null ? 'the ledger records the hook title as not surviving' : 'the ledger records a final span for the hook title', [ev('edits[type=hook_title].final', entry.final ?? null)]));
  }
  return rowOf(1, 'hook', checks);
}

// ---- row 2: pacing ---------------------------------------------------------------------------------------------------------------------------------------------
const GAP_KEYS = new Set(['gapSec', 'minGapSec', 'plannerMinGapSec']);

function findGaps(node: unknown, path: string, out: Array<{path: string; value: number}>, depth = 0): void {
  if (depth > 8) return;
  if (Array.isArray(node)) node.forEach((item, index) => findGaps(item, `${path}[${index}]`, out, depth + 1));
  else if (isObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (GAP_KEYS.has(key) && num(value) !== undefined && (value as number) > 0) out.push({path: path ? `${path}.${key}` : key, value: value as number});
      else findGaps(value, path ? `${path}.${key}` : key, out, depth + 1);
    }
  }
}

/** Where the planner's spacing gap is recorded, if anywhere. Takes the smallest recorded value (the least strict reading, so a pass is never too generous about which gap applied). */
export function readPlannerGap(blueprint: unknown, ledger: unknown): {value: number; sources: Evidence[]} | undefined {
  const found: Array<{path: string; value: number}> = [];
  findGaps(get(blueprint, 'stats.editOutcomes'), 'stats.editOutcomes', found);
  findGaps(get(blueprint, 'assembler'), 'assembler', found);
  findGaps(get(blueprint, 'directorReport'), 'directorReport', found);
  const top = num(get(blueprint, 'plannerMinGapSec'));
  if (top !== undefined && top > 0) found.push({path: 'plannerMinGapSec', value: top});
  findGaps(get(ledger, 'stageContext'), 'ledger.stageContext', found);
  findGaps(get(ledger, 'edits'), 'ledger.edits', found);
  if (found.length === 0) return undefined;
  return {value: Math.min(...found.map(item => item.value)), sources: found.slice(0, 5).map(item => ev(item.path, item.value))};
}

type Span = {kind: string; path: string; start: number; end: number};
function mediaPlacements(bp: unknown): Span[] {
  const out: Span[] = [];
  const add = (kind: string, key: string, filter: (item: Json) => boolean = () => true) =>
    list(get(bp, key)).forEach((item, index) => {
      const start = num(item.start);
      const end = num(item.end);
      if (start !== undefined && end !== undefined && filter(item)) out.push({kind, path: `${key}[${index}]`, start, end});
    });
  add('broll_clip', 'brollClips');
  add('overlay_media', 'visualOverlays', item => typeof item.assetUrl === 'string' && item.assetUrl !== '');
  add('depth_overlay', 'depthOverlays');
  add('inset_reveal', 'insetReveals');
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** WP3B: the gap the editorial gate enforced in this run, written by the mvp profile as `evidence.plannerMinGapSec`; it applies to cutaway clips (`brollClips`). */
function readEvidenceGap(blueprint: unknown): {value: number; sources: Evidence[]} | undefined {
  const value = num(get(blueprint, 'evidence.plannerMinGapSec'));
  if (value === undefined || value <= 0) return undefined;
  return {value, sources: [ev('evidence.plannerMinGapSec', value), ev('evidence.plannerMinGapAppliesTo', get(blueprint, 'evidence.plannerMinGapAppliesTo') ?? null)]};
}

function scorePacing(input: ScoreInput): RowReport {
  const fromEvidence = readEvidenceGap(input.blueprint);
  const recorded = fromEvidence ?? readPlannerGap(input.blueprint, input.ledger);
  const caller = num(input.callerMinGapSec);
  const gap = recorded?.value ?? (caller !== undefined && caller > 0 ? caller : undefined);
  if (gap === undefined) {
    return rowOf(2, 'pacing', [check('min_gap_between_media_edits', 'not_checked', 'no planner gap is recorded in the blueprint or ledger and the caller gave none', [ev('stats.editOutcomes | assembler | directorReport | ledger gapSec', null)])]);
  }
  const source = recorded ? recorded.sources : [ev('callerMinGapSec', caller)];
  // The evidence gap is the cutaway rule, so it is applied to cutaway clips only; a gap found elsewhere (older blueprints) or given by the caller keeps the broader media class.
  const spans = fromEvidence ? mediaPlacements(input.blueprint).filter(span => span.kind === 'broll_clip') : mediaPlacements(input.blueprint);
  const violations: Array<{a: string; b: string; gapSec: number}> = [];
  for (let i = 1; i < spans.length; i += 1) {
    const previous = spans[i - 1]!;
    const current = spans[i]!;
    const between = Math.round((current.start - previous.end) * 1000) / 1000;
    if (between < gap - EPS) violations.push({a: previous.path, b: current.path, gapSec: between});
  }
  const stretch = spans.length === 0 ? undefined : Math.max(0, ...spans.slice(1).map((span, index) => span.start - spans[index]!.end));
  return rowOf(2, 'pacing', [
    check(
      'min_gap_between_media_edits',
      violations.length === 0 ? 'pass' : 'fail',
      violations.length === 0 ? `${spans.length} media placements; none closer than ${gap}s` : `${violations.length} pair(s) closer than ${gap}s`,
      [...source, ev('gapSource', fromEvidence ? 'blueprint.evidence' : recorded ? 'blueprint_or_ledger' : 'caller'), ev('editClass', fromEvidence ? 'cutaway_clips' : 'media_placements'), ev('mediaPlacementCount', spans.length), ...(violations.length > 0 ? [ev('violations', violations.slice(0, 10))] : []), ...(stretch !== undefined ? [ev('longestGapBetweenMediaPlacementsSec', Math.round(stretch * 100) / 100)] : [])],
    ),
  ]);
}

// ---- row 3: captions (blueprint only) --------------------------------------------------------------------------------------------------------------------------
/** Mirrors ONE_WORD_CAPTION_TEMPLATES in stages/broll/legibility.ts (that module is not imported here; a test compares the two sources). */
export const ONE_WORD_TEMPLATES: ReadonlySet<string> = new Set(['simple-one-word', 'simple-one-word-theme', 'kinetic-slam']);

function scoreCaptions(input: ScoreInput): RowReport {
  const bp = input.blueprint;
  const legibility = get(bp, 'legibility.captions');
  if (!isObject(legibility)) {
    // A legacy blueprint (no legibility field) is never failed on this row: the launch bar is written for the mvp path, and nothing here says what the legacy renderer draws.
    return rowOf(3, 'captions', [check('caption_legibility_fields', 'not_checked', 'the blueprint carries no legibility.captions (a legacy blueprint): the caption launch checks were not applied', [ev('legibility.captions', null)])]);
  }
  const checks: Check[] = [];
  const template = get(bp, 'captionDirection.template');
  if (typeof template !== 'string' || template === '') {
    checks.push(check('caption_template_not_one_word', 'not_checked', 'the blueprint records no captionDirection.template', [ev('captionDirection.template', template ?? null)]));
  } else {
    const oneWord = ONE_WORD_TEMPLATES.has(template);
    checks.push(check('caption_template_not_one_word', oneWord ? 'fail' : 'pass', oneWord ? `${template} shows one word at a time` : `${template} is not a one-word template`, [ev('captionDirection.template', template)]));
  }
  const scale = get(bp, 'captionDirection.fontScale');
  if (scale === undefined || scale === null) {
    checks.push(check('font_scale_at_least_1', 'pass', 'no fontScale is recorded: the template draws at its own size (a scale of 1)', [ev('captionDirection.fontScale', null)]));
  } else if (num(scale) === undefined) {
    checks.push(check('font_scale_at_least_1', 'not_checked', 'captionDirection.fontScale is not a number', [ev('captionDirection.fontScale', scale)]));
  } else {
    const below = (scale as number) < 1;
    checks.push(check('font_scale_at_least_1', below ? 'fail' : 'pass', below ? `fontScale ${scale} is below 1` : `fontScale ${scale} is not below 1`, [ev('captionDirection.fontScale', scale)]));
  }
  const position = get(bp, 'captionDirection.position');
  if (typeof position !== 'string' || position === '') {
    checks.push(check('position_not_top_or_center', 'not_checked', 'the blueprint records no captionDirection.position', [ev('captionDirection.position', position ?? null)]));
  } else {
    const bad = position === 'top' || position === 'center';
    checks.push(check('position_not_top_or_center', bad ? 'fail' : 'pass', bad ? `captions at ${position} sit over the face` : `captions at ${position}`, [ev('captionDirection.position', position)]));
  }
  const splits = list(get(bp, 'visualOverlays')).map((item, index) => ({item, index})).filter(({item}) => item.layout === 'split');
  if (splits.length === 0) {
    checks.push(check('split_captions_avoid_face', 'pass', 'no B-roll split is present, so there is nothing to keep captions off', [ev('visualOverlays[layout=split]', 0)]));
  } else {
    const ok = legibility.avoidSplitFace === true;
    checks.push(check('split_captions_avoid_face', ok ? 'pass' : 'fail', ok ? `${splits.length} B-roll split(s) present and legibility.captions.avoidSplitFace is true` : `${splits.length} B-roll split(s) present and avoidSplitFace is not true`, [ev('legibility.captions.avoidSplitFace', legibility.avoidSplitFace ?? null), ev('visualOverlays[layout=split]', splits.length)]));
  }
  // Three launch-bar items need pixels or timings the blueprint does not hold. They are reported, never passed.
  checks.push(check('contrast_vs_footage', 'not_checked', 'needs the footage behind the captions; the scorer reads no pixels', [ev('basis', 'blueprint only')]));
  checks.push(check('glyph_height_px', 'not_checked', 'needs the rendered glyph size (template size x scale x canvas); not computed from the blueprint', [ev('basis', 'blueprint only')]));
  checks.push(check('word_timing_error', 'not_checked', 'needs the rendered caption timing against the ASR words; not measured', [ev('basis', 'blueprint only')]));
  return rowOf(3, 'captions', checks);
}

// ---- row 4: B-roll ids and stock -------------------------------------------------------------------------------------------------------------------------------
const STOCK_PROVIDERS = new Set(['pexels', 'pixabay']);
const STOCK_HOST = /(^|\.)(pexels\.com|pixabay\.com|videos\.pexels\.com|images\.pexels\.com|cdn\.pixabay\.com)(\/|$|:)/i;

type Placement = {path: string; provider: unknown; providerId: unknown; userBrollId: unknown; assetUrl: unknown};
function placements(bp: unknown): Placement[] {
  const out: Placement[] = [];
  const take = (key: string) =>
    list(get(bp, key)).forEach((item, index) => {
      out.push({path: `${key}[${index}]`, provider: item.provider, providerId: item.providerId, userBrollId: item.userBrollId, assetUrl: item.assetUrl});
      list(item.slides).forEach((slide, slideIndex) => out.push({path: `${key}[${index}].slides[${slideIndex}]`, provider: slide.provider, providerId: slide.providerId, userBrollId: slide.userBrollId, assetUrl: slide.assetUrl}));
    });
  for (const key of ['brollClips', 'visualOverlays', 'depthOverlays', 'transitions']) take(key);
  return out.filter(item => typeof item.assetUrl === 'string' && item.assetUrl !== '');
}

const idFromProviderId = (providerId: unknown): string | undefined => {
  const n = num(providerId);
  return n === undefined ? undefined : `ub_${n}`;
};

/**
 * The creator asset id of a placement. WP3B blueprints record it (`userBrollId`) and that is used as is. A blueprint that carries `evidence` is a WP3B blueprint: a creator
 * placement without a recorded id is then unverifiable and yields no id (it fails), instead of being reconstructed. Only an older blueprint (no `evidence`) falls back to
 * `ub_<providerId>`, the planner's own mapping.
 */
function placedId(item: Placement, hasEvidence: boolean): {id: string | undefined; source: 'recorded' | 'reconstructed_from_providerId' | 'missing'} {
  if (typeof item.userBrollId === 'string' && item.userBrollId !== '') return {id: item.userBrollId, source: 'recorded'};
  if (hasEvidence) return {id: undefined, source: 'missing'};
  const id = idFromProviderId(item.providerId);
  return {id, source: id === undefined ? 'missing' : 'reconstructed_from_providerId'};
}

function scoreBroll(input: ScoreInput): RowReport {
  const placed = placements(input.blueprint);
  const stock = placed.filter(item => (typeof item.provider === 'string' && STOCK_PROVIDERS.has(item.provider)) || STOCK_HOST.test(String(item.assetUrl)));
  if (!input.suppliedIds) {
    return rowOf(4, 'b-roll', [
      check('supplied_id_list', 'not_checked', 'no supplied-id list was passed, so placed assets cannot be checked against it', [ev('suppliedIds', null), ev('placedAssetCount', placed.length), ev('observedStockPlacements(info)', stock.length)]),
    ]);
  }
  const supplied = new Set(input.suppliedIds);
  const suppliedUrls = input.suppliedUrls ? new Set(input.suppliedUrls) : undefined;
  const userPlaced = placed.filter(item => item.provider === 'user');
  const unknownProvider = placed.filter(item => item.provider !== 'user' && !(typeof item.provider === 'string' && STOCK_PROVIDERS.has(item.provider)) && item.provider !== 'generated');
  const hasEvidence = isObject(get(input.blueprint, 'evidence'));
  const resolved = userPlaced.map(item => ({item, ...placedId(item, hasEvidence)}));
  const outside = resolved.filter(entry => entry.id === undefined || !supplied.has(entry.id));
  const urlOutside = suppliedUrls ? userPlaced.filter(item => !suppliedUrls.has(String(item.assetUrl))) : [];
  const checks: Check[] = [
    check('no_stock_url', stock.length === 0 ? 'pass' : 'fail', stock.length === 0 ? 'no stock provider or stock host among the placed assets' : `${stock.length} stock placement(s)`, stock.length === 0 ? [ev('placedAssetCount', placed.length)] : stock.slice(0, 10).flatMap(item => [ev(`${item.path}.provider`, item.provider), ev(`${item.path}.assetUrl`, item.assetUrl)])),
    check('placed_ids_in_supplied', outside.length === 0 ? 'pass' : 'fail', outside.length === 0 ? `${userPlaced.length} creator placement(s), every id in the supplied list` : `${outside.length} placement(s) whose id is not in the supplied list`, outside.length === 0 ? [ev('suppliedIds', [...supplied]), ev('idSource', [...new Set(resolved.map(entry => entry.source))])] : outside.slice(0, 10).flatMap(entry => [ev(`${entry.item.path}.userBrollId`, entry.item.userBrollId ?? null), ev(`${entry.item.path}.providerId`, entry.item.providerId ?? null), ev('idSource', entry.source), ev('resolvedId', entry.id ?? null)])),
    check('no_unrecognised_provider', unknownProvider.length === 0 ? 'pass' : 'fail', unknownProvider.length === 0 ? 'every placed asset is a creator asset' : `${unknownProvider.length} placement(s) with an unrecognised provider`, unknownProvider.slice(0, 10).map(item => ev(`${item.path}.provider`, item.provider ?? null))),
  ];
  if (suppliedUrls) checks.push(check('placed_urls_in_supplied', urlOutside.length === 0 ? 'pass' : 'fail', urlOutside.length === 0 ? 'every creator placement URL is a supplied URL' : `${urlOutside.length} placement URL(s) not supplied`, urlOutside.slice(0, 10).map(item => ev(`${item.path}.assetUrl`, item.assetUrl))));
  else checks.push(check('placed_urls_in_supplied', 'not_checked', 'no supplied-URL list was passed; ids were checked through providerId (ub_<providerId>)'));
  return rowOf(4, 'b-roll', checks);
}

// ---- row 5: composition and safe area --------------------------------------------------------------------------------------------------------------------------
function scoreComposition(input: ScoreInput): RowReport {
  const bp = input.blueprint;
  const checks: Check[] = [];
  const width = num(get(bp, 'width'));
  const height = num(get(bp, 'height'));
  checks.push(check('canvas_1080x1920', width === REQUIRED_WIDTH && height === REQUIRED_HEIGHT ? 'pass' : width === undefined || height === undefined ? 'not_checked' : 'fail', `blueprint canvas is ${width ?? '?'}x${height ?? '?'}`, [ev('width', width ?? null), ev('height', height ?? null)]));

  const direction = get(bp, 'captionDirection');
  const bottomFrac = num(get(direction, 'bottomFrac'));
  if (!isObject(direction) || bottomFrac === undefined) checks.push(check('caption_band_in_safe_area', 'not_checked', 'the blueprint has no captionDirection.bottomFrac', [ev('captionDirection', null)]));
  else {
    const band = captionBand(direction.position, bottomFrac);
    const ok = band.top >= SAFE_FRAME.y - EPS && band.bottom <= SAFE_FRAME.y + SAFE_FRAME.h + EPS;
    checks.push(check('caption_band_in_safe_area', ok ? 'pass' : 'fail', `conservative caption band ${band.top.toFixed(3)}..${band.bottom.toFixed(3)} against safe ${SAFE_FRAME.y}..${(SAFE_FRAME.y + SAFE_FRAME.h).toFixed(2)}`, [ev('captionDirection.position', direction.position), ev('captionDirection.bottomFrac', bottomFrac)]));
  }

  const fit = hookFitOf(bp);
  if (!fit) {
    checks.push(check('hook_box_in_safe_area', 'not_checked', 'no legibility.hook on this blueprint', [ev('legibility.hook', null)]));
    checks.push(check('hook_clear_of_caption_band', 'not_checked', 'no legibility.hook on this blueprint', [ev('legibility.hook', null)]));
  } else {
    const box = hookBox(fit);
    const safe = insideFrame(box, SAFE_FRAME);
    checks.push(check('hook_box_in_safe_area', safe ? 'pass' : 'fail', safe ? 'the fitted hook box is inside the safe frame' : 'the fitted hook box leaves the safe frame', [ev('legibility.hook.topFrac', fit.topFrac), ev('legibility.hook.heightFrac', fit.heightFrac), ev('legibility.hook.widthFrac', fit.widthFrac)]));
    if (bottomFrac === undefined || !isObject(direction)) checks.push(check('hook_clear_of_caption_band', 'not_checked', 'no captionDirection to place the caption band'));
    else {
      const band = captionBand(direction.position, bottomFrac);
      const clear = !overlaps(box, {x: 0, y: band.top, w: 1, h: band.bottom - band.top});
      checks.push(check('hook_clear_of_caption_band', clear ? 'pass' : 'fail', clear ? 'the hook box and the caption band do not overlap' : 'the hook box overlaps the caption band', [ev('legibility.hook.topFrac', fit.topFrac), ev('captionDirection.position', direction.position), ev('captionDirection.bottomFrac', bottomFrac)]));
    }
  }

  const splits = list(get(bp, 'visualOverlays')).map((item, index) => ({item, index})).filter(({item}) => item.layout === 'split');
  const badSide = splits.filter(({item}) => item.speakerSide !== undefined && item.speakerSide !== 'top' && item.speakerSide !== 'bottom');
  if (splits.length === 0) checks.push(check('split_is_top_bottom', 'not_checked', 'the blueprint has no split overlay', [ev('visualOverlays[layout=split]', 0)]));
  else checks.push(check('split_is_top_bottom', badSide.length === 0 ? 'pass' : 'fail', badSide.length === 0 ? `${splits.length} split overlay(s); speakerSide is top, bottom or absent (the renderer then uses bottom)` : `${badSide.length} split(s) with an invalid speakerSide`, badSide.length === 0 ? splits.slice(0, 5).map(({item, index}) => ev(`visualOverlays[${index}].speakerSide`, item.speakerSide ?? null)) : badSide.slice(0, 5).map(({item, index}) => ev(`visualOverlays[${index}].speakerSide`, item.speakerSide))));

  checks.push(check('face_inside_speaker_half_and_no_cropping', 'not_checked', 'needs rendered pixels or a measured face box; this scorer reads no media'));
  return rowOf(5, 'composition_safe_area', checks);
}

// ---- row 6: on-screen words (the false-claim check) --------------------------------------------------------------------------------------------------------------
type VisibleText = {path: string; text: string; /** Where the missing words are reported; defaults to `<path>.wordsNotInTranscript`. */ wordsPath?: string};

/** Strings that are addresses or colours, not words a viewer reads. */
const NOT_WORDS = /^(?:https?:|data:|blob:|file:|staticFile:|\/\/)|^#[0-9a-f]{3,8}$/i;

/** Every string leaf of a graphic's `props.content` (the designer's "ONLY copy the designer may show"). Numbers are not words and are not collected. */
function contentStrings(node: unknown, path: string, out: VisibleText[], depth = 0): void {
  if (depth > 8) return;
  if (typeof node === 'string') {
    if (node.trim() !== '' && !NOT_WORDS.test(node.trim())) out.push({path, text: node});
  } else if (Array.isArray(node)) {
    node.forEach((item, index) => contentStrings(item, `${path}[${index}]`, out, depth + 1));
  } else if (isObject(node)) {
    for (const [key, value] of Object.entries(node)) if (key !== 'icon' && key !== 'icons' && key !== 'recipeId') contentStrings(value, `${path}.${key}`, out, depth + 1); // WP11A: icon names are symbols, not words
  }
}

/** The overlay layouts that draw words (VisualOverlayTrack: PhraseStack for lockup and stat, the banner, the bubble and the chip). The others draw media only. */
const TEXT_OVERLAY_LAYOUTS: ReadonlySet<string> = new Set(['lockup', 'stat', 'banner', 'bubble', 'chip']);

function scoreGraphics(input: ScoreInput): RowReport {
  const transcript = input.transcript;
  if (typeof transcript !== 'string' || transcript.trim() === '') {
    return rowOf(6, 'on_screen_text', [check('graphic_text_in_transcript', 'not_checked', 'no transcript was passed in (a blank one counts as none); the scorer does not use the blueprint\'s own transcript or any model', [ev('transcript', null)])]);
  }
  const bp = input.blueprint;
  const checks: Check[] = [];
  const grounding = (id: string, label: string, scope: string, entries: VisibleText[]) => {
    if (entries.length === 0) {
      checks.push(check(id, 'pass', `no ${label} text is present: nothing is claimed`, [ev(scope, 0)]));
      return;
    }
    const bad: Evidence[] = [];
    let failed = 0;
    for (const entry of entries) {
      const missing = ungroundedWords(entry.text, transcript);
      if (missing.length > 0) {
        failed += 1;
        bad.push(ev(entry.path, entry.text), ev(entry.wordsPath ?? `${entry.path}.wordsNotInTranscript`, missing));
      }
    }
    checks.push(check(id, failed === 0 ? 'pass' : 'fail', failed === 0 ? `${entries.length} ${label} text(s), every word is in the transcript` : `${failed} of ${entries.length} ${label} text(s) state words the transcript does not contain`, failed === 0 ? [ev(scope, entries.length)] : bad.slice(0, 20)));
  };
  const plain = (key: 'motionGraphics' | 'semanticEmphasis'): VisibleText[] =>
    list(get(bp, key)).flatMap((item, index) => (typeof item.text === 'string' && item.text.trim() !== '' ? [{path: `${key}[${index}].text`, text: item.text, wordsPath: `${key}[${index}].wordsNotInTranscript`}] : []));

  grounding('motion_graphic_text_in_transcript', 'motion graphic', 'motionGraphics', plain('motionGraphics'));
  grounding('emphasis_text_in_transcript', 'emphasis', 'semanticEmphasis', plain('semanticEmphasis'));

  const generated: VisibleText[] = [];
  list(get(bp, 'generatedGraphics')).forEach((graphic, index) => contentStrings(get(graphic, 'props.content'), `generatedGraphics[${index}].props.content`, generated));
  grounding('generated_graphic_text_in_transcript', 'generated graphic', 'generatedGraphics', generated);

  const overlays: VisibleText[] = [];
  list(get(bp, 'visualOverlays')).forEach((overlay, index) => {
    if (!TEXT_OVERLAY_LAYOUTS.has(String(overlay.layout))) return;
    // The renderer shows `overlayText || keyword`: a text layout with no overlayText draws its search keyword.
    const field = typeof overlay.overlayText === 'string' && overlay.overlayText ? 'overlayText' : 'keyword';
    const text = overlay[field];
    if (typeof text === 'string' && text.trim() !== '') overlays.push({path: `visualOverlays[${index}].${field}`, text, wordsPath: `visualOverlays[${index}].wordsNotInTranscript`});
  });
  grounding('overlay_text_in_transcript', 'overlay', 'visualOverlays[text layouts]', overlays);

  const behind: VisibleText[] = list(get(bp, 'behindSubjectTexts')).flatMap((entry, index) => (typeof entry.text === 'string' && entry.text.trim() !== '' ? [{path: `behindSubjectTexts[${index}].text`, text: entry.text, wordsPath: `behindSubjectTexts[${index}].wordsNotInTranscript`}] : []));
  grounding('behind_subject_text_in_transcript', 'behind-subject', 'behindSubjectTexts', behind);

  // WP4P: a media container draws its canvasTitle as written; an inset reveal of the motion_graphic variant draws its graphic text and (stat callout) data.label. Another variant draws no graphic.
  const canvas: VisibleText[] = list(get(bp, 'mediaContainers')).flatMap((container, index) =>
    typeof container.canvasTitle === 'string' && container.canvasTitle.trim() !== '' ? [{path: `mediaContainers[${index}].canvasTitle`, text: container.canvasTitle, wordsPath: `mediaContainers[${index}].wordsNotInTranscript`}] : []);
  grounding('canvas_title_in_transcript', 'canvas title', 'mediaContainers', canvas);

  const inset: VisibleText[] = [];
  list(get(bp, 'insetReveals')).forEach((reveal, index) => {
    if (get(reveal, 'params.variant') !== 'motion_graphic') return;
    const text = get(reveal, 'params.graphic.text');
    if (typeof text === 'string' && text.trim() !== '') inset.push({path: `insetReveals[${index}].params.graphic.text`, text, wordsPath: `insetReveals[${index}].params.graphic.textWordsNotInTranscript`});
    const label = get(reveal, 'params.graphic.data.label');
    if ((typeof label === 'string' || typeof label === 'number') && String(label).trim() !== '') inset.push({path: `insetReveals[${index}].params.graphic.data.label`, text: String(label), wordsPath: `insetReveals[${index}].params.graphic.labelWordsNotInTranscript`});
  });
  grounding('inset_text_in_transcript', 'inset graphic', 'insetReveals[motion_graphic]', inset);

  // Not decidable from text: reported, never passed.
  checks.push(check('pixel_quality', 'not_checked', 'needs rendered frames; the scorer reads no pixels', [ev('basis', 'blueprint and transcript only')]));
  checks.push(check('layout_repetition', 'not_checked', 'whether adjacent graphics repeat a layout is not judged here', [ev('basis', 'blueprint and transcript only')]));
  checks.push(check('paraphrase_fairness', 'not_checked', 'a phrase with a word the speaker did not say fails above; whether such a phrase would be a fair paraphrase is a human judgement and is not scored', [ev('basis', 'blueprint and transcript only')]));
  return rowOf(6, 'on_screen_text', checks);
}

// ---- row 9: render integrity (only with an inspection file) ----------------------------------------------------------------------------------------------------
function scoreIntegrity(input: ScoreInput): RowReport {
  if (input.inspection === undefined) return rowOf(9, 'render_integrity', [check('output_inspection', 'not_checked', 'no output-inspection JSON was passed in; nothing about the rendered file was checked')]);
  const raw = input.inspection;
  if (!isObject(raw) || typeof raw.exists !== 'boolean' || num(raw.bytes) === undefined) {
    return rowOf(9, 'render_integrity', [check('output_inspection', 'not_checked', 'the inspection JSON is not an OutputFacts object (needs boolean exists and numeric bytes); it was not used', [ev('inspection.exists', isObject(raw) ? raw.exists ?? null : null), ev('inspection.bytes', isObject(raw) ? raw.bytes ?? null : null)])]);
  }
  const width = num(get(input.blueprint, 'width'));
  const height = num(get(input.blueprint, 'height'));
  const duration = num(get(input.blueprint, 'outputDurationSec'));
  if (width === undefined || height === undefined || duration === undefined) {
    return rowOf(9, 'render_integrity', [check('output_inspection', 'not_checked', 'the blueprint lacks width, height or outputDurationSec to compare the inspection against', [ev('width', width ?? null), ev('height', height ?? null), ev('outputDurationSec', duration ?? null)])]);
  }
  // WP3G: the audio expectation is the fact the Lambda check uses, the ingest probe saved on the blueprint (`sourceHasAudio`, written by the mvp profile). It wins over the caller's flag,
  // which is only used when the blueprint has none. A missing field is never a failure: the audio check is then not_checked.
  const saved = get(input.blueprint, 'sourceHasAudio');
  const fromBlueprint = typeof saved === 'boolean' ? saved : undefined;
  const expectAudio = fromBlueprint ?? input.expectAudio;
  const audioSource = fromBlueprint !== undefined ? 'sourceHasAudio' : input.expectAudio !== undefined ? 'callerExpectAudio' : null;
  const failures = judgeRenderOutput(raw as unknown as OutputFacts, {width, height, durationSec: duration, ...(expectAudio !== undefined ? {expectAudio} : {})});
  const audioFailure = failures.find(item => item.check === 'audio_missing');
  const others = failures.filter(item => item.check !== 'audio_missing');
  const checks: Check[] =
    others.length === 0
      ? [check('output_valid', 'pass', 'exists, size, dimensions, duration and decode all hold', [ev('inspection.bytes', raw.bytes), ev('inspection.probe', raw.probe ?? null), ev('inspection.decode.ok', get(raw, 'decode.ok') ?? null)])]
      : others.map(item => check(item.check, 'fail', item.detail, [ev('inspection', item.check)]));
  const hasProbe = isObject(raw.probe);
  const outputHasAudio = get(raw, 'probe.hasAudio');
  if (expectAudio === undefined) {
    checks.push(check('audio_present', 'not_checked', 'neither the blueprint (sourceHasAudio) nor the caller says whether the source had audio', [ev('sourceHasAudio', saved ?? null)]));
  } else if (!hasProbe) {
    checks.push(check('audio_present', 'not_checked', 'the output could not be probed, so its audio streams are unknown', [ev('inspection.probe', null), ev(audioSource ?? 'sourceHasAudio', expectAudio)]));
  } else if (audioFailure) {
    checks.push(check('audio_missing', 'fail', audioFailure.detail, [ev('inspection', 'audio_missing'), ev(audioSource ?? 'sourceHasAudio', expectAudio), ev('inspection.probe.hasAudio', outputHasAudio ?? null)]));
  } else {
    checks.push(check('audio_present', 'pass', expectAudio ? 'the source had audio and the output has an audio stream' : 'the source had no audio, so the output is not required to have any', [ev(audioSource ?? 'sourceHasAudio', expectAudio), ev('inspection.probe.hasAudio', outputHasAudio ?? null)]));
  }
  return rowOf(9, 'render_integrity', checks);
}

// ---- entry point -----------------------------------------------------------------------------------------------------------------------------------------------
export function scoreRubric(input: ScoreInput): RubricReport {
  const rows = [scoreHook(input), scorePacing(input), scoreCaptions(input), scoreBroll(input), scoreComposition(input), scoreGraphics(input), scoreIntegrity(input)];
  const summary = {pass: 0, fail: 0, not_checked: 0};
  for (const row of rows) summary[row.status] += 1;
  return {
    scorer: 'wp3a-offline-rubric',
    version: 1,
    inputs: {blueprint: true, ledger: input.ledger !== undefined, inspection: input.inspection !== undefined, suppliedIds: input.suppliedIds !== undefined, callerMinGapSec: input.callerMinGapSec !== undefined, transcript: typeof input.transcript === 'string' && input.transcript.trim() !== ''},
    rows,
    notScored: [7, 8, 10],
    summary,
  };
}
