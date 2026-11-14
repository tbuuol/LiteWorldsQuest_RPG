// The connection to the house: one WebSocket. Binary for what is frequent (moves, snapshots), JSON for the rest.
// The wire is described in server/src/proto.rs; this is its other end.

const MOVE = 0x01, SNAP = 0x81, FIX = 0x82;
const CM = 100, TURN = 65536 / (Math.PI * 2);

export function connect(url, on) {
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  let seq = 0;
  ws.onmessage = ev => {
    if (typeof ev.data === 'string') {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (on[m.t]) on[m.t](m);
      return;
    }
    const v = new DataView(ev.data);
    const kind = v.getUint8(0);
    if (kind === SNAP) {
      const tick = v.getUint32(1, true), n = v.getUint16(5, true), list = [];
      for (let i = 0, o = 7; i < n; i++, o += 21) {
        list.push({
          id: v.getUint32(o, true),
          x: v.getInt32(o + 4, true) / CM, y: v.getInt32(o + 8, true) / CM, z: v.getInt32(o + 12, true) / CM,
          yaw: v.getUint16(o + 16, true) / TURN, pitch: v.getInt16(o + 18, true) / TURN, anim: v.getUint8(o + 20),
        });
      }
      if (on.snap) on.snap(tick, list);
    } else if (kind === FIX) {
      if (on.fix) on.fix(v.getUint16(1, true), v.getInt32(3, true) / CM, v.getInt32(7, true) / CM, v.getInt32(11, true) / CM);
    }
  };
  ws.onopen = () => on.open && on.open();
  ws.onclose = ev => on.close && on.close(ev.reason || (ev.code === 1006 ? 'the house cannot be reached' : 'closed'));
  return {
    get open() { return ws.readyState === 1; },
    move(x, y, z, yaw, pitch, flags) {
      if (ws.readyState !== 1) return;
      const b = new ArrayBuffer(20), v = new DataView(b);
      seq = (seq + 1) & 0xffff;
      v.setUint8(0, MOVE); v.setUint16(1, seq, true);
      v.setInt32(3, Math.round(x * CM), true); v.setInt32(7, Math.round(y * CM), true); v.setInt32(11, Math.round(z * CM), true);
      v.setUint16(15, ((Math.round(yaw * TURN) % 65536) + 65536) % 65536, true);
      v.setInt16(17, Math.max(-32767, Math.min(32767, Math.round(pitch * TURN))), true);
      v.setUint8(19, flags);
      ws.send(b);
    },
    say(text) { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'say', text })); },
    // only a house in dev mode answers this (local tests, screenshots)
    tp(x, z) { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'tp', x, z })); },
    close() { ws.close(); },
  };
}
