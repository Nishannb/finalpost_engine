/**
 * Director OUTPUT v2: the creative layer (design + contract + validation; the compile step to `KineticPlan` is Phase 4).
 *
 * Today the Director returns `KineticPlan` events: roles and preset names. That says WHAT to draw, never WHY, so nothing can be reasoned about across events (a hook is not a payoff;
 * a calm line and an explosive line look alike). `KineticDirection` is what a motion designer writes BEFORE drawing: the passage's intent, the beats and what each is for, how hard it
 * should land, which word carries it, which visual ideas recur, and how each beat relates to the one before it. Every field has a defined consumer (table below); nothing is decoration.
 *
 * Words are referenced by INDEX, never by text, so the Director cannot invent or alter transcript words (fidelity by construction; the plan layer keeps its own text check).
 * Treatment values are the solver's EXISTING vocabulary (pose names, IN-* / OUT-* tags, accent names, style names, region hints): nothing here asks the solver for a capability it does not have.
 *
 * FIELD -> CONSUMER (compile step, Phase 4)
 *   passage.tone            -> plan style + font pair (bold / urgent -> retroNeon+street, reflective -> editorialLuxury+editorial, calm -> cinematicClean ...), plan accent
 *   beat.kind               -> density (hook / payoff / cta earn heroes; setup / aside stay light), match-cut eligibility (hook, reveal), exit choice (a payoff holds; a setup passes)
 *   beat.intent             -> entry family (assert: slam / z-push, ask: focus-pull, confess: slow fade, warn: glitch, enumerate: cascade, contrast: whip)
 *   beat.energy 0..4        -> motion amplitude: IN-1 / IN-3 for 0-1, IN-4 / IN-5 for 2, IN-2 / IN-7 for 3, IN-6 / IN-9 for 4; hero size step; hold length
 *   beat.restraint          -> no hero, small support, no pose: a deliberate quiet moment (never auto-filled by the fallback)
 *   beat.emphasis           -> the hero word (primary) and support words; the reason is kept for the benchmark and the report
 *   beat.lines              -> the on-screen line grouping (one reading block)
 *   beat.treatment          -> composition -> region hint / preset; pose, enter, exit, accent pass straight through (the solver may still refuse: diagnostics.ts says why)
 *   beat.motif + motifs[]   -> the same look / pose / composition reused on purpose (a signature for the "confession" beats), contrast beats get the opposite
 *   beat.relation           -> continuity: continues = same family and side; contrasts = a different composition and motion; answers = mirrors the question's composition; escalates = one energy step up;
 *                              resolves = the quietest treatment of the arc; resets = breathing room, nothing carried over
 *
 * Pure. No I/O, no model.
 */
import {z} from 'zod';

import {ACCENT_NAMES, ANIM_NAMES, EXIT_NAMES, POSE_NAMES, STYLE_NAMES, type KineticWord} from './schema.ts';

export const TONES = ['bold', 'urgent', 'playful', 'authoritative', 'reflective', 'calm'] as const;
export const BEAT_KINDS = ['hook', 'setup', 'claim', 'question', 'contrast', 'reveal', 'list', 'explain', 'warn', 'emotion', 'payoff', 'cta'] as const;
export const INTENTS = ['assert', 'ask', 'confess', 'warn', 'invite', 'resolve', 'enumerate', 'contrast'] as const;
/** the solver's existing region / layer vocabulary, named for what the viewer sees */
export const COMPOSITIONS = ['headline', 'stack', 'beside', 'above', 'chest_run', 'behind_head', 'stack_over_cutout', 'match_cut'] as const;
export const RELATIONS = ['continues', 'contrasts', 'answers', 'escalates', 'resolves', 'resets'] as const;
export type BeatKind = (typeof BEAT_KINDS)[number];
export type Composition = (typeof COMPOSITIONS)[number];

const idx = z.number().int().nonnegative();
const accent = z.union([z.enum(ACCENT_NAMES), z.string().regex(/^#[0-9a-fA-F]{6}$/)]);
const entry = z.enum(ANIM_NAMES.filter(a => /^IN-(?:[1-9]|10)$/.test(a)) as [string, ...string[]]);
const exit = z.enum(EXIT_NAMES.filter(a => /^OUT-/.test(a)) as [string, ...string[]]);

export const motifSchema = z.strictObject({
  id: z.string().regex(/^m\d{1,2}$/),
  /** what the recurring idea IS, in the Director's words (<= 40 chars): shown in the report, not rendered */
  name: z.string().min(1).max(40),
  look: z.enum(STYLE_NAMES).optional(),
  pose: z.enum(POSE_NAMES).optional(),
  composition: z.enum(COMPOSITIONS).optional(),
  accent: accent.optional(),
});

export const beatSchema = z.strictObject({
  id: z.string().regex(/^b\d{1,2}$/),
  wordRange: z.tuple([idx, idx]),
  kind: z.enum(BEAT_KINDS),
  intent: z.enum(INTENTS),
  /** 0 restrained .. 4 explosive */
  energy: z.number().int().min(0).max(4),
  /** a deliberate quiet beat: no hero, small support. Needs no `emphasis.primary`. */
  restraint: z.boolean().optional(),
  emphasis: z.strictObject({
    primary: idx.optional(),
    supporting: z.array(idx).max(4).default([]),
    /** why this word carries the beat (<= 100 chars) */
    reason: z.string().min(1).max(100),
  }),
  /** on-screen lines as word indices, in spoken order; words left out are shown by the gap-caption track */
  lines: z.array(z.array(idx).min(1).max(6)).min(1).max(4),
  treatment: z.strictObject({
    composition: z.enum(COMPOSITIONS),
    pose: z.enum(POSE_NAMES).optional(),
    enter: entry.optional(),
    exit: exit.optional(),
    accent: accent.optional(),
    look: z.enum(STYLE_NAMES).optional(),
  }),
  motif: z.string().regex(/^m\d{1,2}$/).optional(),
  /** how this beat relates to an EARLIER beat (omit on the first beat, or when it stands alone) */
  relation: z.strictObject({to: z.string().regex(/^b\d{1,2}$/), kind: z.enum(RELATIONS)}).optional(),
});

export const kineticDirectionSchema = z.strictObject({
  version: z.literal('2'),
  passage: z.strictObject({
    /** one sentence: what the speaker is doing across the whole passage (<= 160 chars) */
    intent: z.string().min(1).max(160),
    tone: z.enum(TONES),
  }),
  motifs: z.array(motifSchema).max(4).default([]),
  beats: z.array(beatSchema).max(40),
});
export type KineticDirection = z.infer<typeof kineticDirectionSchema>;
export type Beat = z.infer<typeof beatSchema>;

export type BeatRejection = {beatId: string; code: string; reason: string};
export type DirectionValidation = {
  /** false only when nothing usable is left (bad envelope, or every beat rejected from a non-empty list) */
  ok: boolean;
  direction: KineticDirection | null;
  rejected: BeatRejection[];
  /** soft findings that did not reject anything (e.g. a motif defined but never used) */
  warnings: string[];
};

/**
 * Event-level validation, same philosophy as plan recovery (G5): a bad beat is dropped with a reason, the other beats survive. Rules per beat:
 *   range inside the transcript; beats ordered and non-overlapping; primary and supporting inside the beat's range, supporting does not repeat the primary;
 *   `lines` indices inside the range, strictly ascending across lines, no repeats; a non-restrained beat needs a primary; a restrained beat must not carry energy above 1;
 *   `motif` must be defined; `relation.to` must be an EARLIER kept beat. A reference to a motif / beat that was rejected clears the reference (recorded as a warning), not the beat.
 */
export function validateDirection(raw: unknown, words: readonly KineticWord[]): DirectionValidation {
  const envelope = kineticDirectionSchema.safeParse(typeof raw === 'object' && raw !== null && Array.isArray((raw as {beats?: unknown}).beats) ? {...(raw as object), beats: []} : raw);
  if (!envelope.success) return {ok: false, direction: null, rejected: [], warnings: [`envelope: ${envelope.error.issues.slice(0, 3).map(i => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`).join('; ')}`]};
  const rawBeats = (raw as {beats: unknown[]}).beats;
  const motifIds = new Set(envelope.data.motifs.map(m => m.id));
  const kept: Beat[] = [];
  const rejected: BeatRejection[] = [];
  const warnings: string[] = [];
  const reject = (beatId: string, code: string, reason: string) => { rejected.push({beatId, code, reason}); };
  let lastEnd = -1;
  rawBeats.forEach((rawBeat, i) => {
    const guess = typeof (rawBeat as {id?: unknown} | null)?.id === 'string' ? (rawBeat as {id: string}).id : `beats.${i}`;
    const parsed = beatSchema.safeParse(rawBeat);
    if (!parsed.success) return reject(guess, 'schema', parsed.error.issues.slice(0, 3).map(is => `${is.path.map(String).join('.') || '(root)'}: ${is.message}`).join('; '));
    let beat = parsed.data;
    const [a, b] = beat.wordRange;
    if (a > b || b >= words.length) return reject(beat.id, 'range', `wordRange [${a},${b}] is outside the transcript (${words.length} words)`);
    if (kept.some(k => k.id === beat.id)) return reject(beat.id, 'duplicate_id', 'beat id used twice');
    if (a <= lastEnd) return reject(beat.id, 'order', `starts at word ${a}, before the previous beat ends (${lastEnd}): beats must be ordered and must not overlap`);
    const inRange = (n: number) => n >= a && n <= b;
    const e = beat.emphasis;
    if (!beat.restraint && e.primary === undefined) return reject(beat.id, 'no_primary', 'a beat that is not restrained needs emphasis.primary (the word that carries it)');
    if (beat.restraint && beat.energy > 1) return reject(beat.id, 'restraint_energy', `a restrained beat cannot have energy ${beat.energy} (max 1)`);
    if (e.primary !== undefined && !inRange(e.primary)) return reject(beat.id, 'primary_range', `emphasis.primary ${e.primary} is outside the beat [${a},${b}]`);
    if (e.supporting.some(n => !inRange(n) || n === e.primary)) return reject(beat.id, 'supporting', 'emphasis.supporting must be inside the beat and different from the primary');
    const flat = beat.lines.flat();
    if (flat.some(n => !inRange(n))) return reject(beat.id, 'lines_range', `lines reference words outside the beat [${a},${b}]`);
    if (flat.some((n, k) => k > 0 && n <= flat[k - 1]!)) return reject(beat.id, 'lines_order', 'lines must list word indices in strictly ascending spoken order, without repeats');
    if (e.primary !== undefined && !flat.includes(e.primary)) return reject(beat.id, 'primary_not_shown', 'the primary word must appear in lines');
    if (beat.motif && !motifIds.has(beat.motif)) { warnings.push(`${beat.id}: motif ${beat.motif} is not defined: reference cleared`); const {motif: _motif, ...rest} = beat; beat = rest as Beat; }
    if (beat.relation) {
      const target = kept.find(k => k.id === beat.relation!.to);
      if (!target) { warnings.push(`${beat.id}: relation target ${beat.relation.to} is not an earlier kept beat: reference cleared`); const {relation: _r, ...rest} = beat; beat = rest as Beat; }
    }
    kept.push(beat);
    lastEnd = b;
  });
  if (rawBeats.length > 0 && kept.length === 0) return {ok: false, direction: null, rejected, warnings};
  for (const m of motifIds) if (!kept.some(k => k.motif === m)) warnings.push(`motif ${m} is defined but no beat uses it`);
  return {ok: true, direction: {...envelope.data, beats: kept}, rejected, warnings};
}

export type DirectionStats = {
  beats: number;
  /** words covered by a beat / all words */
  coverage: number;
  kinds: Record<string, number>;
  energies: Record<string, number>;
  /** standard deviation of energy: a flat 2-2-2-2 edit scores ~0 */
  energySpread: number;
  restrainedBeats: number;
  motifsUsed: number;
  /** beats that reuse a motif already used earlier = intentional repetition */
  motifReuses: number;
  relations: Record<string, number>;
  /** longest run of consecutive beats with the same composition: low is varied */
  longestCompositionRun: number;
  distinctCompositions: number;
};

/** What the benchmark reads from a direction (beats are the unit; this never touches a render). */
export function directionStats(d: KineticDirection, wordCount: number): DirectionStats {
  const count = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => { m[x] = (m[x] ?? 0) + 1; return m; }, {});
  const en = d.beats.map(b => b.energy);
  const mean = en.length ? en.reduce((a, b) => a + b, 0) / en.length : 0;
  const spread = en.length ? Math.sqrt(en.reduce((a, b) => a + (b - mean) ** 2, 0) / en.length) : 0;
  let run = 0, longest = 0, prev = '';
  for (const b of d.beats) { run = b.treatment.composition === prev ? run + 1 : 1; prev = b.treatment.composition; longest = Math.max(longest, run); }
  const seen = new Set<string>();
  let reuses = 0;
  for (const b of d.beats) if (b.motif) { if (seen.has(b.motif)) reuses += 1; seen.add(b.motif); }
  const covered = d.beats.reduce((n, b) => n + (b.wordRange[1] - b.wordRange[0] + 1), 0);
  return {
    beats: d.beats.length,
    coverage: wordCount ? Math.round((covered / wordCount) * 1000) / 1000 : 0,
    kinds: count(d.beats.map(b => b.kind)),
    energies: count(d.beats.map(b => String(b.energy))),
    energySpread: Math.round(spread * 100) / 100,
    restrainedBeats: d.beats.filter(b => b.restraint).length,
    motifsUsed: seen.size,
    motifReuses: reuses,
    relations: count(d.beats.flatMap(b => (b.relation ? [b.relation.kind] : []))),
    longestCompositionRun: longest,
    distinctCompositions: new Set(d.beats.map(b => b.treatment.composition)).size,
  };
}
