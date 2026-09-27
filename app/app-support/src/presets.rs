use crate::{atomic_json, read_bounded, storage_error};
use halo2_bridge_core::Fault;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Lighting {
    pub mode: String,
    pub front_brightness: u8,
    pub back_brightness: u8,
    pub temperature_k: u16,
}
impl Lighting {
    fn valid(&self) -> bool {
        matches!(self.mode.as_str(), "front" | "back" | "both")
            && (1..=100).contains(&self.front_brightness)
            && (1..=100).contains(&self.back_brightness)
            && (2700..=6500).contains(&self.temperature_k)
            && self.temperature_k.is_multiple_of(25)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub values: Lighting,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Document {
    version: u8,
    presets: Vec<Preset>,
}
pub struct Presets(PathBuf);
fn valid_name(name: &str) -> bool {
    !name.trim().is_empty() && name.chars().count() <= 40 && !name.chars().any(char::is_control)
}
impl Presets {
    pub fn new(path: PathBuf) -> Self {
        Self(path)
    }
    pub fn list(&self) -> Result<Vec<Preset>, Fault> {
        let Some(document) = read_bounded::<Document>(&self.0, 32_768)? else {
            return Ok(Vec::new());
        };
        let mut ids = std::collections::HashSet::new();
        if document.version != 1
            || document.presets.len() > 20
            || document.presets.iter().any(|p| {
                uuid::Uuid::parse_str(&p.id).is_err()
                    || !ids.insert(&p.id)
                    || !valid_name(&p.name)
                    || !p.values.valid()
            })
        {
            return Err(storage_error());
        }
        Ok(document.presets)
    }
    pub fn save(&self, name: String, values: Lighting) -> Result<Vec<Preset>, Fault> {
        let name = name.trim().to_owned();
        if !valid_name(&name) || !values.valid() {
            return Err(Fault::new("INVALID_PRESET", "情境名稱或燈光設定不合法。"));
        }
        let mut presets = self.list()?;
        if presets.len() >= 20 {
            return Err(Fault::new(
                "PRESET_LIMIT",
                "最多保存 20 個情境，請先刪除不需要的情境。",
            ));
        }
        presets.push(Preset {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            values,
        });
        self.write(presets)
    }
    pub fn delete(&self, id: &str) -> Result<Vec<Preset>, Fault> {
        let mut presets = self.list()?;
        presets.retain(|p| p.id != id);
        self.write(presets)
    }
    fn write(&self, presets: Vec<Preset>) -> Result<Vec<Preset>, Fault> {
        atomic_json(
            &self.0,
            &Document {
                version: 1,
                presets: presets.clone(),
            },
        )?;
        Ok(presets)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn light() -> Lighting {
        Lighting {
            mode: "front".into(),
            front_brightness: 35,
            back_brightness: 50,
            temperature_k: 5500,
        }
    }
    #[test]
    fn persists_and_deletes_without_losing_other_presets() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("presets.json");
        let store = Presets::new(path.clone());
        let first = store.save(" 閱讀 ".into(), light()).unwrap();
        store.save("夜晚".into(), light()).unwrap();
        let reopened = Presets::new(path);
        assert_eq!(reopened.list().unwrap()[0].name, "閱讀");
        assert_eq!(reopened.delete(&first[0].id).unwrap()[0].name, "夜晚");
        assert_eq!(reopened.list().unwrap().len(), 1);
    }
    #[test]
    fn rejects_invalid_values_limits_and_corrupt_files_without_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("presets.json");
        let store = Presets::new(path.clone());
        let mut invalid = light();
        invalid.temperature_k = 3926;
        assert!(store.save("bad".into(), invalid).is_err());
        assert!(store.save("\n".into(), light()).is_err());
        for _ in 0..20 {
            store.save("valid".into(), light()).unwrap();
        }
        assert_eq!(
            store.save("overflow".into(), light()).unwrap_err().code,
            "PRESET_LIMIT"
        );
        std::fs::write(&path, br#"{"version":2,"presets":[]}"#).unwrap();
        let before = std::fs::read(&path).unwrap();
        assert!(store.save("new".into(), light()).is_err());
        assert!(store.delete("any").is_err());
        assert_eq!(std::fs::read(path).unwrap(), before);
    }
}
