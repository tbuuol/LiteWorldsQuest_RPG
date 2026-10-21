# LiteWorldsQuest

A first-person multiplayer game for the DogecoinArcade / PepecoinArcade, built the way ASHVALE is:
one inscribed page with a small module loader, and the game in modules a registry names.

The game starts in **Blockshire** (`src/levels/blockshire.json`), a small fenced camp with five log huts, a village
square with a campfire and a wishing well, and five villagers to talk to. In it you can:

- open hut doors (shared with every player)
- take the storehouse key from the Elder's table and unlock the storehouse
- find three crystals
- make a wish at the well (a wallet payment)

The first test level, "The Testing Halls" (`src/levels/test.json`), is still there.

## Layout

| Path | What it is |
|---|---|
| `src/loader.js` | The module loader baked into every page (ASHVALE's design, cut down) |
| `src/page.html` | The page that gets inscribed; `build.py` fills it in |
| `src/modules/net.js` | Other players: arcade rooms (`arcade.realtime`) plus the fast lane (WebRTC) |
| `src/modules/wallet.js` | Who is playing (`/r/wallet`), saving (`arcade.storage`), paying (`/r/send`) |
| `src/modules/art.js` | Everything drawn, made by code: textures painted on canvases, sky, sun and shadows, huts, campfire, forest, grass, fence, props, the well, blocky people |
| `src/modules/engine.js` | First person, physics, using things, villagers and their lines, the shared world, the HUD |
| `src/levels/blockshire.json` | Blockshire: where every hut, prop, path and villager stands, and what they say |
| `src/levels/test.json` | The first test level |
| `config.json` | Module versions and interfaces, the three.js inscription, and (later) inscription ids |
| `build.py` | Writes `dist/liteworldsquest.html` (one file, ~107 KB) and `dist/modules/*` |
| `dev/` | A stand-in for the arcade viewer, to play without inscribing anything |

three.js is not in the page. The page imports the copy ASHVALE already inscribed
(`374cfd2b…f9539`, r160), so it costs nothing.

## What the graphics cost

There are no picture files. Every texture is painted by code when the game starts: grass, dirt, logs, planks,
thatch, stone, bark, leaves and cloth. The village is laid out from a seed, so everyone sees the same one.

| Part | Size |
|---|---|
| Graphics code (`art.js`) | 46 KB |
| Blockshire's layout (`blockshire.json`) | 5.4 KB |
| The whole page | 107 KB, plus three.js, which ASHVALE already inscribed |

The scene has about 470 draw calls and 79,000 triangles. That is fine on a desktop. For phones, the next step is
to merge the static parts (huts, fence, props) into a few meshes per material.

## Multiplayer

- **Rooms.** Every player of a level is in the room `lwq.<level>` of the game family `liteworldsquest`. This works
  on any arcade node in the mesh.
- **Positions.** They go over the fast lane, browser to browser, 15 times a second. Without a fast lane they go
  through the room, 4 times a second. Standing still, a player sends a heartbeat once a second.
- **Drawing other players.** Others are drawn 100 ms behind on the fast lane, or 300 ms behind through the room,
  and moved smoothly between the positions they sent.
- **The shared world** is kept by the **host**. The host is the player who joined the room first; when they leave,
  the next one takes over, as in ASHVALE. The shared world is which doors are open and who took what.
  - Other players send intents (`{I, o}`).
  - The host decides and sends the whole world (`{W}`), and sends it again every 3 seconds.

## Wallet

- **The HUD** shows the player's @name and balance (`GET /r/wallet`). If the player keeps the wallet private, the
  game still plays.
- **Saving.** Crystals and offerings are kept in the wallet's storage for this page (`arcade.storage`).
- **The shrine** asks the wallet for a 1-coin payment **to the player's own address**, so only the fee leaves.
  The player approves or refuses it in the wallet.

## Playing it locally

```bash
python3 build.py            # optional: the dev server rebuilds on every load
python3 dev/server.py       # http://localhost:8765/?as=alice  and  ?as=bob in a second tab
```

- **Two tabs** of the same browser meet each other.
- **Payments** pop up in the dev viewer as Approve / Refuse. Nothing real is sent.
- **three.js** is fetched once from the local arcade node (`127.0.0.1:8420`) and kept in `dev/cache/`.

**From Windows**, while the server runs on the Linux machine, forward the port over SSH and open the URL in your
browser:

```bash
ssh -L 8765:localhost:8765 tbuuol@<server>
```

**Controls:** click the view to capture the mouse. WASD to move, Shift to run, Space to jump, mouse to look,
E to use or talk, F3 for FPS, Esc to release the mouse.

## Putting it on P test

Not done yet. When the game is ready:

1. Run `python3 build.py`.
2. Inscribe `dist/liteworldsquest.html` from the arcade's Inscriptions page, with this JSON:

   ```json
   {"game": {"name": "LiteWorldsQuest", "family": "liteworldsquest", "version": "0.1",
             "players": "1-8", "multiplayer": true, "wallet": true, "genre": "adventure"}}
   ```

3. Put the publisher's address in `config.json` (`creator`). Later releases can then replace single modules with a
   new registry, without a new page.
