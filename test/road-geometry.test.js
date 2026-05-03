import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildRoadMotionModel, nearestPointOnLanes } from '../src/road-geometry.js';

const DATA_DIR = path.resolve(import.meta.dirname, '..', 'data');

describe('nearestPointOnLanes', () => {
  const channels = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'fiber_channels.json'), 'utf-8'));
  const road = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'road.geojson'), 'utf-8'));
  const motion = buildRoadMotionModel(road, channels);
  const laneEb = motion.lanes.eb;
  const laneWb = motion.lanes.wb;

  it('returns a snap on EB or WB within road length', () => {
    if (!laneEb || !laneWb) {
      expect(laneEb || laneWb).toBeTruthy();
      return;
    }
    const mid = laneEb.points[Math.floor(laneEb.points.length / 2)];
    const snap = nearestPointOnLanes(laneEb, laneWb, mid[0], mid[1]);
    expect(snap).not.toBeNull();
    expect(snap.distanceM).toBeLessThan(5);
    const lane = snap.laneKey === 'eb' ? laneEb : laneWb;
    expect(snap.roadDistM).toBeGreaterThanOrEqual(0);
    expect(snap.roadDistM).toBeLessThanOrEqual(lane.totalM + 1);
  });
});
