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
  trailing_trimmed_sec: z.number().optional(),
  bed_loop_path: z.string().optional(),
  bed_full_path: z.string().optional(),
  bed_carved_path: z.string().optional(),
  loop_duration_sec: z.number().optional(),
  loop_fallback: z.boolean().optional(),
  qc_silence_sec: z.number().nullable().optional(),
  qc_true_peak_dbfs: z.number().nullable().optional(),
  qc_bpm_error_ratio: z.number().nullable().optional(),
  qc_seam_db: z.number().nullable().optional(),
  qc_vocal_score: z.number().nullable().optional(),
  qc_passed: z.boolean().optional(),
  qc_retried: z.boolean().optional(),
});

export type MusicResult = z.infer<typeof musicResultSchema>;
