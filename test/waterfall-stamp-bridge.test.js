import { describe, it, expect } from 'vitest';
import { maxWaterfallStampBridgeChannels } from '../src/simulation.js';

describe('maxWaterfallStampBridgeChannels', () => {
  it('returns a modest bound for typical vehicle motion per tick', () => {
    const m = maxWaterfallStampBridgeChannels(4, 0.62, 0.85);
    expect(m).toBeGreaterThan(22);
    expect(m).toBeLessThan(120);
  });

  it('stays far below fiber-span jumps from steep road→channel mapping', () => {
    const m = maxWaterfallStampBridgeChannels(4, 0.62, 0.85);
    expect(m).toBeLessThan(300);
  });
});
