/**
 * Preset registry: the catalog the director picks BY NAME. Each preset is data: which roles it renders, default layering / anchor / region, font roles, fill recipe, material and entrance.
 * The solver reads this; the Remotion compositor has a component per name (remotion/src/kinetic/presets.tsx). To add a preset: add the name to schema.ts PRESET_NAMES, an entry here, a component there.
 */
import type {AnchorKind, FontKey, Layering, LineRole, PresetName, RegionHint} from './schema.ts';
import {PRESET_NAMES} from './schema.ts';

export type FillRecipe = 'solid' | 'gradient' | 'gold' | 'chrome';
export type Entrance = 'blurFade' | 'slide' | 'perLetter' | 'rise' | 'streak' | 'pop' | 'none';
export type LineStyle = {font: FontKey | 'brandHero' | 'brandSupport' | 'brandCaption' | 'brandSerif'; italic?: boolean; weight: number; fill: FillRecipe; tone: 'ink' | 'paper' | 'accent' | 'accent2'; uppercase?: boolean; letterSpacingEm?: number; sizeRatio: number};

export type PresetDef = {
  name: PresetName;
  layering: Layering;
  anchor: Exclude<AnchorKind, 'auto'>;
  region: Exclude<RegionHint, 'auto'>;
  /** which role is the "hero" the occlusion rule applies to ('none' = caption-only presets) */
  hasHero: boolean;
  material: 'flat' | 'glossy3d' | 'glow';
  entrance: Entrance;
  /** preset needs @remotion/three (flat presets stay DOM/CSS) */
  uses3d: boolean;
  /** tilt of the block, degrees (static; keyframes may ease in) */
  rotateX: number;
  rotateY: number;
  depthBlurPx: number;
  styles: Partial<Record<LineRole, LineStyle>>;
  /** the line count the director should give (min..max) */
  lines: [number, number];
};

const hero = (o: Partial<LineStyle> = {}): LineStyle => ({font: 'brandHero', weight: 400, fill: 'solid', tone: 'paper', uppercase: true, sizeRatio: 1, ...o});
const support = (o: Partial<LineStyle> = {}): LineStyle => ({font: 'brandSupport', weight: 600, fill: 'solid', tone: 'paper', sizeRatio: 0.3, ...o});
const caption = (o: Partial<LineStyle> = {}): LineStyle => ({font: 'brandCaption', weight: 400, fill: 'solid', tone: 'paper', sizeRatio: 0.2, ...o});

const base = {hasHero: true, material: 'flat' as const, entrance: 'blurFade' as Entrance, uses3d: false, rotateX: 0, rotateY: 0, depthBlurPx: 0, anchor: 'screen' as const, lines: [1, 3] as [number, number]};

export const PRESETS: Record<PresetName, PresetDef> = {

  'stack.serifHero.behind': {...base, name: 'stack.serifHero.behind', layering: 'behind', region: 'upperCenter', anchor: 'background', styles: {support: support({font: 'poppins', weight: 500, sizeRatio: 0.22}), hero: hero({font: 'playfairItalic', italic: true, weight: 400, uppercase: false, sizeRatio: 1})}},
  'stack.mixed.between': {...base, name: 'stack.mixed.between', layering: 'auto', region: 'betweenSubjects', entrance: 'slide', lines: [3, 4], styles: {support: support({font: 'poppins', weight: 500, sizeRatio: 0.2}), hero: hero({font: 'brandHero', tone: 'accent', sizeRatio: 0.8})}},
  'plane3d.receding.swap': {...base, name: 'plane3d.receding.swap', layering: 'behind', region: 'upperLeft', anchor: 'plane:wall', rotateY: -32, rotateX: 8, depthBlurPx: 2, lines: [2, 3], styles: {support: support({font: 'poppins', weight: 600, sizeRatio: 0.5}), hero: hero({font: 'poppins', weight: 700, uppercase: true, sizeRatio: 1})}},
  'hero.thinSerif.front': {...base, name: 'hero.thinSerif.front', layering: 'front', region: 'lowerCenter', lines: [1, 2], styles: {hero: hero({font: 'playfair', weight: 400, uppercase: false, sizeRatio: 1}), support: support({font: 'poppins', weight: 500, sizeRatio: 0.18})}},
  'fallback.boldCenter.front': {...base, name: 'fallback.boldCenter.front', layering: 'front', region: 'lowerCenter', entrance: 'pop', lines: [1, 2], styles: {hero: hero({font: 'brandSupport', weight: 800, uppercase: true, sizeRatio: 1, letterSpacingEm: -0.02}), support: support({sizeRatio: 0.5}), caption: caption({font: 'brandSupport', weight: 700, sizeRatio: 0.5})}},
  'hero.gradientWord.behind': {...base, name: 'hero.gradientWord.behind', layering: 'behind', region: 'upperCenter', styles: {hero: hero({font: 'brandHero', fill: 'gradient', tone: 'accent', sizeRatio: 1}), support: support({sizeRatio: 0.2})}},
  'stack.twoCluster.behind': {...base, name: 'stack.twoCluster.behind', layering: 'behind', region: 'upperCenter', lines: [2, 4], styles: {hero: hero({font: 'playfairItalic', italic: true, uppercase: false, sizeRatio: 0.9}), support: support({font: 'poppins', weight: 500, sizeRatio: 0.28})}},
  'hero.perLetter.behind': {...base, name: 'hero.perLetter.behind', layering: 'behind', region: 'upperCenter', entrance: 'perLetter', lines: [1, 1], styles: {hero: hero({font: 'brandHero', sizeRatio: 1})}},
  'hero.goldGlow.behind': {...base, name: 'hero.goldGlow.behind', layering: 'behind', region: 'upperCenter', material: 'glow', lines: [1, 2], styles: {hero: hero({font: 'brandHero', fill: 'gold', sizeRatio: 1}), support: support({sizeRatio: 0.2})}},
  'hero.swapStreak': {...base, name: 'hero.swapStreak', layering: 'auto', region: 'upperCenter', entrance: 'streak', lines: [2, 2], styles: {support: support({font: 'poppins', weight: 500, sizeRatio: 0.3}), hero: hero({font: 'brandHero', fill: 'gradient', tone: 'accent2', sizeRatio: 1})}},
  'caption.serif.lower': {...base, name: 'caption.serif.lower', layering: 'front', region: 'lowerCenter', hasHero: false, entrance: 'blurFade', lines: [1, 2], styles: {caption: caption({font: 'playfair', weight: 400, sizeRatio: 1}), support: caption({font: 'playfair', weight: 400, sizeRatio: 1})}},
  'hero.extruded3d.rise': {...base, name: 'hero.extruded3d.rise', layering: 'behind', region: 'upperCenter', anchor: 'plane:floor', material: 'glossy3d', uses3d: true, entrance: 'rise', rotateX: -18, lines: [1, 1], styles: {hero: hero({font: 'brandHero', fill: 'chrome', tone: 'accent', sizeRatio: 1})}},
  'hero.extruded3d.worldAnchored': {...base, name: 'hero.extruded3d.worldAnchored', layering: 'behind', region: 'upperCenter', anchor: 'plane:wall', material: 'glossy3d', uses3d: true, entrance: 'blurFade', rotateY: -14, lines: [1, 1], styles: {hero: hero({font: 'brandHero', fill: 'chrome', tone: 'accent', sizeRatio: 1})}},
  'hero.gradientWord.sequence': {...base, name: 'hero.gradientWord.sequence', layering: 'auto', region: 'upperCenter', entrance: 'none', lines: [1, 1], styles: {hero: hero({font: 'brandHero', fill: 'gradient', tone: 'accent', sizeRatio: 1})}},
  'hero.extrudedStack.front': {...base, name: 'hero.extrudedStack.front', layering: 'front', region: 'lowerCenter', material: 'glossy3d', entrance: 'pop', lines: [2, 3], styles: {hero: hero({font: 'brandSupport', weight: 900, fill: 'solid', tone: 'accent', sizeRatio: 1}), support: support({font: 'brandSupport', weight: 900, tone: 'paper', sizeRatio: 0.8})}},
  'stack.condensedHero.behind': {...base, name: 'stack.condensedHero.behind', layering: 'behind', region: 'upperCenter', anchor: 'background', lines: [2, 3], styles: {hero: hero({font: 'brandHero', tone: 'accent', sizeRatio: 1}), support: support({font: 'brandSupport', weight: 800, uppercase: true, sizeRatio: 0.3})}},
  'hero.chromatic.mid': {...base, name: 'hero.chromatic.mid', layering: 'auto', region: 'upperCenter', lines: [3, 3], styles: {support: support({font: 'brandHero', weight: 400, uppercase: true, sizeRatio: 0.7}), hero: hero({font: 'brandHero', fill: 'gradient', tone: 'accent2', sizeRatio: 1})}},
  /** MOTION-PLAYBOOK default: solved by playbook.ts (style + roles + zones + per-word motion); `styles` is unused */
  'type.words': {...base, name: 'type.words', layering: 'front', region: 'running', entrance: 'none', lines: [1, 6], styles: {}},
  /** MATCH CUT: full-frame TypeTextMatchCut owned by matchCut.ts; no hero (no occlusion), never behind the matte. `styles` is unused. */
  'type.matchCut': {...base, name: 'type.matchCut', layering: 'front', region: 'running', hasHero: false, entrance: 'none', lines: [1, 1], styles: {}},
  'stack.twoHero.depth': {...base, name: 'stack.twoHero.depth', layering: 'auto', region: 'upperCenter', lines: [2, 2], styles: {hero: hero({font: 'brandHero', tone: 'paper', sizeRatio: 1}), support: hero({font: 'brandHero', tone: 'paper', sizeRatio: 0.92})}},
};

export const presetNames = (): PresetName[] => Object.keys(PRESETS) as PresetName[];
export const isKnownPreset = (name: string): name is PresetName => (PRESET_NAMES as readonly string[]).includes(name);
export const presetDef = (name: PresetName): PresetDef => PRESETS[name];

/** Closest registered preset for an unknown / custom treatment: by keywords in the description, else the bold centre. */
export function closestPreset(description: string, requested?: string): PresetName {
  if (requested && isKnownPreset(requested)) return requested;
  const d = description.toLowerCase();
  const pairs: Array<[RegExp, PresetName]> = [
    [/3d|extrud|glossy|metal/, 'hero.extruded3d.rise'],
    [/gold|glow|neon/, 'hero.goldGlow.behind'],
    [/gradient|chrom|rainbow/, 'hero.gradientWord.behind'],
    [/serif|elegant|\bthin\b/, 'hero.thinSerif.front'],
    [/caption|subtitle|lower/, 'caption.serif.lower'],
    [/letter/, 'hero.perLetter.behind'],
    [/swap|replace/, 'hero.swapStreak'],
    [/behind|depth/, 'stack.condensedHero.behind'],
  ];
  return pairs.find(([re]) => re.test(d))?.[1] ?? 'fallback.boldCenter.front';
}
