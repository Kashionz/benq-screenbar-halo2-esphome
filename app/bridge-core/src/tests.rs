use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

fn fixture(schema: &str) -> Value {
    let examples: Vec<Value> =
        serde_json::from_str(include_str!("../../../protocol/v1/examples.json")).unwrap();
    examples
        .into_iter()
        .find(|e| e["schema"] == schema)
        .unwrap()["body"]
        .clone()
}

#[test]
fn reject_urls_and_credentials_in_host() {
    for host in [
        "",
        "http://example.com",
        "user:secret@host",
        "host/path",
        "host?x",
        "a b",
        "host:8080",
    ] {
        assert!(endpoint(host, 8080).is_err());
    }
    assert_eq!(
        endpoint("192.168.0.99", 8080).unwrap().as_str(),
        "http://192.168.0.99:8080/api/v1/"
    );
    assert_eq!(
        endpoint("::1", 8080).unwrap().as_str(),
        "http://[::1]:8080/api/v1/"
    );
}

#[test]
fn decode_contract_snapshot_and_unknown_fields() {
    let mut value = fixture("Snapshot");
    value["future_extension"] = json!(true);
    let state: Snapshot = decode(value).unwrap();
    assert_eq!(state.lamp_confirmation, "unavailable");
}

#[test]
fn light_patch_validates_ranges_and_capabilities() {
    let features = json!({"mode":"experimental", "temperature_k":"experimental", "front_brightness":"verified"});
    let mode = StatePatch {
        mode: Some("both".into()),
        ..Default::default()
    };
    assert_eq!(
        mode.validate(&features, false).unwrap_err().code,
        "EXPERIMENTAL_DISABLED"
    );
    assert_eq!(
        mode.validate(&features, true).unwrap(),
        json!({"mode":"both"})
    );
    assert!(StatePatch::default().validate(&features, true).is_err());
    for value in [2699, 3926, 6501] {
        assert!(StatePatch {
            temperature_k: Some(value),
            ..Default::default()
        }
        .validate(&features, true)
        .is_err());
    }
    for value in [0, 101, 255] {
        assert!(StatePatch {
            front_brightness: Some(value),
            ..Default::default()
        }
        .validate(&features, true)
        .is_err());
    }
    assert!(StatePatch {
        back_brightness: Some(50),
        ..Default::default()
    }
    .validate(&features, true)
    .is_err());
    assert!(serde_json::from_value::<StatePatch>(json!({"unknown":1})).is_err());
}

fn record(id: &str, boot: &str, status: &str) -> Value {
    json!({"command_id":id,"boot_id":boot,"status":status,"effect":"unconfirmed",
        "target":fixture("Snapshot")["desired"]["values"],"error":null,
        "tx":{"frames_planned":1,"frames_attempted":1,"frames_transmitted":1,"irq":46,"fifo":17,"mode":2}})
}

#[test]
fn unknown_status_and_wrong_identity_are_not_success() {
    for status in ["confirmed", "future_success"] {
        assert!(terminal(decode(record("id", "boot", status)).unwrap(), "id", "boot").is_err());
    }
    assert!(terminal(
        decode(record("other", "boot", "transmitted")).unwrap(),
        "id",
        "boot"
    )
    .is_err());
    let mut malformed = record("id", "boot", "transmitted");
    malformed["tx"]["frames_transmitted"] = json!(0);
    assert!(terminal(decode(malformed).unwrap(), "id", "boot").is_err());
}

// Real TCP fixture exercises redirects, lost POST responses and lookup-only recovery.
fn server(
    post_behavior: &'static str,
    count: usize,
) -> (u16, Arc<Mutex<Vec<String>>>, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let copy = calls.clone();
    let worker = std::thread::spawn(move || {
        let mut last: Value = Value::Null;
        for _ in 0..count {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut data = Vec::new();
            let mut one = [0u8; 1];
            while !data.ends_with(b"\r\n\r\n") {
                socket.read_exact(&mut one).unwrap();
                data.push(one[0]);
            }
            let headers = String::from_utf8(data).unwrap();
            let first = headers.lines().next().unwrap().to_owned();
            copy.lock().unwrap().push(first.clone());
            let length = headers
                .lines()
                .find_map(|l| {
                    l.to_lowercase()
                        .strip_prefix("content-length: ")
                        .map(|s| s.parse::<usize>().unwrap())
                })
                .unwrap_or(0);
            let mut body = vec![0; length];
            socket.read_exact(&mut body).unwrap();
            let (status, value) = if first.contains("/info ") {
                (200, fixture("DeviceInfo"))
            } else if first.contains("/state ") {
                (200, fixture("Snapshot"))
            } else if first.starts_with("POST") {
                last = serde_json::from_slice(&body).unwrap();
                if post_behavior == "lost" {
                    continue;
                }
                if post_behavior == "conflict" {
                    (409, json!({"error":{"code":"REVISION_CONFLICT"}}))
                } else {
                    (
                        202,
                        record(
                            last["command_id"].as_str().unwrap(),
                            last["boot_id"].as_str().unwrap(),
                            "accepted",
                        ),
                    )
                }
            } else {
                (
                    200,
                    record(
                        last["command_id"].as_str().unwrap(),
                        last["boot_id"].as_str().unwrap(),
                        "transmitted",
                    ),
                )
            };
            let body = serde_json::to_vec(&value).unwrap();
            let mut response=format!("HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len()).into_bytes();
            response.extend_from_slice(&body);
            socket.write_all(&response).unwrap();
            // Gracefully finish the response before dropping the Windows socket.
            // Immediate close can reset the connection before the client reads it.
            socket.shutdown(std::net::Shutdown::Write).unwrap();
            let mut tail = [0u8; 128];
            while matches!(socket.read(&mut tail), Ok(n) if n > 0) {}
        }
    });
    (port, calls, worker)
}

#[tokio::test]
async fn one_post_then_lookup() {
    let (port, calls, worker) = server("accepted", 5);
    let (mut bridge, _) = Bridge::connect("127.0.0.1", port, "test".into(), "secret".into())
        .await
        .unwrap();
    assert_eq!(bridge.power(false).await.unwrap().status, "transmitted");
    worker.join().unwrap();
    assert_eq!(
        calls
            .lock()
            .unwrap()
            .iter()
            .filter(|s| s.starts_with("POST"))
            .count(),
        1
    );
}

#[tokio::test]
async fn lost_post_response_blocks_new_write_and_recovers_by_lookup() {
    let (port, calls, worker) = server("lost", 5);
    let (mut bridge, _) = Bridge::connect("127.0.0.1", port, "test".into(), "secret".into())
        .await
        .unwrap();
    assert_eq!(
        bridge.power(false).await.unwrap_err().code,
        "UNKNOWN_OUTCOME"
    );
    assert_eq!(
        bridge.power(true).await.unwrap_err().code,
        "UNKNOWN_OUTCOME"
    );
    assert_eq!(
        bridge.lookup_pending().await.unwrap().unwrap().status,
        "transmitted"
    );
    worker.join().unwrap();
    assert_eq!(
        calls
            .lock()
            .unwrap()
            .iter()
            .filter(|s| s.starts_with("POST"))
            .count(),
        1
    );
}

#[tokio::test]
async fn revision_conflict_does_not_refresh_and_overwrite() {
    let (port, calls, worker) = server("conflict", 4);
    let (mut bridge, _) = Bridge::connect("127.0.0.1", port, "test".into(), "secret".into())
        .await
        .unwrap();
    assert_eq!(
        bridge.power(false).await.unwrap_err().code,
        "REVISION_CONFLICT"
    );
    worker.join().unwrap();
    assert_eq!(calls.lock().unwrap().len(), 4);
}
