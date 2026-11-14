/* Bakes the old computed ground (src/modules/terrain.js) into data for the rebuild, once:
     node --jitless tools/bake/bake_world.cjs [out-dir (content/core/world)]
   ground.bin  u16 LE per 2 m sample, centimetres above BASE, rows north to south (z), columns west to east (x)
   land.bin    2 bytes per sample: land kind (index into KINDS, the strongest), road 0..255
   ground.json the grid's extent, step, base, the kinds and the sea level
   The ground is only the ground. The trees the old code grew on it are world content of their own:
   ../flora/trees.bin (per tree: i16 x dm, i16 z dm, u8 scale*50, u8 kind) and ../flora/flora.json. */
const fs = require('fs'), path = require('path');
const T = require('../../src/modules/terrain.js');
const W = require('../../src/levels/world.json').data;
const OUT = process.argv[2] || path.join(__dirname, '../../content/core/world');
fs.mkdirSync(OUT, { recursive: true });
const TR = T.create(W.land || {});
const [x0, z0, x1, z1] = TR.EXT, STEP = 2, BASE = -20;
const NX = Math.round((x1 - x0) / STEP) + 1, NZ = Math.round((z1 - z0) / STEP) + 1;
const KINDS = ['green', 'valley', 'troll', 'fey', 'ruins', 'cemetery', 'swamp', 'mountain'];
const ground = Buffer.alloc(NX * NZ * 2), land = Buffer.alloc(NX * NZ * 2);
let t0 = Date.now();
for (let iz = 0; iz < NZ; iz++) {
  const z = z0 + iz * STEP;
  for (let ix = 0; ix < NX; ix++) {
    const x = x0 + ix * STEP, h = TR.floor(x, z), i = iz * NX + ix;
    ground.writeUInt16LE(Math.max(0, Math.min(65535, Math.round((h - BASE) * 100))), i * 2);
    const w = TR.weights(x, z, h);
    let best = 0, bv = -1;
    KINDS.forEach((k, j) => { if ((w[k] || 0) > bv) { bv = w[k] || 0; best = j; } });
    land[i * 2] = best;
    land[i * 2 + 1] = Math.round(Math.max(0, Math.min(1, TR.road(x, z))) * 255);
  }
  if (iz % 64 === 0) process.stderr.write(`row ${iz}/${NZ}, ${Math.round((Date.now() - t0) / 1000)} s\n`);
}
const trees = TR.trees(x0, z0, x1, z1);
const TREE_KINDS = [...new Set(trees.map(t => t[3]))].sort();
const tb = Buffer.alloc(trees.length * 6);
trees.forEach(([x, z, s, k], i) => {
  tb.writeInt16LE(Math.round(x * 10), i * 6); tb.writeInt16LE(Math.round(z * 10), i * 6 + 2);
  tb[i * 6 + 4] = Math.max(0, Math.min(255, Math.round(s * 50))); tb[i * 6 + 5] = TREE_KINDS.indexOf(k);
});
fs.writeFileSync(path.join(OUT, 'ground.bin'), ground);
fs.writeFileSync(path.join(OUT, 'land.bin'), land);
const FLORA = path.join(OUT, '../flora');
fs.mkdirSync(FLORA, { recursive: true });
fs.writeFileSync(path.join(FLORA, 'trees.bin'), tb);
fs.writeFileSync(path.join(FLORA, 'flora.json'), JSON.stringify({ trees: { file: 'trees.bin', count: trees.length, kinds: TREE_KINDS,
  record: 'i16 x dm, i16 z dm, u8 scale*50, u8 kind (index into kinds)' },
  note: 'plants and trees are world content placed on the ground, not part of it' }, null, 1));
fs.writeFileSync(path.join(OUT, 'ground.json'), JSON.stringify({
  extent: [x0, z0, x1, z1], step: STEP, nx: NX, nz: NZ, base: BASE, sea: TR.SEA,
  kinds: KINDS.concat(['road']),
  baked_from: 'src/modules/terrain.js v7 (ground only)'
}, null, 1));
process.stderr.write(`done: ${NX}x${NZ} samples, ${trees.length} trees, ${Math.round((Date.now() - t0) / 1000)} s\n`);
