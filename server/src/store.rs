//! What the house keeps: one SQLite file under the state directory. Every write runs on its own thread, so a slow
//! disk never holds the tick up.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::mpsc;

#[derive(Clone, Serialize, Deserialize)]
pub struct Saved {
    pub zone: String,
    pub pos: [f32; 3],
    pub yaw: f32,
    /// how the player chose to look (look.rs); none until the creator was used
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub look: Option<serde_json::Value>,
}

pub enum Job {
    Save { key: String, tag: String, saved: Saved },
    /// answered once every save before it is written
    Flush(mpsc::Sender<()>),
}

pub struct Store {
    tx: mpsc::Sender<Job>,
    path: std::path::PathBuf,
}

fn open(path: &Path) -> rusqlite::Result<Connection> {
    let c = Connection::open(path)?;
    c.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
         CREATE TABLE IF NOT EXISTS players (key TEXT PRIMARY KEY, tag TEXT, saved TEXT NOT NULL, at INTEGER NOT NULL);",
    )?;
    Ok(c)
}

impl Store {
    pub fn open(dir: &Path) -> Result<Store, String> {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let path = dir.join("house.sqlite");
        let c = open(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        let (tx, rx) = mpsc::channel::<Job>();
        std::thread::spawn(move || {
            for job in rx {
                match job {
                    Job::Save { key, tag, saved } => {
                        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
                        let r = c.execute(
                            "INSERT INTO players (key, tag, saved, at) VALUES (?1, ?2, ?3, ?4)
                             ON CONFLICT(key) DO UPDATE SET tag = excluded.tag, saved = excluded.saved, at = excluded.at",
                            params![key, tag, serde_json::to_string(&saved).unwrap_or_default(), now as i64],
                        );
                        if let Err(e) = r {
                            eprintln!("store: {e}");
                        }
                    }
                    Job::Flush(done) => {
                        let _ = done.send(());
                    }
                }
            }
        });
        Ok(Store { tx, path })
    }

    /// Wait (at most 10 s) until every save asked for so far is written.
    pub fn flush(&self) {
        let (tx, rx) = mpsc::channel();
        if self.tx.send(Job::Flush(tx)).is_ok() {
            let _ = rx.recv_timeout(std::time::Duration::from_secs(10));
        }
    }

    pub fn save(&self, key: &str, tag: &str, saved: Saved) {
        let _ = self.tx.send(Job::Save { key: key.to_string(), tag: tag.to_string(), saved });
    }

    /// Read on joining (rare; its own connection, so it never waits behind the writer's queue for long).
    pub fn load(&self, key: &str) -> Option<Saved> {
        let c = Connection::open(&self.path).ok()?;
        let s: String = c.query_row("SELECT saved FROM players WHERE key = ?1", params![key], |r| r.get(0)).ok()?;
        serde_json::from_str(&s).ok()
    }
}
