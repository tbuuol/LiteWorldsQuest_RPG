// The seasons: what the year does to the land, from the year fraction of the clock (0 = spring equinox, 0.25 summer
// solstice, 0.5 autumn equinox, 0.75 winter solstice; a game year is three real months). Pure numbers, the same for
// every player and for the house.
//
// Deciduous trees leaf out in early spring, colour in autumn (each tree its own colour and its own days) and drop
// their leaves, bare through the winter; conifers stay green. Grass is fresh in spring, dries in late summer, is
// straw in autumn and lies under snow in winter. The temperature decides between rain and snow.

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const frac = x => x - Math.floor(x);

/** a tree's own number (0..1) from where it stands; the shaders compute exactly the same */
export function treeHash(x, z) { return frac(frac(x * 0.1031) * 37.17 + frac(z * 0.11369) * 59.83 + frac((x + z) * 0.0713) * 11.3); }

/** what the season does to one deciduous tree (h: its treeHash): how far its leaves are out (0 bare .. 1 full) and
 *  how far they have coloured (0 green .. 1 full autumn); the shader for the impostors does the same in GLSL */
export function treeSeason(yf, h) {
  const j = (h - 0.5) * 0.06;                       // each tree a few days early or late
  const out = smooth(0.02 + j, 0.11 + j, yf);       // leafing out in spring
  const fall = 1 - smooth(0.66 + j, 0.76 + j, yf);  // dropping in late autumn
  const leaf = yf < 0.4 ? out : fall;
  const autumn = yf < 0.4 ? 0 : smooth(0.55 + j, 0.65 + j, yf);
  return { leaf, autumn };
}
export const treeSeasonGLSL = `
  float treeHash(vec2 p) { return fract(fract(p.x * 0.1031) * 37.17 + fract(p.y * 0.11369) * 59.83 + fract((p.x + p.y) * 0.0713) * 11.3); }
  vec2 treeSeason(float yf, float h) {
    float j = (h - 0.5) * 0.06;
    float leaf = yf < 0.4 ? smoothstep(0.02 + j, 0.11 + j, yf) : 1.0 - smoothstep(0.66 + j, 0.76 + j, yf);
    float autumn = yf < 0.4 ? 0.0 : smoothstep(0.55 + j, 0.65 + j, yf);
    return vec2(leaf, autumn);
  }
  // autumn colours: gold, orange, red, brown-gold, and now and then one that stays greenish
  vec3 autumnColour(float h) {
    float k = fract(h * 7.13);
    return k < 0.3 ? vec3(0.95, 0.72, 0.18) : k < 0.58 ? vec3(0.95, 0.42, 0.10) : k < 0.8 ? vec3(0.78, 0.16, 0.08) : k < 0.93 ? vec3(0.66, 0.46, 0.18) : vec3(0.55, 0.6, 0.2);
  }
`;
export function autumnColour(h) {
  const k = frac(h * 7.13);
  return k < 0.3 ? [0.95, 0.72, 0.18] : k < 0.58 ? [0.95, 0.42, 0.10] : k < 0.8 ? [0.78, 0.16, 0.08] : k < 0.93 ? [0.66, 0.46, 0.18] : [0.55, 0.6, 0.2];
}

/** the season as numbers, for year fraction yf */
export function seasonAt(yf) {
  // mean temperature of the day (deg C): the land lags behind the sun, warmest in high summer (yf ~0.35, 19 C),
  // coldest in deep winter (~0.85, -1 C); below freezing roughly through the winter quarter
  const temp = 9 + 10 * Math.sin((yf - 0.10) * Math.PI * 2);
  return {
    yf, temp,
    // grass: 0 fresh green .. 1 dead straw
    dry: yf < 0.25 ? 0.05 : yf < 0.5 ? 0.05 + 0.3 * smooth(0.3, 0.48, yf) : yf < 0.75 ? 0.35 + 0.45 * smooth(0.5, 0.66, yf) : 0.8 - 0.75 * smooth(0.95, 1.0, yf),
    // flowers in the meadow: many in spring and early summer, few later, none in winter
    flowers: yf < 0.5 ? 0.4 + 0.6 * smooth(0.05, 0.15, yf) - 0.6 * smooth(0.3, 0.5, yf) : 0.1 * (1 - smooth(0.55, 0.65, yf)),
    // ferns: unrolling in spring, brown in autumn, gone under the winter
    fern: yf < 0.5 ? smooth(0.04, 0.12, yf) : 1 - smooth(0.7, 0.78, yf),
    fernBrown: yf < 0.5 ? 0 : smooth(0.56, 0.68, yf),
    // the snow that lies all winter where it is cold enough (fresh snowfall adds to it, see main.js)
    snow: smooth(1.5, -0.5, temp),
    name: ['spring', 'summer', 'autumn', 'winter'][Math.floor(yf * 4) % 4],
  };
}
