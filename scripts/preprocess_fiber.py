"""
Preprocess raw GIS data into clean datasets for the DAS Canyon Dashboard.

Input (data/raw/):
  - fiber.geojson    — fiber optic cable segments (may be disconnected/unordered)
  - road.geojson     — UDOT road centerline
  - mileposts.geojson — milepost points with 'milepost' property
  - crossings.geojson — (optional) known fiber-road crossing points

Output (data/):
  - fiber_route.geojson   — single continuous ordered fiber LineString
  - fiber_channels.json   — channel lookup table
  - fiber_crossings.geojson — detected crossing points
  - road.geojson          — road centerline (copied)
  - mileposts.geojson     — mileposts (copied)
  - simulation_config.json — config derived from the data extents
"""

import json
import math
import os
import sys

CHANNEL_SPACING_M = 2.0
CROSSING_THRESHOLD_M = 5.0
EARTH_RADIUS_M = 6371000

RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "raw")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data")


def haversine(lon1, lat1, lon2, lat2):
    """Distance in meters between two WGS84 points."""
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2) ** 2
    return EARTH_RADIUS_M * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def point_to_line_distance(px, py, lx1, ly1, lx2, ly2):
    """Perpendicular distance from point to line segment, in approximate meters."""
    dx, dy = lx2 - lx1, ly2 - ly1
    if dx == 0 and dy == 0:
        return haversine(px, py, lx1, ly1)
    t = max(0, min(1, ((px - lx1) * dx + (py - ly1) * dy) / (dx * dx + dy * dy)))
    proj_x = lx1 + t * dx
    proj_y = ly1 + t * dy
    return haversine(px, py, proj_x, proj_y)


def signed_offset(px, py, lx1, ly1, lx2, ly2):
    """Signed cross product to determine side of road. Positive = left, negative = right."""
    return (lx2 - lx1) * (py - ly1) - (ly2 - ly1) * (px - lx1)


def load_geojson(filepath):
    with open(filepath) as f:
        return json.load(f)


def extract_lines(geojson):
    """Extract all coordinate arrays from LineString/MultiLineString features."""
    lines = []
    for feat in geojson.get("features", []):
        geom = feat["geometry"]
        if geom["type"] == "LineString":
            lines.append(geom["coordinates"])
        elif geom["type"] == "MultiLineString":
            lines.extend(geom["coordinates"])
    return lines


def stitch_segments(segments):
    """Order and stitch disconnected line segments into a single continuous line.

    Uses nearest-endpoint greedy algorithm.
    """
    if not segments:
        return []
    if len(segments) == 1:
        return list(segments[0])

    remaining = [list(seg) for seg in segments]
    result = remaining.pop(0)

    while remaining:
        best_idx = None
        best_dist = float("inf")
        best_reverse = False
        best_end = "end"

        end_pt = result[-1]
        start_pt = result[0]

        for i, seg in enumerate(remaining):
            seg_start = seg[0]
            seg_end = seg[-1]

            d1 = haversine(end_pt[0], end_pt[1], seg_start[0], seg_start[1])
            d2 = haversine(end_pt[0], end_pt[1], seg_end[0], seg_end[1])
            d3 = haversine(start_pt[0], start_pt[1], seg_start[0], seg_start[1])
            d4 = haversine(start_pt[0], start_pt[1], seg_end[0], seg_end[1])

            candidates = [
                (d1, i, False, "end"),
                (d2, i, True, "end"),
                (d3, i, True, "start"),
                (d4, i, False, "start"),
            ]
            for d, idx, rev, attach_end in candidates:
                if d < best_dist:
                    best_dist = d
                    best_idx = idx
                    best_reverse = rev
                    best_end = attach_end

        seg = remaining.pop(best_idx)
        if best_reverse:
            seg = list(reversed(seg))

        if best_end == "end":
            result.extend(seg[1:] if best_dist < 1 else seg)
        else:
            result = seg + (result[1:] if best_dist < 1 else result)

    return result


def interpolate_along_line(coords, spacing_m):
    """Generate evenly spaced points along a polyline."""
    cum_dists = [0]
    for i in range(1, len(coords)):
        d = haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1])
        cum_dists.append(cum_dists[-1] + d)

    total_length = cum_dists[-1]
    points = []
    target_dist = 0
    seg_idx = 0

    while target_dist <= total_length:
        while seg_idx < len(cum_dists) - 1 and cum_dists[seg_idx + 1] < target_dist:
            seg_idx += 1

        if seg_idx >= len(cum_dists) - 1:
            break

        seg_len = cum_dists[seg_idx + 1] - cum_dists[seg_idx]
        if seg_len == 0:
            frac = 0
        else:
            frac = (target_dist - cum_dists[seg_idx]) / seg_len

        lon = coords[seg_idx][0] + frac * (coords[seg_idx + 1][0] - coords[seg_idx][0])
        lat = coords[seg_idx][1] + frac * (coords[seg_idx + 1][1] - coords[seg_idx][1])
        points.append({"lon": lon, "lat": lat, "fiber_distance_m": target_dist})
        target_dist += spacing_m

    return points, total_length


def find_nearest_road_info(point_lon, point_lat, road_coords):
    """Find nearest road segment and compute side-of-road."""
    best_dist = float("inf")
    best_seg_idx = 0
    best_side = 0

    for i in range(len(road_coords) - 1):
        d = point_to_line_distance(
            point_lon, point_lat,
            road_coords[i][0], road_coords[i][1],
            road_coords[i + 1][0], road_coords[i + 1][1],
        )
        if d < best_dist:
            best_dist = d
            best_seg_idx = i
            best_side = signed_offset(
                point_lon, point_lat,
                road_coords[i][0], road_coords[i][1],
                road_coords[i + 1][0], road_coords[i + 1][1],
            )

    side_label = "north" if best_side > 0 else "south" if best_side < 0 else "on_road"
    return best_dist, best_seg_idx, side_label


def interpolate_milepost(point_lon, point_lat, mp_features):
    """Interpolate milepost value from nearest milepost points."""
    dists = []
    for feat in mp_features:
        mp_coord = feat["geometry"]["coordinates"]
        d = haversine(point_lon, point_lat, mp_coord[0], mp_coord[1])
        dists.append((d, feat["properties"]["milepost"]))

    dists.sort(key=lambda x: x[0])

    if len(dists) < 2:
        return dists[0][1] if dists else 0

    d1, mp1 = dists[0]
    d2, mp2 = dists[1]
    total = d1 + d2
    if total == 0:
        return mp1
    return round(mp1 * (d2 / total) + mp2 * (d1 / total), 2)


def detect_crossings(channel_records, threshold_m=CROSSING_THRESHOLD_M):
    """Detect fiber-road crossings where side-of-road changes."""
    crossings = []
    crossing_id = 0
    for i in range(1, len(channel_records)):
        prev_side = channel_records[i - 1]["side_of_road"]
        curr_side = channel_records[i]["side_of_road"]
        if prev_side != curr_side and prev_side != "on_road" and curr_side != "on_road":
            crossing_id += 1
            mid_lon = (channel_records[i - 1]["lon"] + channel_records[i]["lon"]) / 2
            mid_lat = (channel_records[i - 1]["lat"] + channel_records[i]["lat"]) / 2
            crossings.append({
                "crossing_id": f"xing_{crossing_id:03d}",
                "channel_id": channel_records[i]["channel_id"],
                "lon": mid_lon,
                "lat": mid_lat,
                "milepost": channel_records[i]["milepost"],
            })

            for j in range(max(0, i - 2), min(len(channel_records), i + 3)):
                channel_records[j]["crossing_flag"] = True
                channel_records[j]["crossing_id"] = f"xing_{crossing_id:03d}"

    return crossings


def main():
    print("=== DAS Canyon Dashboard — Fiber Preprocessing ===\n")

    fiber_path = os.path.join(RAW_DIR, "fiber.geojson")
    road_path = os.path.join(RAW_DIR, "road.geojson")
    mp_path = os.path.join(RAW_DIR, "mileposts.geojson")

    for p, name in [(fiber_path, "fiber"), (road_path, "road"), (mp_path, "mileposts")]:
        if not os.path.exists(p):
            print(f"ERROR: {name} file not found at {p}")
            sys.exit(1)

    fiber_data = load_geojson(fiber_path)
    road_data = load_geojson(road_path)
    mp_data = load_geojson(mp_path)

    print(f"Loaded {len(fiber_data['features'])} fiber segments")
    segments = extract_lines(fiber_data)
    print(f"Extracted {len(segments)} line segments")

    road_lines = extract_lines(road_data)
    road_coords = road_lines[0] if road_lines else []
    print(f"Road centerline: {len(road_coords)} vertices")
    print(f"Mileposts: {len(mp_data['features'])} points")

    # Step 1: Stitch fiber segments
    print("\nStitching fiber segments...")
    fiber_line = stitch_segments(segments)
    print(f"Continuous fiber line: {len(fiber_line)} vertices")

    # Step 2: Generate channel points
    print(f"\nGenerating channel points (spacing={CHANNEL_SPACING_M}m)...")
    channel_points, total_length = interpolate_along_line(fiber_line, CHANNEL_SPACING_M)
    print(f"Total fiber length: {total_length:.0f}m")
    print(f"Generated {len(channel_points)} channel points")

    # Step 3: Enrich with road/milepost data
    print("\nEnriching channels with road + milepost data...")
    channel_records = []
    for idx, pt in enumerate(channel_points):
        road_dist, seg_idx, side = find_nearest_road_info(pt["lon"], pt["lat"], road_coords)
        mp = interpolate_milepost(pt["lon"], pt["lat"], mp_data["features"])

        channel_records.append({
            "channel_id": idx,
            "fiber_distance_m": round(pt["fiber_distance_m"], 2),
            "route_id": "SR-190",
            "route_name": "Big Cottonwood Canyon",
            "milepost": mp,
            "milepost_label": f"MP {mp:.1f}",
            "lat": round(pt["lat"], 6),
            "lon": round(pt["lon"], 6),
            "side_of_road": side,
            "crossing_flag": False,
            "crossing_id": None,
            "nearest_road_distance_m": round(road_dist, 2),
            "road_segment_id": f"seg_{seg_idx:04d}",
        })

    # Step 4: Detect crossings
    print("Detecting fiber-road crossings...")
    crossings = detect_crossings(channel_records)
    print(f"Found {len(crossings)} crossings")

    # Write outputs
    os.makedirs(OUT_DIR, exist_ok=True)

    fiber_route_geojson = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {"name": "Fiber Route", "length_m": round(total_length, 1)},
            "geometry": {
                "type": "LineString",
                "coordinates": [[round(c[0], 6), round(c[1], 6)] for c in fiber_line],
            },
        }],
    }
    with open(os.path.join(OUT_DIR, "fiber_route.geojson"), "w") as f:
        json.dump(fiber_route_geojson, f)
    print(f"\nWrote fiber_route.geojson")

    with open(os.path.join(OUT_DIR, "fiber_channels.json"), "w") as f:
        json.dump(channel_records, f)
    print(f"Wrote fiber_channels.json ({len(channel_records)} channels)")

    crossings_geojson = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": c,
            "geometry": {"type": "Point", "coordinates": [round(c["lon"], 6), round(c["lat"], 6)]},
        } for c in crossings],
    }
    with open(os.path.join(OUT_DIR, "fiber_crossings.geojson"), "w") as f:
        json.dump(crossings_geojson, f)
    print(f"Wrote fiber_crossings.geojson ({len(crossings)} crossings)")

    # Copy road + mileposts to output
    with open(os.path.join(OUT_DIR, "road.geojson"), "w") as f:
        json.dump(road_data, f)
    with open(os.path.join(OUT_DIR, "mileposts.geojson"), "w") as f:
        json.dump(mp_data, f)

    # Simulation config derived from data extents
    mp_values = [r["milepost"] for r in channel_records]
    sim_config = {
        "route_id": "SR-190",
        "route_name": "Big Cottonwood Canyon",
        "channel_count": len(channel_records),
        "channel_spacing_m": CHANNEL_SPACING_M,
        "fiber_length_m": round(total_length, 1),
        "milepost_start": min(mp_values),
        "milepost_end": max(mp_values),
        "crossing_count": len(crossings),
        "simulation_tick_ms": 500,
        "vehicle_spawn_interval_ticks": 6,
        "max_vehicles": 10,
    }
    with open(os.path.join(OUT_DIR, "simulation_config.json"), "w") as f:
        json.dump(sim_config, f, indent=2)
    print(f"Wrote simulation_config.json")

    print("\n=== Preprocessing complete ===")


if __name__ == "__main__":
    main()
