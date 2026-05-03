import { describe, it, expect } from 'vitest';
import {
  idmAccelerationMps2,
  buildLaneFollowContext,
  clampFollowerCenterBehindLeader,
  stepVehicleIdm,
  vehicleLengthM,
  DEFAULT_IDM,
} from '../src/traffic-follow.js';

describe('traffic-follow', () => {
  it('vehicleLengthM orders semi larger than car', () => {
    expect(vehicleLengthM('semi_truck')).toBeGreaterThan(vehicleLengthM('car'));
  });

  it('idmAccelerationMps2 is negative when gap is too small', () => {
    const acc = idmAccelerationMps2(20 * 0.44704, 0, -2, 30 * 0.44704, DEFAULT_IDM);
    expect(acc).toBeLessThan(0);
  });

  it('idmAccelerationMps2 approaches free flow when gap is huge', () => {
    const v = 10 * 0.44704;
    const acc = idmAccelerationMps2(v, 0, Infinity, 30 * 0.44704, DEFAULT_IDM);
    expect(acc).toBeGreaterThan(0);
  });

  it('buildLaneFollowContext assigns leader along increasing roadDist when fwd is +1', () => {
    const vehicles = [
      { roadDistM: 100, vehicleType: 'car', speedMph: 30 },
      { roadDistM: 200, vehicleType: 'car', speedMph: 25 },
    ];
    const ctx = buildLaneFollowContext(vehicles, [0, 1], 1);
    expect(ctx.get(0).leaderIndex).toBe(1);
    expect(ctx.get(0).gapM).toBeGreaterThan(0);
    expect(ctx.get(1).leaderIndex).toBeNull();
  });

  it('buildLaneFollowContext assigns leader along decreasing roadDist when fwd is -1', () => {
    const vehicles = [
      { roadDistM: 100, vehicleType: 'car', speedMph: 30 },
      { roadDistM: 200, vehicleType: 'car', speedMph: 25 },
    ];
    const ctx = buildLaneFollowContext(vehicles, [0, 1], -1);
    expect(ctx.get(1).leaderIndex).toBe(0);
    expect(ctx.get(0).leaderIndex).toBeNull();
  });

  it('clampFollowerCenterBehindLeader prevents overlap for fwd +1', () => {
    const s = clampFollowerCenterBehindLeader(150, 'car', 100, 'car', 1, 0.5);
    expect(s).toBeLessThanOrEqual(95);
    expect(s).toBeGreaterThan(94);
  });

  it('stepVehicleIdm does not move vehicle when userLock', () => {
    const v = {
      roadDistM: 500,
      speedMph: 40,
      vehicleType: 'car',
      userLock: true,
    };
    stepVehicleIdm(v, null, 50, 80, 1, 0.1);
    expect(v.roadDistM).toBe(500);
    expect(v.speedMph).toBe(0);
  });

  it('stepVehicleIdm accelerates toward free speed with no leader', () => {
    const v = {
      roadDistM: 0,
      speedMph: 0,
      vehicleType: 'car',
      userLock: false,
    };
    for (let t = 0; t < 120; t++) {
      stepVehicleIdm(v, null, 40, 80, 1, 0.1);
    }
    expect(v.speedMph).toBeGreaterThan(35);
    expect(v.roadDistM).toBeGreaterThan(10);
  });
});
