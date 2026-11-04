/** What placement needs to know about a bed. Measured on the bed itself by postprocess v4 (never the arc that was requested). All times are bed seconds. */
export type BedPlacementMeta = {
  /** Bar lines (downbeats) in the full bed. */
  downbeatTimes: number[];
  /** Per-bar energy, 0..1, one value per bar starting at each downbeat. */
  energyMap: number[];
  /** Where the music audibly lifts (beat precision), and the bar it was found in. Null when the bed never lifts. */
  liftSec: number | null;
  liftBar: number | null;
  /** Median bar length. */
  barSec: number | null;
  /** Length of the full bed file. */
  fullDurationSec: number | null;
  /** The bar-aligned loop body that follows the full bed on a long timeline. */
  hasLoop: boolean;
  loopDurationSec: number | null;
  loopBars: number | null;
};
