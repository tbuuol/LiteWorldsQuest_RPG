### 2026-10-22 Games 3x smaller on chain: minify + one gzip bundle, unpacked in the browser (tbuuol / Claude, LiteWorldsQuest)
For anybody inscribing a game: LiteWorldsQuest's page went from **237 KB (v0.3, 32 pieces, ~56 test coins)** to
**74 KB (v0.4: a 10.5 KB page + a 63.6 KB bundle, ~11 pieces, ~18 test coins)**, same game plus combat. Nothing in the
arcade changed; it is all in the game's own build (`~/liteworldsquest/build.py`, `src/loader.js`, `src/page.html`).
Verified in the dev viewer (boot, play, a phone); v0.4 is not inscribed yet.

1. **Minify every module before it is inscribed.** esbuild as one static binary, no Node: `@esbuild/linux-x64`
   0.24.0 from the npm registry (sha1 checked against the registry's `dist.shasum`), then
   `esbuild --minify --target=es2020 --loader=js` on stdin. Comments, whitespace and local names go; property names
   stay (no `--mangle-props`), so modules still meet through their interfaces. **About 45 % off**: engine 66 -> 34 KB,
   art 90 -> 54 KB, combat 17 -> 8.5 KB. Only the release build does this; the dev page stays readable.
2. **Put all modules and levels into ONE gzip bundle and inscribe it as binary** (`application/gzip`), not as base64
   inside the HTML (base64 adds a third back). The bundle is `[{"n": name, "k": "js"|"json", "t": text}]` as compact
   JSON, gzipped with **zopfli** (`pip install zopfli`, 60 iterations: ~5 % below zlib -9). One bundle compresses
   better than separate files because the modules share vocabulary. **174 KB of minified code and level data -> 63.6 KB.**
3. **The inscribed page keeps only the loader and the registry** (10.5 KB, ~4 KB of it the asset ids). At start it
   fetches `/content/<bundle id>` and unpacks it with the browser's own `DecompressionStream('gzip')`:
   `new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text()`. A few milliseconds for 170 KB; the
   download it saves is worth far more, especially on a phone. Each JS module then runs as a `blob:` script (the
   viewer's CSP already allows `blob:`), each JSON one is parsed. The bundle and the registry lookups are fetched in
   parallel.
4. **Updates stay small too.** The release build also writes each module alone as `<name>.js.gz`. A registry entry
   may name `"gz": <id>` beside (or instead of) `"id"`; a loader that can unpack prefers it. A registry that only
   the new loader can read says `"loader": 2`; pages with loader 1 already skip registries with a higher loader
   number, so nothing old breaks.

Caveats: `DecompressionStream` needs Chrome/Edge 80+, Firefox 113+, Safari 16.4+. Pages inscribed before this
(LiteWorldsQuest v0.2/v0.3) cannot read gzip: they keep their baked modules unless a loader-1 registry gives them
plain ones. `arcade.storage` is kept per page inscription, so a new page starts with fresh saves.
Nothing needed from the other side. Questions to @liteworldsquest or tbuuol.
