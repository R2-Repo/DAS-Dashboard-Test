/**
 * End-to-end check: splash dismiss → MapLibre canvas visible (not stuck behind veil).
 * Uses system Chrome via puppeteer-core; starts `vite preview` on a free port.
 */
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VITE_CLI = join(ROOT, 'node_modules/vite/bin/vite.js');
const CHROME =
  process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/local/bin/google-chrome';

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
  const port = Number(process.env.VERIFY_PREVIEW_PORT || 4177);
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
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
    });
    const page = await browser.newPage();
    page.on('pageerror', (err) => console.error('pageerror:', err.message));

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 60000 });

    await page.waitForSelector('#splash-dismiss', { timeout: 10000 });
    await page.click('#splash-dismiss');

    await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 });

    const { canvasW, canvasH, veilOpacity } = await page.evaluate(() => {
      const canvas = document.querySelector('.maplibregl-canvas');
      const veil = document.querySelector('#map-intro-loading-veil');
      const cs = veil ? getComputedStyle(veil) : null;
      return {
        canvasW: canvas?.width ?? 0,
        canvasH: canvas?.height ?? 0,
        veilOpacity: cs ? parseFloat(cs.opacity) : -1,
      };
    });

    if (canvasW < 64 || canvasH < 64) {
      throw new Error(`Map canvas too small: ${canvasW}x${canvasH}`);
    }

    // Veil may fade from cinematic path first; absolute failsafe + CSS fade can take ~13s worst case.
    await page.waitForFunction(
      () => {
        const veil = document.querySelector('#map-intro-loading-veil');
        if (!veil) return true;
        const o = parseFloat(getComputedStyle(veil).opacity);
        return o < 0.05 || veil.classList.contains('map-intro-loading-veil--fade-out');
      },
      { timeout: 20000 },
    );

    console.log('verify-map-load: OK (canvas %dx%d, initial veil opacity was %s)', canvasW, canvasH, veilOpacity);
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
    preview.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
  }
}

main().catch((err) => {
  console.error('verify-map-load: FAILED', err);
  process.exit(1);
});
