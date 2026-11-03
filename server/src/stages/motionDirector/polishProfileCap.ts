import type {ContentProfile} from '../contentProfile/contentProfile.ts';
import {seedLimitForDuration} from './transcriptLibrarySeed.ts';

/**
 * WP8W: under polish a sparse content profile (`maxGraphics` 1) must not starve the look fill and the seeds: the profile cap is raised to the duration-scaled seed limit (the look's own cap and the
 * duration still bound the result). A profile that asks for NO graphics (`maxGraphics` 0 / `density: none`) is honoured, and a cap that is already high enough is left alone. Warning:
 * `polish_profile_cap_raised:<from>-><to>`. PURE.
 */
export function raisePolishProfileCap(profile: ContentProfile | null | undefined, outputDurationSec: number): {profile: ContentProfile | null | undefined; warning?: string} {
  if (!profile || profile.policy.maxGraphics <= 0) return {profile};
  const target = seedLimitForDuration(outputDurationSec);
  if (profile.policy.maxGraphics >= target) return {profile};
  return {profile: {...profile, policy: {...profile.policy, maxGraphics: target}}, warning: `polish_profile_cap_raised:${profile.policy.maxGraphics}->${target}`};
}