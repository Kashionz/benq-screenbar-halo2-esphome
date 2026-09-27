# Project status (2026-09-27)

Latest bounded hardware acceptance: [2026-09-27 validation](VALIDATION_2026-09-27.md).
The polling API's 23 live checks now pass with Wi-Fi power saving disabled;
historical failures below are retained as diagnostic context. Long-term and
Apple-platform validation remain pending.

This document records what was observed on hardware during development of the
Halo 2 ESPHome bridge. It distinguishes a transmitted packet from a visible
lamp response. The project is a personal fork of
[Termina1/benq-screenbar-halo2-esphome](https://github.com/Termina1/benq-screenbar-halo2-esphome).

## App protocol development checkpoint (2026-09-27)

The polling implementation and shared dispatcher are now in
`components/halo2_api/`; usage and scope are described in
[APP_PROTOCOL_IMPLEMENTATION.md](APP_PROTOCOL_IMPLEMENTATION.md).
This is a development checkpoint, not a completed physical-control release.

- Firmware compiled successfully with ESPHome 2026.9.0 and was uploaded over
  COM3 at 115200 baud. The API starts on port 8080, separately from the existing
  port-80 web UI, using the same configured credentials.
- Hardware HTTP checks passed for info/state schemas, authentication on all
  route families, unknown paths, wrong methods/media types, oversized bodies,
  invalid/null/duplicate fields, old boot IDs, and missing command records
  (17 checks). These checks intentionally do not transmit RF.
- Reboot checks confirmed that device_id remains unchanged, boot_id changes,
  lookup using the old boot returns BOOT_CHANGED, the pairing remains saved,
  and active/last command and remote observation are empty after boot.
- Host checks passed: 15 Python tests, the C++ dispatcher/JSON codec/address
  learning programs, 6 contract-validation groups, and 5 actual C++ encoder
  response fixtures checked against the JSON Schema. CI has been updated;
  these are local results, not a claim about a GitHub Actions run.
- The first power exercise was accepted, executed once, and reported
  `failed / unconfirmed / TX_TIMEOUT`, IRQ `0E`, FIFO `01`, mode `5`.
  The driver previously sampled after a fixed 10 ms; it now polls for TX_DS
  or MAX_RT for at most 250 ms, without triggering another transmission.
- A subsequent power exercise reported `failed / not_attempted /
  TX_FIFO_STUCK`, FIFO `01`. No TX trigger was issued for that command.
  The final adapter change latches this known fault so periodic pairing
  metadata updates cannot immediately label it ready again. This final
  fault-state change was uploaded over COM3 at 115200 baud with flash hash
  verification after the user confirmed a physical bridge USB power cycle.
- After that cold power cycle and upload, the reboot checks passed again:
  stable device ID, new boot ID, old-boot rejection, saved pairing restored,
  and no active/last command on boot. The next OFF command passed FIFO
  preparation and triggered TX once, but returned `failed / unconfirmed /
  TX_MAX_RETRIES`, IRQ `1E`, FIFO `01`, mode `2` (27 ms execution).
  The exercise stopped at that failure without sending a reverse command.
  All 17 non-transmitting HTTP contract checks passed again afterward.
  This clears the previous pre-TX FIFO obstruction for that attempt; it
  does not establish restored lamp control or a durable radio fix.
  The user confirmed the lamp was already off during that OFF attempt, so
  its physical effect cannot be determined. Original-controller operations
  still updated the web state; the API also showed valid remote observations.
  A subsequent explicit ON command returned `failed / not_attempted /
  TX_FIFO_STUCK` (FIFO `01`, zero frames attempted), reproducing the TX FIFO
  obstruction after the MAX_RT failure despite working remote RX.
  The user confirmed the lamp did not turn on. A recovery candidate now
  enables/waits for XCLK, bounds FIFO-clear polling, and pulses RC1.RSTLL
  once if the pre-TX flush still fails, then reapplies packet configuration.
  It does not replay a failed transmission. After compilation and COM3
  upload with flash hash verification, the hardware log showed
  `LOGIC RECOVERY rc1=30 fifo=01 mode=2`, followed by
  `LOGIC RECOVERY FIFO=11 RC1=30`. The subsequent explicit ON request
  completed as `transmitted / unconfirmed`, IRQ `2E`, FIFO `11`, mode `2`,
  one frame attempted/transmitted, in 29 ms. No additional USB power cycle
  was needed for that recovery. The user confirmed that ON physically lit
  the lamp. A following OFF/ON API exercise returned TX_DS for both commands
  (`IRQ=2E`, `FIFO=11`). The OFF result, identical duplicate, reordered-key
  duplicate and changed-body rejection passed. The ON result and identical
  duplicate passed, but its reordered-key duplicate hit an HTTP connection
  timeout, stopping the full exercise before its final checks. Three later
  state reads showed the same boot ID, radio ready and the completed ON
  record. This is partial live contract evidence, not a 23-check pass or
  long-term network-stability validation.
  RC1 clock/reset
  and FIFO semantics are documented in the
  [BC5602 v1.20 datasheet](https://www.holtek.com/webapi/116711/BC5602v120.pdf),
  pages 8, 10 and 29.
  Do not relearn or overwrite the verified pair
  in response to this failure. Physical OFF and legacy-web arbitration on
  hardware remain unverified for this development version. Successful
  command deduplication has the partial live evidence described above;
  the host dispatcher tests are separate evidence.
- Network connections were intermittently unavailable during testing, including
  on port 80 and 6053, while the main loop still logged RX counters. One reset
  was followed by an unreachable API before any test requests, so causation
  by request load has not been established. The API now uses the same
  shutdown-before-close protection as ESPHome's web server. Later authenticated
  state reads and reboot checks succeeded; this does not establish long-term
  network stability.

SSE, the Tauri/Rust client, Windows/macOS/iOS integration, original-controller
interleaving, and the 24-hour stability gate remain pending. The Python command
client is a development test tool, not the cross-platform product.

## Hardware and verified wiring

- M5Stack ATOM Lite (ESP32), BCT-5602-001 / BM5602-60-1, ScreenBar Halo 2,
  and its original wireless controller.
- The BCT module uses pin 1 GND, pin 2 3V3, pin 4 CSN to GPIO22, pin 5 SCK
  to GPIO23, pin 6 SDIO to GPIO19, pin 8 GIO2 to GPIO33, and pin 9 GIO3/TBCLK
  to GPIO25. Pin 7 is unused. See [WIRING.md](WIRING.md).
- The radio reported chip version `56 02 01`; SPI, direct-data, and TBCLK
  wiring were exercised on the attached device.

## Verified protocol behavior

| Area | Observation |
| --- | --- |
| Address discovery | Five matching original-controller captures identified `B0 1E E8 E6` in BM5602 register order. |
| Passive normal RX | A 14-byte FIFO read and one-bit alignment recover a 13-byte frame. Valid original-controller requests update the web `Lamp state`. |
| CRC/framing | Five valid captures agreed on effective eight-bit-model seed `CC88`. A leading zero before the canonical PCF reproduces captured CRCs from standard initial state `FFFF`. |
| Direct TX | Replaying a captured original-controller OFF frame physically turned this lamp off, but normal web TX later became intermittent after idle. |
| Packet-engine TX | Sending a captured OFF payload physically turned the lamp off (`IRQ=20`, `FIFO=10`, `TX_DS=1`, `MAX_RT=0`). |
| Web Power | After switching learned nine-bit-PCF pairs to packet-engine TX, ON and OFF both physically changed the lamp. Both still worked after about ten minutes idle (`IRQ=2E`, `FIFO=11`, `TX_DS=1`). |
| Later TX/RX stall | Web ON/OFF later reported `IRQ=1F`, `FIFO=21`, `TX FAILED`; original-controller changes no longer updated `Lamp state`. Power-cycling only the bridge restored both. A firmware change now clears TX failure state and verifies FIFO flushing; immediate ON/OFF after flashing both worked with `IRQ=2E`, `FIFO=11`, `TX_DS=1`. |

The original address `9C EA BB 86` retains the existing direct-TX path. Its
previous validation is documented in [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md).
Chip `TX_DS` and FIFO flags describe local radio state; visible lamp behavior
was checked separately.

## Current limits

- The verified `B0 1E E8 E6` address, `CC88` CRC seed and nine-bit PCF format
  are installed on first boot and saved together in ESP32 flash. Later boots
  load the saved pair. Learning a different pair updates flash only after five
  matching CRC-seed observations. A hardware reset produced `HALO2 PAIRING
  RESTORED ADDRESS=B0 1E E8 E6 CRC_SEED=CC88 PCF_PREFIX_ZERO=1` without
  using the original controller. The same restored pair was logged after the
  FIFO recovery firmware was flashed, and web ON/OFF physically controlled
  the lamp without relearning.
- The learned pair's web Power ON/OFF was tested immediately and after roughly
  ten minutes idle before the later stall. The FIFO recovery change has only
  been tested immediately after flashing. Its longer-term effect and all other
  control entities on that pair have not been physically verified.
- The address finder uses a known rear-brightness/temperature pattern and five
  matching captures. Other Halo 2 controller/lamp pairs may need different
  capture settings or framing analysis.
- A successful local TX status alone is not proof of a lamp state change. The
  bridge cannot independently confirm every web command through one radio.

## Validation before publishing

- `python -m unittest discover -s tests -p 'test_*.py'` passed (9 tests).
- The standalone C++ address-learning test and ESPHome 2026.9.0 firmware
  compile passed. CI is pinned to the same ESPHome release.
- The compiled ESPHome firmware was written to the attached ESP32 over COM3 at
  115200 baud; the flash hash was verified. The higher 460800 baud attempt
  failed its connection check before the successful fallback.
- The pairing-persistence update was compiled and written over COM3 at 115200
  baud with flash hash verification; the next hardware reset loaded the saved
  pairing from ESP32 flash.

For the operating sequence and diagnostic buttons, see
[ADDRESS_LEARNING.md](ADDRESS_LEARNING.md).
