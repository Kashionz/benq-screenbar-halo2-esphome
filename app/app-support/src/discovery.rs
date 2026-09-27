//! Discovery is untrusted address assistance, never authentication or control.
use halo2_bridge_core::Fault;
use serde::Serialize;
use std::{
    collections::BTreeMap,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

#[cfg(target_vendor = "apple")]
mod apple;
#[cfg(target_os = "windows")]
mod windows;

const LIMIT: usize = 20;
const SERVICE: &str = "_halo2-bridge._tcp.local.";
static SCANNING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Candidate {
    pub name: String,
    pub host: String,
    pub port: u16,
}

fn candidate(
    name: &str,
    host: &str,
    port: u16,
    api: Option<&str>,
    model: Option<&str>,
) -> Option<Candidate> {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if api != Some("1")
        || model != Some("screenbar-halo2-bridge")
        || name.is_empty()
        || name.len() > 255
        || name.chars().any(char::is_control)
        || !host.ends_with(".local")
        || host.len() > 253
        || host.split('.').any(|label| {
            label.is_empty()
                || label.len() > 63
                || label.starts_with('-')
                || label.ends_with('-')
                || !label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
        || halo2_bridge_core::endpoint(&host, port).is_err()
    {
        return None;
    }
    Some(Candidate {
        name: name.to_owned(),
        host,
        port,
    })
}

#[derive(Default)]
struct Results(BTreeMap<String, Candidate>);
impl Results {
    fn update(&mut self, key: String, value: Option<Candidate>) {
        self.0.remove(&key);
        if self.0.len() < LIMIT {
            if let Some(value) = value {
                self.0.insert(key, value);
            }
        }
    }
    fn finish(self) -> Vec<Candidate> {
        let mut values: Vec<_> = self.0.into_values().collect();
        values.sort_by(|a, b| (&a.host, a.port, &a.name).cmp(&(&b.host, b.port, &b.name)));
        values.dedup_by(|a, b| a.host == b.host && a.port == b.port);
        values
    }
}

fn unavailable() -> Fault {
    Fault::new(
        "DISCOVERY_UNAVAILABLE",
        "無法搜尋區域網路；請檢查網路與 App 的區域網路權限，或手動輸入 IP。",
    )
}

struct ScanGuard;
impl ScanGuard {
    fn acquire() -> Result<Self, Fault> {
        SCANNING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| Fault::new("DISCOVERY_BUSY", "搜尋仍在進行，請稍候再試。"))?;
        Ok(Self)
    }
}
impl Drop for ScanGuard {
    fn drop(&mut self) {
        SCANNING.store(false, Ordering::Release);
    }
}

pub fn discover() -> Result<Vec<Candidate>, Fault> {
    let _guard = ScanGuard::acquire()?;
    let deadline = Instant::now() + Duration::from_secs(5);
    #[cfg(target_os = "windows")]
    return windows::scan(deadline);
    #[cfg(target_vendor = "apple")]
    return apple::scan(deadline);
    #[cfg(not(any(target_os = "windows", target_vendor = "apple")))]
    {
        let _ = deadline;
        Err(unavailable())
    }
}

#[cfg(any(target_vendor = "apple", test))]
fn txt_fields(bytes: &[u8]) -> Option<(Option<&str>, Option<&str>)> {
    let (mut api, mut model) = (None, None);
    let mut cursor = 0;
    while cursor < bytes.len() {
        let len = bytes[cursor] as usize;
        cursor += 1;
        let field = bytes.get(cursor..cursor.checked_add(len)?)?;
        cursor += len;
        if let Some(split) = field.iter().position(|b| *b == b'=') {
            let key = &field[..split];
            if key.eq_ignore_ascii_case(b"api") || key.eq_ignore_ascii_case(b"model") {
                let value = std::str::from_utf8(&field[split + 1..]).ok()?;
                let slot = if key.eq_ignore_ascii_case(b"api") {
                    &mut api
                } else {
                    &mut model
                };
                if slot.replace(value).is_some() {
                    return None;
                }
            }
        }
    }
    Some((api, model))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn txt_is_bounded_and_rejects_duplicate_version() {
        let model = b"model=screenbar-halo2-bridge";
        let mut valid = b"\x05api=1".to_vec();
        valid.push(model.len() as u8);
        valid.extend_from_slice(model);
        assert_eq!(
            txt_fields(&valid),
            Some((Some("1"), Some("screenbar-halo2-bridge")))
        );
        valid.pop();
        assert_eq!(txt_fields(&valid), None);
        assert_eq!(txt_fields(b"\x05api=1\x05API=2"), None);
    }
    fn valid(host: &str) -> Option<Candidate> {
        candidate(
            "Desk",
            host,
            8080,
            Some("1"),
            Some("screenbar-halo2-bridge"),
        )
    }
    #[test]
    fn only_local_compatible_services_are_candidates() {
        assert_eq!(valid("Desk.LOCAL.").unwrap().host, "desk.local");
        for host in [
            "example.com",
            "user@desk.local",
            "a..local",
            "-a.local",
            "a/.local",
        ] {
            assert!(valid(host).is_none());
        }
        assert!(candidate(
            "Desk",
            "desk.local",
            0,
            Some("1"),
            Some("screenbar-halo2-bridge")
        )
        .is_none());
        assert!(candidate(
            "Desk",
            "desk.local",
            8080,
            Some("2"),
            Some("screenbar-halo2-bridge")
        )
        .is_none());
        assert!(candidate(
            "Desk\n",
            "desk.local",
            8080,
            Some("1"),
            Some("screenbar-halo2-bridge")
        )
        .is_none());
    }
    #[test]
    fn bounds_updates_removals_and_duplicate_interfaces() {
        let mut results = Results::default();
        for i in 0..40 {
            results.update(i.to_string(), valid(&format!("desk{i}.local")));
        }
        assert_eq!(results.0.len(), LIMIT);
        results.update("0".into(), None);
        results.update("duplicate".into(), valid("desk1.local"));
        assert_eq!(results.finish().len(), LIMIT - 1);
    }
    #[test]
    fn concurrent_scan_is_rejected_and_drop_releases_gate() {
        let first = ScanGuard::acquire().unwrap();
        assert!(ScanGuard::acquire().is_err());
        drop(first);
        assert!(ScanGuard::acquire().is_ok());
    }
}
