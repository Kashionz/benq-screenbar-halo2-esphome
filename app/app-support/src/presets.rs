use crate::{atomic_json, read_bounded, storage_error};
use halo2_bridge_core::Fault;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// A preset keeps only the brightness of the lamps its mode lights; the
/// temperature is shared by both lamps and always kept.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Lighting {
    pub mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub front_brightness: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub back_brightness: Option<u8>,
    pub temperature_k: u16,
}
impl Lighting {
    fn lit(&self) -> (bool, bool) {
        (self.mode != "back", self.mode != "front")
    }
    /// Every lit lamp has a brightness. An unlit lamp's brightness, as older
    /// files stored it, is tolerated when in range and dropped by normalized().
    fn valid(&self) -> bool {
        let level = |lit: bool, value: Option<u8>| match value {
            Some(v) => (1..=100).contains(&v),
            None => !lit,
        };
        let (front, back) = self.lit();
        matches!(self.mode.as_str(), "front" | "back" | "both")
            && level(front, self.front_brightness)
            && level(back, self.back_brightness)
            && (2700..=6500).contains(&self.temperature_k)
            && self.temperature_k.is_multiple_of(25)
    }
    fn normalized(self) -> Self {
        let (front, back) = self.lit();
        Self {
            front_brightness: self.front_brightness.filter(|_| front),
            back_brightness: self.back_brightness.filter(|_| back),
            ..self
        }
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
/// Presets the App keeps; a stored file with more is rejected like any other
/// invalid file, and left untouched.
pub const MAX_PRESETS: usize = 4;
fn limit_error() -> Fault {
    Fault::new("PRESET_LIMIT", "最多保存 4 個情境，請先刪除不需要的情境。")
}
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
            || document.presets.len() > MAX_PRESETS
            || document.presets.iter().any(|p| {
                uuid::Uuid::parse_str(&p.id).is_err()
                    || !ids.insert(&p.id)
                    || !valid_name(&p.name)
                    || !p.values.valid()
            })
        {
            return Err(storage_error());
        }
        Ok(document
            .presets
            .into_iter()
            .map(|p| Preset {
                values: p.values.normalized(),
                ..p
            })
            .collect())
    }
    pub fn save(&self, name: String, values: Lighting) -> Result<Vec<Preset>, Fault> {
        let name = name.trim().to_owned();
        if !valid_name(&name) || !values.valid() {
            return Err(Fault::new("INVALID_PRESET", "情境名稱或燈光設定不合法。"));
        }
        let mut presets = self.list()?;
        if presets.len() >= MAX_PRESETS {
            return Err(limit_error());
        }
        presets.push(Preset {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            values: values.normalized(),
        });
        self.write(presets)
    }
    /// Undo a delete: put the preset back at its old position. Only a preset
    /// that is not already stored is accepted, so a repeated undo is refused.
    pub fn restore(&self, preset: Preset, index: usize) -> Result<Vec<Preset>, Fault> {
        let preset = Preset {
            name: preset.name.trim().to_owned(),
            values: preset.values.normalized(),
            ..preset
        };
        if uuid::Uuid::parse_str(&preset.id).is_err()
            || !valid_name(&preset.name)
            || !preset.values.valid()
        {
            return Err(Fault::new("INVALID_PRESET", "情境名稱或燈光設定不合法。"));
        }
        let mut presets = self.list()?;
        if presets.iter().any(|p| p.id == preset.id) {
            return Err(Fault::new("INVALID_PRESET", "這個情境已存在。"));
        }
        if presets.len() >= MAX_PRESETS {
            return Err(limit_error());
        }
        let index = index.min(presets.len());
        presets.insert(index, preset);
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
            front_brightness: Some(35),
            back_brightness: None,
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
    fn keeps_only_the_lit_lamps_brightness() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("presets.json");
        let store = Presets::new(path.clone());
        let mut both_levels = light();
        both_levels.back_brightness = Some(50);
        let saved = store.save("前燈".into(), both_levels).unwrap();
        assert_eq!(saved[0].values.front_brightness, Some(35));
        assert_eq!(saved[0].values.back_brightness, None);
        let file = std::fs::read_to_string(&path).unwrap();
        assert!(file.contains("front_brightness") && !file.contains("back_brightness"));
        // A lit lamp needs a brightness; an unlit one may be omitted.
        let back = Lighting {
            mode: "back".into(),
            front_brightness: None,
            back_brightness: Some(20),
            temperature_k: 3925,
        };
        assert!(store.save("後燈".into(), back.clone()).is_ok());
        let missing = Lighting {
            mode: "both".into(),
            ..back
        };
        assert_eq!(
            store.save("雙燈".into(), missing).unwrap_err().code,
            "INVALID_PRESET"
        );
        // Older files stored both levels for every mode; they still load.
        let id = uuid::Uuid::new_v4().to_string();
        std::fs::write(
            &path,
            format!(
                r#"{{"version":1,"presets":[{{"id":"{id}","name":"舊","values":{{"mode":"back","front_brightness":30,"back_brightness":20,"temperature_k":3925}}}}]}}"#
            ),
        )
        .unwrap();
        let old = &store.list().unwrap()[0].values;
        assert_eq!(
            (old.front_brightness, old.back_brightness),
            (None, Some(20))
        );
    }
    #[test]
    fn restores_a_deleted_preset_at_its_old_position_once() {
        let dir = tempfile::tempdir().unwrap();
        let store = Presets::new(dir.path().join("presets.json"));
        store.save("閱讀".into(), light()).unwrap();
        store.save("工作".into(), light()).unwrap();
        let all = store.save("夜間".into(), light()).unwrap();
        let removed = all[1].clone();
        store.delete(&removed.id).unwrap();
        let restored = store.restore(removed.clone(), 1).unwrap();
        let names: Vec<_> = restored.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["閱讀", "工作", "夜間"]);
        assert_eq!(restored[1].id, removed.id);
        assert!(store.restore(removed, 1).is_err());
        let mut forged = all[0].clone();
        forged.id = "not-a-uuid".into();
        assert!(store.restore(forged, 0).is_err());
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
        for _ in 0..MAX_PRESETS {
            store.save("valid".into(), light()).unwrap();
        }
        assert_eq!(
            store.save("overflow".into(), light()).unwrap_err().code,
            "PRESET_LIMIT"
        );
        // A file holding more than four presets is rejected, not truncated.
        let five: Vec<_> = (0..5)
            .map(|i| Preset {
                id: uuid::Uuid::new_v4().to_string(),
                name: format!("p{i}"),
                values: light(),
            })
            .collect();
        std::fs::write(
            &path,
            serde_json::to_vec(&Document {
                version: 1,
                presets: five,
            })
            .unwrap(),
        )
        .unwrap();
        assert!(store.list().is_err());
        std::fs::write(&path, br#"{"version":2,"presets":[]}"#).unwrap();
        let before = std::fs::read(&path).unwrap();
        assert!(store.save("new".into(), light()).is_err());
        assert!(store.delete("any").is_err());
        assert_eq!(std::fs::read(path).unwrap(), before);
    }
}
