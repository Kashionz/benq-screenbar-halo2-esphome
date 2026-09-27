#pragma once

#include <array>
#include <cstdint>

namespace bm5602_halo2 {

struct PairingConfig {
  std::array<uint8_t, 4> address;
  uint16_t crc_seed;
  bool pcf_prefix_zero;
};

// This pair was verified on the lamp used for this fork. It is written to
// flash on the first boot after an update, before the original remote is needed.
constexpr PairingConfig VERIFIED_PAIRING{{0xB0, 0x1E, 0xE8, 0xE6}, 0xCC88, true};

// One versioned 64-bit preference keeps the address, CRC seed and framing
// flag together. The preference backend provides its own integrity check.
constexpr uint8_t PAIRING_RECORD_VERSION = 0xA1;
constexpr uint32_t PAIRING_PREFERENCE_KEY = 0x48414C32; // "HAL2"

constexpr uint64_t encode_pairing(const PairingConfig &pairing) {
  return (static_cast<uint64_t>(PAIRING_RECORD_VERSION) << 56U) |
         (static_cast<uint64_t>(pairing.pcf_prefix_zero ? 1U : 0U) << 48U) |
         (static_cast<uint64_t>(pairing.crc_seed) << 32U) |
         (static_cast<uint64_t>(pairing.address[0]) << 24U) |
         (static_cast<uint64_t>(pairing.address[1]) << 16U) |
         (static_cast<uint64_t>(pairing.address[2]) << 8U) |
         static_cast<uint64_t>(pairing.address[3]);
}

inline bool decode_pairing(uint64_t record, PairingConfig &pairing) {
  if ((record >> 56U) != PAIRING_RECORD_VERSION ||
      ((record >> 48U) & 0xFFU) > 1U) return false;
  pairing.address = {
      static_cast<uint8_t>(record >> 24U),
      static_cast<uint8_t>(record >> 16U),
      static_cast<uint8_t>(record >> 8U),
      static_cast<uint8_t>(record)};
  pairing.crc_seed = static_cast<uint16_t>(record >> 32U);
  pairing.pcf_prefix_zero = ((record >> 48U) & 1U) != 0;
  return true;
}

} // namespace bm5602_halo2
