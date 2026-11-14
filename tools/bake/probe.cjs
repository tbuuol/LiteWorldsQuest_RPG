const T = require('../../src/modules/terrain.js');
const W = require('../../src/levels/world.json').data;
const TR = T.create(W.land || {});
const [x0, z0, x1, z1] = TR.EXT;
let mn = 1e9, mx = -1e9;
for (let z = z0; z <= z1; z += 8) for (let x = x0; x <= x1; x += 8) { const h = TR.floor(x, z); if (h < mn) mn = h; if (h > mx) mx = h; }
const t = TR.trees(x0, z0, x1, z1);
console.log(JSON.stringify({ ext: TR.EXT, sea: TR.SEA, min: mn, max: mx, trees: t.length, kinds: [...new Set(t.map(a => a[3]))], w: TR.weights(0, 0, TR.floor(0, 0)) }));
