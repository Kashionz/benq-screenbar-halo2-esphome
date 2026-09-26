# Wiring

## BCT-5602-001 / BM5602-60-1 to M5Stack ATOM Lite

Use the module pin numbers printed on the BCT-5602-001 board. Older diagrams in
this repository used a different pin numbering convention and are not the
reference for this module.

| BCT-5602-001 signal | Pin | M5Stack ATOM Lite |
|---|---:|---|
| GND | 1 | GND |
| VCC | 2 | 3V3 |
| CSN | 4 | GPIO22 |
| SCK | 5 | GPIO23 |
| MOSI / SDIO | 6 | GPIO19 |
| GIO2 / SPI SDO / direct TX data | 8 | GPIO33 |
| GIO3 / TBCLK | 9 | GPIO25 |

Pin 7 (MISO) is not connected. Supply voltage is 3.3 V. Do not move GPIO33 to
pin 7: the verified firmware selects GIO2 as SPI SDO during register access and
as direct TX data during transmission.
