# Research notes: UDOT DAS webinar transcript

**Source:** `Webinar_Transcript` (Utah Connected webinar; UDOT distributed acoustic sensing deployment).

**Purpose of this document:** Condense what the speakers said about DAS science, waterfall plots, vehicle appearance, speed and direction, and implications for interpreting fiber that does not stay on one side of the road. These notes support product and modeling decisions for the canyon dashboard prototype.

---

## 1. Purpose of a roadside DAS system (from the webinar)

- **Operational goal:** Real-time situational awareness along long roadway corridors using DOT-owned fiber already in conduit. Outputs feed traffic operations (speeds, travel times, congestion), safety (crashes, avalanches, hazardous conditions), and integration with other tools (for example cloud dashboards).
- **Why fiber:** One interrogator can cover tens of miles of cable with dense spatial sampling (the webinar cites roughly **10–20 ft** resolution along the fiber and **~28 miles** per direction per box, with newer gear cited up to **56 miles** total). No power along the cable; only the hut-end equipment is powered.
- **End-user design point:** Operators are not expected to stare at raw physics plots daily. Alerts and fused outputs matter; detailed waterfall analysis is for tuning detectors, forensics, and R&D.

---

## 2. Physical sensing principle (science in brief)

1. **Interrogator** sends laser pulses into a **single core** of single-mode fiber.
2. Glass contains many **scattering sites**. A fraction of light **backscatters** to the instrument.
3. **Time of flight** maps each portion of the returning signal to **distance along the fiber** (distributed measurement).
4. Nearby **vibration, strain, and temperature** change the backscatter pattern. Road **vehicles radiate acoustic energy** into the ground and structure; that couples into the cable as **strain / vibration** the system measures.
5. **Sampling rate** is high enough (thousands of samples per second along the fiber, in the narrative) to treat the result as **continuous acoustic monitoring** in space and time.
6. **Classification** operates on **acoustic fingerprints** in multiple frequency bands—not only on the simplified waterfall image.

**Takeaway for software visualization:** The “truth” is multi-band acoustic time series along distance. The waterfall is a **lossy, human-oriented summary** of that reality.

---

## 3. What a waterfall plot is and how it behaves

### Axes and flow

- **Horizontal axis:** Distance along the monitored asset (fiber route), up to the full monitored length (examples in the talk: two-mile zoom, six-mile window, longer overviews).
- **Vertical axis:** **Time**, with **new data at the top** and older data **scrolling downward**—hence the name “waterfall.”
- **Color:** Encodes **summed acoustic energy** in selected frequency bands (a deliberate reduction of the full spectrum).

### What the pixels represent

- The waterfall **sums (aggregates) energy in configured frequency bands**—example given: **~20–200 Hz** for the overview—so each column along distance is **not** a single frequency; it is **band-limited intensity over time**.
- **Behind** the waterfall, analysts can take **slices in time or distance** and inspect **other frequencies** (example: avalanche analysis mentions strong **5–35 Hz** content; a truck rollover example mentions **~32 Hz** tonal content interpreted as engine-related). Vehicle detection at highway speeds may require emphasizing **lower** frequencies than the default view shows for some events.

### Color scales mentioned

- **Grayscale:** Low = white, high = black (or inverted variants for specific slides).
- **Jet-style:** Blue → yellow → orange → red for increasing activity.

### Operational quirks called out in the talk

- **Time alignment:** Presenters note possible **small discrepancies** between video and waterfall time bases; interpret simultaneous cues carefully.
- **Fiber break / severe disturbance:** Can show **loss of signal** at a location and, in one utility-cut story, **horizontal artifacts** affecting data **beyond** the break linked to **polarization changes** in the fiber—i.e., the display can show non-local weirdness when the medium itself is compromised.

---

## 4. What vehicles and other events look like on the waterfall

### Vehicles as moving slanted traces

- Each vehicle often appears as a **line or stripe** in the distance–time plane because **distance along fiber advances** as **clock time** advances.
- **Fast road traffic** was described explicitly as **“near horizontal stripes”** in the background during a flood event discussion—i.e., a **large distance change per unit time** → **shallow slope** on the plot (time vertical, distance horizontal in that speaker’s convention).
- When a vehicle **slows**, the same speaker says the **“gradient of the line changes”** and the trace can **fade or disappear** as coupling or energy in the chosen band drops.

### Vehicle size / type and signal strength (not the same as physical size from DAS alone)

- Example narration: **trucks** appear as **thick, dark** traces; **passenger vehicles** as **thinner, lighter** traces—**in that UI** thickness/intensity reads as **stronger vibration / stronger coupling / more energy** in the displayed band, not a calibrated geometric “width.”
- **Stronger red** traces were used to illustrate vehicles at **~45 mph** on a canyon road (with caveats that coupling varies by install).
- **Cyclists** appear as **lighter angled lines** behind stronger vehicle traces in one example.
- **Runners** were detectable at **~6 mph** when **on or very near** the fiber; the speaker notes runners otherwise produce little vibration compared with motor vehicles.
- **Slow vehicles** produce **less vibration**; like other traffic sensors, DAS can **struggle at very low speeds**, with the caveat that under **ideal install conditions** the system can still pick up **vulnerable road users**.

### Non-vehicle events (shape language useful for QA of simulators)

- **Avalanches / mass movement:** Large **blobs** or **splodges** of high energy spanning **hundreds of meters to ~1 km** of fiber for **tens of seconds** (multiple examples). Second slide in a pair may show **longer duration** and more frequency spread.
- **Floods / debris flow:** Broad, slower-moving high-energy patterns; one example estimated **~2 mph** propagation for water on the roadway generating a **large** signal.
- **Impacts / crashes:** May show as **impulsive** features; one speaker stresses a crash may look **“not particularly impressive”** on the default waterfall because the default is a **narrowband snapshot**—lower-frequency spectral views show the impulse better.
- **Idling / stationary machinery:** Example: **vertical** or **extended-time** structure at a fixed distance with **tonal** content (engine turnover frequency) after a truck tips—**energy at one place** as time goes up the axis.

### Detector vs human eye

- A replay example: **small vehicles clearly visible** on the waterfall were **not** always picked up by an **avalanche-period detector tuned for larger vehicles**—i.e., **visibility on the plot ≠ automated alarm**.

---

## 5. Speed and slope on the waterfall

**Convention:** Different slides use **distance horizontal** and **time vertical**; another demo described **latest data at the top** with older rows pushed down. Physics is the same either way: compare **Δdistance along fiber** to **Δtime**.

- **Higher speed** → **more fiber distance per unit time** → in a distance–time image this reads as a **shallower** trace relative to the time axis (the webinar literally calls fast vehicle backgrounds **“near horizontal stripes”** when contrasted with a **~2 mph** flood feature moving along the road).
- **Lower speed** → **smaller Δdistance per Δtime** → **steeper** trace (more aligned with the time axis than fast traffic).
- **Stopping / queue dynamics:** Traces **bend** (slope changes), **pile up**, or leave **gaps** (“stationary traffic” regions with distinctive **queue** shapes in speed-output plots). **Backward-propagating stop waves** were described in congestion.

**Important:** Exact angles depend on **axis scaling** (miles per inch vs seconds per inch), chosen **frequency band**, and **coupling**. The **qualitative** rule is: **speed ↔ slope in the distance–time image**.

---

## 6. Direction of travel on the waterfall

- **Sign of the slope** (left-to-right vs right-to-left in the presenters’ examples) encodes **which way** the disturbance progresses along the **fiber’s distance coordinate**.
- On a **simple parallel** road–fiber layout, **opposing lanes** can both be visible: one demo explicitly mentions traffic in **one direction** as the main focus and notes **the other carriageway** moving the **other way**.
- **Direction-of-travel products** in the project split outputs **per driving direction** (for example **up-canyon vs down-canyon** overlays on the waterfall and speed maps).

**Critical subtlety (turning movements, junctions, fiber path):** Where the **fiber does not follow** a vehicle’s path, tracks **appear or vanish**:

- Vehicles continuing along the fiber route may draw a **continuous** line across the display.
- Vehicles that **branch off** where the fiber does not go may seem to **“disappear into the ether.”**
- Vehicles entering from a leg **without** fiber coupling may **“appear out of nowhere”** when they merge onto the monitored alignment.
- The webinar uses this behavior intentionally for **turning-movement counting** against camera ground truth—not as a bug, but as **geometry of sensing**.

---

## 7. Fiber placement: sides of the road, depth, crossings, and signal quality

The transcript repeatedly ties **interpretation and amplitude** to **install physics**, not only to traffic:

- **Distance from source to fiber** matters (structure, offset from pavement).
- **Depth and cover type** matter: **Big Cottonwood** example—**concrete over the fiber** **attenuated** road energy; sensitivity was **reduced** vs other canyons; traffic only **clear in some locations**.
- **Elevation** separation between road and fiber reduces received energy.
- **Fiber far from the road** still allowed some visibility but with **reduced signal** in places.
- **Uniform microduct / sensing-aware install** (American Fork narrative) gave **more uniform** results.
- At **junctions** where **fiber crosses** or sits on a particular side, the system can support **volume / turning** style analytics when geometry aligns.

**Implication:** When the real fiber **zigzags** or **switches sides** relative to travel lanes, the waterfall is still **“distance along fiber.”** The mapping from **fiber index** to **road position and lane direction** is **nonlinear and sometimes discontinuous**. That is a **geometric sensor fusion** problem, not a display bug.

---

## 8. Is “solving” side-switching and fiber–road alignment worth it?

**What problem we mean:** Users intuit **road chainage and lane direction**; DAS delivers **ordered distance along one buried cable** that may **wobble** in offset, **depth**, and **side** relative to lanes. **Speed slopes and event positions** are faithful in **fiber space**; **map alignment** can be wrong or ambiguous if we treat fiber like a straight 1:1 copy of the centerline.

| If the goal is… | Solving alignment is… |
|------------------|------------------------|
| **Operator alerts** (avalanche, crash impulse, cut, wrong-way queue) | **Nice-to-have** map polish; **fiber distance + time** already actionable. Webinar stresses **alerts**, not perfect map orthorectification. |
| **Per-lane direction and turning counts** | **High value** where geometry is complex; the webinar’s **junction** work required understanding **where fiber follows which leg**. |
| **Public / stakeholder map** with intuitive vehicle icons | **High value** for trust and training; mismatches read as “wrong data.” |
| **Synthetic waterfall / sim** matching public expectations | **Medium–high**: you can fake constant coupling along a 1D chain for **pedagogy**, but **realistic** amplitude and **dropouts** need **side, depth, and cover** modeling if you claim fidelity. |
| **Scientific forensics** (post-crash) | Analysts **cross-check** video, maps, and spectra; they tolerate **non-obvious** waterfall appearance once trained. |

**Pragmatic recommendation for this repo’s direction:**

1. **Must-have:** Document and visualize **fiber distance** as primary, with **approximate** map sync (as you already do with channel tables from processed fiber).
2. **Worth doing in stages:** At **crossings** and **large lateral offsets**, show **confidence** or **thicker uncertainty** on map–waterfall linkage; optionally annotate **known poor-coupling** segments (from preprocessing metadata if available).
3. **Optional / research:** **Per-side lane** inference from DAS alone is **underdetermined** without geometry, models, or other sensors; the webinar pairs DAS with **cameras** for ground truth when counting turns.

**Bottom line:** **Full “solve”** (automatic perfect lane and side assignment everywhere) is **hard** and **sensor-fusion-heavy**. **Partial solve**—honest geometry, crossing awareness, and clear UX that **waterfall X = fiber chainage**—is **worth it** and matches how experts in the webinar actually reason about the data.

---

## 9. Connections to this codebase (for implementers)

- The simulation’s **diagonal vehicle tracks** in channel–time space match the webinar’s **distance–time** language: **faster motion along the sensed axis → shallower angle**, modulo axis orientation and scroll direction in your UI.
- **`fiber_crossings.geojson`** and channel **side-of-road** metadata align with the transcript’s emphasis on **junctions** and **varying lateral offset** as first-class effects.
- When **extending** map–waterfall sync, treat **direction** as **signed progression along ordered fiber channels**, then **snap or explain** breaks at **crossings** where the intuitive road direction and fiber parameterization can **diverge**.

---

## 10. Glossary (transcript-aligned)

| Term | Meaning in the webinar |
|------|-------------------------|
| **DAS** | Distributed acoustic sensing; vibration-sensitive dynamic strain read along fiber via coherent backscatter. |
| **Interrogator** | Hut equipment that launches pulses and receives backscatter. |
| **Waterfall** | Time–distance image of **band-summed** acoustic intensity; new time at top, scrolling down. |
| **Spectrum / slice** | Higher-dimensional views used for detector design and forensics. |

---

*Document generated from internal project research on the webinar transcript; not an official UDOT statement.*
