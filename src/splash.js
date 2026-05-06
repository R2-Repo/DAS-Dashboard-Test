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

  // Automation / dev: skip modal so headless browsers can load the dashboard directly.
  if (
    typeof window !== 'undefined'
    && new window.URLSearchParams(window.location?.search ?? '').has('nosplash')
  ) {
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    return loadData();
  }

  app.setAttribute('inert', '');

  const dataPromise = loadData();
  let dataReady = false;
  dataPromise.finally(() => {
    dataReady = true;
  });

  return new Promise((resolve, reject) => {
    btn.addEventListener(
      'click',
      async () => {
        try {
          if (!dataReady) {
            btn.disabled = true;
            btn.textContent = 'Loading route data…';
          }
          const data = await dataPromise;
          root.hidden = true;
          root.setAttribute('aria-hidden', 'true');
          app.removeAttribute('inert');
          btn.disabled = false;
          btn.textContent = 'Continue';
          resolve(data);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Continue';
          reject(err);
        }
      },
      { once: true },
    );

    window.requestAnimationFrame(() => {
      btn.focus();
    });
  });
}
