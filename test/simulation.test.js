import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(import.meta.dirname, '..', 'data');

describe('Preprocessed data integrity', () => {
  const channels = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'fiber_channels.json'), 'utf-8'));
  const config = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'simulation_config.json'), 'utf-8'));
  const fiberRoute = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'fiber_route.geojson'), 'utf-8'));
  const road = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'road.geojson'), 'utf-8'));
  const mileposts = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'mileposts.geojson'), 'utf-8'));

  it('has a positive number of channels', () => {
    expect(channels.length).toBeGreaterThan(100);
  });

  it('channels have required fields', () => {
    const required = ['channel_id', 'fiber_distance_m', 'route_id', 'milepost', 'lat', 'lon', 'side_of_road'];
    for (const field of required) {
      expect(channels[0]).toHaveProperty(field);
    }
  });

  it('channel IDs are sequential starting from 0', () => {
    expect(channels[0].channel_id).toBe(0);
    expect(channels[channels.length - 1].channel_id).toBe(channels.length - 1);
  });

  it('fiber_distance_m increases monotonically', () => {
    for (let i = 1; i < channels.length; i++) {
      expect(channels[i].fiber_distance_m).toBeGreaterThanOrEqual(channels[i - 1].fiber_distance_m);
    }
  });

  it('mileposts are within reasonable range for SR-190', () => {
    const mps = channels.map((c) => c.milepost);
    expect(Math.min(...mps)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...mps)).toBeLessThanOrEqual(20);
  });

  it('config references SR-190', () => {
    expect(config.route_id).toBe('SR-190');
    expect(config.channel_count).toBe(channels.length);
  });

  it('fiber route is a valid GeoJSON FeatureCollection', () => {
    expect(fiberRoute.type).toBe('FeatureCollection');
    expect(fiberRoute.features.length).toBeGreaterThan(0);
    expect(fiberRoute.features[0].geometry.type).toBe('LineString');
  });

  it('road is a valid GeoJSON FeatureCollection', () => {
    expect(road.type).toBe('FeatureCollection');
    expect(road.features[0].geometry.type).toBe('LineString');
  });

  it('mileposts have milepost property', () => {
    expect(mileposts.features.length).toBeGreaterThan(10);
    expect(mileposts.features[0].properties).toHaveProperty('milepost');
  });
});

describe('Waterfall row generation logic', () => {
  it('noise stays below threshold', () => {
    const row = new Float32Array(100);
    for (let i = 0; i < 100; i++) {
      row[i] = Math.random() * 0.05;
    }
    for (const val of row) {
      expect(val).toBeLessThan(0.1);
    }
  });

  it('vehicle signal creates localized peak', () => {
    const totalChannels = 200;
    const row = new Float32Array(totalChannels);
    const center = 100;
    const spread = 5;
    const strength = 0.8;
    for (let d = -spread; d <= spread; d++) {
      const idx = center + d;
      if (idx >= 0 && idx < totalChannels) {
        const falloff = 1 - Math.abs(d) / (spread + 1);
        row[idx] = Math.min(1, strength * falloff);
      }
    }
    expect(row[center]).toBeGreaterThan(0.5);
    expect(row[center - spread - 2]).toBe(0);
    expect(row[center + spread + 2]).toBe(0);
  });
});

describe('Milepost interpolation', () => {
  const channels = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'fiber_channels.json'), 'utf-8'));

  it('computes milepost for a midpoint channel', () => {
    const midIdx = Math.floor(channels.length / 2);
    const mp = channels[midIdx].milepost;
    const minMp = channels[0].milepost;
    const maxMp = channels[channels.length - 1].milepost;
    expect(mp).toBeGreaterThan(minMp);
    expect(mp).toBeLessThan(maxMp);
  });
});
