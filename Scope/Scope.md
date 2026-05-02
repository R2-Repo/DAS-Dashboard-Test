# Distributed Acoustic Sensing (DAS) Canyon Dashboard
## Research Brief + Build Plan + Agent Prompt

**Purpose:** This document is a practical background brief and implementation plan for building a **front-end dashboard** that simulates a **real-world distributed acoustic sensing (DAS)** system on a **fiber optic cable running along a canyon roadway**. The final dashboard must feel technically credible to domain experts while remaining simple enough for an MVP. It should support **synthetic data first** and later be designed so **real vendor DAS data** can replace the simulated feed with minimal frontend changes.

---

## 1) Project Summary

Build a **front-end-only prototype dashboard** that visualizes live or replayed DAS-derived activity along a fiber route in a canyon. The dashboard should combine:

1. A **waterfall / time-distance heatmap** representing DAS data.
2. An **interactive MapLibre map** showing the canyon road, fiber route, mileposts, and animated vehicles.
3. A **live event feed** that shows vehicle detections and occasional anomaly/hazard events.
4. A **road-centric location model** that reports detections by **route + milepost**, not just raw channel number.
5. A simulation mode that is realistic enough to demonstrate how a real-world DAS monitoring system would behave.

This is not meant to be a perfect scientific or physics-grade DAS simulator in V1. It **is** meant to be a realistic, GIS-grounded, data-science-informed interface and simulation framework that can later ingest real vendor data.

---

## 2) Key Design Philosophy

### Main principle
The dashboard should **not** force end users to interpret raw DAS data directly. Instead:

- The **waterfall plot** is the technical/engineering view.
- The primary user experience is **road events, vehicle tracks, speeds, mileposts, alerts, and map interactions**.

### What “real-world” means in this project
The simulation should be grounded in:

- the **actual GIS geometry** of the fiber route,
- the **actual road geometry**,
- **mileposts**,
- fiber crossings from one side of the road to the other,
- a plausible DAS channel model,
- a plausible event model,
- a credible mapping from **channel -> fiber distance -> route/milepost -> road-side context**.

The simulation does **not** need to reproduce full interrogator physics in V1.

---

## 3) Background Research Notes

## 3.1 What DAS is
Distributed Acoustic Sensing (DAS) turns a fiber optic cable into a dense line of virtual vibration/strain sensors. An interrogator sends repeated laser pulses into the fiber and measures changes in Rayleigh backscatter to infer vibration/strain activity along the fiber.

Common ways to describe DAS visually:

- **waterfall plot**
- **time-distance plot**
- **space-time plot**
- **spatiotemporal heatmap**

For traffic monitoring, moving vehicles often show up as **diagonal/linear features** in the time-space domain.

## 3.2 What a “channel” is
A **fiber channel** is best thought of as a virtual measurement location or sample position along the fiber. It is not exactly a perfect point sensor. In practice, a channel is related to:

- **gauge length** = the fiber interval used for the measurement,
- **channel spacing** = the distance between adjacent channels.

Typical spatial settings vary by system. A common concept is:

- gauge length may be around **10 m** (varies by vendor/settings),
- channel spacing may be **1–10 m**, often smaller than gauge length,
- channels may overlap depending on settings.

For this project, a **2 m channel spacing** is a reasonable simulation setting if it helps the UI and gives smooth motion.

## 3.3 What the raw data looks like
At the conceptual level, raw DAS data is usually a:

- **2D array / matrix**
- **time samples × channels**

So:

- rows = time steps
- columns = channels / distance along the fiber
- cell values = some signal value such as amplitude, strain, strain-rate, phase-derived quantity, or intensity

This is why the data naturally becomes a heatmap / waterfall plot.

## 3.4 Data volume is large
Raw DAS data can be very large. Depending on the system configuration, deployments can produce **hundreds of GB/day to TB/day** scale data. That means:

- raw DAS is not usually what a business/user-facing UI should consume directly,
- real systems often process, filter, detect, and reduce the data first,
- dashboards usually want **events**, **tracks**, **summaries**, and maybe a **downsampled raw view**.

## 3.5 Traffic monitoring interpretation
For traffic monitoring, a moving vehicle typically appears as a **diagonal streak** in the waterfall plot. The **slope** of the trajectory corresponds to velocity in the time-space domain. Opposite travel directions appear as diagonals with opposite orientations.

Conceptually:

- vehicle moving up canyon = channels increase over time
- vehicle moving down canyon = channels decrease over time

From a UI point of view, the user does not need the raw diagonal. The system should convert that to a **vehicle track object**.

## 3.6 Geohazard / anomaly interpretation
Events like:

- rockfall,
- landslide,
- impact,
- unusual vibration burst,
- wide-area disturbance,

would typically **not** look like simple clean vehicle tracks. They may appear as:

- bursts across nearby channels,
- short high-energy pulses,
- broad patches of energy,
- recurring impacts,
- unusual non-linear patterns.

Important caution:
A fiber route generally knows where **along the fiber** a disturbance is sensed. It does **not automatically know exact offset distance away from the fiber**. So the UI should report anomaly location as:

> detected near this fiber section / route / milepost range

rather than pretending the system knows the exact off-road source point.

## 3.7 Data standards and formats
There is **not one universal DAS raw-data standard** across all vendors. Common raw or export formats may include:

- **HDF5 / H5**
- **SEG-Y / SEGY**
- proprietary vendor formats
- sometimes TDMS or similar

The FDSN DAS metadata effort and related community standards are useful references for metadata concepts. Real vendor integration later should ask for:

- number of channels
- sample rate
- gauge length
- channel spacing
- units
- time sync info
- export format
- live API details
- cable/channel calibration data

---

## 4) Why GIS is essential here

The project should be strongly GIS-grounded because the fiber route:

- runs along a canyon roadway,
- may cross the road multiple times,
- may switch sides of the road,
- needs to be reported in terms of **route + milepost**,
- must be understandable to transportation/operations staff.

Therefore, the frontend should not only know “channel 421.” It should know:

- route name/id,
- milepost,
- approximate lat/lon,
- which side of the road the fiber is on,
- whether the segment is part of a crossing,
- nearest road segment,
- direction label (up canyon / down canyon, NB/SB, etc. as appropriate).

This is one of the most important parts of the simulation.

---

## 5) Recommended Spatial Model

## 5.1 Recommended approach
**Yes, break the fiber line into channel-sized locations or channel records.**

This is the cleanest and most practical way to do the simulation and later support real data.

### Recommendation
Create a **channel lookup table** from the fiber route geometry.

Each channel record should represent one sample position along the route at a fixed interval (for example every 2 meters). It can be stored as a point feature or as a tabular record with derived location fields.

### Why this is the right approach
This gives you a direct mapping from raw or simulated DAS channel indexes to real-world context:

- `channel_id`
- `fiber_distance_m`
- `route_id`
- `milepost`
- `lat`
- `lon`
- `side_of_road`
- `crossing_flag`
- `crossing_id`
- `nearest_road_segment_id`

This is easier and more stable for a UI than trying to calculate road-side context on the fly for every animation frame.

## 5.2 Alternative approach
An alternative is linear referencing / interpolation on the fly. That can work, but for an MVP simulation it is less transparent and harder for an AI agent to build correctly.

### Final recommendation
For this project, use:

> **A precomputed fiber channel lookup dataset**, generated from the GIS line.

---

## 6) Required Input Data

The AI agent should expect the following input sources.

## 6.1 GIS layers
Minimum desired GIS layers:

1. **Fiber route line** (very important)
2. **Road centerline** or roadway line
3. **Milepost points** or milepost line event data
4. Optional: road edges / carriageways if available
5. Optional: canyon boundary / terrain / imagery context

Likely formats:

- GeoJSON
- shapefile
- geopackage
- feature service export

For the frontend prototype, convert what is needed to **GeoJSON**.

## 6.2 Synthetic configuration files
The simulation should also use config files such as:

- `simulation-config.json`
- `vehicle-scenarios.json`
- `hazard-scenarios.json`
- `channel-config.json`

## 6.3 Future real data inputs
Design for later ability to accept:

- raw DAS data stream or file slices
- processed vendor event feed
- channel-by-channel measurement feed
- historical event files

---

## 7) Channelization / Fiber Segmentation Plan

## 7.1 Build channel points
From the fiber route line, create regularly spaced channel positions.

Example assumptions for MVP:

- channel spacing = **2 m**
- channel ids increment from interrogator origin outward
- store cumulative fiber distance along the route

Each channel point should include:

```text
channel_id
fiber_distance_m
route_id
route_name
milepost
lat
lon
side_of_road
crossing_flag
crossing_id
nearest_road_distance_m
road_segment_id
label_direction_context
```

## 7.2 Side of road logic
Because the fiber crosses the road, this matters a lot.

For each channel position, derive:

- `side_of_road`: left/right relative to road centerline direction or route calibration
- `crossing_flag`: true/false
- `crossing_id`: identifier for a crossing group
- `crossing_proximity`: distance to crossing center or related metric

The exact side convention must be documented clearly in the data model so users know what “left” or “right” means.

## 7.3 Milepost logic
For this project, **milepost is a first-class field**. Every event should be translatable to:

> Route X at Milepost Y

Recommended approach:

- snap each channel point to the nearest road/milepost reference system,
- derive interpolated milepost values,
- store a `milepost` numeric field,
- optionally store a formatted `milepost_label` like `MP 14.32`.

---

## 8) Data Model for the Dashboard

The frontend should be built around **three layers of data**.

## 8.1 Layer A — Channel lookup / calibration data
Static or rarely changing.

Example:

```json
{
  "channel_id": 421,
  "fiber_distance_m": 842,
  "route_id": "SR-XXX",
  "route_name": "Canyon Route",
  "milepost": 14.32,
  "milepost_label": "MP 14.32",
  "lat": 40.123456,
  "lon": -111.123456,
  "side_of_road": "east",
  "crossing_flag": false,
  "crossing_id": null,
  "road_segment_id": "roadseg_102"
}
```

## 8.2 Layer B — Simulated or live vehicle track events
This is the main user-facing dynamic data.

Example:

```json
{
  "type": "vehicle_track_point",
  "track_id": "veh_00192",
  "timestamp": "2026-05-02T20:15:14Z",
  "channel_id": 421,
  "fiber_distance_m": 842,
  "route_id": "SR-XXX",
  "milepost": 14.32,
  "milepost_label": "MP 14.32",
  "lat": 40.123456,
  "lon": -111.123456,
  "travel_direction": "up_canyon",
  "speed_mph": 47,
  "confidence": 0.91,
  "vehicle_class": "car",
  "signal_strength": 0.62
}
```

## 8.3 Layer C — Simulated or live anomaly/hazard events
Example:

```json
{
  "type": "anomaly_event",
  "event_id": "haz_00072",
  "timestamp_start": "2026-05-02T20:17:02Z",
  "timestamp_end": "2026-05-02T20:17:14Z",
  "subtype": "rockfall_possible",
  "start_channel_id": 615,
  "end_channel_id": 638,
  "route_id": "SR-XXX",
  "milepost_start": 15.10,
  "milepost_end": 15.18,
  "milepost_label": "MP 15.10 - 15.18",
  "lat": 40.125,
  "lon": -111.128,
  "intensity": 0.87,
  "confidence": 0.78,
  "location_quality": "fiber-section-only"
}
```

## 8.4 Layer D — Waterfall frames
Used for the technical view.

Example:

```json
{
  "timestamp": "2026-05-02T20:15:14Z",
  "channel_start": 400,
  "channel_end": 450,
  "values": [0.01, 0.02, 0.05, 0.18, 0.72, 0.41]
}
```

The exact structure can vary, but the frontend needs a manageable structure for rendering a scrolling heatmap.

---

## 9) Simulation Strategy

## 9.1 Overall approach
Create a **synthetic DAS event simulator** that is rooted in the real GIS route and channel table.

### Simulation layers
1. **Static spatial truth**
   - road line
   - fiber line
   - mileposts
   - channel lookup table

2. **Vehicle motion engine**
   - simulate vehicles moving up/down canyon
   - each vehicle progresses through successive channels over time
   - derive speed, direction, current milepost, and map position

3. **Hazard/anomaly engine**
   - occasionally generate rockfall-like or anomaly-like events
   - these affect channel ranges rather than clean vehicle tracks

4. **Waterfall generator**
   - render a synthetic time × channel intensity field
   - vehicles appear as diagonal trajectories
   - anomalies appear as bursts, patches, or pulses
   - add realistic background noise

## 9.2 Vehicle simulation rules
Vehicles should feel realistic.

Suggested simulated attributes:

- track id
- type: car/truck/unknown
- speed
- direction
- duration
- signal intensity
- confidence
- current channel
- current milepost

Suggested scenarios:

- normal low traffic
- moderate traffic
- congestion / slow rolling queue
- sparse night traffic
- mixed speeds
- clusters/platoons

## 9.3 Hazard/anomaly simulation rules
Suggested anomaly scenarios:

- localized rockfall-like burst
- repeated impact sequence
- broad vibration event
- stopped vehicle / stationary anomaly
- data dropout / sensor gap
- false positive event

These should show on both:

- the waterfall view,
- the map/event feed.

---

## 10) Frontend Requirements

## 10.1 Core UI components
The dashboard should include:

### A. Main map (MapLibre)
Show:
- road route
- fiber route
- channelized or event locations
- mileposts
- animated vehicle points/icons
- highlighted anomaly sections
- popups/tooltips

### B. Waterfall panel
Show a scrolling or replayable waterfall heatmap:
- x-axis = time
- y-axis = channel or fiber distance
- color = intensity

It should look like a real DAS waterfall display but remain readable.

### C. Event feed
Show items like:
- Vehicle detected, Route X, MP 14.32, up canyon, 47 mph
- Vehicle detected, Route X, MP 14.78, down canyon, 53 mph
- Anomaly: possible rockfall, Route X, MP 15.10–15.18

### D. Stats / summary cards
Examples:
- active vehicles
- average speed
- up-canyon count
- down-canyon count
- active anomalies
- confidence summary

### E. Replay / timeline control
Allow:
- live mode
- replay last 5 / 15 / 60 minutes
- pause/play
- speed control

## 10.2 Nice-to-have UI elements
- route/milepost search
- click channel/fiber section to inspect details
- synchronized hover between map and waterfall
- layer toggle for road/fiber/channel/crossing
- visual emphasis when fiber crosses the road
- dark theme with high visual polish

---

## 11) Recommended Technical Stack

This project is frontend-first.

Recommended stack:

- **Vanilla HTML/CSS/JS** or a lightweight build setup
- **MapLibre GL JS** for map display
- A simple charting/graphics solution for waterfall rendering, such as:
  - Canvas-based custom renderer,
  - lightweight chart lib,
  - Plotly or ECharts if needed, but avoid unnecessary complexity
- Static GeoJSON + JSON for the MVP data source

Optional but useful for preprocessing outside the frontend:

- Python scripts to:
  - segment the fiber into channels,
  - derive mileposts,
  - derive side-of-road / crossing flags,
  - generate synthetic event files.

### Important architecture rule
The frontend should consume **clean JSON feeds**. Do not tightly couple the UI to the preprocessing logic.

---

## 12) MVP Scope

## 12.1 MVP goals
The MVP should do the following well:

1. Load road + fiber + milepost GIS data.
2. Load a precomputed channel lookup table.
3. Simulate live vehicle tracks moving along the route.
4. Simulate occasional anomaly events.
5. Render a plausible waterfall panel that aligns with the simulated events.
6. Show detections by **route + milepost**.
7. Visually communicate road-side context and crossings.
8. Feel credible and polished to researchers and technical stakeholders.

## 12.2 Non-goals for MVP
The MVP does **not** need to:

- ingest full real raw DAS at scientific production scale,
- implement vendor-specific interrogator physics,
- perfectly solve source localization off the fiber,
- run advanced ML inference in the browser,
- be production-ready backend infrastructure.

---

## 13) Suggested File Structure

```text
/project
  /data
    road.geojson
    fiber.geojson
    mileposts.geojson
    fiber_channels.geojson
    simulation-config.json
    vehicle-events.ndjson
    anomaly-events.ndjson
    waterfall-frames.json
  /src
    index.html
    styles.css
    main.js
    map.js
    waterfall.js
    replay.js
    data-loader.js
    ui-panels.js
  /scripts
    preprocess_fiber.py
    generate_simulation.py
  README.md
```

---

## 14) Implementation Notes for the AI Agent

## 14.1 Preprocessing recommendations
If preprocessing scripts are part of the scope, implement:

### Script A — fiber channelization
Input:
- fiber line GeoJSON
- road line GeoJSON
- milepost GeoJSON

Output:
- `fiber_channels.geojson`
- `fiber_channels.json`

Functions:
- interpolate points every N meters along the fiber
- assign cumulative fiber distance
- derive route/milepost association
- derive side-of-road label
- detect and label crossings

### Script B — simulation generator
Input:
- channel lookup table
- scenario config

Output:
- vehicle track events
- anomaly events
- waterfall frames

## 14.2 Frontend behavior recommendations
- treat simulation as a timed stream,
- update map and waterfall in sync,
- support both live play and replay,
- keep the map responsive,
- avoid overcomplicated frameworks unless needed.

## 14.3 UX recommendations
- put **route + milepost** everywhere,
- keep raw channel numbers available but secondary,
- make the waterfall visually attractive but not overwhelming,
- use the map as the main storytelling surface,
- clearly distinguish vehicle events vs anomaly events.

---

## 15) Acceptance Criteria

The project is successful if the resulting frontend can:

1. Show the canyon road and fiber route on a map.
2. Show mileposts and use them in labels/popups.
3. Show animated vehicles moving in both directions.
4. Show that fiber-side and crossing context matters.
5. Show a synchronized waterfall plot that corresponds to the simulated activity.
6. Display occasional anomaly events that are believable and distinct from vehicles.
7. Present all key event locations as route + milepost.
8. Use a data model that could later accept real DAS-derived data.
9. Look polished enough to demonstrate to research scientists.

---

## 16) Practical Data-Science Notes for Credibility

To impress technical stakeholders, the prototype should explicitly respect these realities:

1. **Raw DAS is huge** and usually not shown directly to ordinary users.
2. **DAS location is along the fiber**, not automatically off-fiber.
3. **Channel spacing and gauge length are not the same thing**.
4. **Calibration matters**: channel-to-map alignment should be treated as a real requirement.
5. **Traffic trajectories in waterfall plots are linear/diagonal features**.
6. **Anomalies are often pattern-based and not simple tracks**.
7. **There is no single universal DAS raw-data standard** across vendors.
8. **A route + milepost reporting model is essential for transportation operations users**.

---

## 17) Agent Prompt (copy/paste section)

Use the following prompt as the main instruction for an AI coding agent.

---

# Prompt for AI Agent

Build a polished front-end prototype for a **Distributed Acoustic Sensing (DAS) canyon roadway monitoring dashboard**.

## Project intent
This is a realistic simulation-first prototype. The app must simulate what a real-world DAS dashboard would look and feel like, but it should be designed so real DAS-derived data can replace the simulation later.

## Core user story
A fiber optic cable runs along a canyon road and crosses the road multiple times. DAS-derived detections need to be displayed as a combination of:
- a live waterfall / time-distance heatmap,
- an interactive MapLibre map,
- a live event feed,
- route + milepost-based event reporting,
- animated vehicles moving up and down the canyon,
- occasional anomaly/hazard events such as rockfall-like disturbances.

## Important domain rules
1. The UI should be road-centric, not channel-centric.
2. Every event must be expressible as **route + milepost**.
3. The fiber route geometry matters, especially where the fiber crosses the road.
4. The simulation must be grounded in GIS data.
5. The waterfall view is important, but it is not the only or main view.
6. Vehicle events should appear as moving tracks. Anomaly events should appear differently.
7. The data model must be designed so real data could later plug in.

## Required inputs
Use these inputs if provided:
- fiber route GeoJSON
- road GeoJSON
- mileposts GeoJSON
- optional precomputed fiber channel dataset

If a precomputed channel dataset is not provided, generate one from the fiber route using a fixed spacing such as 2 meters.

## Required preprocessing logic
Create or expect a channel lookup table containing:
- channel_id
- fiber_distance_m
- route_id / route_name
- milepost / milepost_label
- lat / lon
- side_of_road
- crossing_flag
- crossing_id
- nearest road segment id

## Required UI components
1. **MapLibre map**
   - show road, fiber, mileposts
   - animate vehicles
   - highlight anomaly sections
   - support hover/click popups

2. **Waterfall heatmap panel**
   - show a simulated DAS time-distance heatmap
   - synchronize with the live/replay data
   - make moving vehicles visible as diagonal features
   - make anomaly events visible as bursts or patches

3. **Live event feed**
   - show route + milepost labels
   - show speed, direction, event type, confidence

4. **Stats cards**
   - active vehicles
   - average speed
   - up-canyon count
   - down-canyon count
   - active anomalies

5. **Replay controls**
   - live mode
   - pause/play
   - replay recent history

## Simulation behavior
Generate synthetic but realistic data:
- vehicles moving in both directions
- mixed speeds
- occasional congestion
- occasional anomalies such as rockfall-like events
- waterfall frames that correspond to the simulated activity

## Technical preferences
- keep the app relatively simple
- use HTML/CSS/JavaScript and MapLibre
- use modular JavaScript
- separate data generation/preprocessing from rendering
- prioritize a polished visual result and clear code structure

## Deliverables
- working frontend app
- sample data files
- any preprocessing scripts needed
- short README explaining how the simulation works and how real data could later be integrated

## Quality bar
The result should feel credible to smart research scientists. It does not need to be a perfect physics simulator, but it must respect real DAS concepts, GIS grounding, route/milepost logic, and the importance of fiber crossings.

---

## 18) Future Integration Considerations

When real data becomes available, the ideal integration path is:

```text
vendor DAS output or processed event stream
    -> translator / adapter layer
    -> clean frontend JSON schema
    -> existing map + waterfall + event feed
```

The frontend should be built now so that only the **data adapter** changes later.

---

## 19) Reference Topics for Further Research

Useful research topics and search phrases:

- DAS waterfall plot
- distributed acoustic sensing traffic monitoring
- vehicle trajectory extraction in DAS time-space domain
- DAS channel spacing vs gauge length
- DAS HDF5 SEG-Y metadata
- rockfall monitoring with DAS
- landslide monitoring with DAS
- calibration of DAS channels to geographic location
- synthetic DAS traffic simulation

---

## 20) Reference Notes / Sources to Review

These are useful background references for the team or AI agent to understand the domain:

1. EGU explainer on DAS basics, including gauge length and channel concepts.
2. FDSN DAS metadata draft for metadata concepts.
3. GDR/OpenEI DAS data standard notes for HDF5 / raw array structure.
4. Traffic monitoring papers describing vehicle trajectories as linear features in time-space/waterfall plots.
5. Papers on synthetic DAS traffic datasets.
6. Papers on rockfall / landslide monitoring using DAS.

Representative public sources:
- https://blogs.egu.eu/divisions/sm/2023/12/02/what-is-das/
- https://docs.fdsn.org/projects/das-metadata/en/draft/
- https://gdr.openei.org/das_data_standard
- https://arxiv.org/abs/2403.02791
- https://opg.optica.org/jlt/abstract.cfm?uri=jlt-44-3-913
- https://www.mdpi.com/2412-3811/10/9/228

---

## 21) Final Recommendation

This project is feasible and worth doing.

The most important implementation choice is:

> **Use the real GIS route geometry to build a precomputed channel lookup model, then simulate events and waterfall data on top of that.**

That gives the dashboard a strong real-world backbone now and creates the cleanest path to future real-data integration.

