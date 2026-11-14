//! The places of the content modules (content/<module>/places/*.json): what nobody walks through (the baked solids)
//! and who lives there (the villagers). The client draws the same files; the house decides with them.

use crate::ground::Ground;
use crate::proto;
use serde::Deserialize;
use std::path::Path;

/// a box on the ground, turned about y as three.js turns it: centre x/z, half size x/z, turn (degrees), height
#[derive(Clone, Copy)]
pub struct Solid {
    cx: f32,
    cz: f32,
    hx: f32,
    hz: f32,
    c: f32,
    s: f32,
}

pub struct Npc {
    pub id: u32,
    pub name: String,
    /// the baked figure (content/<module>/people/<figure>.glb)
    pub figure: String,
    pub pos: [f32; 3],
    pub yaw: u16,
    pub home_yaw: u16,
    pub turns: bool,
    pub lines: Vec<String>,
}

#[derive(Deserialize)]
struct NpcFile {
    #[serde(default)]
    id: String,
    name: String,
    pos: [f32; 2],
    #[serde(default, rename = "lookAt")]
    look_at: Option<[f32; 2]>,
    #[serde(default)]
    face: Option<[f32; 2]>,
    #[serde(default, rename = "talkTurn")]
    talk_turn: bool,
    #[serde(default)]
    lines: Vec<String>,
}

#[derive(Deserialize)]
struct PlaceFile {
    #[serde(default)]
    origin: [f32; 2],
    #[serde(default)]
    solids: Vec<[f32; 6]>,
    #[serde(default)]
    npcs: Vec<NpcFile>,
    #[serde(default)]
    guards: Vec<NpcFile>,
}

/// ids of villagers start here, far above any player id
pub const NPC_ID0: u32 = 1 << 24;
/// the player's radius for the house: a little less than the client's 0.32 m, so prediction never gets corrected
const BODY: f32 = 0.24;

pub fn yaw_toward(from: [f32; 3], to_x: f32, to_z: f32) -> u16 {
    // as the client turns figures: atan2(dx, dz)
    let a = (to_x - from[0]).atan2(to_z - from[2]);
    ((a * proto::TURN).rem_euclid(65536.0)) as u16
}

pub struct Places {
    solids: Vec<Solid>,
    pub npcs: Vec<Npc>,
}

impl Places {
    pub fn load(content: &Path, ground: &Ground) -> Places {
        let mut files: Vec<_> = std::fs::read_dir(content)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|m| std::fs::read_dir(m.path().join("places")).ok())
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|e| e == "json"))
            .collect();
        files.sort();
        let mut out = Places { solids: Vec::new(), npcs: Vec::new() };
        for f in files {
            let p: PlaceFile = match std::fs::read(&f).map_err(|e| e.to_string()).and_then(|b| serde_json::from_slice(&b).map_err(|e| e.to_string())) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("place {}: {e}", f.display());
                    continue;
                }
            };
            let [ox, oz] = p.origin;
            for [cx, cz, hx, hz, deg, _h] in p.solids {
                let a = deg.to_radians();
                out.solids.push(Solid { cx: cx + ox, cz: cz + oz, hx, hz, c: a.cos(), s: a.sin() });
            }
            for n in p.npcs.into_iter().chain(p.guards) {
                let (x, z) = (n.pos[0] + ox, n.pos[1] + oz);
                let pos = [x, ground.height(x, z), z];
                let yaw = match n.look_at.or(n.face) {
                    Some([lx, lz]) => yaw_toward([n.pos[0], 0.0, n.pos[1]], lx, lz),
                    None => 0,
                };
                let id = NPC_ID0 + out.npcs.len() as u32;
                out.npcs.push(Npc { id, name: n.name, figure: n.id, pos, yaw, home_yaw: yaw, turns: n.talk_turn, lines: n.lines });
            }
        }
        eprintln!("places: {} solids, {} villagers", out.solids.len(), out.npcs.len());
        out
    }

    /// is a body at (x, z) inside something solid?
    fn blocked(&self, x: f32, z: f32) -> bool {
        self.solids.iter().any(|b| {
            let (dx, dz) = (x - b.cx, z - b.cz);
            let (lx, lz) = (dx * b.c - dz * b.s, dx * b.s + dz * b.c); // into the box's frame
            let (ex, ez) = (lx.abs() - b.hx, lz.abs() - b.hz);
            let (ox, oz) = (ex.max(0.0), ez.max(0.0));
            ox * ox + oz * oz < BODY * BODY
        })
    }

    /// may a body walk in a straight line from a to b? (checked every 10 cm, so no wall is stepped through)
    pub fn path_free(&self, ax: f32, az: f32, bx: f32, bz: f32) -> bool {
        if self.solids.is_empty() {
            return true;
        }
        let n = ((bx - ax).hypot(bz - az) / 0.1).ceil().max(1.0) as usize;
        // starting inside something (an older save, a teleport) must not lock the player in
        let start_blocked = self.blocked(ax, az);
        (1..=n).all(|i| {
            let t = i as f32 / n as f32;
            let (x, z) = (ax + (bx - ax) * t, az + (bz - az) * t);
            start_blocked || !self.blocked(x, z)
        })
    }
}
