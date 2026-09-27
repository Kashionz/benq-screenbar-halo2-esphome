use crate::{atomic_json, read_bounded};
use halo2_bridge_core::{endpoint, Fault};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

const SERVICE: &str = "io.github.kashionz.halo2.bridge";
pub trait Credentials {
    fn put(&self, key: &str, password: &str) -> Result<(), Fault>;
    fn get(&self, key: &str) -> Result<String, Fault>;
    fn remove(&self, key: &str) -> Result<(), Fault>;
}
pub struct NativeCredentials;
fn credential_error() -> Fault {
    Fault::new(
        "CREDENTIAL_STORE",
        "系統憑證庫無法存取；可取消記住帳密，改用本次連線。",
    )
}
fn entry(key: &str) -> Result<keyring::Entry, Fault> {
    // Never silently accept keyring's mock fallback on unsupported platforms.
    if !cfg!(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "ios"
    )) {
        return Err(credential_error());
    }
    if Uuid::parse_str(key).is_err() {
        return Err(credential_error());
    }
    keyring::Entry::new(SERVICE, key).map_err(|_| credential_error())
}
impl Credentials for NativeCredentials {
    fn put(&self, key: &str, password: &str) -> Result<(), Fault> {
        entry(key)?
            .set_password(password)
            .map_err(|_| credential_error())
    }
    fn get(&self, key: &str) -> Result<String, Fault> {
        entry(key)?.get_password().map_err(|_| credential_error())
    }
    fn remove(&self, key: &str) -> Result<(), Fault> {
        match entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(credential_error()),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedConnection {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub device_id: String,
    pub credential_id: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProfileFile {
    profile: Option<SavedConnection>,
    #[serde(default)]
    retired_keys: Vec<String>,
}

// The caller serializes all access, including native credential-store operations.
pub struct Profiles<C: Credentials> {
    path: PathBuf,
    credentials: C,
}
impl<C: Credentials> Profiles<C> {
    pub fn new(path: PathBuf, credentials: C) -> Self {
        Self { path, credentials }
    }
    fn read(&self) -> Result<ProfileFile, Fault> {
        let data: ProfileFile = read_bounded(&self.path, 65536)?.unwrap_or_default();
        if let Some(p) = &data.profile {
            endpoint(&p.host, p.port)?;
            if Uuid::parse_str(&p.device_id).is_err()
                || Uuid::parse_str(&p.credential_id).is_err()
                || p.username.is_empty()
                || p.username.contains(':')
            {
                return Err(crate::storage_error());
            }
        }
        if data.retired_keys.len() > 64
            || data
                .retired_keys
                .iter()
                .any(|k| Uuid::parse_str(k).is_err())
        {
            return Err(crate::storage_error());
        }
        Ok(data)
    }
    pub fn saved(&self) -> Result<Option<SavedConnection>, Fault> {
        let mut data = self.read()?;
        if !data.retired_keys.is_empty() {
            self.clean(&mut data)?;
        }
        Ok(data.profile)
    }
    pub fn password(&self, saved: &SavedConnection) -> Result<String, Fault> {
        self.credentials.get(&saved.credential_id)
    }
    fn clean(&self, data: &mut ProfileFile) -> Result<(), Fault> {
        let mut fault = None;
        data.retired_keys
            .retain(|key| match self.credentials.remove(key) {
                Ok(()) => false,
                Err(e) => {
                    fault = Some(e);
                    true
                }
            });
        atomic_json(&self.path, data)?;
        match fault {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }
    pub fn save(
        &self,
        host: &str,
        port: u16,
        username: &str,
        device_id: &str,
        password: &str,
    ) -> Result<SavedConnection, Fault> {
        let url = endpoint(host, port)?;
        if username.is_empty()
            || username.contains(':')
            || password.is_empty()
            || Uuid::parse_str(device_id).is_err()
        {
            return Err(crate::storage_error());
        }
        let mut data = self.read()?;
        // Complete earlier cleanup before accepting another credential.
        if !data.retired_keys.is_empty() {
            self.clean(&mut data)?;
        }
        let profile = SavedConnection {
            host: url
                .host_str()
                .unwrap_or(host)
                .trim_matches(['[', ']'])
                .into(),
            port,
            username: username.into(),
            device_id: device_id.into(),
            credential_id: Uuid::new_v4().to_string(),
        };
        // Journal the new ID first: interrupted writes cannot orphan a password.
        let mut journal = data.clone();
        journal.retired_keys.push(profile.credential_id.clone());
        atomic_json(&self.path, &journal)?;
        if let Err(e) = self.credentials.put(&profile.credential_id, password) {
            let _ = self.clean(&mut journal);
            return Err(e);
        }
        if let Some(old) = data.profile.replace(profile.clone()) {
            data.retired_keys.push(old.credential_id);
        }
        if let Err(e) = atomic_json(&self.path, &data) {
            let _ = self.clean(&mut journal);
            return Err(e);
        }
        self.clean(&mut data)?;
        Ok(profile)
    }
    pub fn forget(&self) -> Result<(), Fault> {
        let mut data = self.read()?;
        if let Some(old) = data.profile.take() {
            data.retired_keys.push(old.credential_id);
        }
        // Retain failed cleanup keys on disk so forgetting can be retried.
        atomic_json(&self.path, &data)?;
        self.clean(&mut data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        cell::{Cell, RefCell},
        collections::HashMap,
    };
    #[derive(Default)]
    struct Memory(RefCell<HashMap<String, String>>, Cell<bool>);
    impl Credentials for Memory {
        fn put(&self, k: &str, p: &str) -> Result<(), Fault> {
            self.0.borrow_mut().insert(k.into(), p.into());
            Ok(())
        }
        fn get(&self, k: &str) -> Result<String, Fault> {
            self.0.borrow().get(k).cloned().ok_or_else(credential_error)
        }
        fn remove(&self, k: &str) -> Result<(), Fault> {
            if self.1.get() {
                return Err(credential_error());
            }
            self.0.borrow_mut().remove(k);
            Ok(())
        }
    }
    #[test]
    fn save_replace_and_forget_never_write_password_to_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = Profiles::new(dir.path().join("connection.json"), Memory::default());
        let device = Uuid::new_v4().to_string();
        let first = store
            .save("127.0.0.1", 8080, "tester", &device, "secret-sentinel")
            .unwrap();
        assert_eq!(store.password(&first).unwrap(), "secret-sentinel");
        assert!(!std::fs::read_to_string(&store.path)
            .unwrap()
            .contains("secret-sentinel"));
        let second = store
            .save("127.0.0.2", 8080, "tester", &device, "next-secret")
            .unwrap();
        assert!(store.password(&first).is_err());
        assert_eq!(store.password(&second).unwrap(), "next-secret");
        assert_eq!(store.saved().unwrap().unwrap().host, "127.0.0.2");
        store.forget().unwrap();
        assert!(store.read().unwrap().profile.is_none());
        assert!(store.password(&second).is_err());
    }
    #[test]
    fn failed_cleanup_keeps_a_journal_and_forget_retries_all_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let store = Profiles::new(dir.path().join("connection.json"), Memory::default());
        let device = Uuid::new_v4().to_string();
        store
            .save("127.0.0.1", 8080, "test", &device, "one")
            .unwrap();
        store.credentials.1.set(true);
        assert!(store
            .save("127.0.0.2", 8080, "test", &device, "two")
            .is_err());
        assert_eq!(store.read().unwrap().retired_keys.len(), 1);
        assert_eq!(store.credentials.0.borrow().len(), 2);
        assert!(store.forget().is_err());
        assert!(store.read().unwrap().profile.is_none());
        assert!(store.saved().is_err());
        assert_eq!(store.read().unwrap().retired_keys.len(), 2);
        store.credentials.1.set(false);
        store.forget().unwrap();
        assert!(store.credentials.0.borrow().is_empty());
        assert!(store.read().unwrap().retired_keys.is_empty());
    }
    #[test]
    fn corrupt_configuration_is_reported_without_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connection.json");
        std::fs::write(&path, "invalid").unwrap();
        let store = Profiles::new(path.clone(), Memory::default());
        assert!(store.saved().is_err());
        assert!(store.forget().is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "invalid");
    }
}
