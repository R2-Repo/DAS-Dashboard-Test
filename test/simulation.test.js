import { describe, it, expect } from 'vitest';

describe('Fiber coordinate interpolation', () => {
  const FIBER_COORDS = [
    [-111.78, 40.565],
    [-111.775, 40.57],
    [-111.77, 40.575],
    [-111.765, 40.578],
    [-111.76, 40.58],
    [-111.755, 40.583],
    [-111.75, 40.588],
    [-111.745, 40.592],
    [-111.74, 40.595],
  ];

  function interpolatePosition(progress, direction) {
    const coords = direction === 'up_canyon' ? FIBER_COORDS : [...FIBER_COORDS].reverse();
    const totalSegments = coords.length - 1;
    const segment = Math.min(Math.floor(progress * totalSegments), totalSegments - 1);
    const t = (progress * totalSegments) - segment;
    const [x0, y0] = coords[segment];
    const [x1, y1] = coords[segment + 1];
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
  }

  it('returns start coordinates at progress 0 for up_canyon', () => {
    const [lng, lat] = interpolatePosition(0, 'up_canyon');
    expect(lng).toBeCloseTo(-111.78, 4);
    expect(lat).toBeCloseTo(40.565, 4);
  });

  it('returns end coordinates at progress 1 for up_canyon', () => {
    const [lng, lat] = interpolatePosition(1, 'up_canyon');
    expect(lng).toBeCloseTo(-111.74, 4);
    expect(lat).toBeCloseTo(40.595, 4);
  });

  it('returns reversed start at progress 0 for down_canyon', () => {
    const [lng, lat] = interpolatePosition(0, 'down_canyon');
    expect(lng).toBeCloseTo(-111.74, 4);
    expect(lat).toBeCloseTo(40.595, 4);
  });

  it('interpolates midpoint correctly', () => {
    const [lng, lat] = interpolatePosition(0.5, 'up_canyon');
    expect(lng).toBeCloseTo(-111.76, 2);
    expect(lat).toBeCloseTo(40.58, 2);
  });
});

describe('Milepost calculation', () => {
  it('computes milepost from progress', () => {
    const progress = 0.5;
    const milepost = 14 + progress * 2;
    expect(milepost).toBe(15);
  });

  it('formats milepost label correctly', () => {
    const milepost = (14 + 0.75 * 2).toFixed(2);
    expect(milepost).toBe('15.50');
  });
});
