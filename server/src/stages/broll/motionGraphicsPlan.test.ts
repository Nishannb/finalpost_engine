import {describe, expect, it} from 'vitest';

import {
  fallbackMotionPlan,
  parseMotionPlanFromDirector,
} from './motionGraphicsPlan.ts';

describe('motionGraphicsPlan', () => {
  it('parses creative motion graphics from director JSON', () => {
    const plan = parseMotionPlanFromDirector(
      {
        motion_graphics: [
          {
            start: 4.2,
            end: 6.0,
            text: 'RUN THE NUMBERS',
            role: 'primary',
            shape: 'block',
            entrance: 'scale_pop',
            accent_color: '#22D3EE',
            text_color: '#FFFFFF',
            anchor: 'center',
            italic: true,
          },
        ],
        media_containers: [
          {
            start: 8,
            end: 12,
            mode: 'card',
            canvas_color: '#FFFFFF',
            scale: 0.72,
            canvas_title: 'how much',
          },
        ],
        semantic_emphasis: [
          {
            start: 10,
            end: 11.5,
            text: '90k',
            weight: 'primary',
            treatment: 'pop',
            accent_color: '#FACC15',
          },
        ],
      },
      30,
      'Now you are running the numbers toward 90k',
    );

    expect(plan.motionGraphics[0]?.text).toBe('RUN THE NUMBERS');
    expect(plan.motionGraphics[0]?.entrance).toBe('scale_pop');
    expect(plan.mediaContainers[0]?.mode).toBe('card');
    expect(plan.semanticEmphasis[0]?.text).toBe('90k');
  });

  it('fills fallback motion when director omits graphics', () => {
    const plan = fallbackMotionPlan({
      transcript: 'In 5 weeks we launch the product for everyone watching',
      durationSec: 24,
      hookTitle: 'LAUNCH SOON',
    });
    expect(plan.motionGraphics.length).toBeGreaterThan(0);
    expect(plan.mediaContainers.length).toBeGreaterThan(0);
    expect(plan.semanticEmphasis.some(item => /5/.test(item.text))).toBe(true);
  });
});
