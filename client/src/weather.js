// The weather: a pure function of the world clock, like the sky (clock.js), so every player has the same weather at
// the same time and the house can compute it too. One number, the weather's strength w (0 .. 6), drifts slowly
// through the game days; everything else follows from it:
//
//   0 clear   1 partly cloudy   2 overcast   3 drizzle   4 rain   5 heavy rain   6 storm
//
// Changes come gradually (a front takes about half an hour of real time to come in). Clear and partly cloudy are
// the most common, storms are rare. The wind belongs to the weather: calm under a clear sky, gusty in rain, a gale
// in a storm, and it turns slowly from front to front. (Seasons will shift the odds; snow instead of rain in winter.)

import { seasonAt } from './seasons.js';

const DAY_S = 6 * 3600;
const EPOCH = Date.UTC(2026, 10, 14) / 1000;
export const NAMES = ['clear', 'partly cloudy', 'overcast', 'drizzle', 'rain', 'heavy rain', 'storm'];

function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
// smooth value noise in one dimension (smootherstep between knots)
function noise1(x, salt) {
  const i = Math.floor(x), f = x - i, u = f * f * f * (f * (f * 6 - 15) + 10);
  return hash(i + salt * 1000) * (1 - u) + hash(i + 1 + salt * 1000) * u;
}

let forced = null;
/** (dev) hold the weather at w (0..6), or null to follow the clock */
export function setWeather(w) { forced = w; }

/** the weather at world time t (seconds since 1970), in the season of year fraction yf, at hour of the day hour */
export function weatherAt(t = Date.now() / 1000, yf = 0, hour = 12) {
  const days = (t - EPOCH) / DAY_S;
  const season = seasonAt(yf);
  // fronts every ~quarter day (1.5 h real), with smaller swings on top; the seasons tilt the odds: summer is
  // fairer, autumn wetter, winter grey
  const n = noise1(days * 4, 1) * 0.75 + noise1(days * 13, 2) * 0.25 + 0.09 * Math.sin((yf - 0.45) * Math.PI * 2);
  let w = forced ?? Math.max(0, Math.min(6, 6.6 * Math.pow(Math.max(0, n - 0.08) / 0.92, 1.7)));
  const k = (a, b) => Math.max(0, Math.min(1, (w - a) / (b - a)));   // ramps between stages
  const rain = k(2.5, 6);                                             // 0 dry .. 1 storm rain
  // the temperature now: the season's, warmer in the afternoon, cooler under clouds and in rain
  const cover0 = Math.min(1, 0.12 + 0.45 * k(0, 1) + 0.45 * k(1, 2.2));
  const temp = season.temp + 4 * Math.cos((hour - 15) / 24 * Math.PI * 2) * (1 - 0.6 * cover0) - 2.5 * rain + (noise1(days * 2, 4) - 0.5) * 4;
  const snow = rain > 0 && temp < 1;                                  // it snows instead
  // wind: direction turns slowly (with the fronts), strength by the weather, gusts more than the mean
  const dir = 0.6 + (noise1(days * 1.3, 3) - 0.5) * 3.0 + k(4, 6) * 0.4;
  return {
    w, name: NAMES[Math.min(6, Math.round(w))] + (rain > 0 && temp < 1 ? ' (snow)' : ''),
    cover: cover0,                                                     // cloud cover 0..1
    temp, snow, season,
    dark: k(1.6, 6),                                                   // how heavy and dark the clouds are
    rain,                                                              // 0 .. 1 how much falls
    drizzle: w > 2.5 && w < 3.6,                                       // fine and slow
    wind: {
      dir,
      base: 0.15 + 0.35 * k(1, 4) + 0.45 * k(4, 6),                   // the mean strength (see wind.js)
      gust: 0.45 + 0.4 * k(1, 4) + 0.9 * k(4.5, 6),                   // what a gust adds
    },
    fog: 1 + 0.6 * k(2, 3.5) + 1.2 * k(4, 6),                          // haze factor
    lightning: temp < 1 ? 0 : k(5.4, 6),                               // 0 .. 1 how often it strikes (no thunder in snow)
  };
}
