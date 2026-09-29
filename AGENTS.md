# AGENTS.md

Two deliverables share this repo: ESPHome firmware for an ESP32 + BM5602 radio bridge (root YAML/headers plus `components/halo2_api/`), and a Tauri 2 app in `app/` that controls the bridge over its port-8080 HTTP API. Changes here can drive a physical lamp.

## Commands

Mirror CI; these are authoritative.

Firmware and protocol, from the repo root (`.github/workflows/validate.yml`):

- `pip install esphome==2026.9.0 -r protocol/v1/requirements-dev.txt` — CI pins this ESPHome version.
- `python tools/validate_app_protocol.py`
- `python -m unittest discover -s tests -v` — run from the root; tests import `tools.*`.
- `tests/test_dispatcher.cpp` and `tests/test_address_learning.cpp`: `g++ -std=c++17 -Wall -Wextra -pedantic <file> -o <out>`, then run the binary.
- `esphome config screenbar-halo2.yaml` and `esphome compile screenbar-halo2.yaml`. These need `secrets.yaml`. If it is missing, create the compile-only file shown in `validate.yml`. If it exists, it holds real credentials: do not read, print, or overwrite it.
- `tests/test_app_codec.cpp` needs ArduinoJson from `.esphome/build/...`, so it runs only after a compile. Copy the exact steps from `validate.yml`.

App, from `app/` (`.github/workflows/app.yml`):

- `npm ci`, `npm run build`, `npm test`
- `cargo fmt --all -- --check`
- `cargo test --locked -p halo2-bridge-core` and `cargo test --locked -p halo2-app-support`
- `cargo clippy --locked -p <crate> --all-targets -- -D warnings`, once for each of those two crates
- `npm run tauri build -- --debug --no-bundle`

The dev machine runs Windows. macOS and iOS builds are checked only in `.github/workflows/apple.yml`.

## Hardware and RF safety

- Unless the user asks for it in this session, do not flash the firmware or run anything that transmits RF. That covers `esphome run`/upload/OTA, `tools/check_app_api.py --exercise-power`, `tools/check_rf_stability.py --send-rf`, `tools/halo2_client.py set`, and `app/bridge-core/examples/live_probe.rs` with `--power-on`, `--power-off` or `--patch`.
- Never add automatic retry, replay, or compensating commands for a POST or an RF transmission, whether in firmware, app, or tools. When an outcome is unknown, look up the original `command_id`/`boot_id`. See `protocol/v1/acceptance.md` A02, A07 and A22.
- Every control path goes through the shared dispatcher in `components/halo2_api/dispatcher.h`: web UI, Home Assistant, the App, and the YAML buttons. RF debug buttons in `screenbar-halo2.yaml` run inside `Maintenance lease`. Do not add a TX path that bypasses either one.
- Keep RX polling at 50 ms and `wifi: power_save_mode: none`. The README and `docs/PROJECT_STATUS.md` explain why.
- Do not change RF parameters (channel, retries, calibration) in the normal flow without hardware evidence. The VCO calibration attempt failed on hardware and was reverted (`docs/RF_STABILITY.md`).

## Evidence and status claims

- `transmitted`/`TX_DS` means the bridge sent the frame. It is not a lamp acknowledgement. In docs, commits, and UI text, claim lamp behavior, stability, or platform acceptance only when a human observation is recorded. A CI or simulator build does not count as device acceptance.
- Record hardware results in `docs/PROJECT_STATUS.md`, `docs/DEVELOPMENT_ACCEPTANCE.md`, `docs/RF_STABILITY.md` or `docs/LAN_DISCOVERY.md`. Keep failed and historical results; do not rewrite them as passes.
- Raw local reports and logs belong in the git-ignored `.esphome/`. Commit only sanitized summaries (`docs/evidence/`) with no device or boot UUIDs, hosts, IPs, or credentials.

## Protocol contract

`protocol/v1/schema.json` and `protocol/v1/examples.json` define the wire contract. Hand-written mirrors live in `components/halo2_api/codec.h`, `components/halo2_api/dispatcher.h`, `app/bridge-core/src/lib.rs` and `app/src/bridge.ts`. The Python validator, the Rust tests, and the frontend tests all load `examples.json`. When a protocol change touches one of these, update the rest in the same change, and check it against `protocol/v1/acceptance.md`.

## Secrets and privacy

- Templates are `secrets.example.yaml` and `home-assistant/secrets.example.yaml`. Never commit `secrets.yaml`.
- Never pass passwords as CLI arguments or in URLs. Tools take them from a prompt or from `HALO2_USERNAME`/`HALO2_PASSWORD`. The App keeps passwords only in the OS credential store, never in JSON, diagnostics, or the frontend.
- Do not embed credentials or a pairing address in the App. Do not add Tauri commands that proxy arbitrary URLs, file paths, or shell commands (`app/README.md`, "架構與錯誤語意").

## Generated files

- To change `app/src-tauri/icons/*`, edit `app/app-icon.svg` and run `npm run tauri icon -- app-icon.svg --ios-color '#e9ebef'` in `app/`. Then render `docs/design_handoff_halodesk_liuli/icons/app-icon-small.svg` at 32 px (`-o <tmp> -p 32`) and copy it over `icons/32x32.png` and the tray icon `icons/tray.png`. Do not hand-edit the icons.
- `app/src-tauri/gen/` is output from Tauri (`tauri ios init` and schema generation). Do not hand-edit or commit it.

## Conventions

- New firmware files must be added to the copy list in the README "Install" section, because users deploy by copying files by hand.
- Write docs in the file's existing language. `app/README.md` and most `docs/*.md` are in Traditional Chinese; `README.md`, `docs/PROJECT_STATUS.md` and `docs/IMPLEMENTATION_NOTES.md` are in English.
- Commit subjects use `feat:`, `fix:`, `docs:`, `test:`, `ci:` or `chore:` with an imperative English summary. The body states what was verified and what remains unverified.
