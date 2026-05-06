/**
 * Short numeric label for fleet vehicles (matches VEH-#### ids from simulation).
 */
export function fleetDisplayNumberFromId(id) {
  const m = /^VEH-(\d+)$/i.exec(String(id ?? '').trim());
  if (m) return String(Number.parseInt(m[1], 10));
  return String(id ?? '');
}
