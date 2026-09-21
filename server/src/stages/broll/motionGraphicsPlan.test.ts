import {describe, expect, it} from 'vitest';

import {
  fallbackMotionPlan,
  parseMotionPlanFromDirector,
  parseSpokenMagnitude,
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
    expect(
      (plan.motionGraphics[0]?.end ?? 0) - (plan.motionGraphics[0]?.start ?? 0),
    ).toBeGreaterThanOrEqual(1.7);
    expect(plan.mediaContainers[0]?.mode).toBe('card');
    expect(plan.semanticEmphasis[0]?.text).toBe('90k');
  });

  it('fills fallback motion when director omits graphics', () => {
    const plan = fallbackMotionPlan({
      transcript: 'In 5 weeks we launch the product for a 50B audience',
      durationSec: 24,
      hookTitle: 'LAUNCH SOON',
    });
    expect(plan.motionGraphics.length).toBeGreaterThan(0);
    expect(plan.mediaContainers).toEqual([]);
    expect(plan.semanticEmphasis.some(item => item.treatment === 'count')).toBe(true);
    const counter = plan.semanticEmphasis.find(item => item.treatment === 'count');
    expect(counter?.countFrom).toBe(35);
    expect(counter?.countTo).toBe(50);
  });

  it('does not invent a media container when the director omitted one', () => {
    const plan = parseMotionPlanFromDirector(
      {
        motion_graphics: [
          {
            start: 4,
            end: 6,
            text: 'KEEP MOVING',
            role: 'primary',
            entrance: 'spring_up',
          },
        ],
      },
      24,
      'Keep moving through the quiet moments',
    );
    expect(plan.mediaContainers).toEqual([]);
  });

  it('parses a frame inset margin from director JSON', () => {
    const plan = parseMotionPlanFromDirector(
      {
        motion_graphics: [
          {
            start: 4,
            end: 6,
            text: 'HOLD THIS',
            role: 'primary',
            entrance: 'spring_up',
          },
        ],
        frame_insets: [
          {
            start: 7,
            end: 12,
            scale: 0.82,
            margin_color: '#111111',
          },
        ],
      },
      24,
      'Hold this thought for a second',
    );
    expect(plan.frameInsets).toHaveLength(1);
    expect(plan.frameInsets[0]?.scale).toBeCloseTo(0.82);
    expect(plan.frameInsets[0]?.marginColor).toBe('#111111');
  });

  it('parses a spoken magnitude into a counter range without inventing the target', () => {
    const parsed = parseSpokenMagnitude('50 billion');
    expect(parsed?.countTo).toBe(50);
    expect(parsed?.countFrom).toBeLessThan(50);
    expect(parsed?.suffix.toLowerCase()).toMatch(/billion/);
  });

  it('starts a 50B counter near 35 and keeps the spoken suffix', () => {
    const parsed = parseSpokenMagnitude('50B');
    expect(parsed).toEqual({countFrom: 35, countTo: 50, suffix: 'B'});
  });
});
