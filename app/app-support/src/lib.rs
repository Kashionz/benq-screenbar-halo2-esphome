pub mod diagnostics;
pub mod discovery;
pub mod presets;
pub mod profiles;

use halo2_bridge_core::Fault;
use serde::Serialize;
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};

pub fn storage_error() -> Fault {
    Fault::new(
        "STORAGE_ERROR",
        "無法讀寫本機資料，請檢查儲存空間與存取權限。",
    )
}

pub(crate) fn atomic_json(path: &Path, value: &impl Serialize) -> Result<(), Fault> {
    let parent = path.parent().ok_or_else(storage_error)?;
    fs::create_dir_all(parent).map_err(|_| storage_error())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|_| storage_error())?;
    serde_json::to_writer(&mut file, value).map_err(|_| storage_error())?;
    file.flush().map_err(|_| storage_error())?;
    file.as_file().sync_all().map_err(|_| storage_error())?;
    file.persist(path).map_err(|_| storage_error())?;
    Ok(())
}

pub(crate) fn read_bounded<T: serde::de::DeserializeOwned>(
    path: &Path,
    max: u64,
) -> Result<Option<T>, Fault> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(storage_error()),
    };
    if file.metadata().map_err(|_| storage_error())?.len() > max {
        return Err(storage_error());
    }
    let mut bytes = Vec::new();
    file.take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| storage_error())?;
    if bytes.len() as u64 > max {
        return Err(storage_error());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| storage_error())
}
