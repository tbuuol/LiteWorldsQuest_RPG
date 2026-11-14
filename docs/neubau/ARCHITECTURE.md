# LiteWorldsQuest Beta — the rebuild

The beta is rebuilt from the ground up (tbuuol, 2026-11-14): a fast, secure server keeps the world, the browser
only draws it, and new content comes as modules that never touch the core.

## The three parts

| Part | Where | What it does |
|---|---|---|
| **House** (`server/`, Rust) | the ArcadeOS box, one process | The only authority. Simulates every zone at a fixed tick, checks every input, keeps every player, pays and gets paid. |
| **Client** (`client/`, JS + three.js) | the player's browser | Draws, plays sound, reads input, predicts the own movement, shows what the house says. Decides nothing. |
| **Content** (`content/<module>/`, data) | read by both | The world, items, creatures, loot, recipes, quests, dialogue, models and textures. No code. |

Nothing exists twice: rules are Rust, pictures are JS, everything a designer adds is data both of them read.

## The house

- **Tick.** 20 per second. Each tick: inputs in, zones step (movement, AI, combat, timers), deltas out.
- **Zones.** The open world and the instanced places (ship, caves, interiors) are zones in the same process. A
  zone only steps while somebody is in it or something in it is due.
- **Authority and checks.** The client sends intents, never results:
  - movement: the wanted position each frame is checked against speed, ground (baked height map), solids and
    zone bounds; a position that cannot be reached is corrected and sent back;
  - actions (strike, use, take, gather, craft, trade, buy): range, line, cooldown, ownership and price are the
    house's; the client only asks;
  - a rate limit per connection; a connection that keeps breaking it is closed.
- **Interest.** A grid of 32 m cells; a player gets what happens within view distance (about 120 m), nothing else.
- **Wire.** WebSocket, binary frames (little endian, a 1-byte kind first). Positions are quantised (cm, 1/1024 turn)
  and only changes are sent. JSON only for rare, big things (a record, a dialogue).
- **Login.** The arcade's accounts: the client signs a one-time challenge with its login key (Ed25519, the key the
  arcade login already uses); the house checks it against the account's public key. No passwords in the game.
- **Saving.** One store on the box (`/state/lwq`), written in the background: players every 30 s and on leaving,
  the world's lasting things (plots, buildings, shops) when they change. A crash loses at most seconds.
- **Payments.** tLTC (Litecoin testnet node on the box): invoices to fresh addresses of the house's key, watched
  through the node; deeds and resale as the old tools did, now in the house.
- **Doors.** Door 1: WebSocket for players on this arcade. Door 2 (later): the mesh room `liteworldsquest-beta`,
  for players on other arcades. Both feed the same zones.

## Content modules

```
content/<module>/module.json      id, version, depends, what it adds
content/<module>/world/...        baked ground (height tiles, land kinds, trees), places, zones, spawns
content/<module>/items.json       items, materials, recipes
content/<module>/creatures.json   kinds, stats, loot tables, behaviour presets
content/<module>/quests.json      quests as data: steps (talk, kill, gather, bring, reach), rewards
content/<module>/npcs.json        who stands where, what they say
content/<module>/assets/...       glTF models (meshopt), KTX2 textures, sounds
```

- The house checks every file against its schema when it loads a module. A broken module is refused whole and
  does not stop the others.
- Behaviour is chosen from presets the core has (wander, guard, flee, hunt, boss phases); a module sets numbers,
  not code.
- Modules load and reload while the house runs.
- `content/core` is the world as it is now (Blockshire, Greenwood, Genesis, the beach, the ship, the caves, ...),
  carried over and made more beautiful.

## The ground, baked

The old `terrain.js` computed the ground in code. It is run once by `tools/bake/` and becomes data:

- height tiles, 64 m by 64 m on a 2 m grid (u16, centimetres above a base), for the whole 3072 m by 2048 m;
- a land-kind map (green, valley, troll, fey, ruins, cemetery, swamp, mountain, road) for the client's texture
  splatting and the house's rules;
- the trees as a list.

The house walks on the tiles, the client draws them. Neither computes the ground.

## The look

Aim: Oblivion, towards Skyrim, in a browser.

- PBR materials with colour, normal and roughness maps; terrain splatted from the land-kind map with detail
  textures; instanced trees, rocks and grass with wind; a sky with the time of day and haze; fog with height;
  soft shadows (cascades), ambient occlusion, bloom, filmic tone mapping.
- Models and animations are real files from CC0 sources (Poly Haven, ambientCG, Quaternius, ...), compressed.
- **Quality follows the frame rate.** Target 30 fps on every device before anything is lowered. The client
  measures continuously and steps through: render scale, shadows, view distance, grass density, post effects,
  and back up when there is room. The player can also fix a level.

## Stages, each playable

1. House core, login, movement, the open world's ground, sky and forest, automatic quality; players see each other.
2. Combat, creatures and their AI, the bag, equipment, loot.
3. Skills, gathering, crafting, quests, NPC dialogue: all from content modules.
4. Plots, building, shops, tLTC payments, deeds.
5. The mesh door: playing from other arcades.

Everybody begins again in the beta; old records are not carried over.
