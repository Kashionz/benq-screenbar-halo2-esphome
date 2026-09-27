use halo2_bridge_core::Bridge;

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
    // No RF unless the caller explicitly supplies --power-on or --power-off.
    if let Some(argument) = std::env::args().nth(1) {
        let power = match argument.as_str() {
            "--power-on" => true,
            "--power-off" => false,
            _ => panic!("unknown argument"),
        };
        let result = bridge.power(power).await.expect("command");
        println!("{}", serde_json::to_string(&result).unwrap());
        assert_eq!(result.status, "transmitted");
    }
}
