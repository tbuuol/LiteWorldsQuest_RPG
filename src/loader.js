/* LiteWorldsQuest module loader -- the one piece of code baked into every page and never replaced.
   Same architecture as ASHVALE's loader (read off its inscription, 2026-10-20), cut to what this game needs:
   every part of the game is a module with a stable interface, and a REGISTRY names the current inscription id,
   version and interface (api) of each:
     {"lwq":"registry","version":N,"loader":1,"modules":{
        "three":{"id":..,"v":"0.160.0","api":160,"kind":"esm"}, "net":{"id":..,"v":1,"api":1,"kind":"js"}, ...,
        "levels":{"test":{"id":..,"v":1,"api":1,"kind":"json"}}}}
   boot(): take each module from the page when the page carries that exact version, else fetch it by id; check every
   module's declared needs ({dep: api}); a newer module that does not fit falls back to the copy baked into the page.
   Module code registers itself with LWQ.define(name, {api, v, needs}, factory(deps)); a JSON module is
   {"lwq":"module","name","api","v","data"}; an ES module (kind "esm") exports its interface. */
(function (G) {
  'use strict';
  const L = G.LWQ = G.LWQ || {};
  const defs = L._defs = L._defs || {};
  /* 2 (v0.4): modules can come packed -- the page's own in one gzip bundle (L.unpack), an update as a gzip inscription
     (an entry's "gz" id). A registry that only a loader 2 can read says "loader": 2, and older pages pass it by. */
  L.LOADER = 2;
  const gunzip = async r => {
    if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot unpack the game (no DecompressionStream)');
    return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text();
  };
  /* a module's code run as a script of its own (it registers itself with LWQ.define) */
  function runScript(text, src, name) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = url; s.onload = () => { L._src = null; URL.revokeObjectURL(url); res(); };
      s.onerror = () => { L._src = null; rej(new Error(name + ': script failed')); };
      L._src = src; document.head.appendChild(s);
    });
  }
  /* the page's own modules, packed: [{n: name, k: 'js'|'json', t: text}], gzip, an inscription of its own */
  L.unpack = async function (url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('the game bundle: HTTP ' + r.status);
    const list = JSON.parse(await gunzip(r));
    for (const m of list) {
      if (m.k === 'json') { L._src = 'page'; L.defineData(JSON.parse(m.t)); L._src = null; }
      else await runScript(m.t, 'page', m.n);
    }
    return list.length;
  };
  L.define = function (name, meta, factory) { defs[name] = { meta: meta || {}, factory, src: L._src || 'page' }; };
  L.defineData = function (j) {
    if (!j || j.lwq !== 'module') throw new Error('not a LiteWorldsQuest data module');
    defs[j.name] = { meta: { api: j.api, v: j.v, data: true }, factory: () => j.data, src: L._src || 'page' };
  };
  L.defineValue = function (name, meta, value) { defs[name] = { meta: meta || {}, factory: () => value, src: L._src || 'page' }; };
  L.get = function (name) { return L._values ? L._values[name] : undefined; };

  /* registry -> [{name, group, entry}]; levels.X -> "level.X" */
  function flatten(reg) {
    const out = [], M = reg.modules || {};
    for (const k in M) {
      if (k === 'assets') continue;   /* files (textures, models): fetched when the game wants them */
      if (k === 'levels') { for (const j in M[k]) out.push({ name: 'level.' + j, group: 'levels', entry: M[k][j] }); }
      else out.push({ name: k, group: '', entry: M[k] });
    }
    return out;
  }
  async function fetchModule(name, e) {
    const packed = !!e.gz && typeof DecompressionStream !== 'undefined';   /* the packed copy when there is one */
    const r = await fetch('/content/' + (packed ? e.gz : e.id));
    if (!r.ok) throw new Error(name + ': HTTP ' + r.status);
    const text = packed ? await gunzip(r) : await r.text();
    if (e.kind === 'json') { L._src = 'remote'; L.defineData(JSON.parse(text)); L._src = null; return; }
    if (e.kind === 'esm') {
      const ns = await import(URL.createObjectURL(new Blob([text], { type: 'text/javascript' })));
      defs[name] = { meta: Object.assign({ api: e.api, v: e.v }, ns.meta || {}), factory: () => ns, src: 'remote' };
      return;
    }
    await runScript(text, 'remote', name);
  }
  const fits = (have, api) => have && String(have.meta.api) === String(api);

  L.boot = async function (opts) {
    opts = opts || {};
    let reg = opts.baked, regSrc = 'baked';
    const all = flatten(reg), baked = Object.assign({}, defs), report = [], list = [];
    for (const item of all) {
      const { name, entry } = item;
      /* a newer registry may name a module (a new level, say) this page does not carry and that has no inscription
         yet: leave it out instead of refusing to start. If something here needs it, the interface check says so. */
      if (!defs[name] && !entry.id && !entry.gz) { console.warn('LWQ: ' + name + ' is not on this page and not inscribed, left out'); report.push([name, entry.v, 'left out']); continue; }
      list.push(item);
    }
    for (const { name, entry } of list) {
      const have = defs[name];
      if (have && String(have.meta.v) === String(entry.v)) { report.push([name, entry.v, 'page']); continue; }
      if (entry.id || entry.gz) {
        try { await fetchModule(name, entry); report.push([name, entry.v, 'fetched']); continue; }
        catch (e) { console.warn('LWQ: could not fetch ' + name + ', using the baked copy', e.message); }
      }
      if (have) report.push([name, have.meta.v, 'page (fallback)']);
      else throw new Error('Module "' + name + '" is missing and could not be loaded.');
    }
    /* interface check. "levels" means every level module. */
    const names = list.map(l => l.name), levelNames = list.filter(l => l.group === 'levels').map(l => l.name);
    for (const n of names) {
      const needs = defs[n].meta.needs || {};
      for (const dep in needs) {
        for (const t of dep === 'levels' ? levelNames : [dep]) {
          if (fits(defs[t], needs[dep])) continue;
          if (fits(baked[t], needs[dep])) { console.warn('LWQ: ' + t + ' does not fit ' + n + ', using the baked copy'); defs[t] = baked[t]; continue; }
          throw new Error('This page needs ' + t + ' interface ' + needs[dep] + ' (for ' + n + ') but found '
            + (defs[t] ? defs[t].meta.api : 'none') + '. Open the newest LiteWorldsQuest page.');
        }
      }
    }
    const values = {};
    function inst(n, stack) {
      if (n in values) return values[n];
      if (stack.indexOf(n) >= 0) throw new Error('module cycle: ' + stack.concat(n).join(' > '));
      const d = defs[n]; if (!d) throw new Error('missing module ' + n);
      const deps = {};
      for (const dep in (d.meta.needs || {})) {
        if (dep === 'levels') { deps.levels = {}; for (const t of levelNames) deps.levels[t.slice(6)] = inst(t, stack.concat(n)); }
        else deps[dep] = inst(dep, stack.concat(n));
      }
      return (values[n] = d.factory(deps));
    }
    for (const n of names) inst(n, []);
    L._values = values;
    values.$registry = reg; values.$registrySource = regSrc; values.$report = report;
    /* where an asset lives: its inscription once it has one, else beside the page (the dev server) */
    const A = (reg.modules && reg.modules.assets) || {};
    values.$asset = Object.keys(A).length ? (name => { const a = A[name]; if (!a) throw new Error('no asset ' + name); return a.id ? '/content/' + a.id : '/content/assets/' + a.file; }) : null;
    return values;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
