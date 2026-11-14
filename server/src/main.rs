//! lwq-house: the LiteWorldsQuest beta's server, the only authority of the game world.
//!
//! Players connect over a WebSocket (behind the arcade's Caddy, same site as the arcade). Who they are comes from the
//! arcade's own sign-in: the house asks the arcade (its public API, /api/me) about the session cookie the browser sends
//! with the upgrade, so the game never sees a password or a key.
//!
//! Settings (environment):
//!   LWQ_BIND     where to listen                     (127.0.0.1:8095)
//!   LWQ_CONTENT  the content modules                 (/state/lwq/content)
//!   LWQ_STATE    where the house keeps its data      (/state/lwq/data)
//!   LWQ_ARCADE   the arcade's public API             (127.0.0.1:8091)
//!   LWQ_ORIGINS  pages allowed to connect, comma-separated (https://arcade.liteworlds.quest)
//!   LWQ_DEV      1: no arcade, players name themselves (?as=name); only for a local test, never in service

mod ground;
mod proto;
mod store;
mod world;

use futures_util::{SinkExt, StreamExt};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, WebSocketConfig};
use tokio_tungstenite::tungstenite::Message;
use world::{Event, Ident, Out};

fn env(k: &str, d: &str) -> String {
    std::env::var(k).unwrap_or_else(|_| d.to_string())
}

/// The arcade's answer for this session cookie: who is signed in, or None.
fn who(arcade: &str, cookie: &str) -> Option<Ident> {
    let mut s = std::net::TcpStream::connect(arcade).ok()?;
    s.set_read_timeout(Some(std::time::Duration::from_secs(20))).ok();
    let req = format!("GET /api/me HTTP/1.0\r\nHost: {arcade}\r\nCookie: {cookie}\r\n\r\n");
    s.write_all(req.as_bytes()).ok()?;
    let mut resp = Vec::new();
    s.read_to_end(&mut resp).ok()?;
    let split = resp.windows(4).position(|w| w == b"\r\n\r\n")?;
    if !resp.starts_with(b"HTTP/1.0 200") && !resp.starts_with(b"HTTP/1.1 200") {
        return None;
    }
    let v: serde_json::Value = serde_json::from_slice(&resp[split + 4..]).ok()?;
    let key = v["pubkey"].as_str()?.to_string();
    Some(Ident { key, tag: v["tag"].as_str().unwrap_or("").to_string(), address: v["address"].as_str().unwrap_or("").to_string() })
}

struct Cfg {
    arcade: String,
    origins: Vec<String>,
    dev: bool,
}

async fn connection(stream: TcpStream, conn: u64, cfg: Arc<Cfg>, events: mpsc::UnboundedSender<Event>) {
    let mut cookie = String::new();
    let mut query = String::new();
    let mut origin_ok = false;
    let ws_cfg = WebSocketConfig { max_message_size: Some(64 * 1024), max_frame_size: Some(64 * 1024), ..Default::default() };
    let accept = tokio_tungstenite::accept_hdr_async_with_config(
        stream,
        |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
            cookie = req.headers().get("cookie").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
            query = req.uri().query().unwrap_or("").to_string();
            let origin = req.headers().get("origin").and_then(|v| v.to_str().ok()).unwrap_or("");
            origin_ok = cfg.dev || cfg.origins.iter().any(|o| o == origin);
            Ok(resp)
        },
        Some(ws_cfg),
    )
    .await;
    let Ok(mut ws) = accept else { return };
    let close = |why: &str| Message::Close(Some(CloseFrame { code: CloseCode::Policy, reason: why.to_string().into() }));
    if !origin_ok {
        let _ = ws.send(close("not from the arcade")).await;
        return;
    }
    let ident = if cfg.dev {
        let name: String = query.split('&').find_map(|kv| kv.strip_prefix("as=")).unwrap_or("guest").chars().filter(|c| c.is_ascii_alphanumeric()).take(20).collect();
        Some(Ident { key: format!("dev:{name}"), tag: name, address: String::new() })
    } else {
        let (arcade, c) = (cfg.arcade.clone(), cookie.clone());
        tokio::task::spawn_blocking(move || who(&arcade, &c)).await.ok().flatten()
    };
    let Some(ident) = ident else {
        let _ = ws.send(close("sign in at the arcade first")).await;
        return;
    };
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Out>();
    if events.send(Event::Join { conn, ident, out: out_tx }).is_err() {
        return;
    }
    let (mut sink, mut source) = ws.split();
    let writer = tokio::spawn(async move {
        while let Some(o) = out_rx.recv().await {
            let r = match o {
                Out::Bin(b) => sink.send(Message::Binary(b)).await,
                Out::Text(t) => sink.send(Message::Text(t)).await,
                Out::Close(why) => {
                    let _ = sink.send(Message::Close(Some(CloseFrame { code: CloseCode::Policy, reason: why.into() }))).await;
                    break;
                }
            };
            if r.is_err() {
                break;
            }
        }
    });
    while let Some(Ok(msg)) = source.next().await {
        let ev = match msg {
            Message::Binary(data) => Event::Bin { conn, data },
            Message::Text(data) => Event::Text { conn, data },
            Message::Close(_) => break,
            _ => continue,
        };
        if events.send(ev).is_err() {
            break;
        }
    }
    let _ = events.send(Event::Leave { conn });
    writer.abort();
}

#[tokio::main]
async fn main() {
    let bind = env("LWQ_BIND", "127.0.0.1:8095");
    let content = PathBuf::from(env("LWQ_CONTENT", "/state/lwq/content"));
    let state = PathBuf::from(env("LWQ_STATE", "/state/lwq/data"));
    let cfg = Arc::new(Cfg {
        arcade: env("LWQ_ARCADE", "127.0.0.1:8091"),
        origins: env("LWQ_ORIGINS", "https://arcade.liteworlds.quest").split(',').map(|s| s.trim().to_string()).collect(),
        dev: env("LWQ_DEV", "") == "1",
    });
    let ground = match ground::Ground::load(&content.join("core/world")) {
        Ok(g) => Arc::new(g),
        Err(e) => {
            eprintln!("lwq-house: the world's ground: {e}");
            std::process::exit(2);
        }
    };
    let store = match store::Store::open(&state) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("lwq-house: {e}");
            std::process::exit(2);
        }
    };
    let (tx, rx) = mpsc::unbounded_channel();
    let world = world::World::new(ground, store, [0.0, 0.0]);
    let sim = tokio::spawn(world.run(rx));
    let listener = match TcpListener::bind(&bind).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("lwq-house: {bind}: {e}");
            std::process::exit(1);
        }
    };
    eprintln!("lwq-house: listening on {bind}{}", if cfg.dev { " (DEV: no sign-in)" } else { "" });
    let next = AtomicU64::new(1);
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("SIGTERM");
    loop {
        tokio::select! {
            r = listener.accept() => {
                let Ok((stream, _)) = r else { continue };
                stream.set_nodelay(true).ok();
                let conn = next.fetch_add(1, Ordering::Relaxed);
                tokio::spawn(connection(stream, conn, cfg.clone(), tx.clone()));
            }
            _ = tokio::signal::ctrl_c() => break,
            _ = term.recv() => break,
        }
    }
    drop(tx);
    eprintln!("lwq-house: stopping, saving everyone");
    let _ = sim.await;
}
