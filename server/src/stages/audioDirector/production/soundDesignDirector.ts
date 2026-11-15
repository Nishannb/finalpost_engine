/**
 * Sound Design Director (Visual Event Sound Design sprint). Pure and deterministic.
 *
 * Input: an Event Sheet built with {kineticLines: true} (word-level Kinetic events with measured motion) plus every other drawn visual event.
 * Output: one designed sound per selected visual MOMENT (family, character description, duration, envelope, timing, mix treatment) and a logged
 * decision for EVERY event, including the deliberate silences (ordinary captions, fades, running words).
 *
 * The design reads the event's real attributes (type, Kinetic entry animation and role, measured direction / intensity / arrival, transition style,
 * layout, stage enter) - it never gives every event the same whoosh. Then it balances the edit:
 *   - duplicate suppression: one sound per Kinetic cascade word (not per character), per stage span, per identical event;
 *   - coordination: events whose anchors fall within COORDINATION_SEC are one moment; the most important event leads and the others are folded
 *     into a layered description ("... layered with a soft pop") instead of stacking sounds;
 *   - per-family cooldowns, the existing voice-first spacing (0.8 s) and budget (8 per video), importance-first selection.
 * Placement safety (pauses, pre-onset, under-speech accents) stays in audioPlan/sfxSafety.ts; the Director only proposes.
 */
import {SFX_MAX_HITS, SFX_MIN_SPACING_SEC} from '../../../lib/polishSfx.ts';
import type {EditEventSheet, SheetEvent} from '../eventSheet/types.ts';
import type {SfxIntentInput, SfxPurpose} from '../generation/requests.ts';

type Family = SfxIntentInput['character']['family'];

export type SoundDesign = {
  purpose: SfxPurpose;
  family: Family;
  description: string;
  durationSec: {min: number; max: number};
  /** Envelope words for the prompt and the report (attack / body / tail). */
  envelope: 'snap' | 'punch' | 'swell_in' | 'swell_out' | 'flutter' | 'blip';
  /** Where the sound's transient sits relative to the visual anchor (sec; negative = leads the picture, e.g. a whoosh into a cut). */
  timingOffsetSec: number;
  /** Mixing treatment the placement policy may use. `transient_accent` may sit at a word onset under speech, speech-band carved. */
  mix: 'pause_only' | 'transient_accent';
  importance: number;
};

export type DesignDecision = {
  eventId: string;
  type: string;
  timeSec: number;
  decision: 'sound' | 'silent' | 'folded' | 'cooldown' | 'spacing' | 'budget' | 'duplicate';
  reason: string;
  importance: number;
  design?: SoundDesign;
  /** For a folded event: the moment it was folded into. */
  foldedInto?: string;
};

const s = (min: number, max: number) => ({min, max});
const attr = (event: SheetEvent, key: string) => event.attrs[key];
const str = (event: SheetEvent, key: string) => (typeof event.attrs[key] === 'string' ? (event.attrs[key] as string) : '');
const numAttr = (event: SheetEvent, key: string, fallback: number) => (typeof event.attrs[key] === 'number' ? (event.attrs[key] as number) : fallback);

/** Kinetic role importance (schema.ts LINE_ROLES). Running, caption and connector words are ordinary captions. */
const ROLE_WEIGHT: Record<string, number> = {punch: 0.95, hero: 0.85, support: 0.5, connector: 0.25, running: 0, caption: 0};

/** One event -> a design, or a reasoned silence. Every branch is a rule the report can quote. */
export function designFor(event: SheetEvent): {design: SoundDesign} | {silent: string} {
  const intensity = numAttr(event, 'intensity', 0.6);
  switch (event.type) {
    case 'kinetic_line': {
      const role = str(event, 'role');
      const anim = str(event, 'anim');
      const weight = ROLE_WEIGHT[role] ?? 0.3;
      if (weight === 0) return {silent: `ordinary caption word (${role})`};
      if (anim === 'IN-1' || anim === 'IN-11' || anim === 'E1') return {silent: `soft focus fade (${anim}) on a ${role} word: no sound`};
      if (role === 'connector') return {silent: 'connector word: never sounded'};
      const text = str(event, 'text');
      const direction = str(event, 'direction');
      if (anim === 'IN-6' || attr(event, 'overshoot') === true) {
        return {design: {purpose: 'keyword_appearance', family: 'impact', description: `punchy word slam for "${text}", tight low thump with a short dry snap, no ring`, durationSec: s(0.08, 0.15), envelope: 'punch', timingOffsetSec: 0, mix: 'transient_accent', importance: Math.min(1, weight + 0.1)}};
      }
      if (anim === 'IN-9') return {design: {purpose: 'keyword_appearance', family: 'pop', description: `digital glitch blip for "${text}", soft digital interface click with a bit-crushed flutter`, durationSec: s(0.06, 0.12), envelope: 'blip', timingOffsetSec: 0, mix: 'transient_accent', importance: weight}};
      if (anim === 'IN-7' || anim === 'IN-8') return {design: {purpose: 'keyword_appearance', family: 'click', description: `soft mechanical key-tap flurry as "${text}" types on, two or three rounded taps`, durationSec: s(0.1, 0.15), envelope: 'snap', timingOffsetSec: 0, mix: 'transient_accent', importance: weight}};
      if (anim === 'IN-2' || direction === 'from_depth') return {design: {purpose: 'keyword_appearance', family: 'whoosh', description: `short rising whoosh as "${text}" scales up toward the viewer, airy, quick release`, durationSec: s(0.15, 0.3), envelope: 'swell_in', timingOffsetSec: -0.12, mix: 'pause_only', importance: weight * (0.7 + 0.3 * intensity)}};
      if (anim === 'IN-3' || direction === 'from_left' || direction === 'from_right') {
        const side = direction === 'from_left' ? 'left to right' : direction === 'from_right' ? 'right to left' : 'sideways';
        return {design: {purpose: 'keyword_appearance', family: 'whoosh', description: `quick directional swish moving ${side} for "${text}", tight and bright`, durationSec: s(0.12, 0.25), envelope: 'swell_in', timingOffsetSec: -0.08, mix: 'pause_only', importance: weight * (0.6 + 0.4 * intensity)}};
      }
      if (anim === 'IN-4' || anim === 'IN-5' || direction === 'swing' || direction === 'flip') return {design: {purpose: 'keyword_appearance', family: 'whoosh', description: `short airy swing swish as "${text}" turns into place`, durationSec: s(0.15, 0.3), envelope: 'swell_in', timingOffsetSec: -0.1, mix: 'pause_only', importance: weight * 0.8}};
      if (anim === 'IN-10') return {design: {purpose: 'keyword_appearance', family: 'pop', description: `soft bright glint for "${text}", gentle and short`, durationSec: s(0.08, 0.15), envelope: 'blip', timingOffsetSec: 0, mix: 'pause_only', importance: weight * 0.7}};
      return {silent: `entry ${anim} has no designed sound`};
    }
    case 'kinetic_exit': {
      const exit = str(event, 'exit');
      if (str(event, 'scope') === 'word') return {silent: 'word swap exit (X2): frequent and small, kept silent'};
      if (exit === 'OUT-2' || exit === 'OUT-3' || exit === 'X2') return {design: {purpose: 'visual_emphasis', family: 'whoosh', description: 'short reverse whoosh as the words stretch and blur out, airy suck-out', durationSec: s(0.2, 0.35), envelope: 'swell_out', timingOffsetSec: 0, mix: 'pause_only', importance: 0.3}};
      return {silent: `exit ${exit || 'fade'} is a fade: no sound`};
    }
    case 'kinetic_event':
      return {silent: 'phrase container: its words are designed individually (kinetic_line)'};
    case 'kinetic_gap_caption':
      return {silent: 'gap caption (ordinary caption)'};
    case 'kinetic_flash':
      return {design: {purpose: 'visual_emphasis', family: 'click', description: 'soft digital interface click for an on-screen word flash, low blip and airy tick', durationSec: s(0.05, 0.08), envelope: 'snap', timingOffsetSec: 0, mix: 'transient_accent', importance: 0.35}};
    case 'transition': {
      // the renderer's procedural styles (remotion/src/lib/proceduralTransition.ts PROCEDURAL_KEYWORDS); an asset transition keeps the generic whoosh
      const kw = `${str(event, 'drawnAs')} ${str(event, 'keyword')}`.toLowerCase();
      if (/smash.zoom/.test(kw)) return {design: {purpose: 'scene_change', family: 'impact', description: 'smash-zoom hit: a fast rising zip slamming into a short low impact', durationSec: s(0.12, 0.3), envelope: 'punch', timingOffsetSec: 0, mix: 'transient_accent', importance: 0.9}};
      if (/whip/.test(kw)) {
        const side = /left/.test(kw) ? 'right to left' : 'left to right';
        return {design: {purpose: 'scene_change', family: 'whoosh', description: `fast whip-pan swish moving ${side}, bright streak, quick release`, durationSec: s(0.2, 0.4), envelope: 'swell_in', timingOffsetSec: -0.12, mix: 'pause_only', importance: 0.9}};
      }
      if (/flash.black/.test(kw)) return {design: {purpose: 'scene_change', family: 'whoosh', description: 'dark cinematic whoosh dropping into a short low thud on the black flash', durationSec: s(0.25, 0.5), envelope: 'swell_in', timingOffsetSec: -0.15, mix: 'pause_only', importance: 0.9}};
      if (/dip.color/.test(kw)) return {design: {purpose: 'scene_change', family: 'swell', description: 'warm soft swell as the picture dips into colour, gentle', durationSec: s(0.4, 0.8), envelope: 'swell_in', timingOffsetSec: -0.2, mix: 'pause_only', importance: 0.6}};
      if (/grade.bw/.test(kw)) return {silent: 'black-and-white grade hold: a look change, kept silent'};
      const flavour = /flash/.test(kw) ? 'bright cinematic whoosh with a soft flash shimmer' : /blur|dissolve/.test(kw) ? 'soft airy cinematic whoosh smearing into the next shot' : 'cinematic transition whoosh, smooth rise and clean release';
      return {design: {purpose: 'scene_change', family: 'whoosh', description: flavour, durationSec: s(0.25, 0.5), envelope: 'swell_in', timingOffsetSec: -0.15, mix: 'pause_only', importance: 0.9}};
    }
    case 'cut':
      return {design: {purpose: 'scene_change', family: 'whoosh', description: 'short airy swish leading into a hard cut, soft attack', durationSec: s(0.2, 0.4), envelope: 'swell_in', timingOffsetSec: -0.1, mix: 'pause_only', importance: 0.3}};
    case 'zoom':
      return {design: {purpose: 'punch_in', family: 'impact', description: 'short low punch-in impact, crisp transient, dry body, no tail', durationSec: s(0.12, 0.3), envelope: 'punch', timingOffsetSec: 0, mix: 'transient_accent', importance: 0.6}};
    case 'impact_punch_in':
      return {design: {purpose: 'punch_in', family: 'impact', description: 'short low camera punch-in impact, tight and dry', durationSec: s(0.1, 0.25), envelope: 'punch', timingOffsetSec: 0, mix: 'transient_accent', importance: 0.7}};
    case 'impact_flash':
      return {design: {purpose: 'visual_emphasis', family: 'impact', description: 'bright accent snap for a white flash, crisp and very short', durationSec: s(0.08, 0.2), envelope: 'snap', timingOffsetSec: 0, mix: 'transient_accent', importance: 0.55}};
    case 'impact_sat_pop':
      return {design: {purpose: 'visual_emphasis', family: 'pop', description: 'soft rounded pop for a colour pop, low body, quick and gentle', durationSec: s(0.08, 0.15), envelope: 'blip', timingOffsetSec: 0, mix: 'transient_accent', importance: 0.45}};
    case 'impact_bw_span':
      return {design: {purpose: 'emotional_pause', family: 'swell', description: 'dark soft low swell as the picture drains to black and white', durationSec: s(0.6, 1.2), envelope: 'swell_in', timingOffsetSec: 0, mix: 'pause_only', importance: 0.4}};
    case 'broll':
      return {design: {purpose: 'product_reveal', family: 'whoosh', description: 'quick swish revealing a cutaway picture, bright and short', durationSec: s(0.2, 0.35), envelope: 'swell_in', timingOffsetSec: -0.1, mix: 'pause_only', importance: 0.6}};
    case 'frame_inset':
    case 'inset_reveal':
    case 'media_container':
      return {design: {purpose: 'product_reveal', family: 'pop', description: 'soft rounded pop as a picture-in-picture appears, low body, gentle and short', durationSec: s(0.06, 0.12), envelope: 'blip', timingOffsetSec: 0, mix: 'transient_accent', importance: 0.5}};
    case 'explainer_layout':
    case 'newsroom_layout':
      return {design: {purpose: 'scene_change', family: 'whoosh', description: 'directional layered whoosh as the split-screen layout slides in', durationSec: s(0.3, 0.5), envelope: 'swell_in', timingOffsetSec: -0.15, mix: 'pause_only', importance: 0.7}};
    case 'explainer_claim':
      return {design: {purpose: 'title_reveal', family: 'pop', description: 'small soft rounded pop as a claim is highlighted', durationSec: s(0.06, 0.12), envelope: 'blip', timingOffsetSec: 0, mix: 'transient_accent', importance: 0.4}};
    case 'semantic_emphasis':
      return {design: {purpose: 'visual_emphasis', family: 'pop', description: 'small soft rounded pop for a keyword highlight', durationSec: s(0.06, 0.12), envelope: 'blip', timingOffsetSec: 0, mix: 'transient_accent', importance: 0.45}};
    case 'motion_graphic':
    case 'generated_graphic':
      return {design: {purpose: event.type === 'motion_graphic' ? 'important_action' : 'product_reveal', family: 'pop', description: 'clean digital activation blip as a graphic powers on', durationSec: s(0.08, 0.15), envelope: 'blip', timingOffsetSec: 0, mix: 'transient_accent', importance: 0.6}};
    case 'visual_overlay':
      return {design: {purpose: 'important_action', family: 'pop', description: 'soft rounded pop as a callout appears, short', durationSec: s(0.06, 0.12), envelope: 'blip', timingOffsetSec: 0, mix: 'transient_accent', importance: 0.5}};
    case 'behind_subject_text':
      return {design: {purpose: 'keyword_appearance', family: 'pop', description: 'soft deep rounded pop as text appears behind the speaker', durationSec: s(0.08, 0.15), envelope: 'blip', timingOffsetSec: 0, mix: 'transient_accent', importance: 0.45}};
    case 'hook_title':
    case 'opening_treatment':
      return {design: {purpose: 'title_reveal', family: 'pop', description: 'clean bright title reveal pop, fast attack, very short', durationSec: s(0.08, 0.15), envelope: 'blip', timingOffsetSec: 0, mix: 'transient_accent', importance: 0.85}};
    case 'stage_span':
      return str(event, 'enter') === 'slide_up_front'
        ? {design: {purpose: 'product_reveal', family: 'whoosh', description: 'smooth upward whoosh as the stage slides up', durationSec: s(0.25, 0.45), envelope: 'swell_in', timingOffsetSec: -0.1, mix: 'pause_only', importance: 0.55}}
        : {silent: 'stage span with a hard-cut entry: the picture change carries it'};
    case 'stage_accent':
      return {design: {purpose: 'keyword_appearance', family: 'pop', description: 'soft rounded pop as stacked text appears', durationSec: s(0.06, 0.12), envelope: 'blip', timingOffsetSec: 0, mix: 'transient_accent', importance: 0.45}};
    case 'stage_cutaway':
      return {design: {purpose: 'scene_change', family: 'whoosh', description: 'airy cutaway whoosh, smooth rise, clean quick release', durationSec: s(0.25, 0.45), envelope: 'swell_in', timingOffsetSec: -0.15, mix: 'pause_only', importance: 0.7}};
    case 'depth_overlay':
    case 'grade_beat':
      return {silent: `${event.type}: a look change, not a movement; kept silent`};
  }
  return {silent: `no design for ${event.type}`};
}

/** Appended to every accent-capable design: the sound may sit under a word, speech-band carved, so its energy belongs where the voice is weak. */
export const ACCENT_NOTE = ', low thump and bright air, little midrange';

export const COORDINATION_SEC = 0.12;
/** Minimum distance between two sounds of the same family (on top of the global 0.8 s voice-first spacing). */
export const FAMILY_COOLDOWN_SEC: Readonly<Partial<Record<Family, number>>> = Object.freeze({impact: 1.5, whoosh: 1.2, pop: 1.0, click: 1.0, swell: 6});

const anchorSec = (event: SheetEvent) => event.impact?.time.sec ?? event.time.startSec;

/**
 * The whole edit: decisions for every event and the selected intents (most important first, within cooldowns, spacing and budget).
 * `accept` lets the caller veto a candidate the placement policy cannot place (so the budget goes to the next most important event).
 */
export function directSoundDesign(sheet: EditEventSheet, options: {accept?: (intent: SfxIntentInput, design: SoundDesign) => SfxIntentInput | null | {veto: string}; maxSounds?: number} = {}): {intents: SfxIntentInput[]; decisions: DesignDecision[]; designs: Map<string, SoundDesign>} {
  const decisions: DesignDecision[] = [];
  const candidates: Array<{event: SheetEvent; design: SoundDesign; time: number; folded: string[]}> = [];
  const seenParents = new Set<string>();
  for (const event of sheet.events) {
    const time = anchorSec(event);
    if (event.duplicateOf) {
      decisions.push({eventId: event.id, type: event.type, timeSec: time, decision: 'duplicate', reason: `same visual as ${event.duplicateOf}`, importance: 0});
      continue;
    }
    if (event.visibility.status === 'conditional') {
      decisions.push({eventId: event.id, type: event.type, timeSec: time, decision: 'silent', reason: 'drawn only under render-time conditions', importance: 0});
      continue;
    }
    const result = designFor(event);
    if ('silent' in result) {
      decisions.push({eventId: event.id, type: event.type, timeSec: time, decision: 'silent', reason: result.silent, importance: 0});
      continue;
    }
    // a Kinetic cascade (IN-7) is one word written character by character: one sound for the word, on its first character
    if (event.type === 'kinetic_line' && (event.attrs.anim === 'IN-7' || event.attrs.anim === 'IN-8')) {
      const parent = event.id.replace(/\.w\d+$/, '');
      if (seenParents.has(parent)) {
        decisions.push({eventId: event.id, type: event.type, timeSec: time, decision: 'duplicate', reason: `later character of the same cascade (${parent})`, importance: 0});
        continue;
      }
      seenParents.add(parent);
    }
    candidates.push({event, design: result.design, time, folded: []});
  }
  // coordination: one moment per COORDINATION_SEC cluster, led by its most important event
  candidates.sort((a, b) => a.time - b.time);
  const moments: typeof candidates = [];
  for (const candidate of candidates) {
    const last = moments[moments.length - 1];
    if (last && candidate.time - last.time <= COORDINATION_SEC + 1e-9) {
      const [lead, other] = candidate.design.importance > last.design.importance ? [candidate, last] : [last, candidate];
      lead.folded.push(...(lead === candidate ? [last.event.id, ...last.folded] : [candidate.event.id]));
      if (other.design.family !== lead.design.family) lead.design = {...lead.design, description: `${lead.design.description}, layered with a light ${other.design.family}`.slice(0, 280), importance: Math.min(1, lead.design.importance + 0.05)};
      decisions.push({eventId: other.event.id, type: other.event.type, timeSec: other.time, decision: 'folded', reason: `same moment as ${lead.event.id} (within ${COORDINATION_SEC * 1000} ms)`, importance: other.design.importance, design: other.design, foldedInto: lead.event.id});
      if (lead === candidate) moments[moments.length - 1] = candidate;
      continue;
    }
    moments.push(candidate);
  }
  // selection: importance first; cooldown per family, global spacing, budget
  const order = [...moments].sort((a, b) => b.design.importance - a.design.importance || a.time - b.time || (a.event.id < b.event.id ? -1 : 1));
  const chosen: Array<{time: number; family: Family}> = [];
  const intents: SfxIntentInput[] = [];
  const designs = new Map<string, SoundDesign>();
  const budget = Math.min(options.maxSounds ?? SFX_MAX_HITS, SFX_MAX_HITS);
  for (const moment of order) {
    const {event, design, time} = moment;
    const base = {eventId: event.id, type: event.type, timeSec: time, importance: design.importance, design};
    if (intents.length >= budget) {
      decisions.push({...base, decision: 'budget', reason: `the edit already has ${budget} sounds (voice-first budget)`});
      continue;
    }
    const near = chosen.find(item => Math.abs(item.time - time) < SFX_MIN_SPACING_SEC - 1e-9);
    if (near) {
      decisions.push({...base, decision: 'spacing', reason: `within ${SFX_MIN_SPACING_SEC}s of a more important sound at ${near.time}s`});
      continue;
    }
    const cooldown = FAMILY_COOLDOWN_SEC[design.family] ?? 0;
    const hot = chosen.find(item => item.family === design.family && Math.abs(item.time - time) < cooldown - 1e-9);
    if (hot) {
      decisions.push({...base, decision: 'cooldown', reason: `${design.family} cooldown ${cooldown}s (another ${design.family} at ${hot.time}s)`});
      continue;
    }
    const intent: SfxIntentInput = {
      eventId: event.id,
      purpose: design.purpose,
      // an accent-capable sound may end up under a word, speech-band carved: ask for energy where the voice is weak (measured: VISUAL_EVENT_SOUND_DESIGN report)
      // the request schema caps a description at 160 characters (generation/requests.ts); the accent spectrum note is kept short and always included
      character: {family: design.family, description: design.mix === 'transient_accent' ? `${design.description.slice(0, 160 - ACCENT_NOTE.length)}${ACCENT_NOTE}` : design.description.slice(0, 160)},
      durationSec: design.durationSec,
      intensity: 'normal',
      essential: design.importance >= 0.7,
      why: `${event.type}${event.attrs.anim ? ` ${String(event.attrs.anim)}` : ''}${event.attrs.role ? ` ${String(event.attrs.role)}` : ''} at ${time}s; ${design.envelope}; ${design.mix}${moment.folded.length ? `; with ${moment.folded.join(', ')}` : ''}`.slice(0, 240),
    };
    const accepted = options.accept ? options.accept(intent, design) : intent;
    if (!accepted || 'veto' in accepted) {
      decisions.push({...base, decision: 'silent', reason: accepted && 'veto' in accepted ? accepted.veto : 'no speech-safe position for this sound (placement policy)'});
      continue;
    }
    chosen.push({time, family: design.family});
    intents.push(accepted);
    designs.set(event.id, design);
    decisions.push({...base, decision: 'sound', reason: moment.folded.length ? `leads a coordinated moment with ${moment.folded.join(', ')}` : 'selected'});
  }
  intents.sort((a, b) => (a.eventId < b.eventId ? -1 : 1));
  return {intents, decisions, designs};
}
