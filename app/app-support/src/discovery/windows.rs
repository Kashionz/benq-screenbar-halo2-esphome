use super::*;
use std::{
    cell::UnsafeCell,
    ffi::c_void,
    sync::{Arc, Condvar, Mutex},
};
use windows_sys::Win32::NetworkManagement::Dns::*;

const PENDING: i32 = 9506;
const CANCELLED: u32 = 1223;
// Also covers a delayed cancellation callback after the public scan times out.
static NATIVE_ACTIVE: AtomicBool = AtomicBool::new(false);

#[derive(Default)]
struct Peer {
    present: bool,
    host: String,
    port: u16,
    api: Option<String>,
    model: Option<String>,
}
#[derive(Default)]
struct State {
    peers: BTreeMap<String, Peer>,
    error: bool,
    cancelled: bool,
}
struct Cancel(UnsafeCell<DNS_SERVICE_CANCEL>);
// Only the scan worker passes this opaque handle to Windows. Callbacks never
// access it; the native API owns synchronization of its internal state.
unsafe impl Send for Cancel {}
unsafe impl Sync for Cancel {}
struct Request(UnsafeCell<DNS_SERVICE_BROWSE_REQUEST>);
// Initialized before DnsServiceBrowse, then immutable through final callback.
unsafe impl Send for Request {}
unsafe impl Sync for Request {}
struct Context {
    state: Mutex<State>,
    changed: Condvar,
    cancel: Cancel,
    request: Request,
    name: Vec<u16>,
}

// Caller supplies a valid OS-owned NUL-terminated UTF-16 string.
unsafe fn wide(ptr: *const u16) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    for len in 0..=255 {
        if *ptr.add(len) == 0 {
            return String::from_utf16(std::slice::from_raw_parts(ptr, len)).ok();
        }
    }
    None
}

fn service_key(name: &str) -> Option<String> {
    let key = format!("{}.", name.trim_end_matches('.').to_ascii_lowercase());
    let instance = key.strip_suffix(SERVICE)?.strip_suffix('.')?;
    (!instance.is_empty()).then_some(key)
}

impl State {
    // Records and union members are allocated by DnsServiceBrowse. The variable
    // TXT pointer array uses DNS_TEXT_RECORD_LENGTH from the Windows SDK.
    unsafe fn record(&mut self, record: &DNS_RECORDW) {
        if !matches!(record.wType, DNS_TYPE_PTR | DNS_TYPE_SRV | DNS_TYPE_TEXT) {
            return;
        }
        let owner = if record.wType == DNS_TYPE_PTR {
            if wide(record.pName).is_none_or(|n| {
                !n.trim_end_matches('.')
                    .eq_ignore_ascii_case(SERVICE.trim_end_matches('.'))
            }) {
                return;
            }
            wide(record.Data.PTR.pNameHost)
        } else {
            wide(record.pName)
        };
        let Some(key) = owner.as_deref().and_then(service_key) else {
            return;
        };
        // DNS_RECORD_FLAGS.Delete is bit 2 (after the two Section bits).
        if record.dwTtl == 0 || record.Flags.DW & 4 != 0 {
            self.peers.remove(&key);
            return;
        }
        if !self.peers.contains_key(&key) && self.peers.len() >= LIMIT {
            return;
        }
        let peer = self.peers.entry(key).or_default();
        match record.wType {
            DNS_TYPE_PTR => peer.present = true,
            DNS_TYPE_SRV => {
                peer.host = wide(record.Data.SRV.pNameTarget).unwrap_or_default();
                peer.port = record.Data.SRV.wPort;
            }
            DNS_TYPE_TEXT => {
                peer.api = None;
                peer.model = None;
                let txt = &record.Data.TXT;
                let count = txt.dwStringCount as usize;
                let bytes = std::mem::offset_of!(DNS_TXT_DATAW, pStringArray)
                    + count.saturating_mul(std::mem::size_of::<*mut u16>());
                if count > 64 || bytes > record.wDataLength as usize {
                    return;
                }
                let entries = std::ptr::addr_of!(txt.pStringArray).cast::<*mut u16>();
                for i in 0..count {
                    let Some(field) = wide(*entries.add(i)) else {
                        peer.api = None;
                        peer.model = None;
                        return;
                    };
                    if let Some((key, value)) = field.split_once('=') {
                        let slot = if key.eq_ignore_ascii_case("api") {
                            &mut peer.api
                        } else if key.eq_ignore_ascii_case("model") {
                            &mut peer.model
                        } else {
                            continue;
                        };
                        if slot.replace(value.to_owned()).is_some() {
                            peer.api = None;
                            peer.model = None;
                            return;
                        }
                    }
                }
            }
            _ => (),
        }
    }
    fn results(&self) -> Vec<Candidate> {
        let mut results = Results::default();
        for (key, peer) in &self.peers {
            if peer.present {
                results.update(
                    key.clone(),
                    candidate(
                        key.strip_suffix(SERVICE)
                            .unwrap_or("")
                            .trim_end_matches('.'),
                        &peer.host,
                        peer.port,
                        peer.api.as_deref(),
                        peer.model.as_deref(),
                    ),
                );
            }
        }
        results.finish()
    }
}

unsafe extern "system" fn callback(status: u32, raw: *const c_void, records: *const DNS_RECORDW) {
    // The API owns one Arc until its final ERROR_CANCELLED callback.
    let context = &*raw.cast::<Context>();
    if let Ok(mut state) = context.state.lock() {
        if status == CANCELLED {
            state.cancelled = true;
        } else if status != 0 {
            state.error = true;
        } else {
            let mut cursor = records;
            for _ in 0..256 {
                if cursor.is_null() {
                    break;
                }
                state.record(&*cursor);
                cursor = (*cursor).pNext;
            }
        }
        context.changed.notify_all();
    }
    if !records.is_null() {
        DnsFree(records.cast(), DnsFreeRecordList);
    }
    if status == CANCELLED {
        NATIVE_ACTIVE.store(false, Ordering::Release);
        drop(Arc::from_raw(raw.cast::<Context>()));
    }
}

pub(super) fn scan(deadline: Instant) -> Result<Vec<Candidate>, Fault> {
    if NATIVE_ACTIVE.swap(true, Ordering::AcqRel) {
        return Err(Fault::new("DISCOVERY_BUSY", "搜尋仍在結束中，請稍候再試。"));
    }
    let context = Arc::new(Context {
        state: Mutex::new(State::default()),
        changed: Condvar::new(),
        cancel: Cancel(UnsafeCell::new(DNS_SERVICE_CANCEL {
            reserved: std::ptr::null_mut(),
        })),
        request: Request(UnsafeCell::new(unsafe { std::mem::zeroed() })),
        name: SERVICE
            .trim_end_matches('.')
            .encode_utf16()
            .chain(Some(0))
            .collect(),
    });
    let raw = Arc::into_raw(context.clone());
    let request = DNS_SERVICE_BROWSE_REQUEST {
        Version: 1,
        InterfaceIndex: 0,
        QueryName: context.name.as_ptr(),
        Anonymous: DNS_SERVICE_BROWSE_REQUEST_0 {
            pBrowseCallback: Some(callback),
        },
        pQueryContext: raw.cast_mut().cast(),
    };
    // Query name, opaque cancellation handle and callback context remain alive
    // through cancellation, including when Windows completes after our deadline.
    let started = unsafe {
        *context.request.0.get() = request;
        DnsServiceBrowse(context.request.0.get(), context.cancel.0.get())
    };
    if started != PENDING {
        unsafe {
            drop(Arc::from_raw(raw));
        }
        NATIVE_ACTIVE.store(false, Ordering::Release);
        return Err(unavailable());
    }
    let browse_end = deadline - Duration::from_millis(150);
    let state = context.state.lock().unwrap_or_else(|p| p.into_inner());
    let waited = context.changed.wait_timeout_while(
        state,
        browse_end.saturating_duration_since(Instant::now()),
        |s| !s.error && !s.cancelled,
    );
    drop(waited);
    let cancelled = unsafe { DnsServiceBrowseCancel(context.cancel.0.get()) };
    let state = context.state.lock().unwrap_or_else(|p| p.into_inner());
    let (state, _) = context
        .changed
        .wait_timeout_while(
            state,
            deadline.saturating_duration_since(Instant::now()),
            |s| !s.cancelled,
        )
        .unwrap_or_else(|p| p.into_inner());
    if cancelled != 0 || !state.cancelled || state.error {
        return Err(unavailable());
    }
    Ok(state.results())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }

    // Exercises actual Windows record layout, including TXT's flexible array.
    fn feed(state: &mut State, kind: u16, ttl: u32, fields: &[&str], deleted: bool) {
        let mut owner = utf16(if kind == DNS_TYPE_PTR {
            SERVICE
        } else {
            "Desk._halo2-bridge._tcp.local."
        });
        let mut target = utf16(if kind == DNS_TYPE_PTR {
            "Desk._halo2-bridge._tcp.local."
        } else {
            "desk.local."
        });
        let mut strings: Vec<_> = fields.iter().map(|s| utf16(s)).collect();
        // DNS_RECORDW's union has room for the three pointers used below.
        let mut record: DNS_RECORDW = unsafe { std::mem::zeroed() };
        record.pName = owner.as_mut_ptr();
        record.wType = kind;
        record.dwTtl = ttl;
        record.Flags.DW = if deleted { 4 } else { 0 };
        unsafe {
            match kind {
                DNS_TYPE_PTR => record.Data.PTR.pNameHost = target.as_mut_ptr(),
                DNS_TYPE_SRV => {
                    record.Data.SRV.pNameTarget = target.as_mut_ptr();
                    record.Data.SRV.wPort = 8080;
                }
                DNS_TYPE_TEXT => {
                    assert!(fields.len() <= 3);
                    record.Data.TXT.dwStringCount = fields.len() as u32;
                    let len = std::mem::offset_of!(DNS_TXT_DATAW, pStringArray)
                        + fields.len() * std::mem::size_of::<*mut u16>();
                    assert!(len <= std::mem::size_of_val(&record.Data));
                    record.wDataLength = len as u16;
                    let entries =
                        std::ptr::addr_of_mut!(record.Data.TXT.pStringArray).cast::<*mut u16>();
                    for (i, string) in strings.iter_mut().enumerate() {
                        *entries.add(i) = string.as_mut_ptr();
                    }
                }
                _ => unreachable!(),
            }
            state.record(&record);
        }
    }

    #[test]
    fn joins_out_of_order_records_and_removes_goodbyes() {
        let mut state = State::default();
        feed(
            &mut state,
            DNS_TYPE_TEXT,
            120,
            &["api=1", "model=screenbar-halo2-bridge"],
            false,
        );
        feed(&mut state, DNS_TYPE_SRV, 120, &[], false);
        assert!(state.results().is_empty());
        feed(&mut state, DNS_TYPE_PTR, 120, &[], false);
        assert_eq!(state.results()[0].host, "desk.local");
        assert_eq!(state.results()[0].port, 8080);
        feed(&mut state, DNS_TYPE_PTR, 0, &[], false);
        assert!(state.results().is_empty());
        feed(&mut state, DNS_TYPE_PTR, 120, &[], false);
        feed(&mut state, DNS_TYPE_PTR, 120, &[], true);
        assert!(state.peers.is_empty());
    }

    #[test]
    fn txt_replacement_rejects_duplicates_and_incompatible_versions() {
        let mut state = State::default();
        feed(&mut state, DNS_TYPE_PTR, 120, &[], false);
        feed(&mut state, DNS_TYPE_SRV, 120, &[], false);
        for fields in [
            vec!["api=2", "model=screenbar-halo2-bridge"],
            vec!["api=1", "API=1", "model=screenbar-halo2-bridge"],
        ] {
            feed(&mut state, DNS_TYPE_TEXT, 120, &fields, false);
            assert!(state.results().is_empty());
        }
        feed(
            &mut state,
            DNS_TYPE_TEXT,
            120,
            &["api=1", "model=screenbar-halo2-bridge"],
            false,
        );
        assert_eq!(state.results().len(), 1);
        feed(&mut state, DNS_TYPE_TEXT, 120, &[], false);
        assert!(state.results().is_empty());
    }
}
