# Halo 2 address learning

This mode listens for the original controller without changing the verified
GPIO wiring. **Requires hardware
validation** on each controller/lamp pair. Finding five matching candidates is
evidence for a radio address, not proof that the lamp accepts TX.

## Radio path

The finder follows the capture technique in
[kuzmin-no's address finder](https://github.com/kuzmin-no/BenQ_ScreenBar_HALO_2_HA_integration/blob/main/src/find_halo2_address.py),
adapted to the existing C++ bit-banged SPI driver. It temporarily configures
the BM5602 as a passive fixed-width RX with:

| Setting | Learning RX |
|---|---|
| RF channel | 5 / 2405 MHz |
| Modulation/data rate | Existing BM5602 GFSK path, 125 kbps |
| Address length | 3 bytes, `DM1 = 0x42` |
| Matching address, register order | `55 0F 0A` |
| Captured FIFO width | 16 bytes |
| CRC and Auto-ACK | Disabled |
| TX | Disabled while learning |

The three-byte matching address corresponds to the **on-air** byte sequence
`0A 0F 55`: rear brightness 10 and color temperature 3925 K. It causes the
RX FIFO to capture the end of that controller request and the beginning of a
following repeated request. A one-bit right shift with carry aligns FIFO
bytes across the BM5602's 9-bit PCF boundary. The extractor checks the `AA`
preamble byte at offset 7 of that aligned capture and reverses the next four
bytes for the BM5602 register address. The configured width is 16 bytes, but
the reported FIFO length may differ, so 12–32 bytes are accepted when the
known offset is present. The `01 02` tail and next PCF are intentionally not
mandatory: their precise positions in this cross-packet capture have not yet
been verified on the target hardware. Five matching captures are required
before reporting an address.
With hardware CRC disabled, those FIFO bytes include the previous frame's CRC
and the following frame's visible bits; hardware CRC acceptance cannot be used
before the correct 4-byte address is known. Normal RX also leaves hardware CRC
off. It captures 14 FIFO bytes to recover the complete 13-byte frame from a
one-bit-shifted stream, including the final CRC bit. Five structurally valid
frames must agree on the CRC initial state before TX is enabled for a newly
learned address. That state also remains in RAM.

For example, `86 BB EA 9C` **on air** becomes `9C EA BB 86` **register order**.
Logs and the text sensor always show **register order**. Direct TX already
reverses that address when building its on-air bitstream and includes it in
the software CRC. A candidate needs five matching captures; noise candidates
are counted separately. The candidate and any applied address live in RAM.
Reboot restores the compiled `RADIO_ADDRESS` (`9C EA BB 86`).

The prior art confirms this particular 3-byte/16-byte capture approach, but
does not establish that every Halo 2 remote repeats frames with the same
spacing. Normal RX uses a 4-byte address and 14-byte FIFO capture with
software CRC validation; learning switches away from that configuration only
while its mode is active. [The transmission notes](IMPLEMENTATION_NOTES.md)
explain the direct and packet-engine TX paths.

## Flash and operate

1. Put `screenbar-halo2.yaml`, `bm5602_halo2.h`, and
   `halo2_address_learning.h` in the same ESPHome configuration directory.
2. Configure `secrets.yaml`, then run `esphome run screenbar-halo2.yaml` to
   compile, flash over USB, and watch the logs. OTA: `esphome run
   screenbar-halo2.yaml --device screenbar-halo2`.
3. In the web UI, press **Start address learning**. The radio status becomes
   `ADDRESS LEARNING RX=ON`. The log must also show `RFCH=5 DM1=42
   RXPW0=16 STA1_MODE=5 SYNC=55 0F 0A`. A `RX CONFIG ERROR` status means the chip did not
   read back the expected configuration; save that log before further tests.
4. With the original controller, turn the lamp on, set rear brightness to
   10%, and set color temperature to 3925 K. Operate the controller several
   times to generate repeated packets. Do not press bridge control buttons
   during learning.
5. Watch for five matching lines and then `HALO2 ADDRESS FOUND: XX XX XX XX
   [register order]`. The radio status text sensor shows `ADDRESS FOUND XX XX
   XX XX`. Starting ten seconds after entering learning mode, a log every ten
   seconds reports `RX captures` and `rejected`.
   Zero captures means the 3-byte sync was never matched; rising rejected
   counts mean the FIFO content failed the length or preamble checks. The first
   five captures are logged as `HALO2 ADDRESS SAMPLE len=... raw=...` for
   inspection. If no
   candidate appears, press **Cancel address learning** to restore normal RX
   and save the ESPHome log for debugging.
6. Press **Apply found address (RAM)**. This restores normal RX with the found
   address. The register readback should include `DM1=82 RXPW0=14` and the
   learned address. Operate the original controller until the log reports
   `HALO2 CRC SEED FOUND: XXXX` and `HALO2 TX FRAMING:
   PCF_PREFIX_ZERO=0/1`. Power control waits for this result.
   The first five received FIFO samples are logged as `HALO2 NORMAL RX SAMPLE`;
   ten-second `captures` and `rejected` counters distinguish no packets from
   packets that fail frame checks.
7. Press Power ON and Power OFF in the web UI. Observe whether the physical
   lamp responds. For a learned nine-bit PCF pair, Radio status reports
   `ON/OFF PACKET IRQ=... FIFO=... TX_DS` when the BM5602 packet engine sends
   successfully. For the original direct-TX pair, `sent` only means the local
   TBCLK-synchronized transmission completed. Physical lamp behavior is the
   final check for either path.
8. If a single Power command has no physical effect, leave the web UI at the
   desired state and press **Test power sync (02 + 04)**. This diagnostic sends
   command `02` once, then command `04` six times at 250 ms intervals, following
   the update/status sequence in the public
   [MicroPython implementation](https://github.com/kuzmin-no/BenQ_ScreenBar_HALO_2_HA_integration/blob/main/src/benq_halo/__init__.py).
   Logs show each `HALO2 TX PROBE` result with PCF/CRC for direct TX or
   IRQ/FIFO for packet-engine TX. Test while the
   original controller is asleep so its continuous requests do not obscure
   whether the lamp responds. This button does not make `sent` an ACK.
9. If the sync test fails, use **Replay captured remote OFF** to separate frame
   construction from direct RF transmission. After `CRC SEED FOUND`, turn the
   lamp off with the original controller until the log says
   `HALO2 REMOTE OFF CAPTURED` (an even-PID, CRC-valid command `02`). Turn the
   lamp back on with the original controller, let the controller sleep, then
   press **Replay captured remote OFF**. This sends the captured PCF, payload,
   and CRC unchanged through the direct TX path. If no command `02` was caught,
   the button reports `NO CAPTURED REMOTE OFF`; operate the original controller
   again. If the lamp stays on, try the four diagnostic buttons below in order,
   with the lamp on and the original controller asleep before each press:

   | Button | Frame / direct TX change |
   | --- | --- |
   | **Replay OFF new PCF** | Original OFF payload, a different even PCF, and recalculated CRC; tests whether the exact replay was ignored. |
   | **Replay OFF opposite edge** | Same payload and fresh PCF; change data on the other TBCLK edge. |
   | **Replay OFF inverted data** | Same payload and fresh PCF; invert the direct TX data pin. |
   | **Replay OFF opposite edge inverted** | Combine the other edge and inverted data. |

   Each log line includes `phase`, `invert`, `fresh`, the captured PCF, the
   transmitted PCF, and CRC. Stop when the lamp responds and save that log.
   `sent` only reports that the local TBCLK bit loop completed; a single-radio
   bridge cannot confirm that a valid RF packet left the module. If none of
   these variants works, an independent receiver or RF measurement is needed
   to distinguish a transmitter fault from a remaining air-frame mismatch.

## Intermittent TX after idle

If web Power and the exact captured OFF replay worked earlier but later fail
without a bridge reboot, leave the learned address in RAM. First try
**Test power sync (02 + 04)**, which repeats the desired state. If that still
fails, turn the lamp on with the original controller and test **Replay OFF
channel 46** and **Replay OFF channel 75** while channel 5 is failing. Each
test logs its RF channel and restores normal channel-5 RX afterwards. A lamp
response on only one alternate channel would point to a channel-selection
problem; the constants come from the public Halo 2 implementation and have
not been validated for every paired lamp.

**Test packet engine OFF** sends the captured OFF payload using the BM5602
packet engine with a generated nine-bit PCF, hardware CRC and Auto-ACK. It is
available only when a captured OFF frame and the nine-bit PCF format have
been confirmed. The log reports the chip's `TX_DS`, `MAX_RT`, FIFO status and
operation mode, plus the visible lamp response. These status flags are chip
observations; physical lamp behavior remains the final acceptance check.
On the tested `B0 1E E8 E6` pair, this button physically turned the lamp off
with `IRQ=20`, `STATUS=10`, `TX_DS=1`, and `MAX_RT=0`. Normal web control now
uses the packet engine after nine-bit framing is learned; the original address
retains direct TX. Verify web ON/OFF and operation after idle on each pair.

Expected candidate log:

```text
HALO2 ADDRESS CANDIDATE: 9C EA BB 86 (1/5) [register order]
...
HALO2 ADDRESS CANDIDATE: 9C EA BB 86 (5/5) [register order]
HALO2 ADDRESS FOUND: 9C EA BB 86 [register order]
```

The `B0 1E E8 E6` pair has now been checked with the 14-byte normal FIFO
capture, learned CRC and PCF framing, original-controller OFF replay, and
visible web Power ON/OFF. Other pairs still require hardware validation. No
address or CRC seed is saved to NVS or permanently written into the source.

On one tested controller, five captures yielded register-order address
`B0 1E E8 E6`. Subsequent captures showed that normal RX was receiving frames
but the old parser read the FIFO one bit out of alignment. With payload
`04 09 16 0F 55 0A 0F 55 01 02`, initial state `CC88` reproduces four
captured controller CRCs exactly: PCF `52 -> CE90`, `54 -> 3F64`,
`56 -> 9FD7`, and `50 -> 6E23`. The earlier inference from two CRCs
(`2835`/`8886`) was underdetermined because the complete payload was unknown;
it must not be used to assume the old `EFDF` initial state works for every
controller. More complete analysis shows that `CC88` is the effective seed of
an eight-bit PCF model: inserting one zero bit between the on-air address and
canonical PCF reproduces all four CRCs directly from `FFFF`. The captured
remote OFF frame (`PCF=54`, `CONTROL=08`, `CRC=A7F8`) also matches that
nine-bit model. The firmware detects this format from the learned frame and
adds the missing bit in direct TX. On the tested pair, the original-controller
OFF frame (`PCF=52`, `CMD=02`, `CONTROL=08`, `CRC=560C`) was captured and then
replayed with `PCF_PREFIX_ZERO=1`; the physical lamp turned off. The subsequent
web Power ON (`PCF=52`, `CRC=BD2F`) and Power OFF (`PCF=54`, `CRC=A7F8`) both
changed the lamp as requested.
