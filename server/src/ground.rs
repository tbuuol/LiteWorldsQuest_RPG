//! The baked ground (content/<module>/world/ground.bin + ground.json): heights on a 2 m grid. The house walks on it;
//! nothing computes the ground any more.

use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
struct Meta {
    extent: [f32; 4],
    step: f32,
    nx: usize,
    nz: usize,
    base: f32,
    sea: f32,
}

#[allow(dead_code)]
pub struct Ground {
    pub x0: f32,
    pub z0: f32,
    pub x1: f32,
    pub z1: f32,
    step: f32,
    nx: usize,
    nz: usize,
    base: f32,
    pub sea: f32,
    h: Vec<u16>,
}

impl Ground {
    pub fn load(dir: &Path) -> Result<Ground, String> {
        let meta: Meta = serde_json::from_slice(&std::fs::read(dir.join("ground.json")).map_err(|e| format!("ground.json: {e}"))?)
            .map_err(|e| format!("ground.json: {e}"))?;
        let raw = std::fs::read(dir.join("ground.bin")).map_err(|e| format!("ground.bin: {e}"))?;
        if raw.len() != meta.nx * meta.nz * 2 {
            return Err(format!("ground.bin: {} bytes, expected {}", raw.len(), meta.nx * meta.nz * 2));
        }
        let h = raw.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        Ok(Ground {
            x0: meta.extent[0],
            z0: meta.extent[1],
            x1: meta.extent[2],
            z1: meta.extent[3],
            step: meta.step,
            nx: meta.nx,
            nz: meta.nz,
            base: meta.base,
            sea: meta.sea,
            h,
        })
    }

    fn at(&self, ix: usize, iz: usize) -> f32 {
        self.base + self.h[iz.min(self.nz - 1) * self.nx + ix.min(self.nx - 1)] as f32 / 100.0
    }

    /// The ground at (x, z), between the samples as the client's mesh draws it (two triangles per cell).
    pub fn height(&self, x: f32, z: f32) -> f32 {
        let fx = ((x - self.x0) / self.step).clamp(0.0, (self.nx - 1) as f32);
        let fz = ((z - self.z0) / self.step).clamp(0.0, (self.nz - 1) as f32);
        let (ix, iz) = (fx.floor() as usize, fz.floor() as usize);
        let (tx, tz) = (fx - ix as f32, fz - iz as f32);
        let (a, b, c, d) = (self.at(ix, iz), self.at(ix + 1, iz), self.at(ix, iz + 1), self.at(ix + 1, iz + 1));
        // the diagonal from (0,0) to (1,1), as three.js' PlaneGeometry splits its quads
        if tx >= tz {
            a + (b - a) * tx + (d - b) * tz
        } else {
            a + (d - c) * tx + (c - a) * tz
        }
    }

    pub fn inside(&self, x: f32, z: f32) -> bool {
        x >= self.x0 && x <= self.x1 && z >= self.z0 && z <= self.z1
    }
}
