/**
 * P5 Typography voice. The selected caption preset stays the identity (its face, its text / accent colours, its case, outline and shadow), but a kinetic edit is not one face at
 * one size: the voice adds a loud display face, an editorial serif / italic, a condensed face for long hero words and a small connector face, all chosen as COMPANIONS of the
 * preset's own family (a script preset keeps a script accent, a serif preset keeps serif heroes). Per beat the variety controller picks a voice variant (loud / editorial / clean /
 * gradient / mixed), so the same preset produces many looks without ever losing its identity.
 */
import type {FontKey} from '../schema.ts';
import type {KineticIdentity} from '../presetIdentity.ts';
import type {Voice, VoiceVariant} from './types.ts';

type Family = 'condensed' | 'heavy' | 'geometric' | 'serif' | 'script' | 'technical' | 'fat';
const FAMILY_OF: Record<FontKey, Family> = {
  anton: 'condensed', bebas: 'condensed', archivoBlack: 'heavy', poppins: 'geometric', inter: 'geometric', playfair: 'serif', playfairItalic: 'serif', pacifico: 'script', spaceGrotesk: 'technical', shrikhand: 'fat',
};
/** companions per family: display (heroes), editorial (accent), condensed (long heroes), small (connectors) */
const COMPANIONS: Record<Family, {display: FontKey; displayWeight: number; editorial: FontKey; condensed: FontKey; small: FontKey; smallWeight: number}> = {
  condensed: {display: 'anton', displayWeight: 400, editorial: 'playfairItalic', condensed: 'bebas', small: 'poppins', smallWeight: 600},
  heavy: {display: 'archivoBlack', displayWeight: 400, editorial: 'playfairItalic', condensed: 'anton', small: 'poppins', smallWeight: 600},
  geometric: {display: 'poppins', displayWeight: 900, editorial: 'playfairItalic', condensed: 'anton', small: 'poppins', smallWeight: 500},
  serif: {display: 'playfair', displayWeight: 400, editorial: 'playfairItalic', condensed: 'bebas', small: 'inter', smallWeight: 700},
  script: {display: 'archivoBlack', displayWeight: 400, editorial: 'pacifico', condensed: 'anton', small: 'poppins', smallWeight: 600},
  technical: {display: 'spaceGrotesk', displayWeight: 700, editorial: 'playfairItalic', condensed: 'bebas', small: 'inter', smallWeight: 700},
  fat: {display: 'shrikhand', displayWeight: 400, editorial: 'playfairItalic', condensed: 'anton', small: 'poppins', smallWeight: 600},
};

/** Kinetic's own look when no preset is selected */
export const DEFAULT_VOICE: Voice = {
  presetId: null, primary: 'poppins', primaryWeight: 700, display: 'anton', displayWeight: 400, editorial: 'playfairItalic', condensed: 'bebas', small: 'poppins', smallWeight: 600,
  text: '#FFFFFF', accent: '#FFD400', accent2: '#FF5A36', ink: '#111111', upper: null, outline: null, shadowColor: 'rgba(0,0,0,0.55)',
};

/**
 * ONE FONT PER EDIT (owner rule, 2026-11-26): every role is set in the edit's primary face. Hierarchy comes from size, case, colour, weight where the face has it, and motion,
 * never from a second typeface (a single word in a condensed / serif / script companion read as a mistake). Applied by the composer to the preset voice and the default voice.
 */
export function oneFace(voice: Voice): Voice {
  // the selected preset's face is THE face; with no preset, Kinetic's own display face (a text face cannot carry the heroes)
  const face = voice.presetId === null ? voice.display : voice.primary;
  const weight = voice.presetId === null ? voice.displayWeight : voice.primaryWeight;
  // no preset: Kinetic's display face set in caps (a condensed display face is a caps face; the preset path keeps the preset's own case)
  return {...voice, primary: face, primaryWeight: weight, display: face, displayWeight: weight, editorial: face, condensed: face, small: face, smallWeight: weight, ...(voice.presetId === null && voice.upper === null ? {upper: true} : {})};
}

export function voiceFromIdentity(identity: KineticIdentity | undefined): Voice {
  if (!identity) return DEFAULT_VOICE;
  const fam = FAMILY_OF[identity.font] ?? 'geometric';
  const c = COMPANIONS[fam];
  const primaryWeight = identity.font === 'poppins' ? (identity.weight ?? 700) : identity.font === 'inter' ? 800 : 400;
  // the preset's own face IS the display face when it is already a display face (anton / archivo / shrikhand / bebas); a text face (poppins / inter) pairs with a heavier cut
  const display = fam === 'condensed' || fam === 'heavy' || fam === 'fat' || fam === 'serif' || fam === 'technical' ? identity.font : c.display;
  const displayWeight = display === 'poppins' ? 900 : display === 'spaceGrotesk' ? 700 : 400;
  const accent = identity.accent.toUpperCase() !== identity.text.toUpperCase() ? identity.accent : '#FFD400';
  return {
    presetId: identity.presetId, primary: identity.font, primaryWeight, display, displayWeight, editorial: c.editorial, condensed: c.condensed, small: c.small, smallWeight: c.smallWeight,
    text: identity.text, accent, accent2: identity.accent2 !== accent ? identity.accent2 : '#FF5A36', ink: '#111111', upper: identity.upper,
    outline: identity.outline ? {color: identity.outline.color, px: Math.max(2, Math.min(8, identity.outline.strokePxAt1920))} : null,
    shadowColor: identity.shadowColor ?? 'rgba(0,0,0,0.55)',
  };
}

/**
 * Curated palettes the Director may choose from (POLISH_KINETIC_AI_PALETTE). Every running text colour is a near-white (it reads over any footage with the preset's shadow / outline);
 * every accent is either light enough for dark ink on a chip / highlighter (luminance >= 0.45, >= 8:1 against #141414) or is only used as a type colour. No palette sets a mid-grey.
 */
export const PALETTES: Record<string, {text: string; accent: string; accent2: string; mood: string}> = {
  sunshine: {text: '#FFFFFF', accent: '#FFD400', accent2: '#FF5A36', mood: 'bold, energetic, classic creator yellow'},
  electric: {text: '#FFFFFF', accent: '#3DE8FF', accent2: '#B98BFF', mood: 'tech, AI, software, futuristic, cool'},
  mint: {text: '#FFFFFF', accent: '#5CFFB5', accent2: '#3DE8FF', mood: 'money, growth, health, fresh, positive'},
  coral: {text: '#FFF8F2', accent: '#FF8A65', accent2: '#FFD166', mood: 'warm, lifestyle, food, friendly'},
  candy: {text: '#FFFFFF', accent: '#FF6AD5', accent2: '#FFE14D', mood: 'playful, beauty, fashion, fun'},
  lime: {text: '#FFFFFF', accent: '#C8FF3D', accent2: '#3DE8FF', mood: 'sport, fitness, hype, loud'},
  gold: {text: '#FFF6E5', accent: '#FFC247', accent2: '#FF8A3D', mood: 'luxury, business, premium, finance'},
  ice: {text: '#F4F9FF', accent: '#9AD8FF', accent2: '#C9B8FF', mood: 'calm, clean, minimal, wellness'},
  crimson: {text: '#FFFFFF', accent: '#FF4D6A', accent2: '#FFD400', mood: 'urgent, dramatic, warning, passion'},
  earth: {text: '#FFF3E0', accent: '#F0C27B', accent2: '#A8E6A1', mood: 'story, nature, slow, cosy'},
};

/** the Director's palette replaces the preset's text / accent colours (faces, case, outline and shadow stay the preset's); unknown or absent = the voice unchanged */
export function applyPalette(voice: Voice, palette: string | undefined): Voice {
  const p = palette ? PALETTES[palette] : undefined;
  if (!p) return voice;
  return {...voice, text: p.text, accent: p.accent, accent2: p.accent2};
}

export type WordStyle = {font: FontKey; weight: number; italic: boolean; uppercase: boolean; color: string; gradient: [string, string] | null};

/** Role -> look for one beat's voice variant. `key` = a hero / punch word, `ctx` = support words, `conn` = connectors. */
export function styleFor(voice: Voice, variant: VoiceVariant, role: 'key' | 'ctx' | 'conn' | 'run'): WordStyle {
  const caseOf = (dflt: boolean) => (voice.upper === null ? dflt : voice.upper);
  const plain = (font: FontKey, weight: number, upper: boolean, color: string, italic = false): WordStyle => ({font, weight, italic, uppercase: caseOf(upper), color, gradient: null});
  if (role === 'run') return plain(voice.primary, voice.primaryWeight, false, voice.text);
  if (role === 'conn') return plain(voice.small, voice.smallWeight, false, voice.text);
  switch (variant) {
    case 'loud': return role === 'key' ? plain(voice.display, voice.displayWeight, true, voice.accent) : plain(voice.primary, voice.primaryWeight, true, voice.text);
    case 'editorial': return role === 'key' ? {...plain(voice.editorial, voice.editorial === voice.primary ? voice.primaryWeight : voice.editorial === 'playfairItalic' ? 700 : 400, false, voice.text, voice.editorial === 'playfairItalic'), uppercase: voice.upper === true} : plain(voice.small, voice.smallWeight, false, voice.text);
    case 'clean': return role === 'key' ? plain(voice.primary, Math.max(voice.primaryWeight, 800), false, voice.accent) : plain(voice.primary, voice.primaryWeight, false, voice.text);
    case 'gradient': return role === 'key' ? {...plain(voice.display, voice.displayWeight, true, voice.accent), gradient: [voice.accent, voice.accent2]} : plain(voice.primary, voice.primaryWeight, true, voice.text);
    case 'mixed': default: return role === 'key' ? plain(voice.display, voice.displayWeight, true, voice.text) : plain(voice.editorial, voice.editorial === voice.primary ? voice.primaryWeight : voice.editorial === 'playfairItalic' ? 700 : 400, false, voice.accent, voice.editorial === 'playfairItalic');
  }
}
