/**
 * Full-screen splash shown on every load; user must dismiss before using the app.
 * Loads data in parallel; if the user dismisses before load completes, the button shows loading until data is ready.
 */

/**
 * @param {() => Promise<unknown>} loadData
 * @returns {Promise<unknown>}
 */
export async function runSplashGate(loadData) {
  const root = document.getElementById('splash-screen');
  const btn = document.getElementById('splash-dismiss');
  const app = document.getElementById('app');
  if (!root || !btn || !app) {
    return loadData();
  }

  app.setAttribute('inert', '');

  const dataPromise = loadData();
  let dataReady = false;
  dataPromise.finally(() => {
    dataReady = true;
  });

  btn.addEventListener(
    'click',
    async () => {
      if (!dataReady) {
        btn.disabled = true;
        btn.textContent = 'Loading route data…';
        try {
          await dataPromise;
        } catch {
          /* loadData may reject; boot() will surface errors */
        }
      }
      root.hidden = true;
      root.setAttribute('aria-hidden', 'true');
      app.removeAttribute('inert');
      btn.disabled = false;
      btn.textContent = 'Continue';
    },
    { once: true },
  );

  window.requestAnimationFrame(() => {
    btn.focus();
  });

  return dataPromise;
}
