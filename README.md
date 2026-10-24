# 🐝 Buzz Mayhem

A chaotic, physics-driven 3D open-world bee sandbox. You're a tiny cartoon bee in a giant world: fly anywhere, knock things over, annoy the locals, chain tricks into combos, and find secrets. Activities are optional; free roam is the game.

Built with **SvelteKit 3 + TypeScript**, **Three.js** (rendering), **Rapier 3D** (physics), **Tailwind CSS 4** (menus/HUD) and the **Web Audio API**. Deploys with the **Cloudflare adapter**. All assets are procedural: there are no model, texture or audio files.

## Run it

```sh
bun install        # or npm install
bun run dev        # http://localhost:5173
bun run check      # svelte-check / TypeScript
bun run build      # production build (Cloudflare adapter)
bun run preview    # serve the build with wrangler
```

Requires a WebGL 2 browser. Keyboard and mouse recommended. Click **Play** to capture the mouse; **Esc** releases it and pauses.

## Controls

| Input | Action |
| --- | --- |
| W A S D | Fly (camera-relative) |
| Mouse / wheel | Orbit camera / zoom |
| Space · Ctrl (or C) | Ascend · descend |
| Shift | Boost (uses the boost meter) |
| Ctrl + Shift | Dive bomb (hitting the ground hard = Ground Pound shockwave) |
| Q · R | Dash · barrel roll |
| Left click | Headbutt (or throw what you're holding) |
| Right click | Sting (pops balloons and puffballs, angers creatures) |
| E · F | Interact (pick up, sip nectar, talk, start activities) · drop |
| M (or Tab) · Esc (or P) | Map · pause |

Since Ctrl is the descend key, the browser asks for confirmation if Ctrl+W or Ctrl+R is pressed mid-flight.

## What's in the game

**World.** One seamless 1 km² world generated from a fixed seed, so it's the same every run:
- **Flower Meadow:** daisies, tulips, roses, lavender rows, sunflower grove, dandelions; swaying grass and flowers driven by wind; a lily pond with reeds and floaters; picnic grounds; a gardener's corner; a dirt trail.
- **Enchanted Forest:** a raised plateau behind a cliff ridge, with giant trees (branches, canopies, hanging vines), mushrooms, ferns, rocks, a stream with a waterfall, the Elder Tree (climb its shelf fungi), the enterable Hollow Oak, a mossy log tunnel, a bouncy fairy ring, and a spider grove with webs.
- **The Beehive:** a giant straw skep on a tree stump with an arched entrance and four interior floors: Entrance Hall (honey storage cells, sticky honey pool, nectar deposit), Royal Nursery, Wax Workshop, Queen's Chamber, and a secret Royal Attic with an exit at the apex.
- **Misty Peaks** ring the world as a natural boundary.
- Sky gradient, fog, sun with texel-snapped shadows, hemisphere light, drifting clouds, gusts and updrafts.

**The bee.** Procedural model with striped body, expressive eyes and lids, brows, mouth, six legs, antennae on springs, four wings and a stinger. Its expressions change with what's happening (determined, surprised, dizzy, worried, angry). Flight is momentum-based, with banking and pitch, wing speed tied to effort, a hover bob, squash and stretch, and a honey or wet tint.

**Chaos (core loop).** 26 dynamic prop types run on Rapier, including cups, a cup pyramid, dominoes, a sugar-cube tower, a jam jar, balloons on strings, cherries and berries that fall when hit, a beach ball, a watering can, a garden gnome, flower pots, honey jars and globs, a rubber duck and a paper boat. Bee impacts apply exaggerated impulses. Props trigger chain reactions on each other. Breakables shatter, pop, spray spores or leave sticky honey puddles. Light objects can be carried and thrown. The **Chaos Score** uses combo multipliers (up to x8), gives diminishing returns for spamming the same trick, and awards a bonus for each new trick type (28 tricks to discover).

**Creatures** (lightweight state machines: idle, wander, interact, flee, chase, return, tumble, dazed): butterflies, worker bees (they fly a nectar route into the hive), the Queen, royal guards (bump the Queen and see), ladybugs, stag beetles that charge, spiders that hunt bees stuck in webs, robins that chase annoying bees, dragonflies, snails and fireflies. Any of them can be bowled over; they react with speech bubbles.

**Systems.** Pollen comes from touching flowers. Nectar is sipped with E and delivered to the hive, where it turns into honey. There are 18 hidden Golden Pollen orbs. Discovery tracks regions, landmarks, hive chambers and 11 species. There are 19 achievements. Environmental effects: water (buoyancy, currents, soggy wings), the waterfall push, updrafts, wind gusts, honey and webs (mash keys to escape), and bouncy mushrooms.

**Activities** start at glowing hexagon totems: *Meadow Dash* (a 14-ring race with saved best time), *Pollen Rush*, *Nectar Run*, *Chaos Combo* and *Hive Explorer*, plus the ongoing orb hunt.

**UI.** Main menu over a live 3D scene, HUD (chaos/combo, compass, region, counters, boost, prompts, challenge card with objective arrow, struggle meter), toasts, floating score popups, a world map, a pause menu, settings (quality preset, adaptive resolution, sensitivity, FOV, invert Y, shake, volumes, FPS), controls, and progress/achievements. Progress and settings are saved to LocalStorage.

**Audio** is fully synthesized: a wing buzz that follows speed, impact, pop, glass, splash, boing and squawk effects, ambient wind, water and hive hum, birdsong, and a small generative music loop.

## Architecture

```
src/lib/game/
  core/      Game (orchestrator), GameLoop (rAF + fixed 60 Hz physics), InputManager,
             CameraController, Settings (quality presets), context/types (UI bridge)
  player/    BeeModel (expressive mesh), BeeController (flight), BeeAbilities (actions)
  world/     WorldManager, TerrainGenerator, ChunkManager, Biomes (layout/regions),
             Vegetation + Flora (instanced plants/trees), Hive, Features (landmarks),
             Water, Sky, Materials (wind/grass shaders)
  physics/   PhysicsWorld (Rapier wrapper, groups), Interactions (event → gameplay)
  entities/  Props + PropDefs, NPCManager + Insects + InsectModels + SimpleBee
  systems/   Chaos, Collection, Challenge, Environment, Achievements, Audio, Effects, Save
  ui/        ScorePopups (pooled DOM text)
  utils/     seeded Random, simplex Noise, SpatialHash, geometry helpers, math
src/lib/components/   Svelte UI (GameRoot, HUD, menus, map, toasts) + reactive UI state
```

Three.js and Rapier are loaded with a dynamic `import()` inside `onMount`, so SSR and prerendering never touch WebGL. Svelte only renders UI. The game writes HUD state at about 10 Hz through a small bridge, field by field.

## Performance

- Instanced rendering for all vegetation, rocks, trees, props, hive cells and grass. The grass is a single instanced draw whose blades wrap around the player and sample a terrain data texture for height and density.
- Chunked world (8×8 chunks) with distance culling per layer, two terrain LODs with crack-hiding skirts, and three.js frustum culling per chunk.
- Rapier physics on a fixed timestep with interpolation. Prop bodies exist only within about 150 m of the player and sleep when idle. NPCs use kinematic AI instead of physics bodies.
- Pooled particles (one `Points` draw), pooled debris, pooled popups and honey puddles. Shared geometries and materials, and NPC models baked down to 1–3 draws each.
- Shadows only from large casters, with a texel-snapped shadow frustum that follows the player.
- Graphics presets (Low to Ultra) control pixel ratio, shadow size, grass count, draw distance and flower density. Adaptive resolution lowers the pixel ratio when frames run slow. The loop pauses while the tab is hidden.

## Known limitations

- Keyboard and mouse only. There are no gamepad or touch controls yet.
- Chunks are all generated at load. Streaming is visibility- and LOD-based rather than on-demand generation, and the hive interior detail and lights switch on near the hive.
- Held objects are kinematic, so they can clip through walls while carried.
- Performance was profiled by draw-call and triangle counts in headless Chromium using software rendering (about 350–420 draws including the shadow pass, about 1M triangles on High). It has not yet been measured on Apple Silicon hardware.
