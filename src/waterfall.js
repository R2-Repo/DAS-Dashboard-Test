/**
 * DAS Waterfall renderer — clean jet colormap waterfall display optimised for
 * educational DAS demonstrations.
 *
 * Axes: X = milepost increasing left → right (fiber channel index runs opposite along SR-190,
 *   so the horizontal axis is mirrored: low milepost on the left, high on the right).
 *   Y = time (vertical, newest at top flowing downward — matches common DAS waterfall plots).
 * Colormap: jet-like scale — deep blue → cyan → green → yellow → orange → red (high end capped, not maroon).
 * Tuned for a cooler idle field (more blue/cyan) while strong vehicle rows lean saturated red, not yellow-orange wash.
 *
 * Display scaling uses a **fixed reference range** so that ambient noise stays in the dark-blue
 * band and vehicle/anomaly energy pops into green → yellow → red.  This avoids the problem with
 * pure percentile stretch where the colour-map auto-adjusts and makes noise fill the entire
 * colour range, washing out the vehicle diagonal traces.
 *
 * Interaction:
 *   - Mouse wheel / trackpad scroll → focal zoom (channel under cursor stays fixed; fast steps)
 *   - Ctrl/⌘+wheel → same zoom (browser zoom-chord compatibility)
 *   - Touch: one-finger swipe pans horizontally along the fiber; two-finger pinch zooms
 *   - Click / tap → zoom plot toward that channel + notify host (map flies to fiber location)
 *
 * Sim / display (not interrogator PRF):
 *   - 2m channel spacing
 *   - One waterfall row per sim tick (TICK_MS in simulation.js, currently 100ms)
 *   - 256 rows visible = 25.6s of history at that tick
 *   - Vehicle at 45 mph ≈ 1 channel/tick → diagonal slope depends on horizontal zoom
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
    // Cooler lows + shorter yellow/orange leg so traces hit punchy red earlier (less warm halo on peaks).
    if (t < 0.12) {
      JET_R[i] = 0;
      JET_G[i] = 0;
      JET_B[i] = Math.floor(66 + (t / 0.12) * 189);
    } else if (t < 0.37) {
      JET_R[i] = 0;
      JET_G[i] = Math.floor(((t - 0.12) / 0.25) * 255);
      JET_B[i] = 255;
    } else if (t < 0.46) {
      JET_R[i] = 0;
      JET_G[i] = 255;
      JET_B[i] = Math.floor(255 - ((t - 0.37) / 0.09) * 255);
    } else if (t < 0.55) {
      JET_R[i] = Math.floor(((t - 0.46) / 0.09) * 255);
      JET_G[i] = 255;
      JET_B[i] = 0;
    } else if (t < 0.73) {
      JET_R[i] = 255;
      JET_G[i] = Math.floor(255 - ((t - 0.55) / 0.18) * 235);
      JET_B[i] = 0;
    } else {
      const u = (t - 0.73) / (1 - 0.73);
      JET_R[i] = 255;
      JET_G[i] = Math.floor(20 * (1 - u));
      JET_B[i] = Math.floor(8 * (1 - u));
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

  /** Horizontal window in channel index space (half-open [viewStart, viewEnd)). */
  let viewStart = 0;
  let viewEnd = totalChannels;
  const buffer = new Float32Array(totalChannels * HISTORY_ROWS);
  let currentRow = 0;
  let hoveredChannel = null;
  /** Traffic lab: emphasize one channel column (integer index or null). */
  let highlightChannel = null;

  /** Called when user picks a channel on the plot (map can fly to that fiber location). */
  let plotChannelPickCallback = typeof options.onPlotChannelPick === 'function'
    ? options.onPlotChannelPick
    : null;

  /** Mouse: distinguish tiny jitter from intentional click-to-zoom. */
  let wfMouseDown = null; // { pointerId, originClientX, movedPx }
  let wfPanPickSuppressed = false;

  /** Two-finger pinch on the waterfall (touch). */
  let wfPinch = null; // { idA, idB, dist0, range0, centerCh }

  /** One-finger horizontal pan on touch devices (desktop mouse drag remains disabled). */
  let wfTouchPan = null; // { pointerId, lastClientX }

  /** Defer single-click so a quick second tap does not fire twice. */
  let plotPickTimer = null;

  /** When tracking a vehicle channel, keep it inside the horizontal view each frame. */
  let trackChannel = null;
  /** Inner margin in channel units — scroll before the marker hits the plot edge. */
  const TRACK_EDGE_MARGIN_CH = 6;

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

  /** Follow `ch` horizontally when zoomed; keeps the channel inside the view with margin. */
  function scrollTrackChannelIntoView(ch) {
    if (!Number.isFinite(ch)) return;
    const ci = Math.max(0, Math.min(totalChannels - 1, Math.floor(ch)));
    const range = viewEnd - viewStart;
    if (!(range > 0)) return;
    const margin = Math.min(TRACK_EDGE_MARGIN_CH, Math.max(0, Math.floor(range * 0.06)));
    const lo = viewStart + margin;
    const hi = viewEnd - 1 - margin;
    if (ci >= lo && ci <= hi) return;
    let start = viewStart;
    if (ci < lo) start = ci - margin;
    else if (ci > hi) start = ci - range + 1 + margin;
    start = Math.max(0, Math.min(totalChannels - range, Math.floor(start)));
    viewStart = start;
    viewEnd = Math.min(totalChannels, viewStart + range);
    if (viewEnd - viewStart < range) viewStart = Math.max(0, viewEnd - range);
  }

  function setTrackChannel(ch) {
    if (ch === null || ch === undefined) {
      trackChannel = null;
      return;
    }
    const n = Math.floor(Number(ch));
    trackChannel = Number.isFinite(n) ? Math.max(0, Math.min(totalChannels - 1, n)) : null;
  }

  /** Zoom toward channel index `ch` (integer), keeping position roughly centered when possible. */
  function zoomViewportTowardChannel(ch, factor) {
    if (!Number.isFinite(ch)) return;
    const ci = Math.max(0, Math.min(totalChannels - 1, Math.floor(ch)));
    const range = viewEnd - viewStart;
    if (!(range > 0)) return;
    let newRange = Math.round(range / factor);
    newRange = Math.max(MIN_VIEW_CHANNELS, Math.min(MAX_VIEW_CHANNELS, newRange));
    if (newRange === range) return;
    const frac = (viewEnd - 1 - ci) / range;
    let newEnd = ci + 1 + frac * newRange;
    let newStart = newEnd - newRange;
    if (!Number.isFinite(newStart) || !Number.isFinite(newEnd)) return;
    if (newStart < 0) {
      newStart = 0;
      newEnd = Math.min(totalChannels, newStart + newRange);
    }
    if (newEnd > totalChannels) {
      newEnd = totalChannels;
      newStart = Math.max(0, newEnd - newRange);
    }
    viewStart = Math.floor(newStart);
    viewEnd = Math.ceil(newEnd);
  }

  // === Per-channel static noise profile ===
  // Kept very low so ambient reads as dark blue; vehicle traces pop into green/yellow/red.
  const channelBias = new Float32Array(totalChannels);

  for (let i = 0; i < totalChannels; i++) {
    channelBias[i] = 0.006
      + 0.003 * Math.sin(i * 0.002)
      + 0.002 * Math.sin(i * 0.0073)
      + 0.001 * Math.sin(i * 0.019);
  }

  // Sparse coupling imperfections (very subtle)
  for (let i = 0; i < totalChannels; i++) {
    if (hash01(i * 2654435761) < 0.015) {
      const spread = 1 + Math.floor(hash01(i * 2246822519) * 2);
      const extra = 0.004 + hash01(i * 4051735735) * 0.008;
      for (let d = -spread; d <= spread; d++) {
        const idx = i + d;
        if (idx >= 0 && idx < totalChannels) {
          channelBias[idx] += extra * (1 - Math.abs(d) / (spread + 1));
        }
      }
    }
  }

  // Crossing zones: barely visible baseline bump near fiber–road crossings
  for (const ch of data.channels) {
    if (ch.crossing_flag) {
      const cid = ch.channel_id;
      channelBias[cid] += 0.003 + hash01(cid * 1664525 + 1013904223) * 0.003;
    }
  }

  const channelRoadCoupling = new Float32Array(totalChannels);
  for (let i = 0; i < totalChannels; i++) {
    const rd = data.channels[i]?.nearest_road_distance_m;
    const d = typeof rd === 'number' && Number.isFinite(rd) ? Math.max(0, rd) : 6;
    const t = Math.min(1, d / 22);
    channelRoadCoupling[i] = Math.max(0.12, 1 - t * t);
  }

  // Pre-fill with quiet ambient (dark blue) so the waterfall starts clean.
  let prefillNoiseSeed = hash01(totalChannels + 90211) * 1000;
  for (let row = 0; row < HISTORY_ROWS; row++) {
    prefillNoiseSeed += 0.1;
    const offset = row * totalChannels;
    for (let i = 0; i < totalChannels; i++) {
      const spatial =
        0.0008 * Math.sin(i * 0.01 + prefillNoiseSeed)
        + 0.0005 * Math.sin(i * 0.037 + prefillNoiseSeed * 1.7);
      const rnd = hash01(i * 374761393 + row * 668265263 + totalChannels);
      const ambient = channelBias[i] + spatial + rnd * 0.004;
      const grain = (hash01(i * 7919 + row * 31337) - 0.5) * 0.001;
      buffer[offset + i] = Math.max(0, ambient + grain);
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
    if (!(w > 0)) return null;
    const seg = viewEnd - viewStart;
    if (!(seg > 0)) return null;
    const t = Math.max(0, Math.min(1 - 1e-9, x / w));
    const ch = viewEnd - 1 - Math.floor(t * seg);
    if (!Number.isFinite(ch)) return null;
    return ch;
  }

  function floatChannelFromClientX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const w = canvas.width || rect.width;
    if (!(w > 0)) return null;
    const seg = viewEnd - viewStart;
    if (!(seg > 0)) return null;
    const ch = viewEnd - 1 - (x / w) * seg;
    if (!Number.isFinite(ch)) return null;
    return Math.max(0, Math.min(totalChannels - 1, ch));
  }

  const activeTouchX = new Map();

  /** Most zoomed-in window (channels); cap prevents extreme pixel zoom; never wider than route. */
  const MIN_VIEW_CHANNELS = Math.min(200, totalChannels);
  /** Most zoomed-out = full route (all mileposts along the fiber in channel table). */
  const MAX_VIEW_CHANNELS = totalChannels;

  /** Reset view to known-good defaults if state is corrupted. */
  function resetViewIfInvalid() {
    if (!Number.isFinite(viewStart) || !Number.isFinite(viewEnd)
        || viewStart < 0 || viewEnd > totalChannels || viewEnd <= viewStart) {
      viewStart = 0;
      viewEnd = totalChannels;
    }
  }

  /** Pan the horizontal window by integer channel delta (touch swipe). */
  function applyHorizontalScroll(deltaCh) {
    resetViewIfInvalid();
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
  function applyWheelZoomAtClientX(clientX, deltaY) {
    const range = viewEnd - viewStart;
    if (!(range > 0)) return;
    const focal = floatChannelFromClientX(clientX);
    if (focal === null || !Number.isFinite(focal)) return;
    const sign = Math.sign(deltaY);
    const zoomInFactor = 1.26;
    const zoomOutFactor = 1.22;
    let newRange = sign > 0 ? range * zoomOutFactor : range / zoomInFactor;
    newRange = Math.max(MIN_VIEW_CHANNELS, Math.min(MAX_VIEW_CHANNELS, Math.round(newRange)));
    if (!Number.isFinite(newRange) || newRange < 1) return;
    const frac = (viewEnd - 1 - focal) / range;
    let newEnd = focal + 1 + frac * newRange;
    let newStart = newEnd - newRange;
    if (!Number.isFinite(newStart) || !Number.isFinite(newEnd)) return;
    if (newStart < 0) {
      newStart = 0;
      newEnd = Math.min(totalChannels, newStart + newRange);
    }
    if (newEnd > totalChannels) {
      newEnd = totalChannels;
      newStart = Math.max(0, newEnd - newRange);
    }
    viewStart = Math.floor(newStart);
    viewEnd = Math.ceil(newEnd);
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
      if (ch === null) return;
      zoomViewportTowardChannel(ch, 1.38);
      plotChannelPickCallback(ch);
      requestRender();
    }, 280);
  }

  function cancelScheduledPlotPick() {
    if (plotPickTimer) {
      window.clearTimeout(plotPickTimer);
      plotPickTimer = null;
    }
  }

  /** Coalesce redraws during wheel / pinch so the heatmap tracks the view immediately. */
  let renderRaf = 0;
  function requestRender() {
    if (renderRaf) return;
    renderRaf = globalThis.requestAnimationFrame(() => {
      renderRaf = 0;
      render();
    });
  }

  resize();
  window.addEventListener('resize', resize);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    applyWheelZoomAtClientX(e.clientX, e.deltaY);
    requestRender();
  }, { passive: false });

  /** Single-finger tap target (plot zoom + map fly); cleared when a second finger joins (pinch). */
  let wfTouchTap = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button === 0) {
      wfMouseDown = {
        pointerId: e.pointerId,
        originClientX: e.clientX,
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
        wfTouchTap = null;
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
        wfTouchTap = {
          pointerId: e.pointerId,
          originX: e.clientX,
          movedPx: 0,
        };
        wfTouchPan = { pointerId: e.pointerId, lastClientX: e.clientX };
      }
    }
    hoveredChannel = channelFromClientX(e.clientX);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (wfMouseDown && e.pointerId === wfMouseDown.pointerId && e.pointerType === 'mouse') {
      const dx = e.clientX - wfMouseDown.originClientX;
      wfMouseDown.movedPx = Math.max(wfMouseDown.movedPx, Math.abs(dx));
      if (wfMouseDown.movedPx > 8) {
        wfPanPickSuppressed = true;
        cancelScheduledPlotPick();
      }
    }
    if (e.pointerType === 'touch' && activeTouchX.has(e.pointerId)) {
      activeTouchX.set(e.pointerId, e.clientX);

      if (wfTouchTap && e.pointerId === wfTouchTap.pointerId) {
        wfTouchTap.movedPx = Math.max(
          wfTouchTap.movedPx,
          Math.abs(e.clientX - wfTouchTap.originX),
        );
      }

      if (wfPinch && activeTouchX.has(wfPinch.idA) && activeTouchX.has(wfPinch.idB)) {
        const xa = activeTouchX.get(wfPinch.idA);
        const xb = activeTouchX.get(wfPinch.idB);
        const dist = Math.abs(xb - xa);
        if (wfPinch.dist0 > 1 && dist > 1) {
          let newRange = Math.round(wfPinch.range0 * (wfPinch.dist0 / dist));
          newRange = Math.max(MIN_VIEW_CHANNELS, Math.min(MAX_VIEW_CHANNELS, newRange));
          const c = wfPinch.centerCh;
          if (Number.isFinite(c) && Number.isFinite(newRange)) {
            viewStart = Math.max(0, Math.floor(c - newRange / 2));
            viewEnd = Math.min(totalChannels, viewStart + newRange);
            if (viewEnd - viewStart < newRange) viewStart = Math.max(0, viewEnd - newRange);
          }
          requestRender();
        }
      } else if (
        wfTouchPan && e.pointerId === wfTouchPan.pointerId
        && activeTouchX.size === 1 && !wfPinch
      ) {
        const w = canvas.width || canvas.getBoundingClientRect().width;
        const range = viewEnd - viewStart;
        if (w > 0 && range > 0) {
          const dx = e.clientX - wfTouchPan.lastClientX;
          wfTouchPan.lastClientX = e.clientX;
          const deltaCh = Math.round(-dx * (range / w));
          if (deltaCh !== 0) {
            applyHorizontalScroll(deltaCh);
            requestRender();
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
    if (wfMouseDown && e.pointerId === wfMouseDown.pointerId && e.pointerType === 'mouse') {
      if (e.button === 0 && wfMouseDown.movedPx <= 8 && plotChannelPickCallback) {
        schedulePlotChannelPick(e.clientX);
      }
      wfMouseDown = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }

    if (e.pointerType === 'touch') {
      const wasTap = wfTouchTap
        && e.pointerId === wfTouchTap.pointerId
        && wfTouchTap.movedPx <= 14
        && plotChannelPickCallback;
      activeTouchX.delete(e.pointerId);
      if (wfPinch && (e.pointerId === wfPinch.idA || e.pointerId === wfPinch.idB)) wfPinch = null;
      if (wfTouchTap && e.pointerId === wfTouchTap.pointerId) wfTouchTap = null;
      if (wfTouchPan && e.pointerId === wfTouchPan.pointerId) wfTouchPan = null;
      if (activeTouchX.size === 1) {
        const rid = [...activeTouchX.keys()][0];
        const rx = activeTouchX.get(rid) ?? 0;
        wfTouchTap = { pointerId: rid, originX: rx, movedPx: 0 };
        wfTouchPan = { pointerId: rid, lastClientX: rx };
      }
      if (wasTap && activeTouchX.size === 0) {
        schedulePlotChannelPick(e.clientX);
      }
    } else {
      activeTouchX.delete(e.pointerId);
      if (wfPinch && (e.pointerId === wfPinch.idA || e.pointerId === wfPinch.idB)) wfPinch = null;
    }

    if (e.pointerType === 'touch' && activeTouchX.size === 0) {
      hoveredChannel = null;
    }
  });

  canvas.addEventListener('pointercancel', (e) => {
    if (wfMouseDown && e.pointerId === wfMouseDown.pointerId) wfMouseDown = null;
    activeTouchX.delete(e.pointerId);
    wfTouchTap = null;
    wfTouchPan = null;
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

    resetViewIfInvalid();
    if (trackChannel !== null) {
      scrollTrackChannelIntoView(trackChannel);
    }

    const imageData = ctx.createImageData(width, height);
    const pix = imageData.data;
    const chanRange = viewEnd - viewStart;
    const rowH = height / HISTORY_ROWS;

    // Fixed reference range: ambient stays deep blue; vehicle peaks use most of the jet
    // (greens through oranges/reds) with class + speed spread; capped tail avoids maroon slab.
    const vmin = 0.0;
    const vmax = 1.02;
    const span = vmax - vmin;
    /** Pull quiet samples toward cooler LUT indices; paired with high-end val nudge below for red trace cores. */
    const gamma = 0.91;

    // When zoomed out, many channels map to a single pixel.  Point-sampling
    // one channel per pixel misses narrow vehicle traces entirely.  Instead,
    // take the MAX value across the channel span covered by each pixel so
    // vehicle energy is never discarded during down-sampling.
    const channelsPerPx = chanRange / Math.max(1, width);

    for (let row = 0; row < HISTORY_ROWS; row++) {
      const bufRow = (currentRow - 1 - row + HISTORY_ROWS * 2) % HISTORY_ROWS;
      const y0 = Math.floor(row * rowH);
      const y1 = Math.max(y0 + 1, Math.floor((row + 1) * rowH));
      const rowOff = bufRow * totalChannels;

      for (let px = 0; px < width; px++) {
        const tL = px / width;
        const tR = (px + 1) / width;
        const chHi = viewEnd - 1 - Math.floor(tL * chanRange);
        const chLo = viewEnd - 1 - Math.floor(tR * chanRange);
        const lo = Math.max(0, Math.min(chLo, chHi));
        const hi = Math.min(totalChannels - 1, Math.max(chLo, chHi));

        let raw;
        if (channelsPerPx <= 1.5) {
          raw = buffer[rowOff + Math.min(totalChannels - 1, Math.max(0, lo))];
        } else {
          raw = 0;
          for (let c = lo; c <= hi; c++) {
            const v = buffer[rowOff + c];
            if (v > raw) raw = v;
          }
        }

        const norm = (Math.min(vmax, Math.max(vmin, raw)) - vmin) / span;
        const n = Math.min(1, Math.max(0, norm));
        let val = n ** gamma;
        // Only strong rows (vehicles) reach this — nudges them toward saturated red without warming noise.
        if (n > 0.675) {
          const w = ((n - 0.675) / (1 - 0.675)) ** 1.2;
          val = Math.min(1, val + (1 - val) * 0.22 * w);
        }
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

    // Traffic lab: dim off-channel area and draw a soft neon band + line at the tracked channel
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
      grd.addColorStop(0, 'rgba(255,82,82,0)');
      grd.addColorStop(0.5, 'rgba(255,82,82,0.22)');
      grd.addColorStop(1, 'rgba(255,82,82,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(xCenter - bandPx / 2, 0, bandPx, height);
      ctx.shadowColor = 'rgba(255, 71, 102, 0.95)';
      ctx.shadowBlur = 14;
      ctx.strokeStyle = 'rgba(255, 138, 148, 0.92)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xCenter, 0);
      ctx.lineTo(xCenter, height);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Fiber–road crossing guides are available in `crossingChannels` but omitted
    // from the default view to keep the plot clean for educational use.  They add
    // vertical amber lines at every road crossing and are distracting when the
    // primary goal is spotting vehicle diagonal traces.

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

  /** Zoom in toward a channel (for plot pick / map sync); keeps context like a click on the plot. */
  function zoomChannelIntoView(ch, factor = 1.35) {
    if (!Number.isFinite(ch)) return;
    const ci = Math.max(0, Math.min(totalChannels - 1, Math.floor(ch)));
    zoomViewportTowardChannel(ci, factor);
  }

  /** Programmatically zoom so [start, end) channels are visible. */
  function setViewRange(start, end) {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    const lo = Math.max(0, Math.floor(start));
    const hi = Math.min(totalChannels, Math.ceil(end));
    const range = Math.max(MIN_VIEW_CHANNELS, hi - lo);
    viewStart = lo;
    viewEnd = Math.min(totalChannels, lo + range);
    if (viewEnd > totalChannels) {
      viewEnd = totalChannels;
      viewStart = Math.max(0, viewEnd - range);
    }
  }

  return {
    pushRow,
    render,
    channelBias,
    getViewRange: () => [viewStart, viewEnd],
    setViewRange,
    setHighlightChannel,
    setTrackChannel,
    scrollChannelIntoView,
    scrollTrackChannelIntoView,
    zoomChannelIntoView,
    resize,
    setPlotChannelPickCallback,
  };
}
