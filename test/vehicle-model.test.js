import { describe, it, expect } from 'vitest';
import {
  normalizeVehicleType,
  buildVehicleFootprintPolygon,
  mapVehicleFootprintDims,
  vehicleLengthM,
  vehicleSpec,
} from '../src/vehicle-model.js';

describe('vehicle-model', () => {
  it('normalizeVehicleType accepts aliases', () => {
    expect(normalizeVehicleType('semi')).toBe('semi_truck');
    expect(normalizeVehicleType('CAR')).toBe('car');
    expect(normalizeVehicleType('unknown')).toBe('car');
  });

  it('vehicleLengthM increases with class', () => {
    expect(vehicleLengthM('bicycle')).toBeLessThan(vehicleLengthM('motorcycle'));
    expect(vehicleLengthM('motorcycle')).toBeLessThan(vehicleLengthM('car'));
    expect(vehicleLengthM('truck')).toBeLessThan(vehicleLengthM('semi_truck'));
  });

  it('buildVehicleFootprintPolygon returns closed ring', () => {
    const g = buildVehicleFootprintPolygon(-111.7, 40.6, 10, 3, 45);
    expect(g.type).toBe('Polygon');
    const ring = g.coordinates[0];
    expect(ring.length).toBeGreaterThanOrEqual(5);
    expect(ring[0][0]).toBeCloseTo(ring[ring.length - 1][0], 8);
    expect(ring[0][1]).toBeCloseTo(ring[ring.length - 1][1], 8);
  });

  it('mapVehicleFootprintDims scales for map visibility without shrinking physics spec', () => {
    const raw = vehicleSpec('car');
    const m = mapVehicleFootprintDims('car');
    expect(m.lengthM).toBeGreaterThan(raw.lengthM);
    expect(m.widthM).toBeGreaterThanOrEqual(raw.widthM);
    expect(m.heightM).toBeGreaterThanOrEqual(raw.heightM);
    expect(m.widthM).toBeGreaterThanOrEqual(2.5);
  });
});
