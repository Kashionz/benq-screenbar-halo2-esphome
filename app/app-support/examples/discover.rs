//! Read-only DNS-SD probe; no credentials or bridge HTTP/RF commands.
fn main() {
    let started = std::time::Instant::now();
    match halo2_app_support::discovery::discover() {
        Ok(results) => println!(
            "{}",
            serde_json::json!({"elapsed_ms": started.elapsed().as_millis(), "candidates": results})
        ),
        Err(error) => {
            eprintln!("{}", serde_json::to_string(&error).unwrap());
            std::process::exit(1);
        }
    }
}
