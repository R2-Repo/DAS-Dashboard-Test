import { describe, it, expect } from 'vitest';
import { waterfallStitchSpanBudget } from '../src/simulation.js';

describe('waterfallStitchSpanBudget', () => {
  it('allows large-but-plausible per-tick fiber motion (steep road→channel stretches)', () => {
    const skew = 0.58;
    const hw = 4;
    const modest = waterfallStitchSpanBudget(175, hw, skew);
    expect(modest).toBeGreaterThan(160);
    expect(modest).toBeLessThanOrEqual(380);
  });

  it('caps pathological jumps that would paint unrelated mileposts', () => {
    const skew = 0.58;
    const hw = 4;
    expect(waterfallStitchSpanBudget(9000, hw, skew)).toBe(380);
  });

  it('respects a minimum slack footprint even when motion is zero', () => {
    expect(waterfallStitchSpanBudget(0, 4, 0)).toBeGreaterThanOrEqual(24);
  });
});
