//! Supervised native credential-store verification; never transmits RF.
use halo2_app_support::{
    diagnostics::{Diagnostics, Event},
    profiles::{NativeCredentials, Profiles},
};
use halo2_bridge_core::Bridge;
use std::path::PathBuf;

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    assert_eq!(
        args.len(),
        3,
        "usage: saved_bridge_probe <save|restore|forget> <test-directory>"
    );
    let directory = PathBuf::from(&args[2]);
    let store = Profiles::new(directory.join("connection.json"), NativeCredentials);
    match args[1].as_str() {
        "save" => {
            let host = std::env::var("HALO2_HOST").expect("HALO2_HOST");
            let username = std::env::var("HALO2_USERNAME").expect("HALO2_USERNAME");
            let password = std::env::var("HALO2_PASSWORD").expect("HALO2_PASSWORD");
            let (_, state) = Bridge::connect(&host, 8080, username.clone(), password.clone())
                .await
                .expect("read-only connect");
            store
                .save(&host, 8080, &username, &state.device_id, &password)
                .expect("save into native credential store");
            let text = std::fs::read_to_string(directory.join("connection.json")).unwrap();
            assert!(
                !text.contains(&password),
                "password must not be written into JSON"
            );
            println!("native credential stored; JSON excludes password");
        }
        "restore" => {
            let profile = store.saved().unwrap().expect("saved connection");
            let password = store
                .password(&profile)
                .expect("native credential restored");
            let (_, state) =
                Bridge::connect(&profile.host, profile.port, profile.username, password)
                    .await
                    .expect("read-only restored connect");
            assert_eq!(state.device_id, profile.device_id);
            let mut log = Diagnostics::new(directory.join("diagnostics.json")).unwrap();
            log.append(Event::state(&state)).unwrap();
            let exported = log.export(&directory).unwrap();
            println!(
                "restored identity matched; radio={}; read-only; export={}",
                state.radio_status,
                exported.display()
            );
        }
        "forget" => {
            let old = store.saved().unwrap();
            store.forget().unwrap();
            assert!(store.saved().unwrap().is_none());
            if let Some(old) = old {
                assert!(store.password(&old).is_err());
            }
            println!("saved metadata and native credential removed");
        }
        _ => panic!("unknown action"),
    }
}
