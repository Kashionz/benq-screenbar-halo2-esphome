use crate::{atomic_json, read_bounded};
use halo2_bridge_core::{Fault, Record, Snapshot, Tx};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const LIMIT: usize = 200;
#[derive(Clone, Serialize, Deserialize)]
pub struct Event {
    pub unix_ms: u64,
    pub kind: String,
    pub device_id: Option<String>,
    pub boot_id: Option<String>,
    pub command_id: Option<String>,
    pub status: String,
    pub error_code: Option<String>,
    pub tx: Option<Tx>,
    pub control_revision: Option<u64>,
}
fn id(value: &str) -> Option<String> {
    Uuid::parse_str(value).ok().map(|v| v.to_string())
}
fn code(value: &str) -> String {
    // Export a closed vocabulary, never arbitrary server text or request data.
    match value {
        "NETWORK"
        | "UNAUTHORIZED"
        | "PROTOCOL_ERROR"
        | "BOOT_CHANGED"
        | "DEVICE_CHANGED"
        | "UNKNOWN_OUTCOME"
        | "RATE_LIMITED"
        | "BUSY"
        | "RADIO_UNAVAILABLE"
        | "INVALID_VALUE"
        | "EXPERIMENTAL_DISABLED"
        | "UNSUPPORTED_FIELD"
        | "REVISION_CONFLICT"
        | "DEADLINE_EXPIRED"
        | "TX_MAX_RETRIES"
        | "TX_TIMEOUT"
        | "TX_FIFO_STUCK"
        | "TX_FAILED"
        | "CREDENTIAL_STORE"
        | "STORAGE_ERROR"
        | "NOT_CONNECTED" => value.into(),
        _ => "OTHER".into(),
    }
}
fn status(value: &str) -> String {
    match value {
        "ready" | "fault" | "learning" | "unavailable" | "accepted" | "executing"
        | "transmitted" | "failed" | "expired" | "superseded" => value.into(),
        _ => "unknown".into(),
    }
}
impl Event {
    fn sanitized(mut self) -> Self {
        self.kind = match self.kind.as_str() {
            "command" => "command",
            "state" => "state",
            _ => "error",
        }
        .into();
        self.device_id = self.device_id.as_deref().and_then(id);
        self.boot_id = self.boot_id.as_deref().and_then(id);
        self.command_id = self.command_id.as_deref().and_then(id);
        self.status = status(&self.status);
        self.error_code = self.error_code.as_deref().map(code);
        self
    }
    fn new(kind: &str, device: Option<&str>, boot: Option<&str>) -> Self {
        Self {
            unix_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            kind: kind.into(),
            device_id: device.and_then(id),
            boot_id: boot.and_then(id),
            command_id: None,
            status: String::new(),
            error_code: None,
            tx: None,
            control_revision: None,
        }
    }
    pub fn fault(device: Option<&str>, fault: &Fault) -> Self {
        let mut e = Self::new("error", device, fault.boot_id.as_deref());
        e.command_id = fault.command_id.as_deref().and_then(id);
        e.status = "failed".into();
        e.error_code = Some(code(&fault.code));
        e
    }
    pub fn command(device: &str, record: &Record) -> Self {
        let mut e = Self::new("command", Some(device), Some(&record.boot_id));
        e.command_id = id(&record.command_id);
        e.status = status(&record.status);
        e.error_code = record
            .error
            .as_ref()
            .and_then(|v| v["code"].as_str())
            .map(code);
        e.tx = Some(record.tx.clone());
        e
    }
    pub fn state(snapshot: &Snapshot) -> Self {
        let mut e = Self::new("state", Some(&snapshot.device_id), Some(&snapshot.boot_id));
        e.status = status(&snapshot.radio_status);
        e.error_code = snapshot.radio_error_code.as_deref().map(code);
        e.control_revision = Some(snapshot.control_revision);
        e
    }
}

pub struct Diagnostics {
    path: PathBuf,
    events: VecDeque<Event>,
    last_state: Option<String>,
}
impl Diagnostics {
    pub fn new(path: PathBuf) -> Result<Self, Fault> {
        let loaded: VecDeque<Event> = read_bounded(&path, 262144)?.unwrap_or_default();
        let mut events: VecDeque<Event> = loaded.into_iter().map(Event::sanitized).collect();
        while events.len() > LIMIT {
            events.pop_front();
        }
        Ok(Self {
            path,
            events,
            last_state: None,
        })
    }
    pub fn append(&mut self, event: Event) -> Result<(), Fault> {
        let event = event.sanitized();
        if event.kind != "command" {
            let fingerprint = format!(
                "{:?}/{:?}/{}/{:?}/{:?}/{}/{:?}",
                event.device_id,
                event.boot_id,
                event.status,
                event.error_code,
                event.control_revision,
                event.kind,
                event.command_id
            );
            if self.last_state.as_ref() == Some(&fingerprint) {
                return Ok(());
            }
            // Only remember persisted state. A failed write must be retried.
            let mut next = self.events.clone();
            next.push_back(event);
            while next.len() > LIMIT {
                next.pop_front();
            }
            atomic_json(&self.path, &next)?;
            self.events = next;
            self.last_state = Some(fingerprint);
        } else {
            let mut next = self.events.clone();
            next.push_back(event);
            while next.len() > LIMIT {
                next.pop_front();
            }
            atomic_json(&self.path, &next)?;
            self.events = next;
            self.last_state = None;
        }
        Ok(())
    }
    pub fn list(&self) -> Vec<Event> {
        self.events.iter().cloned().collect()
    }
    pub fn export(&self, directory: &Path) -> Result<PathBuf, Fault> {
        let path = directory.join(format!("halo2-diagnostics-{}.json", Uuid::new_v4()));
        atomic_json(
            &path,
            &serde_json::json!({"format":"halo2-diagnostics-v1","events":self.events}),
        )?;
        Ok(path)
    }
    pub fn clear(&mut self) -> Result<(), Fault> {
        atomic_json(&self.path, &Vec::<Event>::new())?;
        self.events.clear();
        self.last_state = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn error_messages_credentials_and_unknown_fields_are_not_exported() {
        let d = tempfile::tempdir().unwrap();
        let mut log = Diagnostics::new(d.path().join("log.json")).unwrap();
        log.append(Event::fault(
            Some("invalid-user-secret"),
            &Fault::new("secret-in-code", "secret-in-message"),
        ))
        .unwrap();
        let text = std::fs::read_to_string(log.export(d.path()).unwrap()).unwrap();
        assert!(!text.contains("secret"));
        assert!(text.contains("OTHER"));
    }
    #[test]
    fn repeated_network_failure_does_not_evict_history() {
        let d = tempfile::tempdir().unwrap();
        let mut log = Diagnostics::new(d.path().join("log.json")).unwrap();
        for _ in 0..5 {
            log.append(Event::fault(None, &Fault::new("NETWORK", "unused")))
                .unwrap();
        }
        assert_eq!(log.list().len(), 1);
        log.append(Event::fault(None, &Fault::new("UNAUTHORIZED", "unused")))
            .unwrap();
        assert_eq!(log.list().len(), 2);
    }
    #[test]
    fn history_is_bounded_and_survives_restart() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("log.json");
        let mut log = Diagnostics::new(path.clone()).unwrap();
        for n in 0..205 {
            let mut event = Event::fault(None, &Fault::new("NETWORK", "unused"));
            event.command_id = Some(Uuid::from_u128(n).to_string());
            log.append(event).unwrap();
        }
        assert_eq!(Diagnostics::new(path).unwrap().list().len(), 200);
        log.clear().unwrap();
        assert!(log.list().is_empty());
    }
}
