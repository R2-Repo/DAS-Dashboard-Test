/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('runSplashGate', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete global.document;
    delete global.window;
  });

  it('does not resolve until Continue is clicked', async () => {
    let clickHandler;
    const btn = {
      addEventListener: vi.fn((_, fn) => {
        clickHandler = fn;
      }),
      disabled: false,
      textContent: '',
      focus: vi.fn(),
    };
    const root = { hidden: false, setAttribute: vi.fn() };
    const app = { setAttribute: vi.fn(), removeAttribute: vi.fn() };

    global.document = {
      getElementById: (id) => {
        if (id === 'splash-screen') return root;
        if (id === 'splash-dismiss') return btn;
        if (id === 'app') return app;
        return null;
      },
    };
    global.window = {
      location: { search: '' },
      URLSearchParams: class {
        constructor() {
          this.has = () => false;
        }
      },
      requestAnimationFrame: (cb) => cb(),
    };

    const { runSplashGate } = await import('../src/splash.js');
    const dataPromise = Promise.resolve({ ok: true });
    const gatePromise = runSplashGate(() => dataPromise);

    await Promise.resolve();
    await expect(Promise.race([gatePromise, Promise.resolve('pending')])).resolves.toBe('pending');

    await clickHandler();
    await expect(gatePromise).resolves.toEqual({ ok: true });
    expect(root.hidden).toBe(true);
    expect(app.removeAttribute).toHaveBeenCalledWith('inert');
  });

  it('awaits loadData on Continue before resolving', async () => {
    let clickHandler;
    const btn = {
      addEventListener: vi.fn((_, fn) => {
        clickHandler = fn;
      }),
      disabled: false,
      textContent: '',
      focus: vi.fn(),
    };
    const root = { hidden: false, setAttribute: vi.fn() };
    const app = { setAttribute: vi.fn(), removeAttribute: vi.fn() };

    global.document = {
      getElementById: (id) => {
        if (id === 'splash-screen') return root;
        if (id === 'splash-dismiss') return btn;
        if (id === 'app') return app;
        return null;
      },
    };
    global.window = {
      location: { search: '' },
      URLSearchParams: class {
        constructor() {
          this.has = () => false;
        }
      },
      requestAnimationFrame: (cb) => cb(),
    };

    let resolveLoad;
    const loadPromise = new Promise((r) => {
      resolveLoad = r;
    });

    const { runSplashGate } = await import('../src/splash.js');
    const gatePromise = runSplashGate(() => loadPromise);

    const afterClick = clickHandler();
    await Promise.resolve();
    resolveLoad({ routes: 1 });
    await afterClick;

    await expect(gatePromise).resolves.toEqual({ routes: 1 });
  });
});
