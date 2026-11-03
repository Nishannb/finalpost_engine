import {z} from 'zod';

/** Stdout of `python -m music_specialist`. Extra keys are ignored. */
export const musicResultSchema = z.object({
  mode: z.enum(['plan', 'dry', 'live']).optional(),
  cache_key: z.string().min(16),
  seed: z.number(),
  bpm: z.number(),
  key: z.string().min(1),
  mood: z.string().optional(),
  caption: z.string().optional(),
  prompt_version: z.number(),
  postprocess_version: z.number().optional(),
  estimated_cost_usd: z.number().optional(),
  cost_usd: z.number().optional(),
  bed_path: z.string().optional(),
  integrated_lufs: z.number().optional(),
  duration_sec: z.number().optional(),
  bed_loop_path: z.string().optional(),
  loop_duration_sec: z.number().optional(),
  loop_fallback: z.boolean().optional(),
});

export type MusicResult = z.infer<typeof musicResultSchema>;
