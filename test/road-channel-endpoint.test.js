import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  buildRoadMotionModel,
  lonLatAtRoadDistance,
  roadDistanceToChannelPos,
} from '../src/road-geometry.js';

const DATA_DIR = path.resolve(import.meta.dirname, '..', 'data');

function haversineM(lon1, lat1, lon2, lat2) {
  const rlat1 = (lat1 * Math.PI) / 180;
  const rlat2 = (lat2 * Math.PI) / 180;
  const dlat = ((lat2 - lat1) * Math.PI) / 180;
  const dlon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rlat1) * Math.cos(rlat2) * Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function exhaustiveNearestChannelIndex(channels, lon, lat) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < channels.length; i++) {
    const d = haversineM(lon, lat, channels[i].lon, channels[i].lat);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

describe('Road endpoint → fiber channel mapping', () => {
  const channels = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'fiber_channels.json'), 'utf-8'));
  const road = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'road.geojson'), 'utf-8'));
  const { lanes } = buildRoadMotionModel(road, channels);

  it('matches exhaustive nearest channel at lane arc length 0 and totalM (both lanes)', () => {
    for (const laneKey of ['eb', 'wb']) {
      const lane = lanes[laneKey];
      if (!lane || lane.totalM < 100) continue;
      for (const s of [0, lane.totalM]) {
        const [lon, lat] = lonLatAtRoadDistance(lane, s);
        const truth = exhaustiveNearestChannelIndex(channels, lon, lat);
        const mapped = Math.round(roadDistanceToChannelPos(lane, s));
        const dIdx = Math.abs(mapped - truth);
        expect(dIdx).toBeLessThanOrEqual(80);
      }
    }
  });
});
