import {describe, expect, it} from 'vitest';

import {missingPythonModule} from './captionKitBurn.ts';

describe('missingPythonModule', () => {
  it('detects fontTools and PIL import failures', () => {
    expect(
      missingPythonModule("ModuleNotFoundError: No module named 'fontTools'"),
    ).toBe('fontTools');
    expect(missingPythonModule("No module named 'PIL'")).toBe('PIL');
  });
  it('ignores other failures', () => {
    expect(missingPythonModule('ffmpeg exited 1')).toBeNull();
  });
});
