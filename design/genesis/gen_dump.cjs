const T = require('../../src/modules/terrain.js');
const W = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../../src/levels/world.json'), 'utf8'));
const D = W.data || W, TR = T.create(D.land || {});
const X0 = 520, X1 = 1100, Z0 = -260, Z1 = 170, st = 4, grid = [];
for (let z = Z0; z <= Z1; z += st) { const row = []; for (let x = X0; x <= X1; x += st) {
  const h = TR.walk(x, z), s = Math.max(Math.abs(TR.walk(x + 2, z) - h), Math.abs(TR.walk(x, z + 2) - h)) / 2;
  row.push([+h.toFixed(1), +s.toFixed(2), +TR.road(x, z).toFixed(2), +TR.coast(x, z).toFixed(0), +TR.river(x, z).toFixed(0)]); } grid.push(row); }
const roads = TR.ROADS.map(r => ({ w: r.w, pts: r.pts.filter(([x, z]) => x > X0 - 200 && x < X1 + 200 && z > Z0 - 200 && z < Z1 + 200) })).filter(r => r.pts.length);
process.stdout.write(JSON.stringify({ X0, X1, Z0, Z1, st, grid, roads, wall: D.land.walls[0] }));
