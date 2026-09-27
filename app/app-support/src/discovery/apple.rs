//! System Bonjour: fixed service browsing does not require raw multicast access.
//! Callback contexts and references stay on this blocking worker thread.
use super::*;
use std::{
    ffi::{c_char, c_void, CStr, CString},
    ptr,
};

type Ref = *mut c_void;
type BrowseReply = unsafe extern "C" fn(
    Ref,
    u32,
    u32,
    i32,
    *const c_char,
    *const c_char,
    *const c_char,
    *mut c_void,
);
type ResolveReply = unsafe extern "C" fn(
    Ref,
    u32,
    u32,
    i32,
    *const c_char,
    *const c_char,
    u16,
    u16,
    *const u8,
    *mut c_void,
);
#[link(name = "dns_sd")]
extern "C" {
    fn DNSServiceBrowse(
        reference: *mut Ref,
        flags: u32,
        interface: u32,
        kind: *const c_char,
        domain: *const c_char,
        callback: BrowseReply,
        context: *mut c_void,
    ) -> i32;
    fn DNSServiceResolve(
        reference: *mut Ref,
        flags: u32,
        interface: u32,
        name: *const c_char,
        kind: *const c_char,
        domain: *const c_char,
        callback: ResolveReply,
        context: *mut c_void,
    ) -> i32;
    fn DNSServiceRefSockFD(reference: Ref) -> i32;
    fn DNSServiceProcessResult(reference: Ref) -> i32;
    fn DNSServiceRefDeallocate(reference: Ref);
}
struct Handle(Ref);
impl Drop for Handle {
    fn drop(&mut self) {
        // SAFETY: created by a successful Bonjour call; uniquely owned here.
        unsafe { DNSServiceRefDeallocate(self.0) }
    }
}
struct Found {
    name: String,
    interface: u32,
    add: bool,
}
#[derive(Default)]
struct BrowseContext {
    events: Vec<Found>,
    error: i32,
}
#[derive(Default)]
struct ResolveContext {
    name: String,
    value: Option<Candidate>,
    done: bool,
    error: i32,
}
struct Pending {
    // Drop the reference before the callback context it borrows.
    handle: Handle,
    context: Box<ResolveContext>,
}

unsafe fn string(value: *const c_char) -> Option<String> {
    if value.is_null() {
        return None;
    }
    // SAFETY: Bonjour supplies NUL-terminated strings valid during the callback.
    let value = unsafe { CStr::from_ptr(value) }.to_str().ok()?;
    (value.len() <= 255).then(|| value.to_owned())
}
unsafe extern "C" fn browsed(
    _: Ref,
    flags: u32,
    interface: u32,
    error: i32,
    name: *const c_char,
    _: *const c_char,
    _: *const c_char,
    context: *mut c_void,
) {
    // SAFETY: the stable boxed context outlives the reference and processing call.
    let context = unsafe { &mut *context.cast::<BrowseContext>() };
    if error != 0 {
        context.error = error;
        return;
    }
    if context.events.len() >= 256 {
        context.error = -1;
        return;
    }
    if let Some(name) = unsafe { string(name) } {
        context.events.push(Found {
            name,
            interface,
            add: flags & 2 != 0,
        });
    }
}

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

unsafe extern "C" fn resolved(
    _: Ref,
    _: u32,
    _: u32,
    error: i32,
    _: *const c_char,
    host: *const c_char,
    port: u16,
    length: u16,
    txt: *const u8,
    context: *mut c_void,
) {
    // SAFETY: stable boxed context, accessed only by this worker thread.
    let context = unsafe { &mut *context.cast::<ResolveContext>() };
    context.done = true;
    context.error = error;
    if error != 0 || txt.is_null() || length > 4096 {
        return;
    }
    // SAFETY: Bonjour provides exactly length bytes valid for this callback.
    let bytes = unsafe { std::slice::from_raw_parts(txt, length as usize) };
    if let (Some(host), Some((api, model))) = (unsafe { string(host) }, txt_fields(bytes)) {
        context.value = candidate(&context.name, &host, u16::from_be(port), api, model);
    }
}

fn fault(code: i32) -> Fault {
    if code == -65570 {
        Fault::new(
            "DISCOVERY_PERMISSION",
            "區域網路搜尋權限遭拒；請在系統設定允許 Halo 2 Control 存取區域網路。",
        )
    } else {
        unavailable()
    }
}

pub(super) fn scan(deadline: Instant) -> Result<Vec<Candidate>, Fault> {
    let kind = CString::new(SERVICE.trim_end_matches(".local.")).unwrap();
    let domain = c"local.";
    let mut context = Box::<BrowseContext>::default();
    let mut reference = ptr::null_mut();
    // SAFETY: strings and boxed context remain valid; reference is output-only.
    let error = unsafe {
        DNSServiceBrowse(
            &mut reference,
            0,
            0,
            kind.as_ptr(),
            domain.as_ptr(),
            browsed,
            (&mut *context as *mut BrowseContext).cast(),
        )
    };
    if error != 0 {
        return Err(fault(error));
    }
    let browse = Handle(reference);
    let mut pending: BTreeMap<(String, u32), Pending> = BTreeMap::new();
    let mut results = Results::default();
    while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
        let refs: Vec<Ref> = std::iter::once(browse.0)
            .chain(pending.values().map(|p| p.handle.0))
            .collect();
        let mut fds: Vec<_> = refs
            .iter()
            .map(|r| libc::pollfd {
                // SAFETY: all references are owned and alive through this iteration.
                fd: unsafe { DNSServiceRefSockFD(*r) },
                events: libc::POLLIN,
                revents: 0,
            })
            .collect();
        if fds.iter().any(|fd| fd.fd < 0) {
            return Err(unavailable());
        }
        // SAFETY: contiguous initialized pollfd array, bounded timeout.
        let status = unsafe {
            libc::poll(
                fds.as_mut_ptr(),
                fds.len() as libc::nfds_t,
                remaining.as_millis().min(100) as i32,
            )
        };
        if status < 0 {
            if std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return Err(unavailable());
        }
        for (fd, reference) in fds.iter().zip(refs) {
            if fd.revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0 {
                return Err(unavailable());
            }
            if fd.revents & libc::POLLIN != 0 {
                // SAFETY: process only readable, live references on this thread.
                let error = unsafe { DNSServiceProcessResult(reference) };
                if error != 0 {
                    return Err(fault(error));
                }
            }
        }
        if context.error != 0 {
            return Err(fault(context.error));
        }
        // Resolve completions first, so a subsequent removal also removes results.
        let completed: Vec<_> = pending
            .iter()
            .filter(|(_, p)| p.context.done)
            .map(|(k, _)| k.clone())
            .collect();
        for key in completed {
            let mut p = pending.remove(&key).unwrap();
            if p.context.error == -65570 {
                return Err(fault(p.context.error));
            }
            results.update(
                format!("{}:{}", key.1, key.0.to_lowercase()),
                p.context.value.take(),
            );
        }
        for event in context.events.drain(..) {
            let key = (event.name.clone(), event.interface);
            if !event.add {
                pending.remove(&key);
                results.update(format!("{}:{}", key.1, key.0.to_lowercase()), None);
                continue;
            }
            if pending.contains_key(&key) || pending.len() + results.0.len() >= LIMIT {
                continue;
            }
            let Ok(name) = CString::new(event.name.clone()) else {
                continue;
            };
            let mut ctx = Box::new(ResolveContext {
                name: event.name,
                ..Default::default()
            });
            let mut reference = ptr::null_mut();
            // SAFETY: stable boxed context moves with its unique reference; API
            // copies name/type/domain during this call. No callback is concurrent.
            let error = unsafe {
                DNSServiceResolve(
                    &mut reference,
                    0,
                    event.interface,
                    name.as_ptr(),
                    kind.as_ptr(),
                    domain.as_ptr(),
                    resolved,
                    (&mut *ctx as *mut ResolveContext).cast(),
                )
            };
            if error == -65570 {
                return Err(fault(error));
            }
            if error == 0 {
                pending.insert(
                    key,
                    Pending {
                        handle: Handle(reference),
                        context: ctx,
                    },
                );
            }
        }
    }
    Ok(results.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn txt_is_bounded_and_rejects_duplicate_version() {
        assert_eq!(
            txt_fields(b"\x05api=1\x1amodel=screenbar-halo2-bridge"),
            Some((Some("1"), Some("screenbar-halo2-bridge")))
        );
        assert_eq!(
            txt_fields(b"\x05api=1\x1cmodel=screenbar-halo2-bridge"),
            None
        );
        assert_eq!(txt_fields(b"\x05api=1"), Some((Some("1"), None)));
        assert_eq!(txt_fields(b"\x05api=1\x05API=2"), None);
    }
}
