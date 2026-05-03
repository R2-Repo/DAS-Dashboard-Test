import { describe, it, expect } from 'vitest';
import { collectCrossingChannelIndices } from '../src/waterfall.js';

describe('collectCrossingChannelIndices', () => {
  it('returns sorted unique indices from GeoJSON channel_id', () => {
    const channels = Array.from({ length: 100 }, (_, i) => ({
      channel_id: i,
      crossing_flag: false,
    }));
    const data = {
      channels,
      crossings: {
        features: [
          { properties: { channel_id: 10 } },
          { properties: { channel_id: 5 } },
          { properties: { channel_id: 10 } },
        ],
      },
    };
    expect(collectCrossingChannelIndices(data)).toEqual([5, 10]);
  });

  it('includes crossing_flag channels and clamps to range', () => {
    const channels = Array.from({ length: 20 }, (_, i) => ({
      channel_id: i,
      crossing_flag: i === 3 || i === 18,
    }));
    const data = {
      channels,
      crossings: { features: [{ properties: { channel_id: 99 } }] },
    };
    expect(collectCrossingChannelIndices(data)).toEqual([3, 18]);
  });

  it('handles missing crossings', () => {
    const channels = [
      { channel_id: 0, crossing_flag: true },
      { channel_id: 1, crossing_flag: false },
    ];
    expect(collectCrossingChannelIndices({ channels })).toEqual([0]);
  });
});
