//! Read-only LAN soak probe. Credentials stay in environment/memory.
use halo2_bridge_core::Bridge;
use serde_json::json;
use std::{collections::BTreeMap, path::PathBuf, time::Instant};

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    assert_eq!(args.len(), 3, "usage: soak <samples> <report.json>");
    let samples: u64 = args[1].parse().expect("sample count");
    assert!((1..=43200).contains(&samples), "samples must be 1..43200");
    let path = PathBuf::from(&args[2]);
    assert!(!path.exists(), "report already exists; choose a new path");
    let (bridge, initial) = Bridge::connect(
        &std::env::var("HALO2_HOST").expect("HALO2_HOST"),
        8080,
        std::env::var("HALO2_USERNAME").expect("HALO2_USERNAME"),
        std::env::var("HALO2_PASSWORD").expect("HALO2_PASSWORD"),
    )
    .await
    .expect("initial read-only connection");
    let started = Instant::now();
    let mut boot = initial.boot_id.clone();
    let mut successful = 0u64;
    let mut network_failures = 0u64;
    let mut other_failures = 0u64;
    let mut boot_changes = 0u64;
    let mut not_ready = 0u64;
    let mut max_latency_ms = 0u128;
    let mut latency_sum_ms = 0u128;
    let mut streak = 0u64;
    let mut longest_failure_streak = 0u64;
    let mut radio_states = BTreeMap::<String, u64>::new();
    for sample in 1..=samples {
        let request_started = Instant::now();
        match bridge.snapshot().await {
            Ok(state) => {
                successful += 1;
                streak = 0;
                if state.boot_id != boot {
                    boot_changes += 1;
                    boot = state.boot_id;
                }
                if state.radio_status != "ready" || state.pairing_status != "ready" {
                    not_ready += 1;
                }
                let label = match state.radio_status.as_str() {
                    "ready" | "fault" | "learning" | "unavailable" => state.radio_status,
                    _ => "unknown".into(),
                };
                *radio_states.entry(label).or_default() += 1;
            }
            Err(error) => {
                if error.code == "NETWORK" {
                    network_failures += 1;
                } else {
                    other_failures += 1;
                }
                streak += 1;
                longest_failure_streak = longest_failure_streak.max(streak);
            }
        }
        let latency = request_started.elapsed().as_millis();
        latency_sum_ms += latency;
        max_latency_ms = max_latency_ms.max(latency);
        let report = json!({
            "format": "halo2-lan-soak-v1", "read_only": true,
            "device_id": initial.device_id, "initial_boot_id": initial.boot_id,
            "last_boot_id": boot, "samples_planned": samples, "samples_completed": sample,
            "complete": sample == samples, "elapsed_ms": started.elapsed().as_millis(),
            "successful": successful, "network_failures": network_failures,
            "other_failures": other_failures, "boot_changes": boot_changes,
            "not_ready": not_ready, "radio_states": radio_states,
            "longest_failure_streak": longest_failure_streak,
            "mean_latency_ms": latency_sum_ms / u128::from(sample),
            "max_latency_ms": max_latency_ms
        });
        // Checkpoints preserve evidence if the supervised process is interrupted.
        std::fs::write(&path, serde_json::to_vec_pretty(&report).unwrap()).expect("write report");
        if sample == 1 || sample % 30 == 0 || sample == samples {
            println!("sample={sample}/{samples} ok={successful} network={network_failures} other={other_failures} boot_changes={boot_changes} not_ready={not_ready}");
        }
        if sample < samples {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    }
    println!("read-only report: {}", path.display());
}
