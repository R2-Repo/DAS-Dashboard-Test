/**
 * DAS Waterfall renderer — realistic jet colormap waterfall display.
 *
 * Axes: X = channel/fiber distance (horizontal), Y = time (vertical, newest at top flowing downward — matches common DAS waterfall plots).
 * Colormap: standard jet — deep blue → cyan → green → yellow → orange → red.
 *
 * Real DAS physics:
 *   - 2m channel spacing
 *   - 10 Hz sample rate (100ms per row)
 *   - 256 rows visible = 25.6 seconds of history
 *   - Vehicle at 45 mph ≈ 1 channel/tick → diagonal slope depends on horizontal zoom
 */

const HISTORY_ROWS = 256;

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

export function initWaterfall(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  const totalChannels = data.channels.length;

  let viewStart = 0;
  let viewEnd = totalChannels;
  const buffer = new Float32Array(totalChannels * HISTORY_ROWS);
  let currentRow = 0;
  let hoveredChannel = null;
  /** Traffic lab: emphasize one channel column (integer index or null). */
  let highlightChannel = null;

  /** One-finger pan / two-finger pinch on the waterfall (touch). */
  let wfTouchPan = null; // { pointerId, lastClientX }
  let wfPinch = null; // { idA, idB, dist0, range0, centerCh }

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

  // Base bias: smooth low-frequency variation across fiber
  for (let i = 0; i < totalChannels; i++) {
    channelBias[i] = 0.03
      + 0.015 * Math.sin(i * 0.002)
      + 0.01 * Math.sin(i * 0.0073)
      + 0.008 * Math.sin(i * 0.019);
  }

  // Noisy channels: fiber coupling imperfections
  for (let i = 0; i < totalChannels; i++) {
    if (Math.random() < 0.04) {
      const spread = 1 + Math.floor(Math.random() * 3);
      const extra = 0.04 + Math.random() * 0.10;
      for (let d = -spread; d <= spread; d++) {
        const idx = i + d;
        if (idx >= 0 && idx < totalChannels) {
          channelBias[idx] += extra * (1 - Math.abs(d) / (spread + 1));
        }
      }
    }
  }

  // Persistent horizontal bands (visible in all reference images)
  for (let b = 0; b < 20; b++) {
    const center = Math.floor(Math.random() * totalChannels);
    const halfWidth = 1 + Math.floor(Math.random() * 6);
    const strength = 0.05 + Math.random() * 0.15;
    for (let d = -halfWidth; d <= halfWidth; d++) {
      const idx = center + d;
      if (idx >= 0 && idx < totalChannels) {
        channelBias[idx] += strength * (1 - Math.abs(d) / (halfWidth + 1));
      }
    }
  }

  // Crossing zones: elevated baseline near fiber-road crossings
  for (const ch of data.channels) {
    if (ch.crossing_flag) {
      channelBias[ch.channel_id] += 0.06 + Math.random() * 0.04;
    }
  }

  // Canyon mouth end is noisier (more ambient road/traffic vibration)
  for (let i = 0; i < Math.min(400, totalChannels); i++) {
    channelBias[i] += 0.02 * (1 - i / 400);
  }

  // Pre-fill buffer with baseline noise so waterfall has texture immediately
  for (let row = 0; row < HISTORY_ROWS; row++) {
    const offset = row * totalChannels;
    for (let i = 0; i < totalChannels; i++) {
      buffer[offset + i] = channelBias[i] + Math.random() * 0.015;
    }
  }

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const headerH = canvas.parentElement.querySelector('.waterfall-header')?.offsetHeight || 24;
    canvas.width = rect.width;
    canvas.height = rect.height - headerH;
  }

  function channelFromClientX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const w = canvas.width || rect.width;
    if (w <= 0) return null;
    return viewStart + Math.floor((x / w) * (viewEnd - viewStart));
  }

  function floatChannelFromClientX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const w = canvas.width || rect.width;
    if (w <= 0) return null;
    const ch = viewStart + (x / w) * (viewEnd - viewStart);
    return Math.max(0, Math.min(totalChannels - 1, ch));
  }

  const activeTouchX = new Map();

  function applyWheelDelta(deltaY, shiftKey) {
    const range = viewEnd - viewStart;
    const delta = Math.sign(deltaY) * Math.max(5, Math.floor(range * 0.04));
    if (shiftKey) {
      const newRange = Math.max(80, Math.min(totalChannels, range + delta * 8));
      const center = (viewStart + viewEnd) / 2;
      viewStart = Math.max(0, Math.floor(center - newRange / 2));
      viewEnd = Math.min(totalChannels, viewStart + newRange);
    } else {
      viewStart = Math.max(0, viewStart + delta);
      viewEnd = Math.min(totalChannels, viewEnd + delta);
      if (viewEnd - viewStart < 80) viewStart = Math.max(0, viewEnd - 80);
    }
  }

  resize();
  window.addEventListener('resize', resize);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    applyWheelDelta(e.deltaY, e.shiftKey);
  }, { passive: false });

  canvas.addEventListener('pointerdown', (e) => {
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
    if (e.pointerType === 'touch' && activeTouchX.has(e.pointerId)) {
      activeTouchX.set(e.pointerId, e.clientX);

      if (wfPinch && activeTouchX.has(wfPinch.idA) && activeTouchX.has(wfPinch.idB)) {
        const xa = activeTouchX.get(wfPinch.idA);
        const xb = activeTouchX.get(wfPinch.idB);
        const dist = Math.abs(xb - xa);
        if (wfPinch.dist0 > 1 && dist > 1) {
          let newRange = Math.round(wfPinch.range0 * (wfPinch.dist0 / dist));
          newRange = Math.max(80, Math.min(totalChannels, newRange));
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
    activeTouchX.delete(e.pointerId);
    if (wfTouchPan && wfTouchPan.pointerId === e.pointerId) wfTouchPan = null;
    if (wfPinch && (e.pointerId === wfPinch.idA || e.pointerId === wfPinch.idB)) wfPinch = null;
    if (e.pointerType === 'touch' && activeTouchX.size === 0) {
      hoveredChannel = null;
    }
  });

  canvas.addEventListener('pointercancel', (e) => {
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

    for (let row = 0; row < HISTORY_ROWS; row++) {
      // Newest sample at top (row 0); ring slot about to be overwritten (currentRow) at bottom.
      const bufRow = (currentRow - 1 - row + HISTORY_ROWS * 2) % HISTORY_ROWS;
      const y0 = Math.floor(row * rowH);
      const y1 = Math.max(y0 + 1, Math.floor((row + 1) * rowH));

      for (let px = 0; px < width; px++) {
        const ch = viewStart + Math.floor((px / width) * chanRange);
        if (ch < 0 || ch >= totalChannels) continue;

        const raw = buffer[bufRow * totalChannels + ch];
        // Gamma compress to keep most of the range in blues with signals popping to warm colors
        const val = Math.pow(Math.min(1, Math.max(0, raw)), 0.65);
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
      const xCenter = ((highlightChannel - viewStart) / chanRange) * width;
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

    // Crosshair
    if (hoveredChannel !== null && hoveredChannel >= viewStart && hoveredChannel < viewEnd) {
      const x = ((hoveredChannel - viewStart) / chanRange) * width;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Bottom axis: milepost labels
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px monospace';
    const labelStep = Math.max(1, Math.floor(chanRange / 8));
    for (let i = viewStart; i < viewEnd; i += labelStep) {
      const x = ((i - viewStart) / chanRange) * width;
      const ch = data.channels[i];
      if (ch) ctx.fillText(`MP ${ch.milepost.toFixed(1)}`, x + 2, height - 3);
    }

    // Hover info
    const infoEl = document.getElementById('waterfall-info');
    if (infoEl && hoveredChannel !== null && data.channels[hoveredChannel]) {
      const ch = data.channels[hoveredChannel];
      infoEl.textContent = `Ch ${ch.channel_id} | MP ${ch.milepost.toFixed(2)} | ${ch.fiber_distance_m}m | ${ch.side_of_road}`;
    }
  }

  return { pushRow, render, channelBias, getViewRange: () => [viewStart, viewEnd], setHighlightChannel, scrollChannelIntoView, resize };
}
