import { describe, it, expect } from 'vitest';
import { isFiberMappingGlitch } from '../src/simulation.js';

describe('isFiberMappingGlitch', () => {
  const hw = 4;

  it('flags large fiber jumps with negligible along-road motion', () => {
    expect(isFiberMappingGlitch(0.5, 120, hw)).toBe(true);
    expect(isFiberMappingGlitch(2, 200, hw)).toBe(true);
  });

  it('allows plausible fiber motion for the distance driven', () => {
    expect(isFiberMappingGlitch(80, 120, hw)).toBe(false);
    expect(isFiberMappingGlitch(40, 55, hw)).toBe(false);
  });

  it('ignores small channel noise', () => {
    expect(isFiberMappingGlitch(0, 12, hw)).toBe(false);
    expect(isFiberMappingGlitch(0, 30, hw)).toBe(false);
  });
});
