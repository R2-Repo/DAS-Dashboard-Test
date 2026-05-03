import { describe, it, expect } from 'vitest';
import {
  clampChannelPosToFiber,
  nearestPointOnLanes,
  nearestPointOnLanesPrefer,
} from '../src/road-geometry.js';

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

function minimalLane(pts) {
  const cumDistM = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = (pts[i][0] - pts[i - 1][0]) * 111320 * Math.cos((pts[i][1] * Math.PI) / 180);
    const dy = (pts[i][1] - pts[i - 1][1]) * 111320;
    cumDistM.push(cumDistM[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  return { points: pts, cumDistM };
}

describe('nearestPointOnLanesPrefer', () => {
  it('forces EB when requested even if WB is closer', () => {
    const laneEb = minimalLane([
      [-111.8, 40.62],
      [-111.78, 40.63],
    ]);
    const laneWb = minimalLane([
      [-111.8, 40.619],
      [-111.78, 40.629],
    ]);
    const lon = -111.79;
    const lat = 40.6192;
    const auto = nearestPointOnLanes(laneEb, laneWb, lon, lat);
    expect(auto?.laneKey).toBe('wb');
    const forced = nearestPointOnLanesPrefer(laneEb, laneWb, lon, lat, 'eb');
    expect(forced?.laneKey).toBe('eb');
    expect(Math.abs(forced.distanceM - auto.distanceM)).toBeGreaterThan(1);
  });

  it('auto matches nearestPointOnLanes', () => {
    const laneEb = minimalLane([
      [-111.8, 40.62],
      [-111.78, 40.63],
    ]);
    const laneWb = minimalLane([
      [-111.8, 40.6],
      [-111.78, 40.61],
    ]);
    const lon = -111.79;
    const lat = 40.605;
    const a = nearestPointOnLanes(laneEb, laneWb, lon, lat);
    const b = nearestPointOnLanesPrefer(laneEb, laneWb, lon, lat, 'auto');
    expect(b?.laneKey).toBe(a?.laneKey);
    expect(b?.distanceM).toBeCloseTo(a.distanceM, 6);
  });
});
