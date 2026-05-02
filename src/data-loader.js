export async function loadData() {
  const [fiberRoute, road, mileposts, crossings, channels, config] = await Promise.all([
    fetchJSON('/fiber_route.geojson'),
    fetchJSON('/road.geojson'),
    fetchJSON('/mileposts.geojson'),
    fetchJSON('/fiber_crossings.geojson'),
    fetchJSON('/fiber_channels.json'),
    fetchJSON('/simulation_config.json'),
  ]);

  return { fiberRoute, road, mileposts, crossings, channels, config };
}

async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load ${url}: ${resp.status}`);
  return resp.json();
}
