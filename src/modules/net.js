/* LiteWorldsQuest net module: other players. Shaped after ASHVALE's net module (v3), plus the arcade's fast lane,
   which a first-person game wants: positions 15 times a second, browser to browser.
     const r = await net.join(roomId, {game})  -> {online, room, why, backend}
     room.me                       {id, tag, address, guest}   (tag without '@'; '' for a guest)
     room.fast                     true when positions can go over the fast lane (WebRTC, ~30/s); else room only (~5/s)
     room.send(obj)    -> Promise<bool>   the room: reliable-ish, at most 512 bytes, about 5 a second
     room.state(obj)                     a position: the fast lane when there is one (unreliable, newest wins), else the room
     room.beat(obj)                      a position through the room as well, about once a second (dropped if the room is busy)
     room.tell(obj)                      something that must arrive (the world, an intent): always through the room,
                                         queued until the room's budget allows, never dropped
   WHY THE ROOM CARRIES WHAT MATTERS (tbuuol's first real test, 2026-10-21: players seen, then not): the arcade viewer
   drops fast-lane sends to a player whose direct link is still being set up ('connecting', up to 12 s) or has gone
   quiet without failing yet. So the fast lane only ever adds smoothness; presence and the world go through the room.
     room.on('message', fn({from, data})) / on('join'|'leave', fn({from})) / on('peer', fn({from, state}))
     room.on('closed', fn(why)) / on('rejoined', fn({me})) / on('reconnecting', fn())
     room.members() -> [player]  ;  room.leave() -> Promise
   A player is {id, tag, address, guest}; the sender is stamped by the arcade node, never taken from the message.
   Backends: the arcade realtime SDK (/r/realtime.js, window.arcade.realtime); otherwise {online:false} = solo.
   The dev harness (dev/viewer.html) answers the same postMessage protocol as the arcade viewer, so this module
   does not know it is being tested. */
(function (G) {
  'use strict';
  const MAX = 500;
  const norm = p => p ? { id: String(p.id || p.address || p.tag || '?'), tag: String(p.tag || '').replace(/^@/, ''),
                          address: p.address || null, guest: !!p.guest }
                      : { id: '?', tag: '', address: null, guest: true };
  const bytes = s => { try { return new TextEncoder().encode(s).length; } catch (e) { return s.length * 3; } };

  function arcadeRoom(r, roomId) {
    const me = norm(r.me), F = r.fast || null;
    /* what goes out and comes in, by way and by kind (the first key of a message), for tuning (LWQGAME.netStats) */
    const stats = { since: Date.now(), out: {}, in: {} };
    const count = (dir, way, s) => {
      if (s instanceof ArrayBuffer) { const k = way + ':bin' + (s.byteLength ? new Uint8Array(s)[0] : ''), b = stats[dir][k] || (stats[dir][k] = [0, 0]); b[0]++; b[1] += s.byteLength; return; }
      let kind = '?'; const m = /^\{"([^"]+)"/.exec(s); if (m) kind = m[1];
      const k = way + ':' + kind, b = stats[dir][k] || (stats[dir][k] = [0, 0]); b[0]++; b[1] += bytes(s);
    };
    const fastSend = (obj, opt) => {
      const s = typeof obj === 'string' || obj instanceof ArrayBuffer ? obj : JSON.stringify(obj);
      count('out', (opt && opt.reliable ? 'fastR' : 'fast') + (opt && opt.to ? '>' : ''), s); F.send(s, opt);
    };
    /* THE STAR (arcade PR #36): a viewer that can link with chosen players only, send to some players and send bytes */
    const STAR = !!(F && typeof F.link === 'function');
    /* our own room budget: 4 in any second, 7 in any two. The node allows ~5/s (burst 10) for everything this page
       sends, and the viewer's fast lane uses the same allowance for its signalling and its room fallback. */
    const sent = [];
    const free = now => { while (sent.length && now - sent[0] > 2000) sent.shift(); return sent.filter(t => now - t <= 1000).length < 4 && sent.length < 7; };
    function roomSend(obj) {
      const s = typeof obj === 'string' ? obj : JSON.stringify(obj), now = Date.now();
      if (bytes(s) > MAX || !free(now)) return Promise.resolve(false);
      sent.push(now); count('out', 'room', s);
      try { return Promise.resolve(r.send(s)).then(() => true, () => false); } catch (e) { return Promise.resolve(false); }
    }
    /* what must arrive waits its turn, one in flight at a time: it leaves the queue only once the node took it, so a
       refusal keeps it at the front (in order) and the pump keeps running until the queue is empty. A message the
       node keeps refusing (a closed room) is given up after a few tries. */
    const outbox = [], TRIES = 10;
    let pumping = null, busy = false;
    function pump() {
      if (pumping) return;
      pumping = setInterval(() => {
        if (busy) return;
        if (!outbox.length) { clearInterval(pumping); pumping = null; return; }
        if (!free(Date.now())) return;
        const head = outbox[0]; busy = true;
        roomSend(head.s).then(ok => {
          busy = false;
          if (outbox[0] !== head) return;   /* left the room meanwhile */
          if (ok || ++head.tries >= TRIES) outbox.shift();
        });
      }, 120);
    }
    const room = {
      id: roomId, me, fast: !!F,
      send: roomSend,
      state(obj) { if (F) { fastSend(obj); return Promise.resolve(true); } return roomSend(obj); },
      /* must arrive, and fast: the fast lane's reliable sends (in order, never lost; through the room at ~3/s for a
         pair that cannot connect directly, the viewer does that); the room's queue where there is no fast lane */
      sure(obj) { if (F) { fastSend(obj, { reliable: true }); return Promise.resolve(true); } return room.tell(obj); },
      star: STAR,
      /* with whom to link (null = everybody); a host asks for up to 60 */
      link(ids, opt) { return STAR ? F.link(ids, opt) : Promise.resolve({ ok: false }); },
      /* to some players only, over the fast lane (bytes too: an ArrayBuffer); only where the viewer can */
      to(ids, obj, reliable) { if (!STAR) return false; fastSend(obj, { to: [].concat(ids), reliable: !!reliable }); return true; },
      stats() { const secs = Math.max(1, (Date.now() - stats.since) / 1000); return { secs, out: stats.out, in: stats.in }; },
      resetStats() { stats.since = Date.now(); stats.out = {}; stats.in = {}; },
      beat(obj) { return roomSend(obj); },
      tell(obj) {
        const s = JSON.stringify(obj);
        if (bytes(s) > MAX) return Promise.resolve(false);
        outbox.push({ s, tries: 0 }); pump(); return Promise.resolve(true);
      },
      members() { try { return (r.members() || []).map(norm); } catch (e) { return [me]; } },
      peers() { return F ? F.peers() : {}; },
      on(t, fn) {
        if (t === 'message') {
          r.on('message', (data, p) => { const from = norm(p); count('in', 'room', typeof data === 'string' ? data : JSON.stringify(data)); if (from.id !== me.id) fn({ from, data }); });
          if (F) F.on('message', (data, p) => { const from = norm(p); count('in', 'fast', typeof data === 'string' || data instanceof ArrayBuffer ? data : JSON.stringify(data)); if (from.id !== me.id) fn({ from, data }); });
        }
        else if (t === 'join' || t === 'leave') r.on(t, p => { const from = norm(p); if (from.id !== me.id) fn({ from }); });
        else if (t === 'peer') { if (F) F.on('peer', (p, state) => fn({ from: norm(p), state })); }
        else if (t === 'closed') r.on('closed', why => fn(why));
        else if (t === 'rejoined') r.on('rejoined', m => fn({ me: m ? norm(m) : me }));
        else if (t === 'reconnecting') r.on('reconnecting', () => fn());
        return room;
      },
      leave() { outbox.length = 0; if (pumping) { clearInterval(pumping); pumping = null; } try { return Promise.resolve(r.leave()).catch(() => { }); } catch (e) { return Promise.resolve(); } }
    };
    return room;
  }

  const net = {
    api: 1,
    async join(roomId, opts) {
      opts = opts || {};
      const RT = G.arcade && G.arcade.realtime;
      if (!RT || typeof RT.join !== 'function') return { online: false, why: 'solo', backend: 'none' };
      let r = null;
      try { r = await RT.join(String(roomId).slice(0, 60), { game: opts.game || 'liteworldsquest', fast: opts.fast !== false }); }
      catch (e) { r = { online: false, why: e && e.message }; }
      if (!r || r.online === false) return { online: false, why: (r && r.why) || 'unavailable', backend: 'arcade' };
      return { online: true, room: arcadeRoom(r, roomId), backend: 'arcade' };
    }
  };
  if (G.LWQ && G.LWQ.define) G.LWQ.define('net', { api: 1, v: 5 }, () => net);
})(typeof globalThis !== 'undefined' ? globalThis : this);
