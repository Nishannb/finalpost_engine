import {describe, expect, it} from 'vitest';

import {seamOnlyFailure} from './musicSpecialist.ts';

describe('seamOnlyFailure (a bed is kept without its loop when only the loop seam failed)', () => {
  const real = {qc_silence_sec: 0.02, qc_true_peak_dbfs: -2.181, qc_bpm_error_ratio: 0.0062, qc_seam_db: 1.516}; // 2026-11-25 aicut.mp4 bed
  it('the aicut.mp4 bed failed on the seam alone', () => expect(seamOnlyFailure(real)).toBe(true));
  it('any other failed check still refuses the bed', () => {
    expect(seamOnlyFailure({...real, qc_silence_sec: 2})).toBe(false);
    expect(seamOnlyFailure({...real, qc_true_peak_dbfs: 0})).toBe(false);
    expect(seamOnlyFailure({...real, qc_bpm_error_ratio: 0.05})).toBe(false);
    expect(seamOnlyFailure({...real, qc_seam_db: 1.2})).toBe(false);
    expect(seamOnlyFailure({...real, qc_seam_db: undefined as unknown as number})).toBe(false);
  });
});
