//! The simulation: one task owns the world and steps it at a fixed tick. Connections only hand it events; it is
//! the single place where anything about the game changes, so there are no locks around the game state.

use crate::ground::Ground;
use crate::places::{self, Places};
use crate::proto::{self, SnapEntry};
use crate::store::{Saved, Store};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

pub const HZ: u32 = 20;
/// how far a player sees other things (metres)
const VIEW: f32 = 160.0;
/// grid cell for finding who is near whom
const CELL: f32 = 32.0;
/// walking / running speed the client may not exceed (m/s), with some slack for lag
const WALK: f32 = 4.6;
const RUN: f32 = 7.8;
const SLACK: f32 = 1.3;
/// how high above the ground a player may be (a jump, a ledge)
const AIR: f32 = 3.2;
/// at most this many messages a second from one connection
const RATE: u32 = 60;
const SAVE_EVERY: Duration = Duration::from_secs(30);
/// how close a player must stand to talk to a villager (metres)
const TALK: f32 = 4.0;

pub struct Ident {
    pub key: String,
    pub tag: String,
    pub address: String,
}

pub enum Event {
    Join { conn: u64, ident: Ident, out: mpsc::UnboundedSender<Out> },
    Bin { conn: u64, data: Vec<u8> },
    Text { conn: u64, data: String },
    Leave { conn: u64 },
}

pub enum Out {
    Bin(Vec<u8>),
    Text(String),
    Close(String),
}

struct Player {
    id: u32,
    conn: u64,
    key: String,
    tag: String,
    out: mpsc::UnboundedSender<Out>,
    pos: [f32; 3],
    yaw: u16,
    pitch: i16,
    anim: u8,
    moved_at: Instant,
    changed: bool,
    known: HashSet<u32>,
    rate_n: u32,
    rate_at: Instant,
    saved_at: Instant,
    /// the next line each villager will say to this player
    talked: HashMap<u32, usize>,
}

impl Player {
    fn send_text(&self, v: Value) {
        let _ = self.out.send(Out::Text(v.to_string()));
    }
    fn saved(&self) -> Saved {
        Saved { zone: "world".into(), pos: self.pos, yaw: self.yaw as f32 / proto::TURN }
    }
}

pub struct World {
    /// local test only (LWQ_DEV): players may jump anywhere ({"t": "tp", "x", "z"})
    pub dev: bool,
    ground: Arc<Ground>,
    places: Places,
    store: Store,
    spawn: [f32; 2],
    players: HashMap<u64, Player>, // by connection
    next_id: u32,
    tick: u32,
    /// villagers that turned this tick
    npc_changed: HashSet<u32>,
}

fn cell_of(x: f32, z: f32) -> (i32, i32) {
    ((x / CELL).floor() as i32, (z / CELL).floor() as i32)
}

impl World {
    pub fn new(ground: Arc<Ground>, places: Places, store: Store, spawn: [f32; 2]) -> World {
        World { dev: false, ground, places, store, spawn, players: HashMap::new(), next_id: 1, tick: 0, npc_changed: HashSet::new() }
    }

    pub async fn run(mut self, mut rx: mpsc::UnboundedReceiver<Event>) {
        let mut every = tokio::time::interval(Duration::from_millis(1000 / HZ as u64));
        every.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                ev = rx.recv() => match ev {
                    Some(ev) => self.event(ev),
                    None => break,
                },
                _ = every.tick() => self.step(),
            }
        }
        for p in self.players.values() {
            self.store.save(&p.key, &p.tag, p.saved());
        }
    }

    fn event(&mut self, ev: Event) {
        match ev {
            Event::Join { conn, ident, out } => self.join(conn, ident, out),
            Event::Leave { conn } => self.leave(conn),
            Event::Bin { conn, data } => {
                if !self.rate_ok(conn) {
                    return;
                }
                if let Some(m) = proto::parse_move(&data) {
                    self.moved(conn, m);
                }
            }
            Event::Text { conn, data } => {
                if !self.rate_ok(conn) {
                    return;
                }
                let Ok(v) = serde_json::from_str::<Value>(&data) else { return };
                if self.dev && v["t"] == "tp" {
                    let ground = self.ground.clone();
                    let (x, z) = (v["x"].as_f64().unwrap_or(0.0) as f32, v["z"].as_f64().unwrap_or(0.0) as f32);
                    if let Some(p) = self.players.get_mut(&conn) {
                        if ground.inside(x, z) {
                            p.pos = [x, ground.height(x, z), z];
                            p.moved_at = Instant::now();
                            p.changed = true;
                            let _ = p.out.send(Out::Bin(proto::fix(0, p.pos[0], p.pos[1], p.pos[2])));
                        }
                    }
                    return;
                }
                if v["t"] == "talk" {
                    let id = v["id"].as_u64().unwrap_or(0) as u32;
                    self.talk(conn, id);
                    return;
                }
                if v["t"] == "say" {
                    let text: String = v["text"].as_str().unwrap_or("").chars().take(200).collect();
                    if text.trim().is_empty() {
                        return;
                    }
                    let Some(p) = self.players.get(&conn) else { return };
                    let (from, at) = (p.tag.clone(), p.pos);
                    let msg = json!({"t": "say", "from": from, "text": text});
                    for q in self.players.values() {
                        if (q.pos[0] - at[0]).hypot(q.pos[2] - at[2]) <= VIEW {
                            q.send_text(msg.clone());
                        }
                    }
                }
            }
        }
    }

    fn rate_ok(&mut self, conn: u64) -> bool {
        let Some(p) = self.players.get_mut(&conn) else { return false };
        if p.rate_at.elapsed() >= Duration::from_secs(1) {
            p.rate_at = Instant::now();
            p.rate_n = 0;
        }
        p.rate_n += 1;
        if p.rate_n > RATE {
            let _ = p.out.send(Out::Close("too many messages".into()));
            return false;
        }
        true
    }

    fn join(&mut self, conn: u64, ident: Ident, out: mpsc::UnboundedSender<Out>) {
        // the same account twice: the older connection goes
        let old: Vec<u64> = self.players.values().filter(|p| p.key == ident.key).map(|p| p.conn).collect();
        for c in old {
            if let Some(p) = self.players.get(&c) {
                let _ = p.out.send(Out::Close("signed in elsewhere".into()));
            }
            self.leave(c);
        }
        let (pos, yaw) = match self.store.load(&ident.key) {
            Some(s) if self.ground.inside(s.pos[0], s.pos[2]) => (s.pos, s.yaw),
            _ => {
                let [x, z] = self.spawn;
                ([x, self.ground.height(x, z) + 0.05, z], 0.0)
            }
        };
        let id = self.next_id;
        self.next_id += 1;
        let now = Instant::now();
        let p = Player {
            id,
            conn,
            key: ident.key,
            tag: ident.tag,
            out,
            pos,
            yaw: ((yaw * proto::TURN).rem_euclid(65536.0)) as u16,
            pitch: 0,
            anim: 0,
            moved_at: now,
            changed: true,
            known: HashSet::new(),
            rate_n: 0,
            rate_at: now,
            saved_at: now,
            talked: HashMap::new(),
        };
        p.send_text(json!({"t": "welcome", "id": id, "tag": p.tag, "zone": "world", "pos": pos, "yaw": yaw, "hz": HZ}));
        eprintln!("join {} ({}), {} playing", if p.tag.is_empty() { "guest" } else { &p.tag }, ident.address, self.players.len() + 1);
        self.players.insert(conn, p);
    }

    fn leave(&mut self, conn: u64) {
        let Some(p) = self.players.remove(&conn) else { return };
        self.store.save(&p.key, &p.tag, p.saved());
        for q in self.players.values_mut() {
            if q.known.remove(&p.id) {
                q.send_text(json!({"t": "despawn", "id": p.id}));
            }
        }
        eprintln!("leave {}, {} playing", p.tag, self.players.len());
    }

    /// A move the client made: accepted if it could have walked there, else the client is put back.
    fn moved(&mut self, conn: u64, m: proto::Move) {
        let ground = self.ground.clone();
        let Some(p) = self.players.get_mut(&conn) else { return };
        let now = Instant::now();
        let dt = now.duration_since(p.moved_at).as_secs_f32().clamp(0.02, 1.0);
        let run = m.flags & 1 != 0;
        let reach = (if run { RUN } else { WALK }) * dt * SLACK + 0.35;
        let horiz = (m.x - p.pos[0]).hypot(m.z - p.pos[2]);
        let ok_where = ground.inside(m.x, m.z) && m.x.is_finite() && m.y.is_finite() && m.z.is_finite();
        let floor = if ok_where { ground.height(m.x, m.z) } else { 0.0 };
        let ok = ok_where
            && horiz <= reach
            && m.y >= floor - 0.4
            && m.y <= floor + AIR
            && self.places.path_free(p.pos[0], p.pos[2], m.x, m.z);
        if ok {
            p.pos = [m.x, m.y.max(floor), m.z];
            p.yaw = m.yaw;
            p.pitch = m.pitch;
            p.anim = if horiz < 0.01 { 0 } else if run { 2 } else { 1 } | (m.flags & 8);
            p.moved_at = now;
            p.changed = true;
        } else {
            // too far, under the ground, flying or outside the world: back to where the house has the player
            let _ = p.out.send(Out::Bin(proto::fix(m.seq, p.pos[0], p.pos[1], p.pos[2])));
            p.moved_at = now;
        }
    }

    /// A player speaks to a villager: the next of its lines, to that player only; it turns to them if it does that.
    fn talk(&mut self, conn: u64, id: u32) {
        let Some(p) = self.players.get_mut(&conn) else { return };
        let Some(n) = id.checked_sub(places::NPC_ID0).and_then(|i| self.places.npcs.get_mut(i as usize)) else { return };
        if (n.pos[0] - p.pos[0]).hypot(n.pos[2] - p.pos[2]) > TALK || n.lines.is_empty() {
            return;
        }
        let k = p.talked.entry(id).or_insert(0);
        let line = n.lines[*k % n.lines.len()].clone();
        *k += 1;
        if n.turns {
            n.yaw = places::yaw_toward(n.pos, p.pos[0], p.pos[2]);
            self.npc_changed.insert(id);
        }
        p.send_text(json!({"t": "say", "from": n.name, "npc": id, "text": line}));
    }

    /// One tick: who sees whom, and what changed.
    fn step(&mut self) {
        self.tick = self.tick.wrapping_add(1);
        let full = self.tick % HZ == 0; // once a second everything visible, also what did not move
        let mut grid: HashMap<(i32, i32), Vec<u64>> = HashMap::new();
        for p in self.players.values() {
            grid.entry(cell_of(p.pos[0], p.pos[2])).or_default().push(p.conn);
        }
        let reach = (VIEW / CELL).ceil() as i32;
        let conns: Vec<u64> = self.players.keys().copied().collect();
        let mut outgoing: Vec<(u64, Vec<Value>, Vec<SnapEntry>)> = Vec::new();
        for &c in &conns {
            let p = &self.players[&c];
            let (cx, cz) = cell_of(p.pos[0], p.pos[2]);
            let mut seen: HashSet<u32> = HashSet::new();
            let mut texts = Vec::new();
            let mut snap = Vec::new();
            for gx in cx - reach..=cx + reach {
                for gz in cz - reach..=cz + reach {
                    let Some(list) = grid.get(&(gx, gz)) else { continue };
                    for &oc in list {
                        if oc == c {
                            continue;
                        }
                        let q = &self.players[&oc];
                        if (q.pos[0] - p.pos[0]).hypot(q.pos[2] - p.pos[2]) > VIEW {
                            continue;
                        }
                        seen.insert(q.id);
                        let new = !p.known.contains(&q.id);
                        if new {
                            texts.push(json!({"t": "spawn", "id": q.id, "kind": "player", "tag": q.tag}));
                        }
                        if new || full || q.changed {
                            snap.push(SnapEntry { id: q.id, x: q.pos[0], y: q.pos[1], z: q.pos[2], yaw: q.yaw, pitch: q.pitch, anim: q.anim });
                        }
                    }
                }
            }
            for n in &self.places.npcs {
                if (n.pos[0] - p.pos[0]).hypot(n.pos[2] - p.pos[2]) > VIEW {
                    continue;
                }
                seen.insert(n.id);
                let new = !p.known.contains(&n.id);
                if new {
                    texts.push(json!({"t": "spawn", "id": n.id, "kind": "npc", "name": n.name, "figure": n.figure}));
                }
                if new || full || self.npc_changed.contains(&n.id) {
                    snap.push(SnapEntry { id: n.id, x: n.pos[0], y: n.pos[1], z: n.pos[2], yaw: n.yaw, pitch: 0, anim: 0 });
                }
            }
            for gone in p.known.difference(&seen) {
                texts.push(json!({"t": "despawn", "id": gone}));
            }
            outgoing.push((c, texts, snap));
            // remember what this player knows now
            let pm = self.players.get_mut(&c).unwrap();
            pm.known = seen;
        }
        for (c, texts, snap) in outgoing {
            let p = &self.players[&c];
            for t in texts {
                p.send_text(t);
            }
            if !snap.is_empty() {
                let _ = p.out.send(Out::Bin(proto::snap(self.tick, &snap)));
            }
        }
        self.npc_changed.clear();
        // a villager that turned to someone looks back where it looked after a while
        if self.tick % (HZ * 12) == 0 {
            for n in self.places.npcs.iter_mut().filter(|n| n.yaw != n.home_yaw) {
                n.yaw = n.home_yaw;
                self.npc_changed.insert(n.id);
            }
        }
        for p in self.players.values_mut() {
            p.changed = false;
            if p.saved_at.elapsed() >= SAVE_EVERY {
                p.saved_at = Instant::now();
                self.store.save(&p.key, &p.tag, p.saved());
            }
        }
    }
}
