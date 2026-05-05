/**
 * Headless check: after placing a rock slide, deck.gl must build many extruded mass-hazard features.
 * Run with dev server: npm run dev -- --host 127.0.0.1 --port 5173
 *   E2E_SCREENSHOT=/tmp/hazard.png npm run test:e2e-hazard-deck
 */
import puppeteer from 'puppeteer-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
const CHROME = process.env.GOOGLE_CHROME_BIN ?? process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/local/bin/google-chrome';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      // Software WebGL for CI / headless (MapLibre + deck.gl need a GL context)
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const url = `${BASE.replace(/\/$/, '')}/?nosplash`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

  await page.waitForFunction(
    () => window.__dasExposeForAutomation?.sim?.addHazardAtLngLat,
    { timeout: 120000 },
  );

  const result = await page.evaluate(() => {
    const { map, sim, getHazardDeckHexColumnCount } = window.__dasExposeForAutomation;
    const center = map.getCenter();
    const before = getHazardDeckHexColumnCount(map);
    const placed = sim.addHazardAtLngLat('rock_slide', center.lng, center.lat, { magnitude: 1 });
    const after = getHazardDeckHexColumnCount(map);
    if (placed) {
      const ch = placed.anchorChannel ?? placed.channelCenter;
      if (typeof ch === 'number') sim.focusMapOnChannel(ch);
    }
    return {
      before,
      after,
      placedId: placed?.id ?? null,
      zoom: map.getZoom(),
    };
  });

  await sleep(2200);

  await page.evaluate(() => {
    const { map } = window.__dasExposeForAutomation;
    const z = map.getZoom();
    if (z < 17) map.jumpTo({ zoom: 17.4 });
  });

  await sleep(1800);

  if (!result.placedId) {
    console.error('FAIL: hazard was not placed (snap failed?)', result);
    await browser.close();
    process.exit(1);
  }
  if (result.after < 50) {
    console.error('FAIL: expected many deck.gl mass-hazard features after rock slide; got', result);
    await browser.close();
    process.exit(1);
  }

  if (process.env.E2E_SCREENSHOT) {
    const shotPath = process.env.E2E_SCREENSHOT;
    await sleep(2500);
    await page.screenshot({ path: shotPath, type: 'png' });
    console.log('Wrote screenshot:', shotPath);
    const clipPath = process.env.E2E_SCREENSHOT_MAP_CLIP;
    if (clipPath) {
      const clip = await page.evaluate(() => {
        const el = document.getElementById('map');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: Math.floor(r.left),
          y: Math.floor(r.top),
          width: Math.floor(r.width),
          height: Math.floor(r.height),
        };
      });
      if (clip && clip.width > 50 && clip.height > 50) {
        await page.screenshot({ path: clipPath, clip, type: 'png' });
        console.log('Wrote map-only screenshot:', clipPath);
      }
    }
  }

  await browser.close();

  console.log('PASS: deck.gl mass-hazard extrusions:', result.after, '(before:', `${result.before})`, 'hazard:', result.placedId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
