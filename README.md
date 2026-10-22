# LiteWorldsQuest

A first-person multiplayer game for the DogecoinArcade / PepecoinArcade, built the way ASHVALE is:
one inscribed page with a small module loader, and the game in modules a registry names.

The game starts in **Blockshire** (`src/levels/blockshire.json`), a small fenced camp with five log huts, a village
square with a campfire and a wishing well, and four villagers to talk to. In it you can:

- open hut doors and the camp's gate (shared with every player)
- fight at the gate: raiders come out of the forest, two guards hold the gate and Brother Anselm heals them; your
  sword (F, a click, or ⚔ on a phone) earns XP and levels (`src/modules/combat.js`)
- make a wish at the well (a wallet payment)

On a phone the picture is always landscape, with a joystick and buttons on the screen.

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
| `src/modules/combat.js` | Player stats (hit points, XP, levels) and the fight at the gate: guards, priest, raiders |
| `build.py` | Writes the dev page `dist/liteworldsquest.html`; with `--release` the page to inscribe (`dist/release/`): a 10 KB page plus `bundle.json.gz`, every module minified (esbuild) and packed (zopfli) |
| `dev/` | A stand-in for the arcade viewer, to play without inscribing anything |

three.js is not in the page. The page imports the copy ASHVALE already inscribed
(`374cfd2b…f9539`, r160), so it costs nothing.

## What it costs on chain

Textures and the people model are real files (the Hybrid tier, ~2 MB, inscribed once). Everything else is code
and level data, and since v0.4 it goes on chain small:

| Part | Size |
|---|---|
| The page (loader + registry) | 10 KB |
| `bundle.json.gz`: every module and level, minified and gzipped | 64 KB (174 KB minified, 268 KB as written) |
| three.js | nothing: ASHVALE's inscription, shared |

How the bundle is made and read is written up for other builders in `docs/collab-notes-entry.md`.

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
