//! A test player against a house in dev mode (LWQ_DEV=1): walls stop it, the open gate lets it through, villagers
//! answer when it stands near them and stay silent from afar.
//!
//!     cargo run --release --example probe [ws://127.0.0.1:8095]

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::time::{sleep, timeout};
use tokio_tungstenite::tungstenite::Message;

type Ws = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

struct Probe {
    ws: Ws,
    seq: u16,
    fix: Option<[f32; 3]>,
    texts: Vec<Value>,
}

impl Probe {
    /// take in what the house sent in the next `ms` milliseconds
    async fn drain(&mut self, ms: u64) {
        let end = tokio::time::Instant::now() + Duration::from_millis(ms);
        while let Ok(Some(Ok(m))) = timeout(end.saturating_duration_since(tokio::time::Instant::now()), self.ws.next()).await {
            match m {
                Message::Text(t) => self.texts.push(serde_json::from_str(&t).unwrap_or(Value::Null)),
                Message::Binary(b) if b.first() == Some(&0x82) => {
                    let i = |o: usize| i32::from_le_bytes(b[o..o + 4].try_into().unwrap()) as f32 / 100.0;
                    self.fix = Some([i(3), i(7), i(11)]);
                }
                _ => {}
            }
        }
    }
    async fn text(&mut self, v: Value) {
        self.ws.send(Message::Text(v.to_string())).await.unwrap();
    }
    async fn step(&mut self, x: f32, y: f32, z: f32) {
        self.seq = self.seq.wrapping_add(1);
        let mut b = vec![0x01];
        b.extend(self.seq.to_le_bytes());
        for v in [x, y, z] {
            b.extend(((v * 100.0).round() as i32).to_le_bytes());
        }
        b.extend([0, 0, 0, 0, 0]); // yaw, pitch, flags
        self.ws.send(Message::Binary(b)).await.unwrap();
    }
    /// jump to (x0, z0), then walk to (x1, z1) in 30 cm steps; true if the house let it through
    async fn walk(&mut self, x0: f32, z0: f32, x1: f32, z1: f32) -> bool {
        self.text(json!({"t": "tp", "x": x0, "z": z0})).await;
        self.drain(300).await;
        let y = self.fix.take().expect("the house did not answer the jump (not in dev mode?)")[1];
        let n = ((x1 - x0).hypot(z1 - z0) / 0.3).ceil() as usize;
        for i in 1..=n {
            let t = i as f32 / n as f32;
            self.step(x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t).await;
            self.drain(100).await;
            if self.fix.is_some() {
                break;
            }
        }
        self.drain(200).await;
        self.fix.is_none()
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let url = std::env::args().nth(1).unwrap_or("ws://127.0.0.1:8095".into());
    let (ws, _) = tokio_tungstenite::connect_async(format!("{url}/?as=probe")).await.expect("connect");
    let mut p = Probe { ws, seq: 0, fix: None, texts: Vec::new() };
    p.drain(500).await;
    let mut bad = 0;
    // (what, from, to, should pass) -- around Blockshire: hut 0 at (0, -13) turned 180, palisade [-20, 20], gate x -2.5..2.5 at z 20
    let walks = [
        ("into a hut's back wall", [0.0, -17.5], [0.0, -14.0], false),
        ("through the open gate", [0.0, 23.0], [0.0, 17.0], true),
        ("into the palisade", [10.0, 22.0], [10.0, 18.0], false),
        ("in through a hut door", [0.0, -9.0], [0.0, -12.0], true),
        ("over a wall in one long step", [0.0, -16.6], [0.0, -15.0], false),
    ];
    for (what, a, b, pass) in walks {
        let ok = if what.contains("long step") {
            // one step of 1.6 m from outside to inside the wall, inside the speed slack
            p.text(json!({"t": "tp", "x": a[0], "z": a[1]})).await;
            p.drain(300).await;
            let y = p.fix.take().unwrap()[1];
            sleep(Duration::from_millis(400)).await;
            p.step(b[0], y, b[1]).await;
            p.drain(300).await;
            p.fix.take().is_none()
        } else {
            p.walk(a[0], a[1], b[0], b[1]).await
        };
        let right = ok == pass;
        bad += !right as u32;
        println!("{} {what}: {}", if right { "ok  " } else { "FAIL" }, if ok { "passed" } else { "stopped" });
    }
    let npcs: Vec<(u64, String)> =
        p.texts.iter().filter(|m| m["t"] == "spawn" && m["kind"] == "npc").map(|m| (m["id"].as_u64().unwrap(), m["name"].as_str().unwrap().to_string())).collect();
    println!("     villagers: {}", npcs.iter().map(|n| n.1.as_str()).collect::<Vec<_>>().join(", "));
    p.walk(1.6, -2.4, 1.6, -2.5).await;
    let id = |pre: &str| npcs.iter().find(|n| n.1.starts_with(pre)).map(|n| n.0).expect(pre);
    p.texts.clear();
    for _ in 0..2 {
        p.text(json!({"t": "talk", "id": id("Elder Bram")})).await;
        p.drain(150).await;
    }
    p.text(json!({"t": "talk", "id": id("Tobin")})).await;
    p.drain(300).await;
    let says: Vec<&Value> = p.texts.iter().filter(|m| m["t"] == "say").collect();
    for s in &says {
        println!("     {}: {}", s["from"].as_str().unwrap_or(""), s["text"].as_str().unwrap_or(""));
    }
    let right = says.len() == 2 && says[0]["text"] != says[1]["text"];
    bad += !right as u32;
    println!("{} talk: two different lines from near, none from afar", if right { "ok  " } else { "FAIL" });
    std::process::exit(bad as i32);
}
