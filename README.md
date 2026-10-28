# Open Road — infinite procedural road-trip driving game

A browser driving game in TypeScript, Three.js and Vite. The world is generated
from a seed and streamed around the car, so you can drive in any direction
without loading screens or a fixed boundary. The design goals are in
[`requirent.txt`](requirent.txt).

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 (exposed on 0.0.0.0)
npm test             # 20 Node tests: world determinism, road graph, physics, streaming, meshes
npm run build        # type-check + production bundle in dist/
```

Pick a world with `?seed=` (a number, or any text): `http://localhost:5173/?seed=42`.

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Accelerate |
| S / ↓ | Brake / reverse |
| A / ←, D / → | Steer |
| Space | Handbrake (slide) |
| R | Reset onto the nearest road |
| C | Cycle camera: Chase, Close chase, Hood, First person |
| T | Toggle real time / fixed time of day |
| V | Cycle weather (auto, clear, cloudy, rain, fog) |
| H | Toggle HUD |
| Esc / P | Pause |

Gamepad: left stick steers, RT accelerates, LT brakes, A handbrakes, Start pauses,
Y switches camera, X resets, B toggles time.

## Architecture

```
src/
  utils/         integer hashing, seeded RNG, math helpers
  terrain/       gradient noise (fbm, ridged) and the base height field
  biomes/        urban density field (cities) and biome classification
  roads/         procedural road graph: lattice nodes, curved edges, queries
  world/         config, chunk generator (pure), streamer (workers, LOD, floating origin), ground queries
  workers/       Web Worker that generates chunks off the main thread
  rendering/     chunk meshes (terrain, roads, instanced trees and buildings), sky / time of day
  vehicles/      arcade car physics (pure) and car mesh
  camera/        chase camera with four modes
  weather/       weather state machine and rain
  audio/         procedural Web Audio ambience (engine, wind, rain, tyres, birds, city, surf)
  input/         keyboard and gamepad
  ui/            menus, HUD, styles
  core/          game loop, settings, exploration stats and achievements
  main.ts        entry point
tests/           node:test suites (run with tsx)
```

### How the infinite world works

- **Determinism.** Every value is a pure function of `(seed, x, z)` or of integer
  lattice coordinates. Chunks, roads, buildings and trees are regenerated identically
  whenever they are needed again, so revisiting an area gives the same world.
- **Chunks.** The world is split into 200 m chunks with a 40×40 terrain grid. Chunks in
  a circle around the player are kept loaded. Chunks further away are unloaded and
  their GPU buffers freed. Chunk generation runs in Web Workers. A chunk the player
  is standing next to is generated synchronously if it is not ready yet, so the
  player can't drive onto a hole. The streamer test checks this over a 2.4 km drive.
- **Ownership.** Trees live on a global 10 m lattice and buildings on a 24 m lot
  lattice. Each one belongs to the chunk containing it, so nothing is duplicated or
  overlapping across chunk borders.
- **Roads.** The road network is a lattice of jittered nodes joined by curved edges.
  Some rows and columns are highways, and each edge's class (highway, city, town or
  rural) comes from the urban density at its midpoint. Shared nodes mean roads meet
  exactly, and tests check that elevations match across joins.
- **Terrain follows roads.** The surface under a road is a smoothed version of the
  base terrain, pinned to node heights at both ends. Nearby terrain is blended into
  that height, so roads never float or clip through hills.
- **Floating origin.** Logical positions are doubles in world space. Each frame,
  every render object is placed relative to the player, so the GPU always works with
  small numbers however far the player travels.

## Status against the requirements (honest summary)

Implemented and exercised by tests or build checks:

- **Phase 1, playable prototype:** Three.js app, car with arcade physics (accel,
  brake, reverse, steering, grip, handbrake slide, gravity along slopes, airtime,
  suspension visuals), chase camera, procedural terrain, procedural roads, chunk
  streaming, and infinite driving.
- **Phase 2, road network (partial):** road graph with highways, city, town and
  rural classes, curved edges, and shared junctions. Junctions appear wherever edges
  meet (T and four-way), but there is no dedicated intersection geometry, roundabouts,
  highway exits or merges, bridges or tunnels yet.
- **Phase 3, biomes (partial):** forest, countryside, mountain, coast, village and
  ocean are classified and blended through vertex colour, vegetation density and
  terrain shading. There are no distance LODs for terrain yet.
- **Phase 4, towns and cities (partial):** cities are placed deterministically, and
  density falls off from the centre through suburbs and towns to countryside. Roads
  get denser and become city streets near city centres. Buildings are procedural boxes
  (towers, flat-roofed blocks and gable houses) with varied colours and heights. Not
  done: district layouts, parks, sidewalks, traffic lights, window textures.
- **Phase 6, atmosphere (partial):** time of day (real or fixed) with sun movement,
  sky and fog colours, and headlights at night. Weather is clear, cloudy, rain or
  fog, with rain slightly reducing grip. Audio is procedural (engine, wind, rain,
  tyres, birds, city ambience, surf). Not done: street lights, tunnels with reverb.
- **Phase 7, polish (partial):** main menu (Play, Settings, Controls, About), pause
  menu with stats, minimal HUD, settings persisted to localStorage, exploration stats
  and six optional achievements, gamepad support, and vegetation distance culling.

Not implemented yet:

- **Phase 5, traffic:** no AI vehicles.
- **Landmarks** (bridges, lighthouses, radio towers and so on) and **rivers**.
- **Real-browser testing:** this environment has no browser and could not download
  one, so the rendering and interaction code has been verified by type-checking,
  production build, Node tests, and a dev-server check that all modules compile and
  are served. It still needs a manual play-test in a browser.

## Notes for next steps

- Traffic (Phase 5) should run on the road graph, using the same `roadsInRect`
  queries and simplified simulation for distant vehicles.
- Intersections and roundabouts can be added as nodes with their own generators,
  keeping the edge functions unchanged so existing chunks stay consistent.
- Terrain LOD: lower-resolution grids for distant chunks, with stitched borders.
