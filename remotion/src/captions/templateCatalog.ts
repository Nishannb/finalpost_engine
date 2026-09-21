/**
 * Dropdown catalog for the app UI. Keep ids in sync with
 * `src/lib/captionTemplateCatalog.ts` on the mobile client.
 */

import type {
  CaptionTemplateCatalogItem,
  DynamicCaptionTemplateId,
} from './types';

export const CAPTION_TEMPLATE_CATALOG: CaptionTemplateCatalogItem[] = [
  {id: 'basic', label: 'Basic', hint: 'No animation, just clear text', family: 'theme'},
  {id: 'moving-pill', label: 'Moving pill', hint: 'Pill tracks the active word', family: 'utility'},
  {id: 'pop', label: 'Pop', hint: 'Clean popup with scale and bounce', family: 'theme'},
  {id: 'karaoke', label: 'Karaoke', hint: 'Fill sweep on the spoken word', family: 'theme'},
  {id: 'hustle', label: 'Hustle', hint: 'Fast kinetic bounce', family: 'theme'},
  {id: 'grape', label: 'Grape', hint: 'Rounded purple boxed captions', family: 'theme'},
  {id: 'beast', label: 'Beast', hint: 'Bold yellow slap, thick outline', family: 'theme'},
  {id: 'poppin', label: 'Poppin', hint: 'Vibrant uppercase Poppins', family: 'theme'},
  {id: 'aarit', label: 'Aarit', hint: 'Letter-by-letter zoom and sweep', family: 'theme'},
  {id: 'soft-ai', label: 'Soft AI', hint: 'Frosted glass blur-in type', family: 'theme'},
  {id: 'gaming-stream', label: 'Gaming', hint: 'Neon glow stream type', family: 'theme'},
  {id: 'simple-one-word', label: 'One word', hint: 'Single-word focal highlight', family: 'theme'},
  {id: 'kinetic-01', label: 'Kinetic', hint: 'Main word plus side-word layout', family: 'theme'},
  {id: 'kinetic-slam', label: 'Kinetic slam', hint: 'One word, full-screen slam', family: 'utility'},
  {id: 'weight-shift', label: 'Weight shift', hint: 'Active word carries the weight', family: 'utility'},
  {id: 'editorial-emphasis', label: 'Editorial', hint: 'Line rises, underline on the word', family: 'utility'},
];

export const DEFAULT_CAPTION_TEMPLATE: DynamicCaptionTemplateId = 'karaoke';

export function isDynamicCaptionTemplateId(
  raw: string | null | undefined,
): raw is DynamicCaptionTemplateId {
  return CAPTION_TEMPLATE_CATALOG.some(item => item.id === raw);
}
