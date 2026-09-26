#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace bm5602_halo2 {

// The learning receiver matches the known on-air sequence 0A 0F 55 in a
// controller request. Its fixed-width capture then spans the request tail
// and the start of the next repeated request. The BM5602 FIFO is shifted one
// bit relative to the direct-mode byte stream.
constexpr std::array<uint8_t, 3> LEARNING_SYNC{0x55, 0x0F, 0x0A}; // register order
constexpr uint8_t ADDRESS_VOTES_REQUIRED = 5;
constexpr uint8_t CRC_SEED_VOTES_REQUIRED = 5;

struct AddressCandidate {
  std::array<uint8_t, 4> register_order{};
  bool valid = false;
};

inline AddressCandidate extract_address_candidate(const uint8_t *raw, size_t length) {
  AddressCandidate result;
  // PKT4 reports received FIFO bytes, which need not equal the configured
  // fixed width on every capture. The sync/preamble/address window needs 12.
  if (raw == nullptr || length < 12 || length > 32) return result;
  std::array<uint8_t, 32> aligned{};
  for (size_t i = 0; i < length; ++i) {
    aligned[i] = static_cast<uint8_t>((raw[i] >> 1U) |
        (i ? (raw[i - 1] & 1U) << 7U : 0U));
  }
  // Only the preamble byte at offset 7 is established by the prior capture
  // method. The earlier tail and later PCF positions need hardware evidence.
  if (aligned[7] != 0xAA) return result;
  for (size_t i = 0; i < 4; ++i) result.register_order[i] = aligned[11 - i];
  result.valid = true;
  return result;
}

class AddressVotes {
 public:
  struct Result {
    std::array<uint8_t, 4> address{};
    uint8_t votes = 0;
    bool found = false;
    bool accepted = false;
  };

  void reset() { entries_ = {}; found_ = false; found_address_ = {}; }

  Result add(const AddressCandidate &candidate) {
    Result result;
    if (!candidate.valid || found_) return result;
    size_t slot = entries_.size();
    for (size_t i = 0; i < entries_.size(); ++i) {
      if (entries_[i].votes && entries_[i].address == candidate.register_order) {
        slot = i;
        break;
      }
    }
    if (slot == entries_.size()) {
      for (size_t i = 0; i < entries_.size(); ++i) {
        if (!entries_[i].votes) { slot = i; break; }
      }
    }
    if (slot == entries_.size()) return result; // ignore excess noise candidates
    auto &entry = entries_[slot];
    entry.address = candidate.register_order;
    if (entry.votes < ADDRESS_VOTES_REQUIRED) ++entry.votes;
    result.address = entry.address;
    result.votes = entry.votes;
    result.accepted = true;
    if (entry.votes == ADDRESS_VOTES_REQUIRED) {
      found_ = true;
      found_address_ = entry.address;
      result.found = true;
    }
    return result;
  }

  bool found() const { return found_; }
  const std::array<uint8_t, 4> &address() const { return found_address_; }

 private:
  struct Entry {
    std::array<uint8_t, 4> address{};
    uint8_t votes = 0;
  };
  std::array<Entry, 8> entries_{};
  bool found_ = false;
  std::array<uint8_t, 4> found_address_{};
};

// Normal 4-byte-address RX starts one bit before the canonical PCF byte.
// Fourteen FIFO bytes are needed to recover all 13 frame bytes, including
// the last CRC bit in raw[13]'s high bit.
inline bool align_normal_rx(const uint8_t *raw, size_t length,
                            std::array<uint8_t, 13> &frame) {
  if (raw == nullptr || length != 14) return false;
  for (size_t i = 0; i < frame.size(); ++i) {
    frame[i] = static_cast<uint8_t>((raw[i] << 1U) | (raw[i + 1] >> 7U));
  }
  return true;
}

// Inverse of one CRC-CCITT byte update. Forward order is on-air address,
// PCF, then the ten application bytes; reverse in the opposite order.
inline uint16_t reverse_crc_byte(uint16_t crc, uint8_t byte) {
  for (int bit = 0; bit < 8; ++bit) {
    const bool high = (crc & 1U) != 0;
    crc = static_cast<uint16_t>(((crc ^ (high ? 0x1021U : 0U)) >> 1U) |
                                (high ? 0x8000U : 0U));
  }
  return static_cast<uint16_t>(crc ^ (static_cast<uint16_t>(byte) << 8U));
}

inline uint16_t recover_crc_seed(uint16_t received_crc,
                                 const std::array<uint8_t, 4> &register_address,
                                 uint8_t pcf, const uint8_t *payload,
                                 size_t payload_length) {
  uint16_t crc = received_crc;
  for (size_t i = payload_length; i > 0; --i)
    crc = reverse_crc_byte(crc, payload[i - 1]);
  crc = reverse_crc_byte(crc, pcf);
  for (uint8_t byte : register_address) crc = reverse_crc_byte(crc, byte);
  return crc;
}

// Some controllers send one zero bit between the address and the eight
// canonical PCF bits. Their CRC is the ordinary CRC-CCITT stream with 0xFFFF
// initialization, including that extra bit. This is independent of the
// pair-specific seed recovered by the legacy eight-bit representation.
inline uint16_t crc_with_zero_before_pcf(
    const std::array<uint8_t, 4> &register_address, uint8_t pcf,
    const uint8_t *payload, size_t payload_length) {
  uint16_t crc = 0xFFFF;
  const auto feed_bit = [&crc](uint8_t bit) {
    const bool high = ((crc >> 15U) ^ bit) & 1U;
    crc = static_cast<uint16_t>((crc << 1U) ^ (high ? 0x1021U : 0U));
  };
  const auto feed_byte = [&feed_bit](uint8_t byte) {
    for (int bit = 7; bit >= 0; --bit) feed_bit((byte >> bit) & 1U);
  };
  for (size_t i = register_address.size(); i > 0; --i)
    feed_byte(register_address[i - 1]);
  feed_bit(0);
  feed_byte(pcf);
  for (size_t i = 0; i < payload_length; ++i) feed_byte(payload[i]);
  return crc;
}

class CrcSeedVotes {
 public:
  struct Result {
    uint16_t seed = 0;
    uint8_t votes = 0;
    bool found = false;
    bool accepted = false;
  };

  void reset() { entries_ = {}; found_ = false; found_seed_ = 0; }

  Result add(uint16_t seed) {
    Result result;
    if (found_) return result;
    size_t slot = entries_.size();
    for (size_t i = 0; i < entries_.size(); ++i) {
      if (entries_[i].votes && entries_[i].seed == seed) { slot = i; break; }
    }
    if (slot == entries_.size()) {
      for (size_t i = 0; i < entries_.size(); ++i) {
        if (!entries_[i].votes) { slot = i; break; }
      }
    }
    if (slot == entries_.size()) return result;
    auto &entry = entries_[slot];
    entry.seed = seed;
    if (entry.votes < CRC_SEED_VOTES_REQUIRED) ++entry.votes;
    result.seed = seed;
    result.votes = entry.votes;
    result.accepted = true;
    if (entry.votes == CRC_SEED_VOTES_REQUIRED) {
      found_ = true;
      found_seed_ = seed;
      result.found = true;
    }
    return result;
  }

  bool found() const { return found_; }
  uint16_t seed() const { return found_seed_; }

 private:
  struct Entry { uint16_t seed = 0; uint8_t votes = 0; };
  std::array<Entry, 8> entries_{};
  bool found_ = false;
  uint16_t found_seed_ = 0;
};

} // namespace bm5602_halo2
