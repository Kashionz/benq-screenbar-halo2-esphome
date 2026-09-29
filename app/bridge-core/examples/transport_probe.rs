//! Bounded GET-only probe using the App's HTTP settings. Never sends lamp commands.
use reqwest::{Client, Url};
use serde_json::{json, Value};
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis()
}

fn check_ports(host: &str) {
    let Ok(ip) = host.parse::<IpAddr>() else {
        println!(
            "{}",
            json!({"kind":"tcp_followup_skipped", "reason":"non_numeric_host"})
        );
        return;
    };
    // One connection to each server, concurrently, only after the failed GET.
    // This is a reachability sample after failure, not a replay of the request.
    std::thread::scope(|scope| {
        for port in [80, 8080] {
            scope.spawn(move || {
                let started = Instant::now();
                let result =
                    TcpStream::connect_timeout(&SocketAddr::new(ip, port), Duration::from_secs(2));
                println!(
                    "{}",
                    json!({"kind":"tcp_followup", "unix_ms":now_ms(),
                    "port":port,"ok":result.is_ok(),"elapsed_ms":started.elapsed().as_millis(),
                    "io_kind":result.as_ref().err().map(|e|format!("{:?}",e.kind()))})
                );
                drop(result);
            });
        }
    });
}

fn report_error(error: &reqwest::Error, phase: &str, started: Instant, sample: usize) {
    // Never print Display/Debug: reqwest errors may contain the authenticated URL.
    let mut io_kind = None;
    let mut cause = std::error::Error::source(error);
    while let Some(value) = cause {
        if let Some(io) = value.downcast_ref::<std::io::Error>() {
            io_kind = Some(format!("{:?}", io.kind()));
        }
        cause = value.source();
    }
    println!(
        "{}",
        json!({"kind":"transport_error", "sample":sample,"unix_ms":now_ms(),
        "phase":phase,"elapsed_ms":started.elapsed().as_millis(),
        "timeout":error.is_timeout(),"connect":error.is_connect(),
        "body":error.is_body(),"request":error.is_request(),"io_kind":io_kind})
    );
}

#[tokio::main]
async fn main() {
    let interval = match std::env::args().nth(1).as_deref() {
        None => 2,
        Some("--one-second") => 1,
        _ => {
            eprintln!("usage: transport_probe [--one-second]");
            std::process::exit(2);
        }
    };
    let host = std::env::var("HALO2_HOST").expect("HALO2_HOST required");
    let username = std::env::var("HALO2_USERNAME").expect("HALO2_USERNAME required");
    let password = std::env::var("HALO2_PASSWORD").expect("HALO2_PASSWORD required");
    println!(
        "{}",
        json!({"kind":"start", "numeric_ip":host.parse::<IpAddr>().is_ok(),"interval_seconds":interval,"rf_sent":false})
    );
    let mut url = Url::parse("http://localhost:8080/api/v1/state").unwrap();
    if url.set_host(Some(&host)).is_err() {
        println!("{}", json!({"kind":"invalid_host"}));
        return;
    }
    let client = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(4))
        .build()
        .expect("HTTP client construction");
    let mut baseline: Option<(Value, Value)> = None;
    let mut maximum_ms = 0;
    for sample in 1..=120 {
        let started = Instant::now();
        let sent = client
            .get(url.clone())
            .basic_auth(&username, Some(&password))
            .header("Accept", "application/json")
            .send()
            .await;
        let mut response = match sent {
            Ok(value) => value,
            Err(error) => {
                report_error(&error, "send_or_headers", started, sample);
                check_ports(&host);
                return;
            }
        };
        let status = response.status().as_u16();
        let connection_close = response
            .headers()
            .get("connection")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.eq_ignore_ascii_case("close"));
        let mut bytes = Vec::new();
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) if bytes.len() + chunk.len() <= 8192 => {
                    bytes.extend_from_slice(&chunk)
                }
                Ok(Some(_)) => {
                    println!("{}", json!({"kind":"oversize", "sample":sample}));
                    return;
                }
                Ok(None) => break,
                Err(error) => {
                    report_error(&error, "response_body", started, sample);
                    check_ports(&host);
                    return;
                }
            }
        }
        let value: Value = match serde_json::from_slice(&bytes) {
            Ok(value) if status == 200 => value,
            _ => {
                println!(
                    "{}",
                    json!({"kind":"http_or_json_error", "status":status,"sample":sample})
                );
                return;
            }
        };
        let identity = (value["device_id"].clone(), value["boot_id"].clone());
        if identity.0.as_str().is_none() || identity.1.as_str().is_none() {
            println!("{}", json!({"kind":"invalid_identity", "sample":sample}));
            return;
        }
        let same_boot = baseline.get_or_insert_with(|| identity.clone()) == &identity;
        let elapsed_ms = started.elapsed().as_millis();
        maximum_ms = maximum_ms.max(elapsed_ms);
        println!(
            "{}",
            json!({"kind":"state", "sample":sample,
            "unix_ms":SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis(),
            "elapsed_ms":elapsed_ms,"same_device_and_boot":same_boot,
            "revision":value["control_revision"],"radio":value["radio_status"],"connection_close":connection_close})
        );
        if !same_boot {
            return;
        }
        if sample < 120 {
            tokio::time::sleep(Duration::from_secs(interval)).await;
        }
    }
    println!(
        "{}",
        json!({"kind":"complete", "samples":120,"max_elapsed_ms":maximum_ms,"rf_sent":false})
    );
}
