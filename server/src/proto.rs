//! The wire. Binary frames for what is frequent (movement, snapshots), JSON text frames for what is rare.
//! All numbers little endian; positions in centimetres (i32), angles in 1/65536 of a turn (yaw u16, pitch i16).
//!
//! Client -> house (binary)
//!   0x01 MOVE    seq u16, x i32, y i32, z i32, yaw u16, pitch i16, flags u8 (1 run, 2 jump, 4 crouch, 8 in air)
//! House -> client (binary)
//!   0x81 SNAP    tick u32, n u16, then n x [id u32, x i32, y i32, z i32, yaw u16, pitch i16, anim u8]
//!   0x82 FIX     seq u16, x i32, y i32, z i32        the house did not accept the move: be here
//! Both ways (text, JSON) {"t": ...}
//!   house: welcome {id, tag, zone, pos, yaw, hz}  ·  spawn {id, kind, tag}  ·  despawn {id}  ·  say {from, text}
//!          kick {why}
//!   client: say {text}

pub const MOVE: u8 = 0x01;
pub const SNAP: u8 = 0x81;
pub const FIX: u8 = 0x82;

pub const CM: f32 = 100.0;
pub const TURN: f32 = 65536.0 / std::f32::consts::TAU;

pub struct Move {
    pub seq: u16,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub yaw: u16,
    pub pitch: i16,
    pub flags: u8,
}

fn i32_at(b: &[u8], i: usize) -> i32 {
    i32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]])
}

pub fn parse_move(b: &[u8]) -> Option<Move> {
    if b.len() != 20 || b[0] != MOVE {
        return None;
    }
    Some(Move {
        seq: u16::from_le_bytes([b[1], b[2]]),
        x: i32_at(b, 3) as f32 / CM,
        y: i32_at(b, 7) as f32 / CM,
        z: i32_at(b, 11) as f32 / CM,
        yaw: u16::from_le_bytes([b[15], b[16]]),
        pitch: i16::from_le_bytes([b[17], b[18]]),
        flags: b[19],
    })
}

pub fn fix(seq: u16, x: f32, y: f32, z: f32) -> Vec<u8> {
    let mut o = Vec::with_capacity(15);
    o.push(FIX);
    o.extend_from_slice(&seq.to_le_bytes());
    for v in [x, y, z] {
        o.extend_from_slice(&((v * CM).round() as i32).to_le_bytes());
    }
    o
}

pub struct SnapEntry {
    pub id: u32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub yaw: u16,
    pub pitch: i16,
    pub anim: u8,
}

pub fn snap(tick: u32, list: &[SnapEntry]) -> Vec<u8> {
    let mut o = Vec::with_capacity(7 + list.len() * 21);
    o.push(SNAP);
    o.extend_from_slice(&tick.to_le_bytes());
    o.extend_from_slice(&(list.len() as u16).to_le_bytes());
    for e in list {
        o.extend_from_slice(&e.id.to_le_bytes());
        for v in [e.x, e.y, e.z] {
            o.extend_from_slice(&((v * CM).round() as i32).to_le_bytes());
        }
        o.extend_from_slice(&e.yaw.to_le_bytes());
        o.extend_from_slice(&e.pitch.to_le_bytes());
        o.push(e.anim);
    }
    o
}
