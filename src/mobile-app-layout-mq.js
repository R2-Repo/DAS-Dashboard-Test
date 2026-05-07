/**
 * Same media query as `initResponsiveLayout` in `main.js` — stack layout + tab bar.
 * Used for map tuning so framing / WebGL limits match the viewport that actually shows the map.
 */
export const MOBILE_APP_LAYOUT_MEDIA_QUERY =
  '(max-width: 768px), (max-width: 900px) and (max-height: 560px), (max-width: 1024px) and (max-height: 480px)';

export function matchesMobileAppLayout() {
  return (
    typeof globalThis !== 'undefined'
    && typeof globalThis.matchMedia === 'function'
    && Boolean(globalThis.matchMedia(MOBILE_APP_LAYOUT_MEDIA_QUERY).matches)
  );
}
