/** I/O glue: the selected CaptionKit preset id -> the Kinetic identity (pure mapping lives in stages/kinetic/presetIdentity.ts). */
import {loadCaptionKitPresetDefinition} from './captionKitPresets.ts';
import {deriveKineticIdentity, type KineticIdentity} from '../stages/kinetic/presetIdentity.ts';

export function resolveKineticIdentity(presetId: string | undefined, warnings: string[]): KineticIdentity | undefined {
  const id = (presetId ?? '').trim();
  if (!id) return undefined;
  let def;
  try { def = loadCaptionKitPresetDefinition(id); } catch { def = null; }
  if (!def) { warnings.push(`kinetic_engine:identity_unknown_preset:${id}`); return undefined; }
  const identity = deriveKineticIdentity(def);
  warnings.push(`kinetic_engine:identity:${identity.presetId}:font=${identity.font}${identity.mapping.exact ? '' : '(nearest)'}:text=${identity.text}:accent=${identity.accent}:case=${identity.upper === null ? 'kinetic' : identity.upper ? 'upper' : 'lower'}`);
  for (const l of identity.limitations) warnings.push(`kinetic_engine:identity_limit:${l}`);
  return identity;
}
