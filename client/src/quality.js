// Quality follows the frame rate: the game measures itself and steps down when it falls under 30 fps, and back up
// when there is room for long enough. The player can also fix a level (setFixed). Levels 0 (lowest) .. 4.

export const LEVELS = [
  { name: 'low',     scale: 0.5,  shadows: 0,    view: 260,  trees: 180, density: 0.35, detail: false, fog: 0.0030 },
  { name: 'medium',  scale: 0.7,  shadows: 0,    view: 420,  trees: 280, density: 0.6,  detail: false, fog: 0.0019 },
  { name: 'good',    scale: 0.85, shadows: 1024, view: 620,  trees: 400, density: 0.8,  detail: true,  fog: 0.0013 },
  { name: 'high',    scale: 1.0,  shadows: 2048, view: 900,  trees: 560, density: 1.0,  detail: true,  fog: 0.0009 },
  { name: 'highest', scale: 1.0,  shadows: 4096, view: 1250, trees: 760, density: 1.0,  detail: true,  fog: 0.0007, dprMax: 1.5 },
];
const LOW = 28, HIGH = 50, DOWN_AFTER = 2500, UP_AFTER = 9000;

export function createQuality(apply, start = 2) {
  let level = start, fixed = null, frames = 0, since = performance.now(), fps = 60;
  let lowFor = 0, highFor = 0, ceiling = LEVELS.length - 1, lastChange = 0;
  apply(LEVELS[level], level);
  function set(l, now) {
    l = Math.max(0, Math.min(LEVELS.length - 1, l));
    if (l === level) return;
    level = l; lastChange = now; lowFor = highFor = 0;
    apply(LEVELS[level], level);
  }
  return {
    get fps() { return fps; },
    get level() { return level; },
    get name() { return LEVELS[level].name + (fixed !== null ? ' (fixed)' : ''); },
    setFixed(l, now = performance.now()) { fixed = l; if (l !== null) set(l, now); },
    frame(now) {
      frames++;
      const span = now - since;
      if (span < 500) return;
      fps = frames * 1000 / span; frames = 0; since = now;
      if (fixed !== null || now - lastChange < 1500) return;
      if (fps < LOW) { lowFor += span; highFor = 0; } else if (fps > HIGH) { highFor += span; lowFor = 0; } else { lowFor = highFor = 0; }
      if (lowFor >= DOWN_AFTER && level > 0) {
        ceiling = level - 1;   // the level that was too much is only tried again after a long good stretch
        set(level - 1, now);
      } else if (highFor >= UP_AFTER && level < LEVELS.length - 1) {
        if (level + 1 <= ceiling || highFor >= UP_AFTER * 4) { ceiling = Math.max(ceiling, level + 1); set(level + 1, now); }
      }
    },
  };
}
