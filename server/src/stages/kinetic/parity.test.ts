/** The zod contracts are duplicated for Lambda (like the blueprint zod). This pins the two copies together. */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {storyboardProps} from './storyboard.ts';
import {PRESET_NAMES} from './schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
const remotion = join(here, '../../../../remotion/src');

describe('kinetic duplication parity', () => {
  it('remotion/src/kinetic/spec.ts is byte-identical to schema.ts', () => {
    expect(readFileSync(join(remotion, 'kinetic/spec.ts'), 'utf8')).toBe(readFileSync(join(here, 'schema.ts'), 'utf8'));
  });
  it('every preset name has a Remotion component and a registry entry', () => {
    const presets = readFileSync(join(remotion, 'kinetic/presets.tsx'), 'utf8');
    for (const n of PRESET_NAMES) expect(presets).toContain(`'${n}':`);
  });
  it('the checked-in storyboard spec equals what the solver produces now (rerun `cli.ts storyboard` if this fails)', () => {
    const checkedIn = JSON.parse(readFileSync(join(remotion, 'kinetic/storyboard.spec.json'), 'utf8'));
    expect(checkedIn).toEqual(JSON.parse(JSON.stringify(storyboardProps())));
  });
  it('heroSweep stays byte-identical (kinetic reuses shortsSafeRect and does not edit it)', () => {
    expect(readFileSync(join(remotion, 'motion/heroSweep.ts'), 'utf8')).toBe(readFileSync(join(here, '../broll/heroSweep.ts'), 'utf8'));
  });
});
