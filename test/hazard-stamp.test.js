import { describe, it, expect } from 'vitest';
import { stampHazardOntoRow, hazardInitialTtl, hazardSpanChannels } from '../src/hazard-stamp.js';

describe('hazard-stamp', () => {
  it('crash with more vehicles increases row peak at center', () => {
    const total = 500;
    const row1 = new Float32Array(total);
    const row3 = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      row1[i] = 0.02;
      row3[i] = 0.02;
    }
    const center = 250;
    const a1 = {
      kind: 'crash',
      startChannel: center - 5,
      endChannel: center + 5,
      intensity: 0.8,
      initialTtl: 50,
      ttl: 50,
      phase: 1,
      magnitude: 0.6,
      vehicleCount: 1,
      tickCreated: 0,
    };
    const a3 = { ...a1, vehicleCount: 3 };
    stampHazardOntoRow(row1, a1, total, 10);
    stampHazardOntoRow(row3, a3, total, 10);
    expect(row3[center]).toBeGreaterThan(row1[center]);
  });

  it('avalanche stamp is smoother than rock slide at same span', () => {
    const total = 400;
    const rowR = new Float32Array(total);
    const rowA = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      rowR[i] = 0.02;
      rowA[i] = 0.02;
    }
    const lo = 150;
    const hi = 250;
    const base = {
      startChannel: lo,
      endChannel: hi,
      intensity: 0.75,
      initialTtl: 120,
      ttl: 80,
      phase: 0.5,
      magnitude: 0.5,
      tickCreated: 0,
    };
    stampHazardOntoRow(rowR, { ...base, kind: 'rock_slide' }, total, 5);
    stampHazardOntoRow(rowA, { ...base, kind: 'avalanche' }, total, 5);
    let varR = 0;
    let varA = 0;
    for (let i = lo; i <= hi; i++) {
      const n = i - (lo + hi) / 2;
      varR += Math.abs(rowR[i] - rowR[i - 1] || 0) * Math.abs(n);
      varA += Math.abs(rowA[i] - rowA[i - 1] || 0) * Math.abs(n);
    }
    expect(varR).toBeGreaterThan(varA * 0.85);
  });

  it('hazardInitialTtl grows with magnitude', () => {
    expect(hazardInitialTtl('crash', 0.2, 1)).toBeLessThan(hazardInitialTtl('crash', 1, 1));
    expect(hazardInitialTtl('avalanche', 0.1)).toBeLessThan(hazardInitialTtl('avalanche', 1));
  });

  it('hazardSpanChannels respects cap', () => {
    const n = 10000;
    const s = hazardSpanChannels('avalanche', 1, n);
    expect(s).toBeLessThanOrEqual(Math.max(80, Math.floor(n * 0.12)));
  });
});
