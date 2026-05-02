const HISTORY_ROWS = 180;
const VISIBLE_CHANNELS = 300;
const COLOR_STOPS = [
  [0, 10, 20, 40],
  [0, 30, 80, 180],
  [0, 60, 160, 255],
  [0, 20, 60, 120],
];

export function initWaterfall(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  const totalChannels = data.channels.length;

  let viewStart = 0;
  let viewEnd = Math.min(VISIBLE_CHANNELS, totalChannels);
  const buffer = new Float32Array(totalChannels * HISTORY_ROWS);
  let currentRow = 0;
  let hoveredChannel = null;

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const headerH = canvas.parentElement.querySelector('.waterfall-header')?.offsetHeight || 24;
    canvas.width = rect.width;
    canvas.height = rect.height - headerH;
  }

  resize();
  window.addEventListener('resize', resize);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = Math.sign(e.deltaY) * Math.max(10, Math.floor((viewEnd - viewStart) * 0.05));
    if (e.shiftKey) {
      const range = viewEnd - viewStart;
      const newRange = Math.max(50, Math.min(totalChannels, range + delta * 5));
      const center = (viewStart + viewEnd) / 2;
      viewStart = Math.max(0, Math.floor(center - newRange / 2));
      viewEnd = Math.min(totalChannels, viewStart + newRange);
    } else {
      viewStart = Math.max(0, viewStart + delta);
      viewEnd = Math.min(totalChannels, viewEnd + delta);
      if (viewEnd - viewStart < 50) {
        viewStart = Math.max(0, viewEnd - 50);
      }
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const channelRange = viewEnd - viewStart;
    hoveredChannel = viewStart + Math.floor((x / canvas.width) * channelRange);
  });

  canvas.addEventListener('mouseleave', () => {
    hoveredChannel = null;
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
    const pixels = imageData.data;
    const channelRange = viewEnd - viewStart;
    const rowHeight = height / HISTORY_ROWS;

    for (let row = 0; row < HISTORY_ROWS; row++) {
      const bufRow = (currentRow - HISTORY_ROWS + row + HISTORY_ROWS * 2) % HISTORY_ROWS;
      const y0 = Math.floor(row * rowHeight);
      const y1 = Math.floor((row + 1) * rowHeight);

      for (let px = 0; px < width; px++) {
        const ch = viewStart + Math.floor((px / width) * channelRange);
        if (ch < 0 || ch >= totalChannels) continue;

        const val = buffer[bufRow * totalChannels + ch];
        const clamped = Math.min(1, Math.max(0, val));
        const ci = Math.min(3, Math.floor(clamped * 4));
        const t = (clamped * 4) - ci;

        const r = lerp(COLOR_STOPS[0][ci], COLOR_STOPS[0][Math.min(3, ci + 1)], t);
        const g = lerp(COLOR_STOPS[1][ci], COLOR_STOPS[1][Math.min(3, ci + 1)], t);
        const b = lerp(COLOR_STOPS[2][ci], COLOR_STOPS[2][Math.min(3, ci + 1)], t);
        const a = lerp(COLOR_STOPS[3][ci], COLOR_STOPS[3][Math.min(3, ci + 1)], t);

        for (let y = y0; y < y1; y++) {
          const idx = (y * width + px) * 4;
          pixels[idx] = r;
          pixels[idx + 1] = g;
          pixels[idx + 2] = b;
          pixels[idx + 3] = Math.max(80, a);
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Draw crosshair for hovered channel
    if (hoveredChannel !== null && hoveredChannel >= viewStart && hoveredChannel < viewEnd) {
      const x = ((hoveredChannel - viewStart) / channelRange) * width;
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '10px monospace';
    const step = Math.max(1, Math.floor(channelRange / 6));
    for (let i = viewStart; i < viewEnd; i += step) {
      const x = ((i - viewStart) / channelRange) * width;
      const ch = data.channels[i];
      if (ch) {
        ctx.fillText(`MP ${ch.milepost.toFixed(1)}`, x + 2, height - 4);
      }
    }

    // Hovered channel info
    const infoEl = document.getElementById('waterfall-info');
    if (infoEl && hoveredChannel !== null && data.channels[hoveredChannel]) {
      const ch = data.channels[hoveredChannel];
      infoEl.textContent = `Ch ${ch.channel_id} | MP ${ch.milepost.toFixed(2)} | ${ch.fiber_distance_m}m | ${ch.side_of_road}`;
    }
  }

  return { pushRow, render, getViewRange: () => [viewStart, viewEnd] };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
