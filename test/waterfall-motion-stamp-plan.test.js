import { describe, it, expect } from 'vitest';
import { planVehicleWaterfallStamps } from '../src/simulation.js';

describe('planVehicleWaterfallStamps', () => {
  const halfWidth = 4;
  const peak = 0.22;

  it('returns several overlapping stamps for typical along-fiber motion', () => {
    const plan = planVehicleWaterfallStamps(120, 120.85, 1.7, 0.85, halfWidth, peak);
    expect(plan.kind).toBe('blend');
    expect(plan.stamps.length).toBeGreaterThanOrEqual(2);
    expect(plan.stamps.length).toBeLessThanOrEqual(7);
    const sumStr = plan.stamps.reduce((s, x) => s + x.strength, 0);
    expect(sumStr).toBeGreaterThan(peak * 1.5);
  });

  it('falls back to one stamp when motion span is implausible', () => {
    const plan = planVehicleWaterfallStamps(120, 145, 4, 25, halfWidth, peak);
    expect(plan.kind).toBe('one');
    expect(plan.pos).toBe(145);
    expect(plan.strength).toBe(peak);
  });

  it('matches glitch guard from isFiberMappingGlitch', () => {
    const plan = planVehicleWaterfallStamps(10, 900, 6, 890, halfWidth, peak);
    expect(plan.kind).toBe('one');
    expect(plan.pos).toBe(900);
  });
});
