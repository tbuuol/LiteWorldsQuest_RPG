//! How players look: the look a player chose in the creator (client/src/creator.js), checked against what the
//! standard people have (content/core/people/standard.json) the same way the client checks it
//! (client/src/standard.js, checkStandard): a base, an outfit with one of its colour variants and its extras, a
//! hairstyle of that base, a beard where the base has one, a hair colour of the list. What is unknown is dropped.

use serde_json::{json, Value};
use std::path::Path;

pub struct Looks {
    cat: Value,
}

fn strs(v: &Value) -> Vec<&str> {
    v.as_array().into_iter().flatten().filter_map(|x| x.as_str()).collect()
}

impl Looks {
    pub fn load(content: &Path) -> Result<Looks, String> {
        let f = content.join("core/people/standard.json");
        let s = std::fs::read_to_string(&f).map_err(|e| format!("{}: {e}", f.display()))?;
        let cat = serde_json::from_str(&s).map_err(|e| format!("{}: {e}", f.display()))?;
        Ok(Looks { cat })
    }

    /// The look made safe, or None if it is none (no known base or outfit).
    pub fn check(&self, l: &Value) -> Option<Value> {
        let cat = &self.cat;
        let base = l["base"].as_str().filter(|b| strs(&cat["bases"]).contains(b))?;
        let outfit = l["outfit"].as_str().filter(|o| cat["outfits"].get(*o).is_some())?;
        let o = &cat["outfits"][outfit];
        let colours: Vec<i64> = o["colours"].as_array()?.iter().filter_map(|c| c.as_i64()).collect();
        let colour = l["colours"].as_i64().filter(|c| colours.contains(c)).unwrap_or(*colours.first()?);
        let extras = strs(&o["extras"]);
        let hair = l["hair"].as_str().filter(|h| strs(&cat["hair"][base]).contains(h));
        let hair_colours = strs(&cat["hairColors"]);
        let hair_colour = l["hairColor"].as_str().filter(|c| hair_colours.contains(c)).or(hair_colours.get(2).copied())?;
        Some(json!({
            "base": base, "outfit": outfit, "colours": colour, "hair": hair,
            "beard": l["beard"].as_bool().unwrap_or(false) && strs(&cat["beard"]).contains(&base),
            "hood": l["hood"].as_bool().unwrap_or(false) && extras.contains(&"hood"),
            "pauldrons": l["pauldrons"].as_bool().unwrap_or(false) && extras.contains(&"pauldrons"),
            "hairColor": hair_colour,
        }))
    }
}
