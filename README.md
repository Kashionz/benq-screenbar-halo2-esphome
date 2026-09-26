# BenQ ScreenBar HALO 2 · ESPHome radio bridge

[![Validate](https://github.com/Kashionz/benq-screenbar-halo2-esphome/actions/workflows/validate.yml/badge.svg)](https://github.com/Kashionz/benq-screenbar-halo2-esphome/actions/workflows/validate.yml)

Control a **BenQ ScreenBar HALO 2** from Home Assistant using a **BM5602** radio module and an **M5Stack ATOM Lite**. The bridge supports power, front/back light, both brightness channels, color temperature, lamp mode, ultrasonic presence mode, and state updates from the original wireless controller.

This firmware supports two validated transmit paths: the original tested pair uses BM5602 `TBCLK`-synchronized direct transmission, and a learned nine-bit-PCF pair uses the BM5602 packet engine. The original controller's state changes are received passively.

See [current project status](docs/PROJECT_STATUS.md) for the tested hardware, observations, and known limits.

## What works

- Power on/off
- Front and rear light selection
- Front brightness: 1–100
- Rear brightness: 1–100
- Color temperature: 2700–6500 K
- Ultrasonic presence mode
- Passive reception of original-controller state changes
- ESPHome API, OTA, web UI and Home Assistant REST compatibility

## Hardware

- M5Stack ATOM Lite (ESP32)
- BM5602 2.4 GHz transceiver module
- Seven wires, including the required `GIO3/TBCLK` synchronization wire
- Fine soldering tools for BM5602 pin 8

See **[Wiring and soldering](docs/WIRING.md)** before powering the boards.

## Files

| Path | Purpose |
|---|---|
| `screenbar-halo2.yaml` | Production ESPHome configuration |
| `bm5602_halo2.h` | BM5602 SPI, packet-engine/direct TX, CRC and passive RX driver |
| `halo2_address_learning.h` | Address candidate extraction and five-capture voting |
| `secrets.example.yaml` | Safe configuration template |
| `home-assistant/package.yaml` | Optional authenticated REST integration with guarded controller-state synchronization |
| `home-assistant/dashboard.yaml` | Compact stock-card dashboard |
| `home-assistant/secrets.example.yaml` | Matching Home Assistant web credentials |
| [`docs/IMPLEMENTATION_NOTES.md`](docs/IMPLEMENTATION_NOTES.md) | Radio framing, transmit paths, and physical validation |
| [`docs/ADDRESS_LEARNING.md`](docs/ADDRESS_LEARNING.md) | Original-controller address discovery and RAM-only application |
| [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) | Tested behavior, limitations, and next checks |

## Install

### 1. Copy the ESPHome files

Copy these files into the same ESPHome configuration directory:

```text
screenbar-halo2.yaml
bm5602_halo2.h
halo2_address_learning.h
```

Copy `secrets.example.yaml` to `secrets.yaml` and replace all placeholders. Generate the API key with `openssl rand -base64 32`. Use a unique web password; it protects the control/state endpoints used by the optional HA package. Never commit `secrets.yaml`.

### 2. Flash over USB

```bash
esphome run screenbar-halo2.yaml
```

After boot, the node advertises as:

```text
screenbar-halo2
screenbar-halo2.local
```

Authenticated web UI:

```text
http://screenbar-halo2/
```

Use `web_username` and `web_password` from ESPHome `secrets.yaml`. Web-based firmware upload is disabled; OTA updates use the separately protected native ESPHome OTA service.

Future updates:

```bash
esphome run screenbar-halo2.yaml --device screenbar-halo2
```

### 3. Add to Home Assistant

The simplest option is the native ESPHome integration:

1. Open **Settings → Devices & services → Add integration → ESPHome**.
2. Enter `screenbar-halo2` and port `6053`.
3. Use the exposed switches, numbers, select and buttons directly.

For the included compact dashboard and explicit polling synchronization, copy:

```text
home-assistant/package.yaml   -> config/packages/screenbar_halo2.yaml
home-assistant/dashboard.yaml -> config/dashboards/screenbar_halo2.yaml
```

Merge the two values from `home-assistant/secrets.example.yaml` into Home Assistant's `config/secrets.yaml`. They must match `web_username` and `web_password` in ESPHome.

Enable packages and register the YAML dashboard in `configuration.yaml`:

```yaml
homeassistant:
  packages: !include_dir_named packages

lovelace:
  dashboards:
    screenbar-yaml:
      mode: yaml
      title: ScreenBar
      icon: mdi:monitor-shimmer
      show_in_sidebar: true
      filename: dashboards/screenbar_halo2.yaml
```

Validate before restarting:

```bash
ha core check
ha core restart
```

The package accesses authenticated endpoints below `http://screenbar-halo2/...`; no fixed IP is embedded. A synchronization guard prevents received controller state from being echoed back as a new command, and HA startup waits for a valid bridge state instead of overwriting the lamp with restored helper values.

## Radio details

Tested configuration:

```text
Channel:              5 / 2405 MHz
Register address:     9C EA BB 86
Direct air address:   86 BB EA 9C
Data path:            GIO2 / GPIO33
Synchronization:      GIO3 TBCLK / GPIO25
Bit order:            MSB first
Data update edge:     TBCLK low
CRC:                  CRC-CCITT, polynomial 0x1021
CRC initial state:    0xEFDF before the four-byte on-air address
```

The original tested lamp uses address `9C EA BB 86` and the eight-bit-model CRC
initial state `EFDF`. A second tested pair uses address `B0 1E E8 E6` and a
leading zero bit before the canonical PCF. Its effective eight-bit-model CRC
initial state is `CC88`; the complete nine-bit frame uses `FFFF`. Address
learning derives the address and frame format from original-controller traffic;
these values remain in RAM until reboot.

For an unknown address, use the [address learning procedure](docs/ADDRESS_LEARNING.md)
to capture the original controller and apply a five-capture candidate in RAM.
After applying the address, operate the original controller until five frames
agree on a CRC initial state, then test physical ON/OFF. The second pair's web
Power ON and OFF were both confirmed on the lamp; other pairs still require
hardware validation.

### RX state rule

Only even-PID request frames are treated as authoritative controller state. Odd-PID lamp replies are deliberately ignored for synchronization: their control byte is response metadata and can differ from the requested state.

## Reliability notes

- RX polling is deliberately limited to 50 ms. Aggressive synchronous 10 ms FIFO draining can starve ESPHome API, HTTP and OTA while ICMP still appears alive.
- Transmission always returns the BM5602 to passive RX mode.
- Passive RX captures 14 FIFO bytes, aligns the complete 13-byte frame, and accepts only even-PID stock requests with a valid CRC and in-range brightness/temperature values.
- Learned RX frames can identify a leading zero bit before the canonical PCF; direct TX includes that bit when the received CRC confirms the format.
- Learned nine-bit PCF pairs use the BM5602 packet engine for normal web commands. A captured controller OFF payload and subsequent web Power ON/OFF physically changed the second tested lamp. Web OFF/ON still worked after about ten minutes idle; both reported `IRQ=2E`, `FIFO=11`, and `TX_DS=1`. Longer-term operation has not yet been measured.
- The native ESPHome API uses encryption. HTTP control uses unique basic-auth credentials, and web OTA is disabled.
- Local transmission success is not described as a lamp acknowledgement. The original pair was validated using the transmitted frame, an independently received lamp response, and visible lamp reaction; the second pair was validated by physical web Power ON/OFF and exact original-controller OFF replay.
- A diagnostic **Test power sync (02 + 04)** button can compare a single Power command with an update followed by repeated status requests on a newly learned pair.
- **Replay captured remote OFF** can transmit a CRC-valid original-controller power-off request unchanged after the lamp has been turned back on, isolating TX from payload generation.

## Prior art and research

The interoperability work was informed by the public BM5602 examples and by [kuzmin-no/BenQ_ScreenBar_HALO_2_HA_integration](https://github.com/kuzmin-no/BenQ_ScreenBar_HALO_2_HA_integration). This repository provides an independently implemented ESP-IDF/ESPHome C++ driver with direct and packet-engine TX, the recovered framing/CRC behavior, and the Home Assistant integration used by this project.

See **[Radio transmission modes and validation](docs/IMPLEMENTATION_NOTES.md)** for the architectural differences, failed hypotheses, recovered frame format, and end-to-end validation criteria.

## Disclaimer

This is an unofficial community project and is not affiliated with or endorsed by BenQ. BenQ and ScreenBar are trademarks of their respective owner. Modifying hardware can damage it and may void its warranty.

## License

MIT. See [LICENSE](LICENSE).
