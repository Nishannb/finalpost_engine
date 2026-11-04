import {z} from 'zod';

/** Stdout of `python -m music_specialist`. Extra keys are ignored. */
export const musicResultSchema = z.object({
  mode: z.enum(['plan', 'dry', 'live']).optional(),
  cache_key: z.string().min(16),
  seed: z.number(),
  bpm: z.number(),
  key: z.string().min(1),
  mood: z.string().optional(),
  /** Personalised generation (Phase 3). Null/absent on a family-mood plan. */
  style: z.string().nullable().optional(),
  family: z.string().optional(),
  arc: z.string().nullable().optional(),
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
  loop_bars: z.number().optional(),
  measured_bpm: z.number().nullable().optional(),
  /** Measured on the bed itself (postprocess v4). Placement uses these, never the requested arc. */
  downbeat_times: z.array(z.number()).optional(),
  energy_map: z.array(z.number()).optional(),
  lift_bar: z.number().nullable().optional(),
  lift_sec: z.number().nullable().optional(),
  bar_sec: z.number().nullable().optional(),
  qc_silence_sec: z.number().nullable().optional(),
  qc_true_peak_dbfs: z.number().nullable().optional(),
  qc_bpm_error_ratio: z.number().nullable().optional(),
  qc_seam_db: z.number().nullable().optional(),
  qc_vocal_score: z.number().nullable().optional(),
  qc_speech_band: z.object({energy_share: z.number(), flux: z.number()}).passthrough().optional(),
  qc_passed: z.boolean().optional(),
  qc_retried: z.boolean().optional(),
});

export type MusicResult = z.infer<typeof musicResultSchema>;
