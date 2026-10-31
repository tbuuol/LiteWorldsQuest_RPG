/* The terrain at many points, for tools/make_world.py (which places things on the land without a browser):
     echo '{"land": {...}, "points": [[x, z], ...]}' | node tools/terrain_probe.cjs
   prints [[walk, coast, river, road, slope], ...]: the ground walked on, metres to the shore (+ on land), to the river's
   water (- in it), how much road (0..1), and the steepest rise over 2 m. */
const T = require('../src/modules/terrain.js');
let input = '';
process.stdin.on('data', d => { input += d; }).on('end', () => {
  const q = JSON.parse(input), TR = T.create(q.land || {});
  const out = q.points.map(([x, z]) => {
    const h = TR.walk(x, z), s = Math.max(Math.abs(TR.walk(x + 2, z) - h), Math.abs(TR.walk(x - 2, z) - h), Math.abs(TR.walk(x, z + 2) - h), Math.abs(TR.walk(x, z - 2) - h)) / 2;
    return [+h.toFixed(2), +TR.coast(x, z).toFixed(1), +TR.river(x, z).toFixed(1), +TR.road(x, z).toFixed(2), +s.toFixed(2)];
  });
  process.stdout.write(JSON.stringify(out));
});
