# Aetherfall: Echoes of the Arcane

A third-person open-world magic action RPG that runs in the browser. You play **the Arcanist**, a mage who holds all four elements at once, sent by Elder Mirael to restore the Broken Seal and put down **Azrak, the Crystal Tyrant**.

Built with **SvelteKit 3 + TypeScript**, **Three.js** (WebGL 2, bloom post-processing), **Rapier 3D** (character controllers, colliders, ray casts), **Tailwind CSS 4** (HUD and menus) and the **Web Audio API**. It deploys with the Cloudflare adapter. Everything is procedural: there are no model, texture or audio files. Character and enemy visuals sit behind small interfaces, so rigged GLB models can replace them later without touching gameplay.

## Run it

```sh
bun install        # or npm install
bun run dev        # http://localhost:5173
bun run check      # svelte-check / TypeScript
bun run build      # production build (Cloudflare adapter)
bun run preview    # serve the build with wrangler
```

You need a WebGL 2 browser. Keyboard and mouse are recommended, and a gamepad also works. Click **New Journey** to start; the mouse is captured while you play, and **Esc** releases it and pauses. Add `?nolock` to the URL to play without pointer lock (useful in embedded previews and automation).

## Controls

| Input | Action |
| --- | --- |
| W A S D | Move (camera-relative) |
| Mouse · wheel | Orbit camera · zoom |
| Shift | Sprint |
| Space (twice) | Jump · double jump |
| Q | Dodge roll with i-frames (dash while sprinting or airborne) |
| Left click | Basic spell (chain three casts for a finisher) |
| Hold right click | Charge the element's special, release to cast |
| 1 2 3 4 | Fire · Ice · Lightning · Wind |
| F (hold) · R | Aegis shield · parry (perfect timing counters) |
| Tab | Lock on / switch target |
| X (hold) | Prismatic Ray channel (unlocked by defeating Azrak) |
| G | Aetherfall ultimate (when the aether gauge is full) |
| H · J | Healing Draught · Aether Tonic |
| E | Interact (talk, waystones, caches, crystals, inscriptions, the Seal) |
| I (or C) · K · M | Character and inventory · skill tree · world map |
| Esc (or P) | Pause |

**Gamepad** (standard layout): left stick move, right stick camera, RT basic spell, LT charge, A jump, B dodge, RB shield, LB parry, Y ultimate, X interact, D-pad elements, R3 lock-on, L3 sprint, Back map, Start pause.

## The game

**World.** One seamless 720 m world built from a fixed seed:
- **Lumen Hollow**, the lantern-lit starting village (Elder Mirael, Wren the lamplighter, the Lumen Well, an observatory tower and a market).
- **Whispering Vale** and the Crossroads Watch, where the three roads meet.
- **The Enchanted Forest (Eldergrove):** glowing mushrooms and flowers, ancient trees, the Shrine of Verdance, a river that ends in Moonwell Falls and its lake, and a Hidden Grotto.
- **The Arcane Highlands:** a raised plateau with the Ring of Echoes, the Starfall Spire, the climbable Drifting Isles and ruined towers.
- **The Forgotten Sanctuary**, behind the Seal Gate: the Aether Academy courtyard, the Temple of Dusk, the Sunken Library, the Undercroft (an underground crypt) and the Crystal Throne arena.

Each region blends its own fog, light, sky tint, ambient particles and music. Eight waystones act as checkpoints (they heal you, save, and become your respawn point). Caches, relics, lore inscriptions and landmark discoveries reward exploration.

**The Arcanist.** A jointed procedural mage with robe panels, a spring-driven cape and hair, glowing gauntlets, an amulet and a floating grimoire. The two-layer state machine (movement × action) handles sprinting, coyote-time jumps, a flipping double jump, dodge rolls with invulnerability frames, air and sprint dashes, dash-casting, dodge-cancelling and staggers.

**Combat.** Eight elemental spells: Fireball → Flame Explosion, Ice Shards → Frost Nova, Lightning Bolt → Chain Lightning, Wind Blade → Tornado. They cover projectile, hitscan, area-on-target, self-area and chain casts, plus charged specials, a channelled beam (Prismatic Ray), a barrier (Aegis) and an ultimate (Aetherfall, a meteor storm). The combat system adds:
- three-hit combos with finishers;
- perfect parries that reflect projectiles and grant a guaranteed-crit counter;
- block stamina and guard breaks;
- crits, weak points, poise, stagger, knockback, cast interruption, mana and stamina regeneration, hit-stop and slow motion.

**Elemental reactions** are data-driven:

| Reaction | Trigger |
| --- | --- |
| Thermal Shock | Fire on a frozen or chilled target |
| Overcharge | Lightning on a wet target; chains to nearby wet foes |
| Shatter | Heavy hit on a frozen target |
| Fire Tornado | Fire cast into a Tornado ignites it |
| Accelerated Spell | Ice, lightning or wind projectiles passing through a Tornado speed up and hit harder |
| Tailwind | A projectile cast within a second of a Wind Blade rides its slipstream |
| Waterspout | A Tornado over water soaks everything it pulls in |

Rivers and lakes make anything standing in them Wet.

**Enemies.** Three foes run on finite-state AI with perception and line of sight, telegraphed attacks, evasion and adaptive behaviour (they learn whether you fight at range and which way you dodge):
- **Forest Wraith:** fast, chains claw attacks, lunges.
- **Crystal Golem:** heavy, slams with jumpable shockwaves, has a weak core that is exposed after it swings.
- **Corrupted Mage:** casts bolts, void zones and silencing hexes, raises barriers and blinks away.

**Azrak, the Crystal Tyrant.** A three-phase boss in the Crystal Throne arena, with an intro cutscene and a sealed arena:
- **Phase I:** cleaves (which can be parried), a crushing fist that leaves his core exposed, crystal shard volleys and ground-slam shockwaves you can jump over.
- **Phase II:** he draws on four Resonance Pillars for a Prism Ward; shatter the pillars to break it and stagger him. He adds cleave combos, lines of crystal spikes, prism rain, a leap that punishes kiting, and a sweeping prism beam that overheats him. The stone plinths block the beam.
- **Phase III:** faster and harder-hitting. Four more pillars, volatile crystals you must shatter before they detonate, and chains of delayed slams.

**RPG systems.**
- Levelling: EXP and levels grant attribute points (Vitality, Wisdom, Endurance, Arcana, Fortitude, Precision, Warding) and skill points.
- Skill tree: Pyromancer, Frostweaver and Stormcaller branches.
- Inventory: potions and stat-granting relics.
- Saves: autosave to LocalStorage at waystones, quest milestones and on pause or exit.

**Quest: The Broken Seal.**
1. Speak with Elder Mirael.
2. Travel to the Eldergrove.
3. Purge five corrupted creatures.
4. Recover the three Arcane Crystals from their guardians at the Shrine of Verdance, Moonwell Falls and the Starfall Spire.
5. Restore the Seal at the Seal Gate.
6. Descend through the Academy and the Undercroft to defeat Azrak.
7. Return to the Elder.

The reward is 1500 EXP, the Heart of Azrak relic and the Prismatic Ray. A HUD tracker, a compass marker, map markers and a pillar of light guide you.

**Presentation.** Bloom and ACES tone mapping, a shader sky with clouds, texel-snapped shadows, wind-animated grass and foliage, emissive glow masks, water and a waterfall, light shafts, instanced particle pools for every element, rune circles, ground-draped attack telegraphs, lightning ribbons, beams and crystal spikes. Damage numbers are pooled DOM elements. Sound effects, ambience (wind, water, birdsong, crickets, chimes) and adaptive music for exploring, combat and each boss phase are all synthesized live.

## Architecture

```
src/lib/game/
  core/      Game (orchestrator, modes, saving, HUD snapshot), GameLoop (fixed 60 Hz +
             interpolation, time scale), InputManager, CameraController, Settings, EventBus,
             context (shared system references) and types (UI bridge)
  world/     WorldLayout (regions, landmarks, waystones), Terrain (heightfield), ChunkManager
             (streaming + LOD), Vegetation/Flora (instanced), Structures/StructureKit (merged
             architecture + colliders), Water, Sky, Ambience, Materials (wind/glow shaders)
  physics/   PhysicsWorld (Rapier wrapper, collision groups, ray casts, barriers)
  player/    PlayerModel (rig + procedural animation), PlayerController (movement),
             PlayerCombat (casting/defence), PlayerStateMachine (rule tables)
  combat/    CombatSystem (hit pipeline, queries), DamageSystem, StatusEffects, TargetingSystem
  magic/     SpellRegistry (data), SpellSystem (projectiles, AoE, tornado, channel, ultimate),
             ElementalReactions (data + evaluation)
  entities/  Enemy/EnemyAI/EnemyTypes/EnemyModels/EnemyManager (encounters), Boss + BossModel,
             NPC (dialogue runner), Interactables (waystones, caches, crystals, lore, Seal),
             Pickups
  systems/   Progression, Inventory, QuestSystem, SaveSystem, PlayerProfile (adaptive AI),
             AudioManager, Lore
  vfx/       MagicVFX, ParticlePool, VfxPrimitives (rings, circles, telegraphs, arcs, beams,
             spikes, shield), Textures, DamageNumbers
src/lib/components/   Svelte UI: HUD, menus, settings, controls, character/skills/map panels,
                      dialogue, notifications, game over, victory
```

The game modules are loaded with a dynamic `import()` inside `onMount`, so SSR and prerendering never touch WebGL, Rapier or Web Audio. Rendering, physics, gameplay and UI stay separate. Gameplay talks to Svelte only through the `UIBridge`, and the HUD is pushed about 10 times a second.

## Performance

- Instanced vegetation, rocks and crystals with distance LOD; architecture merged into a few draws per structure.
- 9×9 terrain chunks streamed in and out around the player, one GPU build per frame.
- Pooled projectiles, particles, rings, telegraphs, arcs, beams, spikes, lights and damage numbers.
- Enemies spawn by encounter only near the player and despawn behind them.
- Quality presets (Low / Medium / High) set pixel ratio, shadows, bloom, MSAA, grass, draw distance, vegetation density and particle budget. An adaptive-resolution option lowers the pixel ratio when frames run slow.
- Shaders are compiled during loading. While paused or in menus the simulation stops and the scene redraws only a few times a second; audio suspends while the tab is hidden.

## Testing status and known limitations

- `bun run check` (svelte-check) reports no errors or warnings, and `bun run build` succeeds.
- Gameplay was checked in headless Chromium with software rendering (SwiftShader). Scripted Playwright runs drive real keyboard and mouse input, using debug teleports and damage only to skip travel time. They covered:
  - **Movement and defence:** movement, dodge, double jump and shield.
  - **Spells:** every basic and special spell.
  - **Reactions:** all seven elemental reactions, triggered by actual casts.
  - **The quest:** from the first dialogue to the epilogue, including the Seal cutscene.
  - **The boss:**
    - every attack, forced once each;
    - all three phases and breaking the pillar ward;
    - parry stagger, the overheat window and shattering volatile crystals;
    - the arena barrier;
    - dying mid-fight, respawning with a full boss reset, and re-entering.
  - **Wrap-up:** victory and rewards, pause and panels, and reloading the save with Continue.
- Software rendering runs at about 10–60 fps depending on the scene, so frame cost has **not** been measured on a real GPU. The Low/Medium/High presets may need tuning on actual hardware.
- Balance (boss health, damage, EXP curve) is set from the numbers in code and the scripted runs, not from a human play-through.
- There are no touch controls yet.

For debugging, `window.__game.debug()` returns the live game context (player, enemies, boss, quests, and so on).
