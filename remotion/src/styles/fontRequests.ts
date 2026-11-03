/**
 * WP4Q: what each caption font family asks the Google Fonts loader for. Pure (no imports).
 *
 * Calling `loadFont()` with no style, weights or subsets makes @remotion/google-fonts fetch EVERY file of the family (all styles, all weights, all subsets), and each file holds a render
 * handle for up to 60 seconds. The product needs far less:
 *  - style `normal` (nothing draws italic captions);
 *  - the weights `fontWeightFor` can return (400, 700, 800), limited to what the family ships: asking for a weight or subset the family's metadata does not list THROWS, and the guard in
 *    fonts.ts then drops the whole family, so a family never requests one it does not have;
 *  - the `latin` subset (captions are romanized to Latin letters upstream; Spanish accents are Latin). Noto Sans Tamil also gets `tamil`, the script it exists for.
 * A test checks every entry against the installed metadata (`getInfo()` of each family).
 */
export const CAPTION_FONT_STYLE = 'normal' as const;

/** The weights `fontWeightFor` can return. */
export const CAPTION_FONT_WEIGHTS = ['400', '700', '800'] as const;

export type FontRequest = {weights: readonly string[]; subsets: readonly string[]};

export const CAPTION_FONT_REQUESTS = {
  anton: {weights: ['400'], subsets: ['latin']},
  bebas: {weights: ['400'], subsets: ['latin']},
  inter: {weights: ['400', '700', '800'], subsets: ['latin']},
  manrope: {weights: ['400', '700', '800'], subsets: ['latin']},
  tamil: {weights: ['400', '700', '800'], subsets: ['tamil', 'latin']},
  oswald: {weights: ['400', '700'], subsets: ['latin']},
  playfair: {weights: ['400', '700', '800'], subsets: ['latin']},
  poppins: {weights: ['400', '700', '800'], subsets: ['latin']},
  spaceGrotesk: {weights: ['400', '700'], subsets: ['latin']},
} as const satisfies Record<string, FontRequest>;

export type CaptionFontKey = keyof typeof CAPTION_FONT_REQUESTS;
