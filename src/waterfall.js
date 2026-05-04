/**
 * DAS Waterfall renderer — realistic jet colormap waterfall display.
 *
 * Axes: X = milepost increasing left → right (fiber channel index runs opposite along SR-190,
 *   so the horizontal axis is mirrored: low milepost on the left, high on the right).
 *   Y = time (vertical, newest at top flowing downward — matches common DAS waterfall plots).
 * Colormap: standard jet — deep blue → cyan → green → yellow → orange → red.
 * Display levels use percentile stretch (≈5th–95th) over visible history so outliers do not
 * wash out the noise floor. Gamma is adaptive: a narrow value range (ambient noise only) uses a
 * higher gamma so the stretch maps mostly into the blue/cyan end of jet; strong events widen the
 * range and restore the lower gamma used for traffic visualization. Idle pre-fill uses a low
 * variance fiber bias + fine speckle so the default view stays calm (mostly blue static).
 *
 * Sim / display (not interrogator PRF):
 *   - 2m channel spacing
 *   - One waterfall row per sim tick (TICK_MS in simulation.js, currently 100ms)
 *   - 256 rows visible = 25.6s of history at that tick
 *   - Vehicle at 45 mph ≈ 1 channel/tick → diagonal slope depends on horizontal zoom
 *   - Zoom: mouse wheel (focal zoom); Shift+wheel / Ctrl+wheel widen or narrow the window.
 *     Double-click does not change zoom (avoids accidental extreme zoom + loss of contrast).
 *   - Horizontal zoom is clamped: default shows the full fiber; zoom-in stops at a minimum window
 *     width so the plot cannot zoom to a single-pixel-wide strip.
 */

const HISTORY_ROWS = 256;

/** Deterministic [0, 1) pseudo-random from channel index / band id (stable noise texture). */
function hash01(n) {
  let x = Math.imul(n >>> 0, 0x9e3779b1);
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

// Precomputed jet colormap LUT — 512 entries for smooth gradients
const LUT_SIZE = 512;
const JET_R = new Uint8Array(LUT_SIZE);
const JET_G = new Uint8Array(LUT_SIZE);
const JET_B = new Uint8Array(LUT_SIZE);

(function buildJetLUT() {
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1);
    // Standard jet: deep navy → blue → cyan → green → yellow → orange → red → dark red
    if (t < 0.1) {
      JET_R[i] = 0;
      JET_G[i] = 0;
      JET_B[i] = Math.floor(80 + t / 0.1 * 175);
    } else if (t < 0.35) {
      JET_R[i] = 0;
      JET_G[i] = Math.floor((t - 0.1) / 0.25 * 255);
      JET_B[i] = 255;
    } else if (t < 0.5) {
      JET_R[i] = 0;
      JET_G[i] = 255;
      JET_B[i] = Math.floor(255 - (t - 0.35) / 0.15 * 255);
    } else if (t < 0.65) {
      JET_R[i] = Math.floor((t - 0.5) / 0.15 * 255);
      JET_G[i] = 255;
      JET_B[i] = 0;
    } else if (t < 0.85) {
      JET_R[i] = 255;
      JET_G[i] = Math.floor(255 - (t - 0.65) / 0.2 * 255);
      JET_B[i] = 0;
    } else {
      JET_R[i] = Math.floor(255 - (t - 0.85) / 0.15 * 128);
      JET_G[i] = 0;
      JET_B[i] = 0;
    }
  }
})();

/**
 * Channel indices to draw as vertical crossing guides (GeoJSON + channel flags).
 * Exported for unit tests (browser init uses the same logic).
 *
 * @param {{ crossings?: { features?: unknown[] }; channels: { channel_id?: number; crossing_flag?: boolean }[] }} data
 * @returns {number[]}
 */
export function collectCrossingChannelIndices(data) {
  const totalChannels = data.channels.length;
  const crossingChannelSet = new Set();
  if (data.crossings && Array.isArray(data.crossings.features)) {
    for (const f of data.crossings.features) {
      const id = f?.properties?.channel_id;
      if (typeof id === 'number' && Number.isFinite(id)) {
        const ci = Math.floor(id);
        if (ci >= 0 && ci < totalChannels) crossingChannelSet.add(ci);
      }
    }
  }
  for (const ch of data.channels) {
    if (ch.crossing_flag && typeof ch.channel_id === 'number') {
      crossingChannelSet.add(Math.max(0, Math.min(totalChannels - 1, ch.channel_id)));
    }
  }
  return [...crossingChannelSet].sort((a, b) => a - b);
}

export function initWaterfall(canvasId, data, options = {}) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  const totalChannels = data.channels.length;

  const crossingChannels = collectCrossingChannelIndices(data);

  /** Horizontal window in channel index space (half-open [viewStart, viewEnd)). */
  let viewStart = 0;
  let viewEnd = totalChannels;
  const buffer = new Float32Array(totalChannels * HISTORY_ROWS);
  /** Subsampled values for percentile autoscale (reused each frame). */
  const scratchSamples = new Float32Array(32768);
  let currentRow = 0;
  let hoveredChannel = null;
  /** Traffic lab: emphasize one channel column (integer index or null). */
  let highlightChannel = null;

  /** Called when user picks a channel on the plot (map can fly to that fiber location). */
  let plotChannelPickCallback = typeof options.onPlotChannelPick === 'function'
    ? options.onPlotChannelPick
    : null;

  /** Mouse: left-drag horizontal pan; distinguish from click-to-focus-map. */
  let wfMousePan = null; // { pointerId, originClientX, originViewStart, movedPx }
  let wfPanPickSuppressed = false;

  /** One-finger pan / two-finger pinch on the waterfall (touch). */
  let wfTouchPan = null; // { pointerId, lastClientX }
  let wfPinch = null; // { idA, idB, dist0, range0, centerCh }

  /** Defer single-click so a quick second click does not move the map twice. */
  let plotPickTimer = null;

  function setHighlightChannel(ch) {
    if (ch === null || ch === undefined) {
      highlightChannel = null;
      return;
    }
    const n = Math.floor(Number(ch));
    highlightChannel = Number.isFinite(n) ? Math.max(0, Math.min(totalChannels - 1, n)) : null;
  }

  /** Pan horizontal view so channel `ch` is visible (used when lab vehicle jumps). */
  function scrollChannelIntoView(ch) {
    if (!Number.isFinite(ch)) return;
    const ci = Math.max(0, Math.min(totalChannels - 1, Math.floor(ch)));
    const range = viewEnd - viewStart;
    if (ci >= viewStart && ci < viewEnd) return;
    viewStart = Math.max(0, ci - Math.floor(range / 2));
    viewEnd = Math.min(totalChannels, viewStart + range);
    if (viewEnd - viewStart < range) viewStart = Math.max(0, viewEnd - range);
  }

  // === Per-channel static noise profile ===
  // Real fiber has coupling variations, micro-bends, splice points, etc.
  const channelBias = new Float32Array(totalChannels);

  // Base bias: smooth low-frequency variation across fiber (kept subtle so idle plot is calm)
  for (let i = 0; i < totalChannels; i++) {
    channelBias[i] = 0.018
      + 0.009 * Math.sin(i * 0.002)
      + 0.006 * Math.sin(i * 0.0073)
      + 0.005 * Math.sin(i * 0.019);
  }

  // Noisy channels: fiber coupling imperfections (deterministic — stable across reloads)
  for (let i = 0; i < totalChannels; i++) {
    if (hash01(i * 2654435761) < 0.022) {
      const spread = 1 + Math.floor(hash01(i * 2246822519) * 2);
      const extra = 0.018 + hash01(i * 4051735735) * 0.045;
      for (let d = -spread; d <= spread; d++) {
        const idx = i + d;
        if (idx >= 0 && idx < totalChannels) {
          channelBias[idx] += extra * (1 - Math.abs(d) / (spread + 1));
        }
      }
    }
  }

  // Sparse bumps along the route (coupling quirks)
  const bandCount = Math.min(28, Math.max(12, Math.floor(totalChannels / 520)));
  for (let b = 0; b < bandCount; b++) {
    const center = Math.floor(hash01(b * 374761393 + totalChannels * 17) * totalChannels);
    const halfWidth = 1 + Math.floor(hash01(b * 668265263) * 4);
    const strength = 0.012 + hash01(b * 15485863) * 0.03;
    for (let d = -halfWidth; d <= halfWidth; d++) {
      const idx = center + d;
      if (idx >= 0 && idx < totalChannels) {
        channelBias[idx] += strength * (1 - Math.abs(d) / (halfWidth + 1));
      }
    }
  }

  // Crossing zones: slight elevated baseline near fiber–road crossings (subtle vs traffic tracks)
  for (const ch of data.channels) {
    if (ch.crossing_flag) {
      const cid = ch.channel_id;
      channelBias[cid] += 0.012 + hash01(cid * 1664525 + 1013904223) * 0.012;
    }
  }

  // Canyon mouth: gentle taper (quieter default — avoids a bright vertical ramp at full-route zoom)
  for (let i = 0; i < Math.min(400, totalChannels); i++) {
    channelBias[i] += 0.004 * (1 - i / 400);
  }

  // Pre-fill buffer with speckled baseline noise (fine grain + weak horizontal micro-streaks)
  for (let row = 0; row < HISTORY_ROWS; row++) {
    const offset = row * totalChannels;
    const rowPhase = row * 0.29;
    const rowFlutter = (hash01(row * 27644437 + 9001) - 0.5) * 0.002;
    for (let i = 0; i < totalChannels; i++) {
      const speckle = (hash01(i * 7919 + row * 31337) - 0.5) * 0.011;
      const micro =
        0.0035 * Math.sin(i * 0.079 + rowPhase)
        + 0.0022 * Math.sin(i * 0.0173 + row * 0.51)
        + 0.0014 * Math.sin(i * 0.0024 + row * 0.11);
      buffer[offset + i] = Math.max(
        0,
        channelBias[i] + speckle + micro + rowFlutter,
      );
    }
  }

  function resize() {
    const panel = canvas.parentElement;
    const rect = panel?.getBoundingClientRect?.() ?? canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  /** Map pixel x to channel index; left = smaller milepost, right = larger milepost. */
  function channelFromClientX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const w = canvas.width || rect.width;
    if (w <= 0) return null;
    const seg = viewEnd - viewStart;
    if (seg <= 0) return null;
    const t = Math.max(0, Math.min(1 - 1e-9, x / w));
    return viewEnd - 1 - Math.floor(t * seg);
  }

  function floatChannelFromClientX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const w = canvas.width || rect.width;
    if (w <= 0) return null;
    const seg = viewEnd - viewStart;
    if (seg <= 0) return null;
    const ch = viewEnd - 1 - (x / w) * seg;
    return Math.max(0, Math.min(totalChannels - 1, ch));
  }

  const activeTouchX = new Map();

  /** Most zoomed-in window (channels); cap prevents extreme pixel zoom; never wider than route. */
  const MIN_VIEW_CHANNELS = Math.min(200, totalChannels);
  /** Most zoomed-out = full route (all mileposts along the fiber in channel table). */
  const MAX_VIEW_CHANNELS = totalChannels;

  /** Scroll/pan horizontally by channel delta (positive = view moves toward higher channel indices / right side of plot). */
  function applyHorizontalScroll(deltaCh) {
    const range = viewEnd - viewStart;
    if (range <= 0) return;
    viewStart = Math.max(0, viewStart + deltaCh);
    viewEnd = Math.min(totalChannels, viewEnd + deltaCh);
    if (viewEnd - viewStart < range) {
      if (viewStart === 0) viewEnd = Math.min(totalChannels, viewStart + range);
      else if (viewEnd === totalChannels) viewStart = Math.max(0, viewEnd - range);
    }
  }

  /** Zoom so channel under `clientX` stays fixed; `deltaY` > 0 zooms out (wider view). */
  function applyWheelZoomAtClientX(clientX, deltaY, shiftKey) {
    const range = viewEnd - viewStart;
    if (range <= 0) return;
    const focal = floatChannelFromClientX(clientX);
    if (focal === null) return;
    const sign = Math.sign(deltaY);
    const strong = shiftKey ? 1.14 : 1.09;
    let newRange = sign > 0 ? range * strong : range / strong;
    newRange = Math.max(MIN_VIEW_CHANNELS, Math.min(MAX_VIEW_CHANNELS, Math.round(newRange)));
    const frac = (viewEnd - 1 - focal) / range;
    let newEnd = focal + 1 + frac * newRange;
    let newStart = newEnd - newRange;
    if (newStart < 0) {
      newStart = 0;
      newEnd = Math.min(totalChannels, newStart + newRange);
    }
    if (newEnd > totalChannels) {
      newEnd = totalChannels;
      newStart = Math.max(0, newEnd - newRange);
    }
    viewStart = newStart;
    viewEnd = newEnd;
  }

  /** Legacy: wheel without focal (fallback). */
  function applyWheelDelta(deltaY, shiftKey) {
    const range = viewEnd - viewStart;
    const delta = Math.sign(deltaY) * Math.max(8, Math.floor(range * 0.06));
    if (shiftKey) {
      const newRange = Math.max(MIN_VIEW_CHANNELS, Math.min(totalChannels, range + delta * 6));
      const center = (viewStart + viewEnd) / 2;
      viewStart = Math.max(0, Math.floor(center - newRange / 2));
      viewEnd = Math.min(totalChannels, viewStart + newRange);
    } else {
      applyHorizontalScroll(delta);
    }
  }

  function schedulePlotChannelPick(clientX) {
    if (!plotChannelPickCallback) return;
    if (plotPickTimer) window.clearTimeout(plotPickTimer);
    plotPickTimer = window.setTimeout(() => {
      plotPickTimer = null;
      if (wfPanPickSuppressed) {
        wfPanPickSuppressed = false;
        return;
      }
      const ch = channelFromClientX(clientX);
      if (ch !== null) plotChannelPickCallback(ch);
    }, 300);
  }

  function cancelScheduledPlotPick() {
    if (plotPickTimer) {
      window.clearTimeout(plotPickTimer);
      plotPickTimer = null;
    }
  }

  resize();
  window.addEventListener('resize', resize);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      applyWheelDelta(e.deltaY, true);
    } else {
      applyWheelZoomAtClientX(e.clientX, e.deltaY, e.shiftKey);
    }
  }, { passive: false });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button === 0) {
      wfMousePan = {
        pointerId: e.pointerId,
        originClientX: e.clientX,
        originViewStart: viewStart,
        movedPx: 0,
      };
      wfPanPickSuppressed = false;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    if (e.pointerType === 'touch') {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      activeTouchX.set(e.pointerId, e.clientX);

      if (activeTouchX.size === 2) {
        wfTouchPan = null;
        const ids = [...activeTouchX.keys()];
        const x0 = activeTouchX.get(ids[0]);
        const x1 = activeTouchX.get(ids[1]);
        const mid = (x0 + x1) / 2;
        const dist0 = Math.abs(x1 - x0);
        if (dist0 > 10) {
          wfPinch = {
            idA: ids[0],
            idB: ids[1],
            dist0,
            range0: viewEnd - viewStart,
            centerCh: floatChannelFromClientX(mid) ?? (viewStart + viewEnd) / 2,
          };
        }
      } else if (activeTouchX.size === 1) {
        wfPinch = null;
        wfTouchPan = { pointerId: e.pointerId, lastClientX: e.clientX };
      }
    }
    hoveredChannel = channelFromClientX(e.clientX);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (wfMousePan && e.pointerId === wfMousePan.pointerId && e.pointerType === 'mouse') {
      const dx = e.clientX - wfMousePan.originClientX;
      wfMousePan.movedPx = Math.max(wfMousePan.movedPx, Math.abs(dx));
      if (wfMousePan.movedPx > 6) {
        wfPanPickSuppressed = true;
        cancelScheduledPlotPick();
      }
      const w = canvas.width || canvas.getBoundingClientRect().width;
      const range = viewEnd - viewStart;
      if (w > 0 && range > 0 && wfMousePan.movedPx > 2) {
        const deltaCh = Math.round(-dx * (range / w));
        if (deltaCh !== 0) {
          viewStart = wfMousePan.originViewStart + deltaCh;
          viewEnd = viewStart + range;
          wfMousePan.originClientX = e.clientX;
          wfMousePan.originViewStart = viewStart;
          if (viewStart < 0) {
            viewStart = 0;
            viewEnd = Math.min(totalChannels, range);
          }
          if (viewEnd > totalChannels) {
            viewEnd = totalChannels;
            viewStart = Math.max(0, viewEnd - range);
          }
        }
      }
    }
    if (e.pointerType === 'touch' && activeTouchX.has(e.pointerId)) {
      activeTouchX.set(e.pointerId, e.clientX);

      if (wfPinch && activeTouchX.has(wfPinch.idA) && activeTouchX.has(wfPinch.idB)) {
        const xa = activeTouchX.get(wfPinch.idA);
        const xb = activeTouchX.get(wfPinch.idB);
        const dist = Math.abs(xb - xa);
        if (wfPinch.dist0 > 1 && dist > 1) {
          let newRange = Math.round(wfPinch.range0 * (wfPinch.dist0 / dist));
          newRange = Math.max(MIN_VIEW_CHANNELS, Math.min(totalChannels, newRange));
          const c = wfPinch.centerCh;
          viewStart = Math.max(0, Math.floor(c - newRange / 2));
          viewEnd = Math.min(totalChannels, viewStart + newRange);
          if (viewEnd - viewStart < newRange) viewStart = Math.max(0, viewEnd - newRange);
        }
      } else if (wfTouchPan && e.pointerId === wfTouchPan.pointerId && activeTouchX.size === 1) {
        const w = canvas.width || canvas.getBoundingClientRect().width;
        const range = viewEnd - viewStart;
        if (w > 0 && range > 0) {
          const dx = e.clientX - wfTouchPan.lastClientX;
          wfTouchPan.lastClientX = e.clientX;
          const deltaCh = Math.round(-dx * (range / w));
          if (deltaCh !== 0) {
            viewStart = Math.max(0, viewStart + deltaCh);
            viewEnd = Math.min(totalChannels, viewEnd + deltaCh);
            if (viewEnd - viewStart < range) {
              if (viewStart === 0) viewEnd = Math.min(totalChannels, viewStart + range);
              else if (viewEnd === totalChannels) viewStart = Math.max(0, viewEnd - range);
            }
          }
        }
      }
    }

    if (e.pointerType === 'mouse' && e.buttons === 0) {
      hoveredChannel = channelFromClientX(e.clientX);
    } else if (e.pointerType === 'touch' && activeTouchX.size === 1) {
      hoveredChannel = channelFromClientX(e.clientX);
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (wfMousePan && e.pointerId === wfMousePan.pointerId && e.pointerType === 'mouse') {
      if (e.button === 0 && wfMousePan.movedPx <= 6 && plotChannelPickCallback) {
        schedulePlotChannelPick(e.clientX);
      }
      wfMousePan = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    activeTouchX.delete(e.pointerId);
    if (wfTouchPan && wfTouchPan.pointerId === e.pointerId) wfTouchPan = null;
    if (wfPinch && (e.pointerId === wfPinch.idA || e.pointerId === wfPinch.idB)) wfPinch = null;
    if (e.pointerType === 'touch' && activeTouchX.size === 0) {
      hoveredChannel = null;
    }
  });

  canvas.addEventListener('pointercancel', (e) => {
    if (wfMousePan && e.pointerId === wfMousePan.pointerId) wfMousePan = null;
    activeTouchX.delete(e.pointerId);
    if (wfTouchPan && wfTouchPan.pointerId === e.pointerId) wfTouchPan = null;
    if (wfPinch && (e.pointerId === wfPinch.idA || e.pointerId === wfPinch.idB)) wfPinch = null;
    hoveredChannel = null;
  });

  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') hoveredChannel = null;
  });

  function pushRow(values) {
    const offset = currentRow * totalChannels;
    for (let i = 0; i < totalChannels; i++) {
      buffer[offset + i] = values[i] || 0;
    }
    currentRow = (currentRow + 1) % HISTORY_ROWS;
  }

  function render() {
    const { width, height } = canvas;
    if (width === 0 || height === 0) return;

    const imageData = ctx.createImageData(width, height);
    const pix = imageData.data;
    const chanRange = viewEnd - viewStart;
    const rowH = height / HISTORY_ROWS;

    // Percentile stretch (~5th–95th) over subsampled visible history so lone bright pixels
    // (or stale vehicle tails) do not flatten ambient noise to a single hue.
    const ch0 = Math.max(0, viewStart);
    const ch1 = Math.min(totalChannels, viewEnd);
    const chSpan = ch1 - ch0;
    const chStride = chSpan * HISTORY_ROWS > 450_000 ? Math.max(1, Math.ceil(chSpan / 800)) : 1;
    const cellsPerRow = Math.ceil(chSpan / chStride);
    const totalCells = HISTORY_ROWS * cellsPerRow;
    const sampleEvery = Math.max(1, Math.floor(totalCells / scratchSamples.length));

    let nSamp = 0;
    let cellCounter = 0;
    outerCollect:
    for (let row = 0; row < HISTORY_ROWS; row++) {
      const bufRow = (currentRow - 1 - row + HISTORY_ROWS * 2) % HISTORY_ROWS;
      const rowOff = bufRow * totalChannels;
      for (let i = ch0; i < ch1; i += chStride) {
        if (cellCounter % sampleEvery === 0 && nSamp < scratchSamples.length) {
          scratchSamples[nSamp++] = buffer[rowOff + i];
        }
        cellCounter++;
        if (nSamp >= scratchSamples.length) break outerCollect;
      }
    }

    let vmin;
    let vmax;
    if (nSamp < 32) {
      vmin = 0;
      vmax = 0.32;
    } else {
      scratchSamples.subarray(0, nSamp).sort();
      const lo = Math.max(0, Math.min(nSamp - 1, Math.floor(0.05 * (nSamp - 1))));
      const hi = Math.max(0, Math.min(nSamp - 1, Math.floor(0.95 * (nSamp - 1))));
      vmin = scratchSamples[lo];
      vmax = scratchSamples[hi];
      if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmax <= vmin + 1e-8) {
        vmin = 0;
        vmax = 0.32;
      } else {
        const pad = 0.06 * (vmax - vmin);
        vmin = Math.max(0, vmin - pad);
        vmax = vmax + pad;
      }
    }
    const span = Math.max(vmax - vmin, 1e-8);
    // Fixed γ<1 (e.g. 0.72) lifts dark pixels toward mid jet — fine for high-contrast traffic,
    // but it turns quiet percentile-stretched noise green/yellow/red. Widen γ when the visible
    // history has little dynamic range so ambient reads as blue static.
    let gamma;
    if (span < 0.048) {
      gamma = 2.35;
    } else if (span < 0.095) {
      gamma = 1.62;
    } else if (span < 0.2) {
      gamma = 1.05;
    } else {
      gamma = 0.72;
    }

    for (let row = 0; row < HISTORY_ROWS; row++) {
      // Newest sample at top (row 0); ring slot about to be overwritten (currentRow) at bottom.
      const bufRow = (currentRow - 1 - row + HISTORY_ROWS * 2) % HISTORY_ROWS;
      const y0 = Math.floor(row * rowH);
      const y1 = Math.max(y0 + 1, Math.floor((row + 1) * rowH));

      for (let px = 0; px < width; px++) {
        const t = Math.min(1 - Number.EPSILON, px / width);
        const ch = viewEnd - 1 - Math.floor(t * chanRange);
        if (ch < 0 || ch >= totalChannels) continue;

        const raw = buffer[bufRow * totalChannels + ch];
        const norm = (Math.min(vmax, Math.max(vmin, raw)) - vmin) / span;
        const val = Math.pow(Math.min(1, Math.max(0, norm)), gamma);
        const lutIdx = Math.min(LUT_SIZE - 1, Math.floor(val * (LUT_SIZE - 1)));

        for (let y = y0; y < y1; y++) {
          const off = (y * width + px) * 4;
          pix[off] = JET_R[lutIdx];
          pix[off + 1] = JET_G[lutIdx];
          pix[off + 2] = JET_B[lutIdx];
          pix[off + 3] = 255;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Traffic lab: dim off-channel area and draw a band at the vehicle channel
    if (highlightChannel !== null && highlightChannel >= viewStart && highlightChannel < viewEnd) {
      const chanRange = viewEnd - viewStart;
      const xCenter = ((viewEnd - 1 - highlightChannel) / chanRange) * width;
      const bandPx = Math.max(14, width * 0.04);
      const xLeft = xCenter - bandPx / 2;
      const xRight = xCenter + bandPx / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.fillRect(0, 0, Math.max(0, xLeft), height);
      ctx.fillRect(xRight, 0, Math.max(0, width - xRight), height);
      const grd = ctx.createLinearGradient(xCenter - bandPx / 2, 0, xCenter + bandPx / 2, 0);
      grd.addColorStop(0, 'rgba(79,195,247,0)');
      grd.addColorStop(0.5, 'rgba(79,195,247,0.18)');
      grd.addColorStop(1, 'rgba(79,195,247,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(xCenter - bandPx / 2, 0, bandPx, height);
      ctx.strokeStyle = 'rgba(79,195,247,0.65)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xCenter, 0);
      ctx.lineTo(xCenter, height);
      ctx.stroke();
    }

    // Fiber–road crossings (vertical guides)
    if (crossingChannels.length > 0) {
      ctx.save();
      for (const ch of crossingChannels) {
        if (ch < viewStart || ch >= viewEnd) continue;
        const x = ((viewEnd - 1 - ch) / chanRange) * width;
        ctx.strokeStyle = 'rgba(255, 193, 7, 0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Crosshair
    if (hoveredChannel !== null && hoveredChannel >= viewStart && hoveredChannel < viewEnd) {
      const x = ((viewEnd - 1 - hoveredChannel) / chanRange) * width;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const bottomPad = 34;
    // Bottom axis: milepost labels
    ctx.fillStyle = 'rgba(245,248,252,0.92)';
    ctx.font = '11px monospace';
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;
    const labelStep = Math.max(1, Math.floor(chanRange / 8));
    for (let i = viewStart; i < viewEnd; i += labelStep) {
      const x = ((viewEnd - 1 - i) / chanRange) * width;
      const ch = data.channels[i];
      if (ch) ctx.fillText(`MP ${ch.milepost.toFixed(1)}`, x + 2, height - bottomPad + 14);
    }
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Axis captions (fiber chainage + time flow)
    ctx.fillStyle = 'rgba(180, 186, 200, 0.88)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Milepost along route →', width * 0.5, height - 6);
    ctx.textAlign = 'left';

    ctx.save();
    ctx.translate(11, height * 0.52);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(180, 186, 200, 0.88)';
    ctx.textAlign = 'center';
    ctx.fillText('Time → (newest at top)', 0, 0);
    ctx.restore();

    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(150, 156, 172, 0.75)';
    ctx.textAlign = 'left';
    ctx.fillText('Horizontal = distance along fiber (not lane map)', 4, height - bottomPad - 1);
    if (crossingChannels.length > 0) {
      const cmsg = `Crossings: ${crossingChannels.length}`;
      ctx.fillStyle = 'rgba(255, 193, 7, 0.45)';
      ctx.textAlign = 'right';
      ctx.fillText(cmsg, width - 4, height - bottomPad - 1);
      ctx.textAlign = 'left';
    }

    if (hoveredChannel !== null && data.channels[hoveredChannel]) {
      const ch = data.channels[hoveredChannel];
      const t = `Ch ${ch.channel_id} · MP ${ch.milepost.toFixed(2)} · ${ch.fiber_distance_m}m · ${ch.side_of_road}`;
      ctx.font = '11px monospace';
      const tw = ctx.measureText(t).width;
      ctx.fillStyle = 'rgba(12, 14, 20, 0.78)';
      ctx.fillRect(4, 4, tw + 10, 17);
      ctx.fillStyle = 'rgba(228, 230, 235, 0.95)';
      ctx.fillText(t, 9, 16);
    }
  }

  function setPlotChannelPickCallback(fn) {
    plotChannelPickCallback = typeof fn === 'function' ? fn : null;
  }

  return {
    pushRow,
    render,
    channelBias,
    getViewRange: () => [viewStart, viewEnd],
    setHighlightChannel,
    scrollChannelIntoView,
    resize,
    setPlotChannelPickCallback,
  };
}
