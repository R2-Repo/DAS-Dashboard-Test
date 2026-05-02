/**
 * Vite base URL for static assets and fetch paths (GitHub Pages project sites use a subpath).
 */
export function getBaseUrl() {
  const base = import.meta.env.BASE_URL ?? '/';
  return base.endsWith('/') ? base : `${base}/`;
}
