import { describe, expect, it } from 'vitest';
import {
  buildCorridorPolygonLonLat,
  hazardEventDurationTicks,
  hazardFootprintMeters,
  hazardPeakIntensity,
  hazardWaterfallEnvelope,
  lateralWidthsForHazard,
  normalizeHazardKind,
  normalizeHazardSize,
} from '../src/hazard-model.js';

describe('hazard-model', () => {
  it('normalizes kind and size aliases', () => {
    expect(normalizeHazardKind('rockslide')).toBe('rock_slide');
    expect(normalizeHazardKind('bogus')).toBe('crash');
    expect(normalizeHazardSize('')).toBe('medium');
    expect(normalizeHazardSize('large')).toBe('large');
  });

  it('scales footprint meters by hazard kind and size tier', () => {
    const crashS = hazardFootprintMeters('crash', 'small');
    const crashL = hazardFootprintMeters('crash', 'large');
    expect(crashL.lengthM).toBeGreaterThan(crashS.lengthM);

    const rock = hazardFootprintMeters('rock_slide', 'medium');
    expect(rock.leftWidthM).toBeGreaterThan(rock.rightWidthM);

    const widths = lateralWidthsForHazard('avalanche', 'medium');
    expect(widths.leftWidthM).toBeGreaterThan(widths.rightWidthM);
  });

  it('maps intensity by size', () => {
    expect(hazardPeakIntensity('crash', 'small')).toBeLessThan(hazardPeakIntensity('crash', 'large'));
  });

  it('waterfall envelope is time-limited with prelude / impact / tail shape', () => {
    const crashDur = hazardEventDurationTicks('crash', 'medium');
    expect(crashDur).toBeGreaterThan(10);
    expect(hazardWaterfallEnvelope('crash', 'medium', -1)).toBe(0);
    expect(hazardWaterfallEnvelope('crash', 'medium', crashDur)).toBe(0);
    const prelude = hazardWaterfallEnvelope('crash', 'medium', 0);
    const midImpact = hazardWaterfallEnvelope('crash', 'medium', Math.floor(crashDur * 0.35));
    expect(midImpact).toBeGreaterThan(prelude);
    const avDur = hazardEventDurationTicks('avalanche', 'medium');
    expect(hazardWaterfallEnvelope('avalanche', 'medium', avDur - 1)).toBeGreaterThan(0);
    expect(hazardWaterfallEnvelope('avalanche', 'medium', avDur)).toBe(0);
  });

  it('builds a closed corridor polygon', () => {
    const g = buildCorridorPolygonLonLat(-111.7, 40.58, 125, 40, 6, 6);
    expect(g.type).toBe('Polygon');
    const ring = g.coordinates[0];
    expect(ring.length).toBeGreaterThanOrEqual(4);
    expect(ring[0][0]).toBeCloseTo(ring[ring.length - 1][0], 10);
    expect(ring[0][1]).toBeCloseTo(ring[ring.length - 1][1], 10);
  });
});
