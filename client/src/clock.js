// The world's clock and sky: what time and season it is, where sun, stars and the three moons stand, and how much of
// each moon is lit. A pure function of the world clock (seconds since 1970), so every player sees the same sky, and
// the house can compute the same (it is all plain numbers).
//
//   a game day   = 6 real hours        (tbuuol, 2026-11-15)
//   a game year  = 364 game days = 91 real days, four seasons; year fraction 0 = spring equinox
//   the land lies at 52 degrees north; the sky turns like ours (real stars, real constellations)
//   three moons on their own orbits; their phases come from where the sun stands, as for our moon
//
// Directions are in the world's frame: x east, y up, z south (north is -z).

const DAY_S = 6 * 3600, YEAR_DAYS = 364;
const EPOCH = Date.UTC(2026, 10, 14) / 1000;        // world day 0
const LAT = 52 * Math.PI / 180, OBL = 23.44 * Math.PI / 180;
const TAU = Math.PI * 2;

// the moons: angular radius (degrees, our moon 0.26; these hang huge in the sky, as in the north's old tales), sidereal period (game days, negative: runs backwards), orbit
// inclination and node (degrees), where it stood at day 0, its colour (linear rgb) and how much light it gives
export const MOONS = [
  { name: 'Silvermoon', radius: 9.0, period: 27.3, incl: 5.1, node: 40, at0: 0.10, color: [0.80, 0.86, 1.00], albedo: 1.0 },
  { name: 'Embermoon', radius: 5.5, period: 9.1, incl: 11.0, node: 160, at0: 0.55, color: [1.00, 0.58, 0.32], albedo: 0.55 },
  { name: 'Tidewisp', radius: 2.4, period: -3.3, incl: 18.0, node: 280, at0: 0.80, color: [0.45, 0.95, 0.85], albedo: 0.3 },
];

// a unit vector in the equatorial frame (x to the spring point, z to the celestial pole)
export function equatorial(ra, dec) { const c = Math.cos(dec); return [c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)]; }
// ecliptic longitude / latitude to the equatorial frame
function fromEcliptic(lon, lat) {
  const c = Math.cos(lat), x = c * Math.cos(lon), y = c * Math.sin(lon), z = Math.sin(lat);
  return [x, y * Math.cos(OBL) - z * Math.sin(OBL), y * Math.sin(OBL) + z * Math.cos(OBL)];
}

let offset = 0, scale = 1, fixedHour = null, fixedDay = null;
/** (dev / film) shift or speed up the clock, or hold the hour of the day (0..24) or the day of the year (0..363) */
export function setClock({ hour, day, speed } = {}) {
  if (hour !== undefined) fixedHour = hour;
  if (day !== undefined) fixedDay = day;
  if (speed !== undefined) { const now = Date.now() / 1000; offset = now * scale + offset - now * speed; scale = speed; }
}

/** the sky at world time t (seconds since 1970) */
export function skyAt(t = Date.now() / 1000) {
  let days = (t * scale + offset - EPOCH) / DAY_S;
  if (fixedDay !== null) days = Math.floor(days / YEAR_DAYS) * YEAR_DAYS + fixedDay + (days - Math.floor(days));
  if (fixedHour !== null) days = Math.floor(days) + fixedHour / 24;
  const dayFrac = days - Math.floor(days);
  const yearFrac = ((days / YEAR_DAYS) % 1 + 1) % 1;

  // the sun on the ecliptic; the hour angle so that it is highest at noon; the sky's turn (sidereal time) follows
  const sunLon = yearFrac * TAU;
  const sunEq = fromEcliptic(sunLon, 0);
  const sunRa = Math.atan2(sunEq[1], sunEq[0]);
  const lst = TAU * (dayFrac - 0.5) + sunRa;
  // equatorial -> world: rows of the 3x3 matrix (column-major for three's Matrix3.fromArray below)
  const cl = Math.cos(lst), sl = Math.sin(lst), sp = Math.sin(LAT), cp = Math.cos(LAT);
  // east  = -sl x + cl y ; up = cp (cl x + sl y) + sp z ; north = -sp (cl x + sl y) + cp z ; world z = -north
  const rows = [[-sl, cl, 0], [cp * cl, cp * sl, sp], [sp * cl, sp * sl, -cp]];
  const toWorld = v => [rows[0][0] * v[0] + rows[0][1] * v[1] + rows[0][2] * v[2],
                        rows[1][0] * v[0] + rows[1][1] * v[1] + rows[1][2] * v[2],
                        rows[2][0] * v[0] + rows[2][1] * v[1] + rows[2][2] * v[2]];
  const sun = toWorld(sunEq);
  const moons = MOONS.map((m, i) => {
    const lon = (m.at0 + days / m.period) * TAU;
    const lat = m.incl * Math.PI / 180 * Math.sin(lon - m.node * Math.PI / 180);
    const dir = toWorld(fromEcliptic(lon, lat));
    // lit fraction from the angle between moon and sun as seen from here (0 new, 1 full)
    const cosE = dir[0] * sun[0] + dir[1] * sun[1] + dir[2] * sun[2];
    return { ...m, i, dir, lit: (1 - cosE) / 2 };
  });
  return {
    days, dayFrac, yearFrac, hour: dayFrac * 24,
    season: ['spring', 'summer', 'autumn', 'winter'][Math.floor(yearFrac * 4) % 4],
    sun, sunAlt: Math.asin(Math.max(-1, Math.min(1, sun[1]))) * 180 / Math.PI,
    moons,
    // column-major 3x3 (for a mat3 uniform): equatorial -> world
    eqToWorld: [rows[0][0], rows[1][0], rows[2][0], rows[0][1], rows[1][1], rows[2][1], rows[0][2], rows[1][2], rows[2][2]],
  };
}
