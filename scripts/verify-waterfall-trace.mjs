/**
 * Headless check: demo fleet produces warm (yellow/red) jet pixels on the waterfall canvas,
 * not only washed-out cyan from low-amplitude traces.
 */
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VITE_CLI = join(ROOT, 'node_modules/vite/bin/vite.js');
const CHROME =
  process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/local/bin/google-chrome';
const ARTIFACT_DIR = process.env.CURSOR_ARTIFACT_DIR || '/opt/cursor/artifacts';

function waitForPort(port, host = '127.0.0.1', timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function tryOnce() {
      const socket = createConnection({ port, host }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timeout waiting for ${host}:${port}`));
        } else {
          setTimeout(tryOnce, 100);
        }
      });
    }
    tryOnce();
  });
}

async function main() {
  const port = Number(process.env.VERIFY_WATERFALL_PORT || 4178);
  const preview = spawn(process.execPath, [VITE_CLI, 'preview', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  /** @type {import('puppeteer-core').Browser | undefined} */
  let browser;

  try {
    await waitForPort(port);
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900'],
    });
    const page = await browser.newPage();
    page.on('pageerror', (err) => console.error('pageerror:', err.message));

    await page.goto(`http://127.0.0.1:${port}/?nosplash`, { waitUntil: 'load', timeout: 90000 });

    await page.waitForSelector('#waterfall-canvas', { timeout: 60000 });

    await page.evaluate(() => {
      document.getElementById('btn-demo-fleet')?.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    await page.evaluate(() => {
      document.getElementById('btn-demo-fleet-run')?.click();
    });
    await new Promise((r) => setTimeout(r, 3200));

    const stats = await page.evaluate(() => {
      const canvas = document.querySelector('#waterfall-canvas');
      if (!canvas || canvas.width < 16 || canvas.height < 16) {
        return { error: 'bad canvas' };
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return { error: 'no 2d context' };
      const { width: w, height: h } = canvas;
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      let warm = 0;
      let maxR = 0;
      let maxLum = 0;
      const n = w * h;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        const R = d[o];
        const G = d[o + 1];
        const B = d[o + 2];
        maxR = Math.max(maxR, R);
        maxLum = Math.max(maxLum, 0.299 * R + 0.587 * G + 0.114 * B);
        // Yellow → orange → red on jet (exclude bright cyan: high G/B, weak R)
        if (R > 135 && G > 105 && B < 155 && R > B + 35) warm++;
      }
      return { warm, maxR, maxLum: Math.round(maxLum), w, h };
    });

    if (stats.error) {
      throw new Error(String(stats.error));
    }

    try {
      mkdirSync(ARTIFACT_DIR, { recursive: true });
      const shot = await page.screenshot({ type: 'png' });
      writeFileSync(join(ARTIFACT_DIR, 'verify-waterfall.png'), shot);
    } catch {
      /* optional artifact */
    }

    const warmEnough = stats.warm >= 28 || stats.maxR >= 210;
    if (!warmEnough) {
      throw new Error(
        `Waterfall trace looks too cold (warmPixels=${stats.warm}, maxR=${stats.maxR}, maxLum=${stats.maxLum}). Expected yellow→red jet from vehicle stamps.`,
      );
    }

    console.log(
      `verify-waterfall-trace OK: warm=${stats.warm} maxR=${stats.maxR} maxLum=${stats.maxLum} canvas=${stats.w}x${stats.h}`,
    );
  } finally {
    preview.kill('SIGTERM');
    await browser?.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
