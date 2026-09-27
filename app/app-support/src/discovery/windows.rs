use super::*;
use mdns_sd::{ServiceDaemon, ServiceEvent};

struct Daemon(ServiceDaemon);
impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = self.0.stop_browse(SERVICE);
        let _ = self.0.shutdown();
    }
}

pub(super) fn scan(deadline: Instant) -> Result<Vec<Candidate>, Fault> {
    let daemon = Daemon(ServiceDaemon::new().map_err(|_| unavailable())?);
    let events = daemon.0.browse(SERVICE).map_err(|_| unavailable())?;
    let mut results = Results::default();
    while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
        match events.recv_timeout(remaining) {
            Ok(ServiceEvent::ServiceResolved(service)) => {
                let name = service
                    .fullname
                    .strip_suffix(SERVICE)
                    .unwrap_or("")
                    .trim_end_matches('.');
                let value = candidate(
                    name,
                    service.get_hostname(),
                    service.get_port(),
                    service.get_property_val_str("api"),
                    service.get_property_val_str("model"),
                );
                results.update(service.fullname.to_ascii_lowercase(), value);
            }
            Ok(ServiceEvent::ServiceRemoved(_, name)) => {
                results.update(name.to_ascii_lowercase(), None)
            }
            Ok(ServiceEvent::SearchStopped(_)) => return Err(unavailable()),
            Ok(_) => (),
            Err(mdns_sd::RecvTimeoutError::Timeout) => break,
            Err(_) => return Err(unavailable()),
        }
    }
    Ok(results.finish())
}
