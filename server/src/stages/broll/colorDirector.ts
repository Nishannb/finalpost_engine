/**
 * WP56 Color Director — editorial *video* colours, not website/SaaS neon.
 * Prefers paper / off-white grounds and muted ink accents. Wraps `pickEditPalette`
 * and remaps flashy defaults for talking-head polish.
 */
import {
  EDIT_PALETTES,
  pickEditPalette,
  type EditPalette,
  type EditPaletteId,
  type PickEditPaletteInput,
} from './editPalette.ts';

/** Soft paper editorial — default polish talking-head look (WP56). */
export const EDITORIAL_PAPER: EditPalette = {
  id: 'editorial_paper',
  accent: '#3D4A5C',
  ground: '#FAFAF7',
  groundDot: '#D8D6CF',
  groundStyle: 'paper_dot',
  text: '#111111',
  inkOnAccent: '#FAFAF7',
  reason: 'Color Director: editorial paper ground + muted slate accent (video, not web neon)',
  preferredFor: 'any',
};

const FLASHY_IDS = new Set<string>(['edu_lime_paper', 'energy_orange', 'tech_cyan']);

export type ColorDirectorResult = {
  palette: EditPalette;
  /** Motion-theme override so opaque plates stop using navy website blue `#0B1020`. */
  themeOverride: {
    background: string;
    surface: string;
    text: string;
    mutedText: string;
    accent: string;
    primary: string;
    secondary: string;
  };
  warning: string;
};

function byId(id: EditPaletteId): EditPalette | undefined {
  return EDIT_PALETTES.find(p => p.id === id);
}

/**
 * Direct polish colours. Newsroom/finance may keep signal red on ink.
 * Generic explainer / sales / default → editorial paper (never neon lime as the live default).
 */
export function directEditColors(input: PickEditPaletteInput & {videoEdit?: boolean}): ColorDirectorResult {
  const raw = pickEditPalette(input);
  let palette = raw;

  // Skill proofs may force preferred lime; Color Director still documents it.
  if (!input.forcePreferred) {
    if (raw.id === 'newsroom_red_ink') {
      palette = raw;
    } else if (raw.id === 'clean_mono' && input.skill === 'faceless') {
      palette = raw;
    } else if (FLASHY_IDS.has(raw.id) || raw.id === 'night_amber') {
      // Demote flashy / dark website grounds for talking-head polish to paper editorial.
      // Keep night_amber only when content was warmly lifestyle AND caller opts out of videoEdit remap — default remap to paper.
      palette = {
        ...EDITORIAL_PAPER,
        reason: `Color Director remapped ${raw.id} → editorial_paper (${raw.reason})`,
      };
    } else if (raw.groundStyle === 'ink_black' && input.skill !== 'newsroom_mg') {
      palette = {
        ...EDITORIAL_PAPER,
        reason: `Color Director: prefer paper over ink_black for ${input.skill}`,
      };
    }
  }

  // Ensure editorial_paper is addressable even if not yet in EDIT_PALETTES catalog (parity added below).
  if ((palette.id as string) === 'editorial_paper' && !byId('editorial_paper' as EditPaletteId)) {
    palette = {...EDITORIAL_PAPER, reason: palette.reason};
  }

  const paper = palette.groundStyle === 'paper_dot' || /^#f/i.test(palette.ground);
  const themeOverride = paper
    ? {
        background: palette.ground,
        surface: '#F0EEE8',
        text: palette.text.startsWith('#') && palette.text.toLowerCase() !== '#ffffff' ? palette.text : '#111111',
        mutedText: '#5C5A55',
        accent: palette.accent,
        primary: palette.accent,
        secondary: '#6B7280',
      }
    : {
        background: palette.ground,
        surface: palette.ground,
        text: palette.text,
        mutedText: '#94A3B8',
        accent: palette.accent,
        primary: palette.accent,
        secondary: palette.accent,
      };

  return {
    palette,
    themeOverride,
    warning: `polish_color_director:${palette.id}:${palette.ground}`,
  };
}

/** True when a hex looks like flashy website blue / neon (for guards in tests). */
export function isFlashyVideoColor(hex: string): boolean {
  const h = hex.toLowerCase();
  if (h === '#bfff00' || h === '#00c2ff' || h === '#ff5a1f') return true;
  if (h === '#0b1020' || h === '#11102a' || h === '#6366f1') return true;
  return false;
}
