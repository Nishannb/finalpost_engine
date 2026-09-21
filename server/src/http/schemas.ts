/**
 * Request validation. Every route parses its body through zod so a malformed
 * client can never reach a paid upstream call.
 */

import {z} from 'zod';

import {
  CAPTION_TEMPLATES,
  LAYOUT_STYLES,
  SUPPORTED_LANGUAGES,
  type RenderStyle,
} from '../types/blueprint.ts';

const httpUrl = z
  .string()
  .trim()
  .min(1)
  .refine(
    value => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:';
      } catch {
        return false;
      }
    },
    {message: 'videoUrl must be an http(s) URL'},
  );

export const analyzeRequestSchema = z.object({
  videoUrl: httpUrl,
  languageCode: z.enum(SUPPORTED_LANGUAGES),
  /** Only honoured for service-key callers; JWT callers use their own `sub`. */
  userId: z.string().trim().min(1).max(128).optional(),
  /** Set false to force a fresh analysis instead of reusing a cached blueprint. */
  useCache: z.boolean().optional().default(true),
  /** Basename of a .cube in ai-video-engine/luts (e.g. CELLULOID_01_FU_LOW). */
  colorGradeLut: z.string().trim().max(120).optional().default(''),
  /** Optional Kinmel template recipe constraints for the director. */
  styleRecipe: z.record(z.string(), z.unknown()).optional(),
  /**
   * Optional creator-supplied B-roll URLs (already on R2 / HTTPS).
   * Director studies them and places matching clips into the edit.
   */
  userBrollUrls: z.array(httpUrl).max(12).optional().default([]),
  /** Learned caption look from the creator's profile reference video. */
  captionStyleGuide: z.record(z.string(), z.unknown()).optional(),
  /** Force speaker-over-B-roll so the cutout path can be tested. */
  forceSpeakerCutout: z.boolean().optional().default(false),
  /** Free multi-stage director (perception + story + creative + compiler). */
  directorV2: z.boolean().optional().default(false),
  /** Opt-in north-star compositor (implies Director v2). */
  northStar: z.boolean().optional().default(false),
  /** Allowlist of edit toolkits (cutaway, depth_overlay, inset_reveal, …). Omit = lean captions pipeline. Pass `all` for every toolkit. */
  requestedEdits: z.array(z.string().trim().min(1).max(40)).max(24).optional(),
  /** Caption kinetic template the Director should honor. */
  captionTemplate: z.enum(CAPTION_TEMPLATES).optional(),
});

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

export const extractStyleRequestSchema = z.object({
  videoUrl: httpUrl,
});

export type ExtractStyleRequest = z.infer<typeof extractStyleRequestSchema>;

export const seedanceEditRequestSchema = z.object({
  videoUrl: httpUrl,
  styleRecipe: z.record(z.string(), z.unknown()),
  styleReferenceVideoUrl: httpUrl.optional().nullable(),
});

export type SeedanceEditRequest = z.infer<typeof seedanceEditRequestSchema>;

export const renderStyleSchema = z.object({
  captionTemplate: z.enum(CAPTION_TEMPLATES).default('clean'),
  layoutStyle: z.enum(LAYOUT_STYLES).default('fullscreen'),
  captionBottomFrac: z.number().min(0.02).max(0.9).default(0.22),
  captionCenterXFrac: z.number().min(0.1).max(0.9).default(0.5),
  brollEnabled: z.boolean().default(true),
  zoomEnabled: z.boolean().default(true),
  trimEnabled: z.boolean().default(true),
  colorGradeLut: z.string().trim().max(120).optional().default(''),
});

/** Style the app gets when it sends nothing: the preview's own defaults. */
export const DEFAULT_RENDER_STYLE: RenderStyle = renderStyleSchema.parse({});

export const renderRequestSchema = z.object({
  blueprintId: z.string().trim().min(1).max(64),
  style: renderStyleSchema.default(DEFAULT_RENDER_STYLE),
  userId: z.string().trim().min(1).max(128).optional(),
});

export type RenderRequest = z.infer<typeof renderRequestSchema>;
