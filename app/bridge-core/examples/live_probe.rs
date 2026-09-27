use halo2_bridge_core::{Bridge, StatePatch};

#[tokio::main]
async fn main() {
    let host = std::env::var("HALO2_HOST").expect("HALO2_HOST");
    let username = std::env::var("HALO2_USERNAME").expect("HALO2_USERNAME");
    let password = std::env::var("HALO2_PASSWORD").expect("HALO2_PASSWORD");
    let (mut bridge, state) = Bridge::connect(&host, 8080, username, password)
        .await
        .expect("connect");
    println!(
        "device={} radio={} pairing={}",
        state.device_id, state.radio_status, state.pairing_status
    );
    println!("state={}", serde_json::to_string(&state).unwrap());
    // No RF without an explicit power flag or JSON patch.
    if let Some(argument) = std::env::args().nth(1) {
        let result = match argument.as_str() {
            "--power-on" => bridge.power(true).await,
            "--power-off" => bridge.power(false).await,
            "--patch" => {
                let patch: StatePatch =
                    serde_json::from_str(&std::env::args().nth(2).expect("JSON patch"))
                        .expect("valid patch");
                bridge.set_state(patch, true).await
            }
            _ => panic!("unknown argument"),
        }
        .expect("command");
        println!("{}", serde_json::to_string(&result).unwrap());
        assert_eq!(result.status, "transmitted");
    }
}
