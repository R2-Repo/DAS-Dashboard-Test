import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** Production base URL for asset paths. '/' for root hosting; '/repo-name/' for GitHub project Pages. */
function resolveBase() {
  const explicit = process.env.VITE_BASE_URL?.trim();
  if (explicit) {
    const withSlash = explicit.endsWith('/') ? explicit : `${explicit}/`;
    return withSlash === '//' ? '/' : withSlash;
  }
  const repo = process.env.GITHUB_REPOSITORY;
  if (process.env.GITHUB_PAGES === 'true' && repo?.includes('/')) {
    const name = repo.split('/')[1];
    return `/${name}/`;
  }
  return '/';
}

export default defineConfig(({ mode }) => {
  const base = resolveBase();

  return {
    base,
    root: '.',
    publicDir: 'data',
    build: {
      outDir: 'dist',
    },
    server: {
      port: 5173,
      host: '0.0.0.0',
    },
    plugins: [
      ...(mode === 'test'
        ? []
        : [
            VitePWA({
              registerType: 'autoUpdate',
              injectRegister: 'auto',
              includeAssets: ['icons/*.png', 'icons/*.svg'],
              manifest: {
                name: 'DAS Canyon Dashboard',
                short_name: 'DAS Canyon',
                description:
                  'Distributed Acoustic Sensing roadway monitoring — SR-190 Big Cottonwood Canyon',
                theme_color: '#0f1422',
                background_color: '#0f1422',
                display: 'standalone',
                orientation: 'any',
                scope: base,
                start_url: base,
                icons: [
                  {
                    src: 'icons/pwa-192.png',
                    sizes: '192x192',
                    type: 'image/png',
                  },
                  {
                    src: 'icons/pwa-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                  },
                  {
                    src: 'icons/pwa-512-maskable.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable',
                  },
                ],
              },
              workbox: {
                globPatterns: ['**/*.{js,css,html,png,svg,ico,json,geojson}'],
                globIgnores: ['**/fiber_channels.json'],
                navigateFallback: `${base.replace(/\/$/, '') || ''}/index.html`,
                navigateFallbackDenylist: [/^\/api\//],
                runtimeCaching: [
                  {
                    urlPattern: ({ url }) => url.pathname.endsWith('/fiber_channels.json'),
                    handler: 'NetworkFirst',
                    options: {
                      cacheName: 'das-channel-data',
                      expiration: {
                        maxEntries: 2,
                        maxAgeSeconds: 60 * 60 * 24 * 7,
                      },
                      cacheableResponse: {
                        statuses: [0, 200],
                      },
                    },
                  },
                ],
              },
              devOptions: {
                enabled: false,
              },
            }),
          ]),
    ],
  };
});
