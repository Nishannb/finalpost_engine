/**
 * remotion-captions-themes package ids, exposed in our catalog as `{name}-theme`
 * so they sit beside our in-house templates without colliding.
 */

export const PACKAGE_CAPTION_THEME_IDS = [
  'pop-theme',
  'karaoke-theme',
  'hustle-theme',
  'grape-theme',
  'beast-theme',
  'poppin-theme',
  'aarit-theme',
  'soft-ai-theme',
  'gaming-stream-theme',
  'simple-one-word-theme',
  'kinetic-01-theme',
] as const;

export type PackageCaptionThemeId = (typeof PACKAGE_CAPTION_THEME_IDS)[number];

/** Catalog id → package `theme` prop (without the `-theme` suffix). */
export const PACKAGE_THEME_NAME_BY_ID: Record<PackageCaptionThemeId, string> = {
  'pop-theme': 'pop',
  'karaoke-theme': 'karaoke',
  'hustle-theme': 'hustle',
  'grape-theme': 'grape',
  'beast-theme': 'beast',
  'poppin-theme': 'poppin',
  'aarit-theme': 'aarit',
  'soft-ai-theme': 'soft-ai',
  'gaming-stream-theme': 'gaming-stream',
  'simple-one-word-theme': 'simple-one-word',
  'kinetic-01-theme': 'kinetic-01',
};

export const PACKAGE_THEME_CATALOG = [
  {id: 'pop-theme', label: 'Pop theme', hint: 'Package: popup scale and bounce', family: 'theme' as const},
  {id: 'karaoke-theme', label: 'Karaoke theme', hint: 'Package: karaoke fill sweep', family: 'theme' as const},
  {id: 'hustle-theme', label: 'Hustle theme', hint: 'Package: fast kinetic bounce', family: 'theme' as const},
  {id: 'grape-theme', label: 'Grape theme', hint: 'Package: rounded boxed captions', family: 'theme' as const},
  {id: 'beast-theme', label: 'Beast theme', hint: 'Package: bold high-contrast slap', family: 'theme' as const},
  {id: 'poppin-theme', label: 'Poppin theme', hint: 'Package: uppercase Poppins', family: 'theme' as const},
  {id: 'aarit-theme', label: 'Aarit theme', hint: 'Package: letter zoom and sweep', family: 'theme' as const},
  {id: 'soft-ai-theme', label: 'Soft AI theme', hint: 'Package: frosted glass blur-in', family: 'theme' as const},
  {id: 'gaming-stream-theme', label: 'Gaming theme', hint: 'Package: neon stream type', family: 'theme' as const},
  {id: 'simple-one-word-theme', label: 'One word theme', hint: 'Package: single-word focus', family: 'theme' as const},
  {id: 'kinetic-01-theme', label: 'Kinetic theme', hint: 'Package: main + side-word layout', family: 'theme' as const},
] as const;

export function isPackageCaptionThemeId(
  raw: string | null | undefined,
): raw is PackageCaptionThemeId {
  return (
    typeof raw === 'string' &&
    Object.prototype.hasOwnProperty.call(PACKAGE_THEME_NAME_BY_ID, raw)
  );
}

export function packageThemeNameFor(
  id: PackageCaptionThemeId,
): string {
  return PACKAGE_THEME_NAME_BY_ID[id];
}
