//! How players look: the recipe a player chose in the creator (client/src/creator.js), checked against the
//! catalogue (content/core/people/catalogue.json) the same way the client checks it (client/src/recipes.js,
//! checkPlayer): only what players may have, sliders in their ranges, colours from the player palette. A villager's
//! apron or robe, its colours, cannot be had: no player looks like a villager. What is unknown is dropped.

use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::path::Path;

pub struct Looks {
    cat: Value,
    skins: Vec<String>,
}

fn clamp(v: &Value, r: &Value) -> f64 {
    let (a, b) = (r[0].as_f64().unwrap_or(-1.0), r[1].as_f64().unwrap_or(1.0));
    let x = v.as_f64().unwrap_or(0.0);
    if x.is_finite() { x.clamp(a, b) } else { 0.0 }
}

fn round(x: f64) -> Value {
    json!((x * 1000.0).round() / 1000.0)
}

fn for_player(tag: &Value) -> bool {
    tag == "both" || tag == "player"
}

impl Looks {
    pub fn load(content: &Path) -> Result<Looks, String> {
        let read = |p: &str| -> Result<Value, String> {
            let f = content.join(p);
            let s = std::fs::read_to_string(&f).map_err(|e| format!("{}: {e}", f.display()))?;
            serde_json::from_str(&s).map_err(|e| format!("{}: {e}", f.display()))
        };
        let cat = read("core/people/catalogue.json")?;
        let skins = read("core/people/kit/assets.json")?["skins"].as_array().cloned().unwrap_or_default()
            .into_iter().filter_map(|s| s.as_str().map(String::from)).collect();
        Ok(Looks { cat, skins })
    }

    /// The recipe made safe, or None if it is none (no base, or no outfit players may wear).
    pub fn check(&self, rec: &Value) -> Option<Value> {
        let cat = &self.cat;
        let base = rec["base"].as_str().filter(|b| *b == "m" || *b == "f")?;
        let lim = &cat["shape"]["player"];
        let mut shape = Map::new();
        for k in ["weight", "muscle", "age"] {
            shape.insert(k.into(), round(clamp(&rec["shape"][k], &lim[k])));
        }
        for k in ["african", "asian"] {
            let v = clamp(&rec["shape"][k], &json!([0, 1]));
            if v != 0.0 {
                shape.insert(k.into(), round(v));
            }
        }
        for f in cat["shape"]["face"].as_array()?.iter().filter_map(|f| f.as_str()) {
            let v = clamp(&rec["shape"][f], &json!([-1, 1]));
            if v != 0.0 {
                shape.insert(f.into(), round(v));
            }
        }
        let hair = rec["hair"].as_str().filter(|h| for_player(&cat["hair"][base][*h])).map(String::from);
        let colours: Vec<&str> = ["both", "player"].iter().flat_map(|w| cat["hairColors"][*w].as_array().into_iter().flatten())
            .filter_map(|c| c.as_str()).collect();
        let pick = |v: &Value, list: &[&str], def: &str| -> String {
            v.as_str().filter(|c| list.contains(c)).unwrap_or(def).to_string()
        };
        let hair_colour = pick(&rec["hairColor"], &colours, colours.first().copied().unwrap_or("#4a3020"));
        let brow_colour = pick(&rec["browColor"], &colours, &hair_colour);
        let brows: Vec<&str> = cat["brows"].as_array()?.iter().filter_map(|b| b.as_str()).collect();
        let eyes: Vec<&str> = cat["eyes"].as_array()?.iter().filter_map(|b| b.as_str()).collect();
        let suffix = if base == "m" { "_male" } else { "_female" };
        let skin = rec["skin"].as_str().filter(|s| self.skins.iter().any(|k| k == s) && s.ends_with(suffix))
            .map(String::from).unwrap_or_else(|| format!("young_caucasian{suffix}"));
        // the outfit: one players may wear, with exactly its parts
        let parts = rec["parts"].as_array()?;
        let ids: HashSet<&str> = parts.iter().filter_map(|p| p["id"].as_str()).collect();
        let outfit = cat["outfits"].as_object()?.values().find(|o| {
            for_player(&o["for"]) && o["parts"].as_array().is_some_and(|ps| ps.len() == parts.len()
                && ps.iter().all(|p| p.as_str().is_some_and(|id| ids.contains(id))))
        })?;
        let pal = &cat["palettes"]["player"];
        let allowed: HashSet<&str> = ["cloth", "dyed", "light", "leather"].iter()
            .flat_map(|k| pal[*k].as_array().into_iter().flatten()).filter_map(|c| c.as_str()).collect();
        let first = |k: &str| pal[k][0].as_str().unwrap_or("#4a3424").to_string();
        let out_parts: Vec<Value> = outfit["parts"].as_array()?.iter().filter_map(|id| id.as_str()).map(|id| {
            let c = parts.iter().find(|p| p["id"] == id).and_then(|p| p["color"].as_str()).filter(|c| allowed.contains(c));
            let def = if id.contains("boots") || id.contains("belt") { first("leather") } else { first("cloth") };
            json!({"id": id, "color": c.map(String::from).unwrap_or(def)})
        }).collect();
        Some(json!({
            "base": base, "height": round(clamp(&rec["height"], &lim["height"])), "shape": shape,
            "skin": skin, "eyes": pick(&rec["eyes"], &eyes, "brown"), "brows": pick(&rec["brows"], &brows, brows.first().copied().unwrap_or("eyebrow001")),
            "hair": hair, "hairColor": hair_colour, "browColor": brow_colour, "parts": out_parts,
        }))
    }
}
