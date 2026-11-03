/**
 * Semantic colour roles chosen by the Director, and the deterministic checks that keep them legible.
 *
 * The Director decides the identity and the roles. This module only VALIDATES, and corrects the minimum needed: a role that already meets its
 * contrast target is returned untouched (a deliberate, valid choice is never overridden); a failing role is moved along its own lightness axis, hue and
 * saturation preserved, until it passes. Every change is reported with its reason. Nothing here assumes complementary colours are readable:
 * contrast is measured, and text over footage is measured against the footage itself (see `textOverFootage`).
 */

import {contrastRatio, hexLuminance} from '../../lib/contrast.ts';

export const COLOR_ROLES = ['primary_text', 'secondary_text', 'accent', 'graphic_background', 'panel', 'highlight', 'data'] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];
export type ColorRoles = Record<ColorRole, string>;

const HEX6 = /^#[0-9a-fA-F]{6}$/;
export const isHex6 = (value: unknown): value is string => typeof value === 'string' && HEX6.test(value);

export type Hsl = {h: number; s: number; l: number};

export function hexToHsl(hex: string): Hsl {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) {
    return {h: 0, s: 0, l};
  }
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return {h: (h * 60 + 360) % 360, s, l};
}

export function hslToHex({h, s, l}: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (v: number) => Math.round(Math.min(1, Math.max(0, v + m)) * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

/** Moves `color` along its lightness axis (hue and saturation kept) until it reaches `target` contrast against `against`. Null when it cannot. */
export function adjustForContrast(color: string, against: string, target: number): string | null {
  if (contrastRatio(color, against) >= target) {
    return color;
  }
  const base = hexToHsl(color);
  // Move away from the background: lighter when the background is dark, darker when it is light.
  const direction = hexLuminance(against) < 0.4 ? 1 : -1;
  for (let step = 1; step <= 40; step++) {
    const candidate = hslToHex({...base, l: Math.min(1, Math.max(0, base.l + (direction * step) / 40))});
    if (contrastRatio(candidate, against) >= target) {
      return candidate;
    }
  }
  return null;
}

export type RoleCorrection = {role: ColorRole | string; from: string; to: string; reason: string};
export type RoleReport = {
  roles: ColorRoles;
  corrections: RoleCorrection[];
  warnings: string[];
};

/** Contrast every pair must reach. Large display text needs 3:1; body-size labels 4.5:1. */
export const ROLE_TARGETS: Array<{role: ColorRole; against: ColorRole; target: number}> = [
  {role: 'primary_text', against: 'graphic_background', target: 4.5},
  {role: 'secondary_text', against: 'graphic_background', target: 3},
  {role: 'accent', against: 'graphic_background', target: 3},
  {role: 'primary_text', against: 'panel', target: 4.5},
  {role: 'highlight', against: 'panel', target: 3},
  {role: 'data', against: 'graphic_background', target: 3},
];

/** Saturated colours whose hues are further apart than this count as separate accents. */
const HUE_SEPARATION = 35;
const MAX_ACCENT_HUES = 2;

export function validateColorRoles(input: Partial<Record<ColorRole, string>>): RoleReport {
  const corrections: RoleCorrection[] = [];
  const warnings: string[] = [];
  const roles = {} as ColorRoles;
  for (const role of COLOR_ROLES) {
    const value = input[role];
    if (isHex6(value)) {
      roles[role] = value.toUpperCase();
    } else {
      // Missing or malformed: derive from the roles that are valid rather than inventing an unrelated colour.
      roles[role] = '';
      warnings.push(`role_missing_or_invalid:${role}`);
    }
  }
  const dark = isHex6(roles.graphic_background) ? roles.graphic_background : '#111111';
  roles.graphic_background ||= dark;
  roles.panel ||= roles.graphic_background;
  const light = hexLuminance(roles.graphic_background) < 0.4;
  roles.primary_text ||= light ? '#FFFFFF' : '#111111';
  roles.secondary_text ||= roles.primary_text;
  roles.accent ||= roles.primary_text;
  roles.highlight ||= roles.accent;
  roles.data ||= roles.accent;

  for (const {role, against, target} of ROLE_TARGETS) {
    const ratio = contrastRatio(roles[role], roles[against]);
    if (ratio >= target) {
      continue;
    }
    // Move the foreground role first; it is the one that carries the text.
    const fixed = adjustForContrast(roles[role], roles[against], target);
    if (fixed) {
      corrections.push({role, from: roles[role], to: fixed, reason: `contrast ${ratio.toFixed(2)} < ${target} against ${against}`});
      roles[role] = fixed;
    } else {
      const fallback = contrastRatio('#FFFFFF', roles[against]) >= contrastRatio('#111111', roles[against]) ? '#FFFFFF' : '#111111';
      corrections.push({role, from: roles[role], to: fallback, reason: `contrast ${ratio.toFixed(2)} < ${target} against ${against}, no tint of the colour reaches it`});
      roles[role] = fallback;
    }
  }

  // Foreground and background must never be the same colour, even after the passes above.
  for (const [a, b] of [['primary_text', 'graphic_background'], ['primary_text', 'panel'], ['accent', 'graphic_background']] as const) {
    if (roles[a] === roles[b]) {
      warnings.push(`identical_roles:${a}=${b}`);
    }
  }

  // Too many competing accents: keep the Director's accent and fold the rest onto it.
  const accentHues: number[] = [];
  for (const role of ['accent', 'highlight', 'data'] as const) {
    const hsl = hexToHsl(roles[role]);
    if (hsl.s < 0.25) {
      continue;
    }
    if (!accentHues.some(h => Math.min(Math.abs(h - hsl.h), 360 - Math.abs(h - hsl.h)) < HUE_SEPARATION)) {
      accentHues.push(hsl.h);
    }
  }
  if (accentHues.length > MAX_ACCENT_HUES) {
    for (const role of ['highlight', 'data'] as const) {
      const hsl = hexToHsl(roles[role]);
      const accent = hexToHsl(roles.accent);
      const apart = Math.min(Math.abs(accent.h - hsl.h), 360 - Math.abs(accent.h - hsl.h)) >= HUE_SEPARATION;
      if (hsl.s >= 0.25 && apart) {
        const folded = adjustForContrast(roles.accent, roles[role === 'highlight' ? 'panel' : 'graphic_background'], 3) ?? roles.accent;
        corrections.push({role, from: roles[role], to: folded, reason: `more than ${MAX_ACCENT_HUES} competing accent hues; folded onto the accent`});
        roles[role] = folded;
        break;
      }
    }
  }
  return {roles, corrections, warnings};
}

// ---- text over the actual footage ---------------------------------------------------------------------------------------------------------------

export type RegionStats = {
  /** Relative luminance (0-1) at the 10th / 50th / 90th percentile of the sampled pixels. */
  p10: number;
  p50: number;
  p90: number;
  /** Mean RGB, 0-255. */
  meanRgb: {r: number; g: number; b: number};
  /** Std-dev of luminance across the region: a busy background has a high value. */
  spread: number;
};

export type OverFootageResult = {
  textColor: string;
  /** Contrast of the (possibly corrected) text colour against the WORST pixels it can land on. */
  worstContrast: number;
  corrections: Array<{kind: 'text_color' | 'outline' | 'panel'; reason: string; value?: string}>;
  /** Outline colour to draw behind the glyphs, when needed. */
  strokeColor?: string;
  /** Backing panel to draw behind the text, when needed. */
  panel?: {color: string; opacity: number};
};

const lumAt = (l: number) => l;
const contrastLum = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Text drawn straight on the footage. Worst case is the footage's brightest pixels under light text, or darkest under dark text. The Director's colour is kept
 * when it clears 3:1 (large display type) there AND the region is calm; otherwise, in this order: the text colour moves along its lightness; an outline
 * (a role-derived colour opposite to the text) is added; a backing panel is added when the region is busy or nothing else reaches 3:1.
 */
export function textOverFootage(input: {textColor: string; panelColor: string; stats: RegionStats; large?: boolean}): OverFootageResult {
  const target = input.large === false ? 4.5 : 3;
  const lightText = hexLuminance(input.textColor) >= 0.4;
  const worstLum = lightText ? input.stats.p90 : input.stats.p10;
  const corrections: OverFootageResult['corrections'] = [];
  let textColor = input.textColor;
  let worst = contrastLum(hexLuminance(textColor), lumAt(worstLum));
  const busy = input.stats.spread > 0.22;

  if (worst >= target && !busy) {
    return {textColor, worstContrast: worst, corrections};
  }
  if (worst < target) {
    // Try the text colour's own lightness first.
    const stand = hslToHex({...hexToHsl(textColor), l: lightText ? 1 : 0});
    const standWorst = contrastLum(hexLuminance(stand), lumAt(worstLum));
    if (standWorst >= target && stand !== textColor && !busy) {
      corrections.push({kind: 'text_color', value: stand, reason: `contrast ${worst.toFixed(2)} < ${target} on the brightest/darkest footage pixels`});
      return {textColor: stand, worstContrast: standWorst, corrections};
    }
  }
  // Outline: opposite lightness to the text. It rescues edges on a calm region where the text is only just short; it does not fix a busy field.
  const stroke = lightText ? '#000000' : '#FFFFFF';
  if (!busy && worst >= 2) {
    corrections.push({kind: 'outline', value: stroke, reason: `contrast ${worst.toFixed(2)} < ${target}; outline added`});
    return {textColor, worstContrast: worst, corrections, strokeColor: stroke};
  }
  const panelIsDark = lightText;
  const panelColor = (panelIsDark ? hexLuminance(input.panelColor) < 0.25 : hexLuminance(input.panelColor) > 0.6) ? input.panelColor : panelIsDark ? '#0B0F19' : '#FFFFFF';
  // Text on its own panel: contrast is text vs panel, not vs the footage.
  const onPanel = contrastRatio(textColor, panelColor);
  if (onPanel < 4.5) {
    textColor = adjustForContrast(textColor, panelColor, 4.5) ?? (panelIsDark ? '#FFFFFF' : '#111111');
    corrections.push({kind: 'text_color', value: textColor, reason: `text vs its panel was ${onPanel.toFixed(2)}`});
  }
  corrections.push({kind: 'panel', value: panelColor, reason: busy ? `busy footage behind the text (spread ${input.stats.spread.toFixed(2)})` : `contrast ${worst.toFixed(2)} on the footage and no outline or tint reaches ${target}`});
  return {textColor, worstContrast: contrastRatio(textColor, panelColor), corrections, panel: {color: panelColor, opacity: 0.82}};
}

/** Maps validated roles onto the engine's shared design object. Only the four colour fields change; fonts, motion preset etc. come from `base`. */
export function designColorsFromRoles(roles: ColorRoles): {primaryColor: string; secondaryColor: string; inkColor: string; surfaceColor: string} {
  return {primaryColor: roles.accent, secondaryColor: roles.highlight, inkColor: roles.primary_text, surfaceColor: roles.graphic_background};
}

/** The generated-graphics theme (props.theme) for the same roles. */
export function motionThemeFromRoles(roles: ColorRoles): Record<string, string> {
  return {primary: roles.accent, secondary: roles.highlight, background: roles.graphic_background, surface: roles.panel, text: roles.primary_text, mutedText: roles.secondary_text, accent: roles.accent};
}

/**
 * Colours for text drawn BEHIND the speaker. It has no backing panel (a panel would be hidden by, or fight with, the subject), so it is allowed only where the
 * footage is calm enough for the text colour plus an outline to read. Null means "do not draw it unpanelled": the caller downgrades the request.
 */
export function behindSubjectColors(stats: RegionStats, roles: {primary_text: string; panel: string}): {color: string; strokeColor?: string} | null {
  const over = textOverFootage({textColor: roles.primary_text, panelColor: roles.panel, stats, large: true});
  if (over.panel) {
    return null;
  }
  return {color: over.textColor, ...(over.strokeColor ? {strokeColor: over.strokeColor} : {})};
}
