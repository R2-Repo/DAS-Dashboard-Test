import { describe, it, expect } from 'vitest';
import {
  bearingDegClockwiseFromNorthLonLat,
  travelBearingDegAtRoadDistance,
} from '../src/road-geometry.js';

describe('bearingDegClockwiseFromNorthLonLat', () => {
  it('returns ~0° for due north (increasing latitude)', () => {
    const d = bearingDegClockwiseFromNorthLonLat(-111.7, 40.6, -111.7, 40.65);
    const northish = d < 0.5 || d > 359.5;
    expect(northish).toBe(true);
  });

  it('returns ~90° for due east (increasing longitude at mid-latitude)', () => {
    const d = bearingDegClockwiseFromNorthLonLat(-111.75, 40.62, -111.74, 40.62);
    expect(d).toBeGreaterThan(89);
    expect(d).toBeLessThan(91);
  });

  it('returns ~180° for due south', () => {
    const d = bearingDegClockwiseFromNorthLonLat(-111.7, 40.65, -111.7, 40.6);
    expect(d).toBeGreaterThan(179);
    expect(d).toBeLessThan(181);
  });

  it('returns ~270° for due west', () => {
    const d = bearingDegClockwiseFromNorthLonLat(-111.74, 40.62, -111.75, 40.62);
    expect(d).toBeGreaterThan(269);
    expect(d).toBeLessThan(271);
  });
});

describe('travelBearingDegAtRoadDistance', () => {
  const laneEast = {
    points: [
      [-111.8, 40.6],
      [-111.79, 40.6],
    ],
    cumDistM: [0, 800],
    forwardIncreasesChannel: true,
    channelAlong: new Float32Array([0, 1]),
    curvature: new Float32Array([0, 0]),
    totalM: 800,
  };

  it('matches segment bearing for up_canyon when polyline increases channel', () => {
    const b = travelBearingDegAtRoadDistance(laneEast, 400, 'up_canyon');
    expect(b).toBeGreaterThan(89);
    expect(b).toBeLessThan(91);
  });

  it('reverses bearing for down_canyon on same polyline', () => {
    const b = travelBearingDegAtRoadDistance(laneEast, 400, 'down_canyon');
    expect(b).toBeGreaterThan(269);
    expect(b).toBeLessThan(271);
  });
});
