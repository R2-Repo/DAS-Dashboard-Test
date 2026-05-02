"""
Generate sample GeoJSON data for Big Cottonwood Canyon (SR-190) development.
This creates plausible sample data so the dashboard works before real GIS data is added.
"""

import json
import math
import os

# Big Cottonwood Canyon approximate coordinates (SR-190)
# From canyon mouth (~Wasatch Blvd) up to Brighton/Solitude area
ROAD_COORDS = [
    [-111.7952, 40.6232],
    [-111.7920, 40.6218],
    [-111.7885, 40.6198],
    [-111.7848, 40.6183],
    [-111.7810, 40.6170],
    [-111.7770, 40.6158],
    [-111.7728, 40.6148],
    [-111.7685, 40.6142],
    [-111.7640, 40.6138],
    [-111.7598, 40.6128],
    [-111.7555, 40.6112],
    [-111.7510, 40.6098],
    [-111.7468, 40.6088],
    [-111.7425, 40.6075],
    [-111.7380, 40.6060],
    [-111.7335, 40.6048],
    [-111.7288, 40.6038],
    [-111.7240, 40.6030],
    [-111.7195, 40.6018],
    [-111.7148, 40.6005],
    [-111.7100, 40.5992],
    [-111.7055, 40.5978],
    [-111.7008, 40.5965],
    [-111.6960, 40.5955],
    [-111.6912, 40.5945],
    [-111.6865, 40.5938],
    [-111.6818, 40.5930],
    [-111.6770, 40.5925],
    [-111.6722, 40.5918],
    [-111.6675, 40.5910],
    [-111.6628, 40.5902],
    [-111.6580, 40.5895],
    [-111.6535, 40.5888],
    [-111.6488, 40.5882],
    [-111.6440, 40.5878],
    [-111.6395, 40.5875],
    [-111.6348, 40.5870],
    [-111.6300, 40.5862],
    [-111.6255, 40.5855],
    [-111.6210, 40.5850],
    [-111.6165, 40.5848],
    [-111.6120, 40.5845],
    [-111.6075, 40.5840],
    [-111.6030, 40.5832],
    [-111.5985, 40.5822],
]

def offset_coords(coords, offset_m=15):
    """Offset coordinates slightly to simulate fiber not exactly on road."""
    result = []
    for i, (lon, lat) in enumerate(coords):
        angle = math.atan2(
            coords[min(i + 1, len(coords) - 1)][1] - coords[max(i - 1, 0)][1],
            coords[min(i + 1, len(coords) - 1)][0] - coords[max(i - 1, 0)][0],
        )
        perp = angle + math.pi / 2
        d = offset_m / 111320
        side = 1 if (i // 8) % 2 == 0 else -1
        result.append([
            lon + math.cos(perp) * d * side,
            lat + math.sin(perp) * d * side,
        ])
    return result


def make_fiber_segments(fiber_coords):
    """Split fiber into random segments to simulate un-optimized export."""
    segments = []
    i = 0
    while i < len(fiber_coords) - 1:
        seg_len = min(3 + (i * 7 % 5), len(fiber_coords) - i)
        segment = fiber_coords[i : i + seg_len]
        if len(segment) >= 2:
            segments.append(segment)
        i += seg_len - 1
    return segments


def generate_mileposts(road_coords, start_mp=8.0, end_mp=14.5):
    """Generate milepost points along the road."""
    total_dist = 0
    distances = [0]
    for i in range(1, len(road_coords)):
        dx = road_coords[i][0] - road_coords[i - 1][0]
        dy = road_coords[i][1] - road_coords[i - 1][1]
        d = math.sqrt(dx * dx + dy * dy) * 111320
        total_dist += d
        distances.append(total_dist)

    mp_range = end_mp - start_mp
    features = []
    mp = start_mp
    while mp <= end_mp:
        frac = (mp - start_mp) / mp_range
        target_dist = frac * total_dist
        for j in range(1, len(distances)):
            if distances[j] >= target_dist:
                seg_frac = (target_dist - distances[j - 1]) / (distances[j] - distances[j - 1])
                lon = road_coords[j - 1][0] + seg_frac * (road_coords[j][0] - road_coords[j - 1][0])
                lat = road_coords[j - 1][1] + seg_frac * (road_coords[j][1] - road_coords[j - 1][1])
                features.append({
                    "type": "Feature",
                    "properties": {
                        "milepost": round(mp, 1),
                        "label": f"MP {mp:.1f}",
                        "route_id": "SR-190",
                    },
                    "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                })
                break
        mp = round(mp + 0.1, 1)

    return {"type": "FeatureCollection", "features": features}


def find_crossings(fiber_coords, road_coords):
    """Find approximate points where fiber crosses the road."""
    crossings = []
    for i in range(1, len(fiber_coords)):
        dx = fiber_coords[i][0] - road_coords[min(i, len(road_coords) - 1)][0]
        dx_prev = fiber_coords[i - 1][0] - road_coords[min(i - 1, len(road_coords) - 1)][0]
        if (dx > 0) != (dx_prev > 0):
            mid_lon = (fiber_coords[i][0] + fiber_coords[i - 1][0]) / 2
            mid_lat = (fiber_coords[i][1] + fiber_coords[i - 1][1]) / 2
            crossings.append({
                "type": "Feature",
                "properties": {
                    "crossing_id": f"xing_{len(crossings) + 1:03d}",
                    "type": "fiber_road_crossing",
                },
                "geometry": {"type": "Point", "coordinates": [round(mid_lon, 6), round(mid_lat, 6)]},
            })
    return {"type": "FeatureCollection", "features": crossings}


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "data", "raw")
    os.makedirs(out_dir, exist_ok=True)

    road_geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"route_id": "SR-190", "name": "Big Cottonwood Canyon Road"},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[round(c[0], 6), round(c[1], 6)] for c in ROAD_COORDS],
                },
            }
        ],
    }
    with open(os.path.join(out_dir, "road.geojson"), "w") as f:
        json.dump(road_geojson, f, indent=2)

    fiber_coords = offset_coords(ROAD_COORDS)
    segments = make_fiber_segments(fiber_coords)
    fiber_features = []
    for idx, seg in enumerate(segments):
        fiber_features.append({
            "type": "Feature",
            "properties": {"segment_id": idx + 1},
            "geometry": {
                "type": "LineString",
                "coordinates": [[round(c[0], 6), round(c[1], 6)] for c in seg],
            },
        })
    fiber_geojson = {"type": "FeatureCollection", "features": fiber_features}
    with open(os.path.join(out_dir, "fiber.geojson"), "w") as f:
        json.dump(fiber_geojson, f, indent=2)

    mileposts_geojson = generate_mileposts(ROAD_COORDS)
    with open(os.path.join(out_dir, "mileposts.geojson"), "w") as f:
        json.dump(mileposts_geojson, f, indent=2)

    crossings_geojson = find_crossings(fiber_coords, ROAD_COORDS)
    with open(os.path.join(out_dir, "crossings.geojson"), "w") as f:
        json.dump(crossings_geojson, f, indent=2)

    print(f"Generated {len(fiber_features)} fiber segments")
    print(f"Generated {len(mileposts_geojson['features'])} milepost points")
    print(f"Generated {len(crossings_geojson['features'])} crossing points")
    print(f"Files written to {out_dir}")


if __name__ == "__main__":
    main()
