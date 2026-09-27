# Project status (2026-09-27)

This document records what was observed on hardware during development of the
Halo 2 ESPHome bridge. It distinguishes a transmitted packet from a visible
lamp response. The project is a personal fork of
[Termina1/benq-screenbar-halo2-esphome](https://github.com/Termina1/benq-screenbar-halo2-esphome).

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
