import { describe, it, expect } from 'vitest';
import { clampChannelPosToFiber } from '../src/road-geometry.js';

describe('clampChannelPosToFiber', () => {
  it('clamps so floor is always a valid channel index', () => {
    expect(clampChannelPosToFiber(-5, 100)).toBe(0);
    expect(clampChannelPosToFiber(99.9, 100)).toBe(99.9);
    const hi = clampChannelPosToFiber(150, 100);
    expect(Math.floor(hi)).toBe(99);
    expect(hi).toBeLessThan(100);
  });

  it('handles single-channel fiber', () => {
    expect(clampChannelPosToFiber(0.5, 1)).toBe(0.5);
    const hi = clampChannelPosToFiber(2, 1);
    expect(Math.floor(hi)).toBe(0);
    expect(hi).toBeLessThan(1);
  });
});
